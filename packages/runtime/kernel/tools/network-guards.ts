import dns from "node:dns";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { Readable } from "node:stream";
import zlib from "node:zlib";
import {
  isBlockedIpAddress,
  isLocalHostname,
  normalizeHostForClassification,
  normalizeSafePublicUrl,
} from "./url-guard.js";

const MAX_PUBLIC_REDIRECTS = 5;

/** Split-DNS escape hatch: hostnames that may resolve to private addresses. */
const allowedPrivateHosts = (): Set<string> =>
  new Set(
    (process.env.STELLA_ALLOW_PRIVATE_HOSTS ?? "")
      .split(",")
      .map((entry) => normalizeHostForClassification(entry))
      .filter((entry) => entry.length > 0),
  );

const privateTargetError = (detail: string) =>
  Object.assign(
    new Error(
      `Private and local network targets are blocked.${detail} If this host is genuinely safe, add it to STELLA_ALLOW_PRIVATE_HOSTS (comma-separated hostnames).`,
    ),
    { code: "ESTELLAPRIVATE" },
  );

/** http(s) only, no credentials, no local or private literal target; http becomes https. */
export const normalizeSafeExternalUrl = (inputUrl: string): string => {
  let parsed: URL | null = null;
  try {
    parsed = new URL(inputUrl.trim());
  } catch {
    parsed = null;
  }
  const hostname = parsed ? normalizeHostForClassification(parsed.hostname) : "";
  if (parsed && hostname && allowedPrivateHosts().has(hostname)) {
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("Only HTTP and HTTPS URLs are supported.");
    }
    if (parsed.username || parsed.password) {
      throw new Error("Embedded URL credentials are not allowed.");
    }
    parsed.protocol = "https:";
    return parsed.toString();
  }
  try {
    return normalizeSafePublicUrl(inputUrl);
  } catch (error) {
    if (hostname && (isLocalHostname(hostname) || isBlockedIpAddress(hostname))) {
      throw privateTargetError("");
    }
    throw error;
  }
};

/**
 * The lookup every public request dials with: the addresses it resolves are
 * the ones connected to, so a name cannot pass a check and then resolve
 * somewhere private for the connection itself.
 */
const publicLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) {
      callback(error, "", 4);
      return;
    }
    const normalized = normalizeHostForClassification(hostname);
    if (
      !allowedPrivateHosts().has(normalized) &&
      addresses.some((entry) => isBlockedIpAddress(entry.address))
    ) {
      callback(
        privateTargetError(
          ` "${normalized}" resolved to: ${addresses.map((entry) => entry.address).join(", ")}. Check hosts file, VPN, or DNS if this should be a public site.`,
        ),
        "",
        4,
      );
      return;
    }
    if (options.all) {
      callback(null, addresses);
      return;
    }
    const first = addresses[0];
    if (!first) {
      callback(new Error(`Could not resolve hostname "${normalized}".`), "", 4);
      return;
    }
    callback(null, first.address, first.family);
  });
};

const decodedBody = (response: import("node:http").IncomingMessage): Readable => {
  switch ((response.headers["content-encoding"] ?? "").toString().trim().toLowerCase()) {
    case "gzip":
    case "x-gzip":
      return response.pipe(zlib.createGunzip());
    case "deflate":
      return response.pipe(zlib.createInflate());
    case "br":
      return response.pipe(zlib.createBrotliDecompress());
    default:
      return response;
  }
};

/** One request to an already-normalized public URL; never follows redirects. */
export const requestPublicUrl = (
  url: string,
  init: { headers?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<Response> =>
  new Promise<Response>((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: "GET",
        lookup: publicLookup,
        headers: { "accept-encoding": "gzip, deflate, br", ...init.headers },
      },
      (incoming) => {
        const status = incoming.statusCode ?? 502;
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (value === undefined) continue;
          for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
        }
        const encoded = headers.has("content-encoding");
        headers.delete("content-encoding");
        if (encoded) headers.delete("content-length");
        const body =
          status === 204 || status === 304
            ? null
            : (Readable.toWeb(decodedBody(incoming)) as ReadableStream<Uint8Array>);
        resolve(new Response(body, { status, statusText: incoming.statusMessage ?? "", headers }));
      },
    );
    request.on("error", reject);
    const signal = init.signal;
    if (signal) {
      const abort = () => request.destroy(signal.reason instanceof Error ? signal.reason : new Error("Aborted."));
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    }
    request.end();
  });

/** GET a model- or user-supplied URL, re-checking every redirect hop at dial time. */
export const fetchPublicUrl = async (
  inputUrl: string,
  init: { headers?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<Response> => {
  let target = normalizeSafeExternalUrl(inputUrl);
  for (let hop = 0; ; hop += 1) {
    const response = await requestPublicUrl(target, init);
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) return response;
    await response.body?.cancel().catch(() => {});
    if (hop >= MAX_PUBLIC_REDIRECTS) {
      throw new Error(`Too many redirects (limit ${MAX_PUBLIC_REDIRECTS}).`);
    }
    target = normalizeSafeExternalUrl(new URL(location, target).toString());
  }
};
