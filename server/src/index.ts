#!/usr/bin/env node
import type { Server } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BASE_PORT, createHttpServer, DEFAULT_EXTENSION_ID, PORT_RANGE } from "./http.ts";
import { formatMessage, INSTRUCTIONS } from "./format.ts";
import { hasChannelFlag, parentCommandLine } from "./channel.ts";

const SERVER_NAME = "point-and-prompt";

// stdout belongs to the MCP protocol; all logging goes to stderr.
const log = (...args: unknown[]) => console.error(`[${SERVER_NAME}]`, ...args);

const basePort = Number(process.env.PNP_PORT ?? BASE_PORT);
if (!Number.isInteger(basePort) || basePort < 1 || basePort + PORT_RANGE - 1 > 65535) {
  log(`PNP_PORT ist ungültig: ${process.env.PNP_PORT}`);
  process.exit(1);
}
const extensionId = process.env.PNP_EXTENSION_ID ?? DEFAULT_EXTENSION_ID;

const mcp = new McpServer(
  { name: SERVER_NAME, version: "0.1.0" },
  {
    capabilities: { experimental: { "claude/channel": {} } },
    instructions: INSTRUCTIONS,
  },
);

async function notify(content: string, meta: Record<string, string>): Promise<void> {
  await mcp.server.notification({ method: "notifications/claude/channel", params: { content, meta } });
}

await mcp.connect(new StdioServerTransport());

/** Sessions started without the channel flag drop our events silently, so they must stay invisible to the extension. */
async function channelEnabled(): Promise<boolean> {
  if (process.env.PNP_SKIP_FLAG_CHECK === "1") return true;
  try {
    return hasChannelFlag(await parentCommandLine(), SERVER_NAME);
  } catch (error) {
    log("Startzeile von Claude Code nicht lesbar, bleibe inaktiv. PNP_SKIP_FLAG_CHECK=1 überspringt die Prüfung.", error);
    return false;
  }
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

let http: Server | undefined;

if (await channelEnabled()) {
  const server = createHttpServer({
    extensionId,
    onSelection: async (selection, imagePath) => {
      const meta: Record<string, string> = { mode: selection.mode, url: selection.url };
      if (imagePath) meta.image = imagePath;
      await notify(formatMessage(selection, imagePath), meta);
      log(`Auswahl (${selection.mode}) von ${selection.url} weitergegeben`);
    },
  });

  let port: number | undefined;
  for (let p = basePort; p < basePort + PORT_RANGE && port === undefined; p++) {
    try {
      await listen(server, p);
      port = p;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") continue;
      throw error;
    }
  }

  if (port === undefined) {
    const reason = `Alle Ports ${basePort}–${basePort + PORT_RANGE - 1} sind belegt. Schließe eine andere point-and-prompt-Session.`;
    log(reason);
    await notify(`point-and-prompt ist in dieser Session nicht aktiv. ${reason}`, { status: "error" });
  } else {
    http = server;
    log(`Wartet auf http://127.0.0.1:${port}`);
  }
} else {
  log("Session läuft ohne Channel-Flag, kein Port geöffnet.");
}

const shutdown = () => {
  http?.close();
  process.exit(0);
};
process.stdin.on("close", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
