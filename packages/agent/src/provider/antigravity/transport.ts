import { Buffer } from "node:buffer";
import * as net from "node:net";
import { PassThrough, Readable, Transform } from "node:stream";
import * as tls from "node:tls";
import { createGunzip } from "node:zlib";

/**
 * HTTP/1.1 over a raw socket, so requests carry the official Antigravity CLI's
 * header set and order (Host, User-Agent, framing, Authorization,
 * Content-Type, Accept-Encoding) instead of fetch's extra browser headers.
 */

const HEAD_TIMEOUT_MS = 180_000;
const IDLE_TIMEOUT_MS = 180_000;

export type AgyRequest = {
  method?: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

const abortError = () => new DOMException("The operation was aborted", "AbortError");

const proxyFor = (url: URL): URL | undefined => {
  const noProxy = (process.env.NO_PROXY || process.env.no_proxy || "").toLowerCase();
  const host = url.hostname.toLowerCase();
  if (
    noProxy
      .split(",")
      .map((entry) => entry.trim())
      .some((entry) => entry === "*" || (entry && (host === entry || host.endsWith(entry.startsWith(".") ? entry : `.${entry}`))))
  ) {
    return undefined;
  }
  const raw = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY || process.env.all_proxy;
  if (!raw) return undefined;
  try {
    return new URL(raw);
  } catch {
    return undefined;
  }
};

const waitForHead = (socket: net.Socket, signal?: AbortSignal): Promise<{ head: string; rest: Buffer }> =>
  new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const finish = (done: () => void) => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
      signal?.removeEventListener("abort", onAbort);
      done();
    };
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      const end = buffer.indexOf("\r\n\r\n");
      if (end === -1) return;
      finish(() => resolve({ head: buffer.subarray(0, end).toString("latin1"), rest: buffer.subarray(end + 4) }));
    };
    const onError = (error: Error) => finish(() => reject(error));
    const onClose = () => finish(() => reject(new Error("Antigravity closed the connection before answering.")));
    const onAbort = () => finish(() => reject(abortError()));
    const timer = setTimeout(
      () => finish(() => reject(new Error("Antigravity didn't answer in time."))),
      HEAD_TIMEOUT_MS,
    );
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
    signal?.addEventListener("abort", onAbort, { once: true });
  });

const secureConnect = (options: tls.ConnectionOptions): Promise<tls.TLSSocket> =>
  new Promise((resolve, reject) => {
    const socket = tls.connect({ ALPNProtocols: ["http/1.1"], ...options });
    socket.once("secureConnect", () => resolve(socket));
    socket.once("error", reject);
  });

