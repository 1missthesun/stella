const URL_IMAGE_PROVIDERS = new Set(["openai", "anthropic", "openrouter", "xai"]);

const URL_IMAGE_HOSTS = new Set(["api.openai.com", "api.anthropic.com", "openrouter.ai", "api.x.ai"]);

export const providerFetchesImageUrls = (provider: string): boolean => URL_IMAGE_PROVIDERS.has(provider);

export const hostFetchesImageUrls = (host: string): boolean => URL_IMAGE_HOSTS.has(host.toLowerCase());

const STORED_IMAGE_PATH = "/conversation-images/";
const FETCH_TIMEOUT_MS = 20_000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const BLANK_GIF = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

export const mayCarryStoredImages = (text: string): boolean => text.includes("conversation-images");

const isStoredImageUrl = (value: string, backendOrigin: string | undefined): boolean => {
  if (!value.startsWith("https://")) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (!url.pathname.includes(STORED_IMAGE_PATH)) return false;
  if (url.hostname.endsWith(".r2.cloudflarestorage.com")) return url.searchParams.has("X-Amz-Signature");
  if (!backendOrigin) return false;
  try {
    return url.origin === new URL(backendOrigin).origin && url.pathname.startsWith("/api/r2/");
  } catch {
    return false;
  }
};

type Inlined = { mimeType: string; data: string };

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
};

export const inlineStoredImages = async <T>(
  json: T,
  options: { fetch: typeof fetch; backendOrigin?: string },
): Promise<{ json: T; inlined: number; failed: number }> => {
  let inlined = 0;
  let failed = 0;
  const read = async (url: string): Promise<Inlined> => {
    try {
      const response = await options.fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`status ${response.status}`);
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) throw new Error("too large");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("too large");
      const mimeType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim() || "image/jpeg";
      inlined += 1;
      return { mimeType, data: toBase64(bytes) };
    } catch {
      failed += 1;
      return { mimeType: "image/gif", data: BLANK_GIF };
    }
  };
  const stored = (value: unknown): value is string =>
    typeof value === "string" && isStoredImageUrl(value, options.backendOrigin);
  const walk = async (value: unknown): Promise<unknown> => {
    if (Array.isArray(value)) {
      let changed = false;
      const out: unknown[] = [];
      for (const item of value) {
        const next = await walk(item);
        if (next !== item) changed = true;
        out.push(next);
      }
      return changed ? out : value;
    }
    if (!value || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    if (record.type === "url" && stored(record.url)) {
      const image = await read(record.url);
      return { type: "base64", media_type: image.mimeType, data: image.data };
    }
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) {
      let next: unknown;
      if ((key === "url" || key === "image_url") && stored(item)) {
        const image = await read(item);
        next = `data:${image.mimeType};base64,${image.data}`;
      } else {
        next = await walk(item);
      }
      if (next !== item) changed = true;
      out[key] = next;
    }
    return changed ? out : value;
  };
  const next = (await walk(json)) as T;
  return { json: next, inlined, failed };
};
