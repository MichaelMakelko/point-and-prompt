import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { chmod, lstat, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { PayloadError, parseSelection, SCREENSHOT_PREFIX, type Selection } from "./payload.ts";

/** Name of the MCP server and of the screenshot folder, and the name the extension looks for in /health. */
export const SERVER_NAME = "point-and-prompt";
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

function send(res: ServerResponse, status: number, body: unknown, cors?: Record<string, string>): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...cors });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    // Past the limit the rest is still read, but thrown away. Stopping here would reset the connection
    // while the extension is still sending, and the user would see "not reachable" instead of the reason.
    if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    else chunks.length = 0;
  }
  if (size > MAX_BODY_BYTES) throw new PayloadError("Anfrage ist größer als 8 MB. Wähle einen kleineren Bereich.", 413);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Owner-only folder: the temp folder is shared between users on Linux, and screenshots show the user's page.
 * A folder that belongs to someone else is refused, because its owner could swap a screenshot before Claude reads it.
 */
async function prepareImageDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // Windows has no user ids; its temp folder already belongs to one user.
  const uid = process.getuid?.();
  if (uid === undefined) return;
  const stats = await lstat(dir);
  if (!stats.isDirectory() || stats.uid !== uid) {
    throw new Error(`Screenshot-Ordner ${dir} ist kein eigener Ordner dieses Nutzers`);
  }
  if ((stats.mode & 0o077) !== 0) await chmod(dir, 0o700);
}

async function saveScreenshot(dataUrl: string, dir: string): Promise<string> {
  const data = Buffer.from(dataUrl.slice(SCREENSHOT_PREFIX.length), "base64");
  if (!data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) throw new PayloadError("screenshot ist kein PNG");
  await prepareImageDir(dir);
  const path = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.png`);
  // wx: only ever create a new file, never write through one that is already there.
  await writeFile(path, data, { mode: 0o600, flag: "wx" });
  return path;
}

/**
 * Local endpoint for the Chrome extension. Only requests carrying the extension's origin are
 * accepted: web pages cannot forge the Origin header, so a random site cannot inject prompts.
 */
export function createHttpServer(options: HttpOptions): Server {
  const allowedOrigin = `chrome-extension://${options.extensionId}`;
  const imageDir = options.imageDir ?? join(tmpdir(), SERVER_NAME);
  const cwd = options.cwd ?? process.cwd();
  const info = { name: SERVER_NAME, cwd, project: basename(cwd) };
  const target = encodeURIComponent(cwd);
  const cors = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Pnp-Target",
    Vary: "Origin",
  };

  return createServer(async (req, res) => {
    if (req.headers.origin !== allowedOrigin) {
      send(res, 403, { ok: false, error: "Nur die point-and-prompt-Extension darf hier senden" });
      return;
    }

    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, cors).end();
        return;
      }

      // POST, not GET: Chrome omits the Origin header on GET requests from the extension's service worker.
      if (req.method === "POST" && req.url === "/health") {
        send(res, 200, { ok: true, ...info }, cors);
        return;
      }

      if (req.method === "POST" && req.url === "/prompt") {
        // Ports are reused after restarts, so the extension says which project it means.
        if (req.headers["x-pnp-target"] !== target) {
          send(res, 409, { ok: false, error: `Auf diesem Port läuft jetzt ${info.project}. Session neu wählen.` }, cors);
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
        send(res, 200, { ok: true, project: info.project }, cors);
        return;
      }

      send(res, 404, { ok: false, error: "Unbekannter Pfad" }, cors);
    } catch (error) {
      if (error instanceof PayloadError) {
        send(res, error.status, { ok: false, error: error.message }, cors);
        return;
      }
      console.error(`[${SERVER_NAME}] Fehler bei Anfrage:`, error);
      send(res, 500, { ok: false, error: "Interner Fehler im point-and-prompt-Server" }, cors);
    }
  });
}
