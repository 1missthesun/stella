// A view's `stella.fetch` on the desktop: the public internet only. Every hop of a redirect is
// followed here, and each connection's address is checked as it is made (the socket's own DNS
// lookup), so neither a redirect nor a name that resolves (or re-resolves) to a private address
// reaches this computer, its LAN, a VPN or the cloud metadata service.
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import zlib from "node:zlib";
import { isIpLiteral, isPublicAddress } from "@stella/views/network";

export type PublicFetchInit = { method?: string; headers?: Record<string, string>; body?: string };
export type PublicFetchResponse = { status: number; statusText: string; headers: Record<string, string>; url: string; body: string };

const MAX_REDIRECTS = 10;
const REDIRECT = new Set([301, 302, 303, 307, 308]);
/** Headers that carry the caller's credentials, dropped when a redirect leaves the origin. */
const CREDENTIAL_HEADERS = ["authorization", "cookie", "proxy-authorization"];

class BlockedAddress extends Error {}

const blockedMessage = (host: string) => `fetch can't reach ${host}: views reach only the public internet`;

/** The socket's lookup: resolves as usual, then refuses any address that isn't public. */
const publicLookup = (host: string): LookupFunction => (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "", 4);
    const list = addresses as dns.LookupAddress[];
    const blocked = list.find((a) => !isPublicAddress(a.address));
    if (blocked || list.length === 0) return callback(new BlockedAddress(blockedMessage(host)), "", 4);
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
};

const decoded = (response: http.IncomingMessage): NodeJS.ReadableStream => {
  const encoding = String(response.headers["content-encoding"] ?? "").trim().toLowerCase();
  if (encoding === "gzip" || encoding === "x-gzip") return response.pipe(zlib.createGunzip());
  if (encoding === "deflate") return response.pipe(zlib.createInflate());
  if (encoding === "br") return response.pipe(zlib.createBrotliDecompress());
  return response;
};

type Hop = { response: http.IncomingMessage; body: Promise<string> | null };

const request = (url: URL, method: string, headers: Record<string, string>, body: string | undefined, allowPrivate: boolean, maxBytes: number, signal: AbortSignal): Promise<Hop> =>
  new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    // An IP literal never goes through the lookup: check it here.
    const literal = url.hostname.replace(/^\[|\]$/gu, "");
    if (!allowPrivate && isIpLiteral(literal) && !isPublicAddress(literal)) return reject(new BlockedAddress(blockedMessage(url.hostname)));
    const req = client.request(url, {
      method,
      headers: { "accept-encoding": "gzip, deflate, br", ...headers },
      ...(allowPrivate ? {} : { lookup: publicLookup(url.hostname) }),
      signal,
    });
    req.on("error", reject);
    req.on("response", (response) => {
      if (REDIRECT.has(response.statusCode ?? 0) && response.headers.location) {
        response.resume();
        return resolve({ response, body: null });
      }
      const text = new Promise<string>((done, fail) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const stream = decoded(response);
        stream.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            req.destroy();
            return fail(new Error(`The response is bigger than ${Math.round(maxBytes / (1024 * 1024))} MB`));
          }
          chunks.push(chunk);
        });
        stream.on("end", () => done(new TextDecoder().decode(Buffer.concat(chunks))));
        stream.on("error", fail);
      });
      resolve({ response, body: text });
    });
    if (body !== undefined) req.write(body);
    req.end();
  });

/** `fetch` for a view: http(s) to public addresses only (unless `allowPrivate`), following up to 10 redirects itself. */
export async function publicFetch(target: URL, init: PublicFetchInit, options: { allowPrivate: boolean; timeoutMs: number; maxBytes: number }): Promise<PublicFetchResponse> {
  const signal = AbortSignal.timeout(options.timeoutMs);
  let url = target;
  let method = (init.method ?? "GET").toUpperCase();
  let body = init.body;
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(init.headers ?? {})) headers[key.toLowerCase()] = String(value);
  try {
    for (let hop = 0; ; hop++) {
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`fetch can reach only http(s) URLs, not ${url.protocol}`);
      const { response, body: text } = await request(url, method, headers, body, options.allowPrivate, options.maxBytes, signal);
      const status = response.statusCode ?? 0;
      if (text === null) {
        if (hop >= MAX_REDIRECTS) throw new Error(`fetch followed ${MAX_REDIRECTS} redirects from ${target.host} without arriving`);
        const next = new URL(String(response.headers.location), url);
        if (next.origin !== url.origin) for (const name of CREDENTIAL_HEADERS) delete headers[name];
        if (status === 303 || ((status === 301 || status === 302) && method === "POST")) {
          if (method !== "HEAD") method = "GET";
          body = undefined;
          delete headers["content-type"];
          delete headers["content-length"];
        }
        url = next;
        continue;
      }
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(response.headers)) if (value !== undefined) out[key] = Array.isArray(value) ? value.join(", ") : value;
      return { status, statusText: response.statusMessage ?? "", headers: out, url: url.toString(), body: await text };
    }
  } catch (error) {
    if (error instanceof BlockedAddress) throw new Error(error.message);
    if (signal.aborted) throw new Error(`${url.host} didn't answer within ${options.timeoutMs / 1000} s`);
    throw error;
  }
}
