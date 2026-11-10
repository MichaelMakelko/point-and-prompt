// Service worker: toggles the overlay, takes the screenshot and talks to the local channel server.

// Same range as BASE_PORT / PORT_RANGE in server/src/http.ts: every session takes the first free port.
const BASE_PORT = 7428;
const PORT_RANGE = 20;
const HEALTH_TIMEOUT_MS = 600;
const CROP_PADDING = 8;
const UNREACHABLE = "Server nicht erreichbar. Läuft Claude Code mit dem Channel-Flag?";

async function toggle(tab) {
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "pnp:toggle" });
    await chrome.action.setBadgeText({ tabId: tab.id, text: "" });
  } catch (error) {
    // No content script means the tab is not a localhost page (or was open before install).
    console.warn("[point-and-prompt] Toggle fehlgeschlagen:", error);
    await chrome.action.setBadgeText({ tabId: tab.id, text: "!" });
    await chrome.action.setTitle({
      tabId: tab.id,
      title: "point-and-prompt läuft nur auf http://localhost und http://127.0.0.1. Seite neu laden, falls sie vor der Installation offen war.",
    });
  }
}

chrome.action.onClicked.addListener(toggle);
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "toggle-overlay") toggle(tab);
});

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function captureCrop(windowId, rect, dpr) {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());

  const x = Math.max(0, Math.floor((rect.x - CROP_PADDING) * dpr));
  const y = Math.max(0, Math.floor((rect.y - CROP_PADDING) * dpr));
  const right = Math.min(bitmap.width, Math.ceil((rect.x + rect.width + CROP_PADDING) * dpr));
  const bottom = Math.min(bitmap.height, Math.ceil((rect.y + rect.height + CROP_PADDING) * dpr));
  const width = right - x;
  const height = bottom - y;
  if (width <= 0 || height <= 0) throw new Error("Auswahl liegt außerhalb des sichtbaren Bereichs");

  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext("2d").drawImage(bitmap, x, y, width, height, 0, 0, width, height);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return `data:image/png;base64,${toBase64(await blob.arrayBuffer())}`;
}

async function readError(res) {
  try {
    const body = await res.json();
    return body.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/** All running point-and-prompt sessions. A closed port just means no session there, so it is skipped. */
async function sessions() {
  const ports = Array.from({ length: PORT_RANGE }, (_, i) => BASE_PORT + i);
  const found = await Promise.all(
    ports.map(async (port) => {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`, {
          method: "POST",
          signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
        });
        if (!res.ok) return null;
        const body = await res.json();
        return body.name === "point-and-prompt" ? { port, cwd: body.cwd, project: body.project } : null;
      } catch {
        return null;
      }
    }),
  );
  return found.filter(Boolean);
}

async function send(payload, target, sender) {
  // The port ends up in a URL, so it must be a number from our range and nothing else.
  const port = Number(target?.port);
  if (!Number.isInteger(port) || port < BASE_PORT || port >= BASE_PORT + PORT_RANGE || typeof target.cwd !== "string") {
    return { ok: false, stale: true, error: "Ungültige Session. Session neu wählen." };
  }

  let screenshot;
  let screenshotError;
  try {
    screenshot = await captureCrop(sender.tab.windowId, payload.rect, payload.dpr);
  } catch (error) {
    screenshotError = error instanceof Error ? error.message : String(error);
  }

  const body = { ...payload, screenshot };
  delete body.dpr;

  let res;
  try {
    res = await fetch(`http://127.0.0.1:${port}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Pnp-Target": encodeURIComponent(target.cwd) },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, stale: true, error: `${target.project}: ${UNREACHABLE}` };
  }
  // 409: the port now belongs to another session, so the overlay has to refresh its list.
  if (!res.ok) return { ok: false, stale: res.status === 409, error: await readError(res) };
  const { project } = await res.json();
  return { ok: true, project, warning: screenshotError ? `Ohne Screenshot gesendet: ${screenshotError}` : undefined };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "pnp:sessions") {
    sessions().then(sendResponse);
    return true;
  }
  if (message?.type === "pnp:send") {
    send(message.payload, message.target, sender).then(sendResponse, (error) =>
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
    );
    return true;
  }
  return false;
});
