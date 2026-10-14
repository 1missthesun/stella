export const MAX_FETCH_BODY_CHARS = 80_000;
export const FETCH_TIMEOUT_MS = 30_000;
export const MAX_FETCH_REDIRECTS = 5;

export const MAX_FETCH_BODY_BYTES = 8 * 1024 * 1024;

const readCappedText = async (response: Response): Promise<string> => {
  const contentLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_FETCH_BODY_BYTES
  ) {
    await response.body?.cancel("response byte limit exceeded").catch(() => undefined);
    throw new Error("Response exceeded the safe byte limit.");
  }
  const body = response.body;
  if (!body) return response.text();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = MAX_FETCH_BODY_BYTES - total;
      if (remaining <= 0) break;
      const accepted = Math.min(value.byteLength, remaining);
      chunks.push(
        accepted === value.byteLength ? value : value.slice(0, accepted),
      );
      total += accepted;
      if (accepted < value.byteLength || total >= MAX_FETCH_BODY_BYTES) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk.subarray(0, Math.min(chunk.byteLength, total - offset)), offset);
    offset += chunk.byteLength;
    if (offset >= total) break;
  }
  return new TextDecoder().decode(joined);
};

const htmlToText = (html: string): string => {
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<(?:br|p|div|li|h[1-6]|tr)[^>]*>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "");
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
};

export type WebFetchCoreOptions = {
  guardUrl: (url: string) => Promise<string>;
  checkSecretLikeToken?: (url: string) => boolean;
  sanitize?: (text: string) => string;
  userAgent?: string;
  signal?: AbortSignal;
};

export const fetchReadableText = async (
  args: { url: string; prompt?: string },
  options: WebFetchCoreOptions,
): Promise<string> => {
  const sanitize = options.sanitize ?? ((text: string) => text);
  if (!args.url) return "Error: URL is required.";
  if (options.checkSecretLikeToken?.(args.url)) {
    return "Error: URL contains what appears to be an API key or token. Secrets must not be sent in URLs.";
  }

  const timeoutSignal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const requestSignal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;

  try {
    let targetUrl = await options.guardUrl(args.url);

    let response: Response | null = null;
    for (
      let redirectCount = 0;
      redirectCount <= MAX_FETCH_REDIRECTS;
      redirectCount += 1
    ) {
      response = await fetch(targetUrl, {
        signal: requestSignal,
        redirect: "manual",
        headers: {
          "User-Agent": options.userAgent ?? "Stella/1.0",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
        },
      });

      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        targetUrl = await options.guardUrl(
          new URL(location, targetUrl).toString(),
        );
        continue;
      }

      break;
    }
    if (!response) {
      return "Error: No response received.";
    }
    if (
      response.status >= 300 &&
      response.status < 400 &&
      response.headers.get("location")
    ) {
      return `Error: Too many redirects (limit ${MAX_FETCH_REDIRECTS})`;
    }

    if (!response.ok) {
      return `Error: HTTP ${response.status} ${response.statusText}`;
    }

    const contentType = response.headers.get("content-type") ?? "";
    const rawBody = await readCappedText(response);

    let text: string;
    if (
      contentType.includes("text/html") ||
      contentType.includes("application/xhtml")
    ) {
      text = htmlToText(rawBody);
    } else {
      text = rawBody;
    }

    if (text.length > MAX_FETCH_BODY_CHARS) {
      text = text.slice(0, MAX_FETCH_BODY_CHARS) + "\n\n[Content truncated]";
    }

    if (!text.trim()) {
      return "The page returned no readable text content.";
    }

    return sanitize(text);
  } catch (error) {
    const msg = (error as Error).message ?? "Unknown error";
    // `TimeoutError` is what `AbortSignal.timeout` rejects with; its message
    // varies by runtime ("The operation timed out." on Bun does not contain
    // "abort"), so match the name as well to keep the legacy timeout string.
    if (options.signal?.aborted) {
      return "Error: Request canceled.";
    }
    if (msg.includes("abort") || (error as Error).name === "TimeoutError") {
      return `Error: Request timed out after ${FETCH_TIMEOUT_MS / 1000}s`;
    }
    return `Error fetching URL: ${sanitize(msg)}`;
  }
};