const connect = async (url: URL, signal?: AbortSignal): Promise<net.Socket> => {
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  if (url.protocol === "http:") {
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
      throw new Error("Antigravity requests only go to Google over https.");
    }
    return await new Promise((resolve, reject) => {
      const socket = net.connect({ host: url.hostname.replace(/^\[|\]$/g, ""), port });
      socket.once("connect", () => resolve(socket));
      socket.once("error", reject);
    });
  }
  const proxy = proxyFor(url);
  if (!proxy) return await secureConnect({ host: url.hostname, port, servername: url.hostname });
  const tunnel = await new Promise<net.Socket>((resolve, reject) => {
    const socket = net.connect({ host: proxy.hostname, port: Number(proxy.port || 8080) });
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
  const auth = proxy.username
    ? `Proxy-Authorization: Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}\r\n`
    : "";
  tunnel.write(`CONNECT ${url.hostname}:${port} HTTP/1.1\r\nHost: ${url.hostname}:${port}\r\n${auth}\r\n`);
  const { head, rest } = await waitForHead(tunnel, signal);
  if (!/^HTTP\/1\.[01] 2\d\d\b/.test(head)) {
    tunnel.destroy();
    throw new Error(`The proxy refused the connection: ${head.split("\r\n")[0] ?? ""}`);
  }
  if (rest.length > 0) tunnel.unshift(rest);
  return await secureConnect({ socket: tunnel, servername: url.hostname });
};

class ChunkedDecoder extends Transform {
  private buffer = Buffer.alloc(0);
  complete = false;

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    if (this.complete) return callback();
    this.buffer = Buffer.concat([this.buffer, chunk]);
    try {
      this.drain();
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }

  override _flush(callback: (error?: Error | null) => void) {
    callback(this.complete ? null : new Error("Antigravity's answer was cut off."));
  }

  private drain() {
    for (;;) {
      const lineEnd = this.buffer.indexOf("\r\n");
      if (lineEnd === -1) return;
      const size = Number.parseInt(this.buffer.subarray(0, lineEnd).toString("latin1").split(";", 1)[0]!.trim(), 16);
      if (!Number.isFinite(size)) throw new Error("Antigravity sent a malformed answer.");
      if (size === 0) {
        if (this.buffer.indexOf("\r\n\r\n", lineEnd) === -1) return;
        this.complete = true;
        this.buffer = Buffer.alloc(0);
        this.push(null);
        return;
      }
      const start = lineEnd + 2;
      if (this.buffer.length < start + size + 2) return;
      this.push(this.buffer.subarray(start, start + size));
      this.buffer = this.buffer.subarray(start + size + 2);
    }
  }
}

class LengthLimiter extends Transform {
  constructor(private remaining: number) {
    super();
    if (remaining <= 0) this.push(null);
  }

  get complete() {
    return this.remaining <= 0;
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    if (this.remaining > 0) {
      const piece = chunk.subarray(0, this.remaining);
      this.remaining -= piece.length;
      this.push(piece);
      if (this.remaining <= 0) this.push(null);
    }
    callback();
  }

  override _flush(callback: (error?: Error | null) => void) {
    callback(this.remaining > 0 ? new Error("Antigravity's answer was cut off.") : null);
  }
}

const bodyStream = (
  socket: net.Socket,
  rest: Buffer,
  framing: { chunked: boolean; gzip: boolean; length?: number },
  signal?: AbortSignal,
): ReadableStream<Uint8Array> => {
  const source = new PassThrough();
  if (rest.length > 0) source.write(rest);
  socket.pipe(source);
  const stages: Readable[] = [source];
  let body: Readable = source;
  const framer = framing.chunked
    ? new ChunkedDecoder()
    : framing.length !== undefined
      ? new LengthLimiter(framing.length)
      : undefined;
  if (framer) stages.push((body = body.pipe(framer)));
  if (framing.gzip) stages.push((body = body.pipe(createGunzip())));

  let settled = false;
  let ended = false;
  let idle: ReturnType<typeof setTimeout> | undefined;
  const settle = (error?: Error) => {
    if (settled) return;
    settled = true;
    clearTimeout(idle);
    socket.off("data", arm);
    signal?.removeEventListener("abort", onAbort);
    socket.unpipe(source);
    socket.destroy();
    for (const stage of stages) if (stage !== body && !stage.destroyed) stage.destroy();
    if (!body.destroyed && (error || !body.readableEnded)) body.destroy(error);
  };
  function arm() {
    clearTimeout(idle);
    idle = setTimeout(() => settle(new Error("Antigravity stopped sending its answer.")), IDLE_TIMEOUT_MS);
  }
  const onAbort = () => settle(abortError());
  socket.on("error", (error) => settle(error));
  socket.on("data", arm);
  socket.once("end", () => (ended = true));
  socket.once("close", () => {
    if (!ended && !(framer as { complete?: boolean } | undefined)?.complete) {
      settle(new Error("Antigravity closed the connection mid-answer."));
    }
  });
  for (const stage of stages) stage.on("error", (error) => settle(error));
  body.once("end", () => settle());
  body.once("close", () => settle());
  arm();
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  return Readable.toWeb(body) as unknown as ReadableStream<Uint8Array>;
};

const isStreaming = (url: URL) => url.pathname.includes(":streamGenerateContent");

export async function agyFetch(target: string, request: AgyRequest): Promise<Response> {
  const url = new URL(target);
  if (request.signal?.aborted) throw abortError();
  const body = Buffer.from(request.body ?? "");
  const header = (name: string) =>
    Object.entries(request.headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  const chunked = isStreaming(url) && body.length > 0;
  const lines: [string, string][] = [
    ["Host", url.port ? `${url.hostname}:${url.port}` : url.hostname],
    ["User-Agent", header("User-Agent") ?? ""],
    chunked ? ["Transfer-Encoding", "chunked"] : ["Content-Length", String(body.length)],
  ];
  const authorization = header("Authorization");
  if (authorization) lines.push(["Authorization", authorization]);
  lines.push(["Content-Type", header("Content-Type") ?? "application/json"]);
  lines.push(["Accept-Encoding", header("Accept-Encoding") ?? "gzip"]);
  const head = `${request.method ?? "POST"} ${url.pathname}${url.search} HTTP/1.1\r\n${lines
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\r\n")}\r\n\r\n`;
  const payload =
    body.length === 0
      ? Buffer.from(head)
      : chunked
        ? Buffer.concat([Buffer.from(head), Buffer.from(`${body.length.toString(16)}\r\n`), body, Buffer.from("\r\n0\r\n\r\n")])
        : Buffer.concat([Buffer.from(head), body]);

  const socket = await connect(url, request.signal);
  const onAbort = () => socket.destroy(abortError());
  try {
    request.signal?.addEventListener("abort", onAbort, { once: true });
    request.signal?.throwIfAborted();
    socket.write(payload);
    const { head: responseHead, rest } = await waitForHead(socket, request.signal);
    const [statusLine = "", ...headerLines] = responseHead.split("\r\n");
    const match = /^HTTP\/1\.[01]\s+(\d{3})\s*(.*)$/.exec(statusLine);
    if (!match) throw new Error(`Antigravity sent an unexpected answer: ${statusLine}`);
    const headers = new Headers();
    let chunkedResponse = false;
    let gzip = false;
    let length: number | undefined;
    for (const line of headerLines) {
      const colon = line.indexOf(":");
      if (colon <= 0) continue;
      const key = line.slice(0, colon).trim();
      const value = line.slice(colon + 1).trim();
      const lower = key.toLowerCase();
      if (lower === "transfer-encoding" && /chunked/i.test(value)) chunkedResponse = true;
      else if (lower === "content-encoding" && /gzip/i.test(value)) gzip = true;
      else if (lower === "content-length") length = Number.parseInt(value, 10);
      else headers.append(key, value);
    }
    const status = Number(match[1]);
    const stream = bodyStream(
      socket,
      rest,
      { chunked: chunkedResponse, gzip, ...(Number.isFinite(length) ? { length } : {}) },
      request.signal,
    );
    return new Response(status === 204 || status === 304 ? null : stream, {
      status,
      statusText: match[2] ?? "",
      headers,
    });
  } catch (error) {
    socket.destroy();
    throw error;
  } finally {
    request.signal?.removeEventListener("abort", onAbort);
  }
}
