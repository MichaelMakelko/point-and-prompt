import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { PayloadError, parseSelection, type Selection } from "./payload.ts";

/** Fixed by the "key" field in extension/manifest.json. */
export const DEFAULT_EXTENSION_ID = "moeaooemoikililkakdldlamlgcebpll";
/** Each session takes the first free port in this range; the extension scans the same range. */
export const BASE_PORT = 7428;
export const PORT_RANGE = 20;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface HttpOptions {
  extensionId: string;
  /** Project folder of this session; the extension names the session it means by this path. */
  cwd?: string;
  imageDir?: string;
  onSelection: (selection: Selection, imagePath: string | undefined) => Promise<void>;
}

function send(res: ServerResponse, status: number, body: unknown, origin?: string): void {
  const headers: Record<string, string> = { "Content-Type": "application/json; charset=utf-8" };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, X-Pnp-Target";
    headers["Vary"] = "Origin";
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new PayloadError("Anfrage ist größer als 8 MB");
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function saveScreenshot(dataUrl: string, dir: string): Promise<string> {
  const data = Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
  if (!data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) throw new PayloadError("screenshot ist kein PNG");
  // Owner-only: the temp folder is shared between users on Linux, and screenshots show the user's page.
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.png`);
  await writeFile(path, data, { mode: 0o600 });
  return path;
}

/**
 * Local endpoint for the Chrome extension. Only requests carrying the extension's origin are
 * accepted: web pages cannot forge the Origin header, so a random site cannot inject prompts.
 */
export function createHttpServer(options: HttpOptions): Server {
  const allowedOrigin = `chrome-extension://${options.extensionId}`;
  const imageDir = options.imageDir ?? join(tmpdir(), "point-and-prompt");
  const cwd = options.cwd ?? process.cwd();
  const info = { name: "point-and-prompt", cwd, project: basename(cwd) };

  return createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin !== allowedOrigin) {
      send(res, 403, { ok: false, error: "Nur die point-and-prompt-Extension darf hier senden" });
      return;
    }

    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, X-Pnp-Target",
        });
        res.end();
        return;
      }

      // POST, not GET: Chrome omits the Origin header on GET requests from the extension's service worker.
      if (req.method === "POST" && req.url === "/health") {
        send(res, 200, { ok: true, ...info }, origin);
        return;
      }

      if (req.method === "POST" && req.url === "/prompt") {
        // Ports are reused after restarts, so the extension says which project it means.
        const target = req.headers["x-pnp-target"];
        if (target !== encodeURIComponent(cwd)) {
          send(res, 409, { ok: false, error: `Auf diesem Port läuft jetzt ${info.project}. Session neu wählen.` }, origin);
          return;
        }
        if (!req.headers["content-type"]?.startsWith("application/json")) {
          throw new PayloadError("Content-Type muss application/json sein");
        }
        const raw = await readBody(req);
        let json: unknown;
        try {
          json = JSON.parse(raw);
        } catch {
          throw new PayloadError("Body ist kein gültiges JSON");
        }
        const selection = parseSelection(json);
        const imagePath = selection.screenshot ? await saveScreenshot(selection.screenshot, imageDir) : undefined;
        await options.onSelection(selection, imagePath);
        send(res, 200, { ok: true, project: info.project }, origin);
        return;
      }

      send(res, 404, { ok: false, error: "Unbekannter Pfad" }, origin);
    } catch (error) {
      if (error instanceof PayloadError) {
        send(res, 400, { ok: false, error: error.message }, origin);
        return;
      }
      console.error("[point-and-prompt] Fehler bei Anfrage:", error);
      send(res, 500, { ok: false, error: "Interner Fehler im point-and-prompt-Server" }, origin);
    }
  });
}
