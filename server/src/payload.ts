/** Shape and validation of what the Chrome extension posts to /prompt. */

export type Mode = "element" | "box";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoxElement {
  selector: string;
  text: string;
}

export interface Selection {
  mode: Mode;
  prompt: string;
  url: string;
  title: string;
  rect: Rect;
  selector?: string;
  text?: string;
  html?: string;
  elements?: BoxElement[];
  /** PNG as data URL, cropped to the selection. */
  screenshot?: string;
}

export const LIMITS = {
  prompt: 4000,
  url: 2000,
  title: 300,
  selector: 500,
  text: 4000,
  html: 6000,
  elements: 40,
  elementText: 300,
} as const;

export class PayloadError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, field: string, max: number, required: boolean): string | undefined {
  if (value === undefined || value === null || value === "") {
    if (required) throw new PayloadError(`${field} fehlt`);
    return undefined;
  }
  if (typeof value !== "string") throw new PayloadError(`${field} muss Text sein`);
  // Long page text is cut instead of rejected; the user should not lose a prompt over a big DOM.
  return value.length > max ? `${value.slice(0, max)} …[gekürzt]` : value;
}

function num(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new PayloadError(`${field} muss eine Zahl sein`);
  return Math.round(value);
}

export function parseSelection(body: unknown): Selection {
  if (!isRecord(body)) throw new PayloadError("Body muss ein JSON-Objekt sein");

  const mode = body.mode;
  if (mode !== "element" && mode !== "box") throw new PayloadError("mode muss element oder box sein");

  const prompt = str(body.prompt, "prompt", LIMITS.prompt, true)!;
  if (prompt.trim() === "") throw new PayloadError("prompt ist leer");

  const url = str(body.url, "url", LIMITS.url, true)!;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new PayloadError("url ist ungültig");
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new PayloadError("url muss http oder https sein");
  }

  if (!isRecord(body.rect)) throw new PayloadError("rect fehlt");
  const rect: Rect = {
    x: num(body.rect.x, "rect.x"),
    y: num(body.rect.y, "rect.y"),
    width: num(body.rect.width, "rect.width"),
    height: num(body.rect.height, "rect.height"),
  };

  let elements: BoxElement[] | undefined;
  if (body.elements !== undefined) {
    if (!Array.isArray(body.elements)) throw new PayloadError("elements muss eine Liste sein");
    elements = body.elements.slice(0, LIMITS.elements).map((item, i) => {
      if (!isRecord(item)) throw new PayloadError(`elements[${i}] ist ungültig`);
      return {
        selector: str(item.selector, `elements[${i}].selector`, LIMITS.selector, true)!,
        text: str(item.text, `elements[${i}].text`, LIMITS.elementText, false) ?? "",
      };
    });
  }

  let screenshot: string | undefined;
  if (body.screenshot !== undefined) {
    if (typeof body.screenshot !== "string" || !body.screenshot.startsWith("data:image/png;base64,")) {
      throw new PayloadError("screenshot muss ein PNG-Data-URL sein");
    }
    screenshot = body.screenshot;
  }

  return {
    mode,
    prompt,
    // Normalized form: no raw line breaks or quotes, because the URL is shown outside the fenced page content.
    url: parsedUrl.href,
    title: str(body.title, "title", LIMITS.title, false) ?? "",
    rect,
    selector: str(body.selector, "selector", LIMITS.selector, false),
    text: str(body.text, "text", LIMITS.text, false),
    html: str(body.html, "html", LIMITS.html, false),
    elements,
    screenshot,
  };
}
