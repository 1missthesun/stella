// app.requestSingleInstanceLock on macOS and Linux, on Electron's own lock: Chromium's POSIX
// ProcessSingleton (chrome/browser/process_singleton_posix.cc) with Electron's message format
// (patches/chromium/feat_add_data_parameter_to_processsingleton.patch). Rune Stella and Electron
// Stella on one user data folder therefore exclude each other, and a second launch of either hands
// its command line to whichever is running.
//
// In the user data folder: `SingletonLock` -> "<hostname>-<pid>", `SingletonSocket` -> a socket in a
// private temp folder, `SingletonCookie` -> a random number that the temp folder's own
// `SingletonCookie` repeats. A second instance connects and writes
// "START\0<cwd>\0<argc>\0<argv...>[\0<data length>\0<data>]", half-closes, and waits for "ACK"
// (handled) or "SHUTDOWN" (the holder is exiting; start normally).

import { spawnSync } from "node:child_process";
import { mkdtempSync, readlinkSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { decodeV8Value, encodeV8Value } from "./v8-value";

const LOCK = "SingletonLock";
const SOCKET = "SingletonSocket";
const COOKIE = "SingletonCookie";
const RETRY_ATTEMPTS = 20;
const TIMEOUT_MS = 20_000;
const MAX_MESSAGE = 32 * 1024;

export type SecondInstance = { argv: string[]; cwd: string; data: unknown };

const readLink = (p: string) => { try { return readlinkSync(p); } catch { return null; } };
const unlink = (p: string) => { try { unlinkSync(p); } catch {} };

const parseLock = (lockPath: string) => {
  const target = readLink(lockPath);
  if (target === null) return null;
  const at = target.lastIndexOf("-");
  const pid = Number(target.slice(at + 1));
  return { hostname: at > 0 ? target.slice(0, at) : "", pid: Number.isInteger(pid) ? pid : 0 };
};

const alive = (pid: number) => {
  if (pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
};

const CLIENT = `
const net = require("node:net");
const [socketPath, message, timeoutMs] = [process.argv[1], Buffer.from(process.argv[2], "base64"), Number(process.argv[3])];
const s = net.connect(socketPath);
let reply = "";
let connected = false;
const timer = setTimeout(() => process.exit(connected ? 5 : 3), timeoutMs);
s.on("connect", () => { connected = true; s.end(message); });
s.on("data", (d) => { reply += d.toString("latin1"); });
s.on("close", () => { clearTimeout(timer); process.exit(!connected ? 3 : reply === "ACK" ? 0 : reply === "SHUTDOWN" ? 4 : reply ? 6 : 5); });
s.on("error", () => {});
`;

/** Electron's NotifyOtherProcess: 0 notified, 3 nobody listening, 4 holder shutting down, 5 holder hung. */
function notifySocket(userData: string, message: Buffer): number {
  const socketTarget = readLink(path.join(userData, SOCKET));
  if (socketTarget === null) return 3;
  const cookie = readLink(path.join(userData, COOKIE));
  if (!cookie || readLink(path.join(path.dirname(socketTarget), COOKIE)) !== cookie) return 3;
  const result = spawnSync(process.execPath, ["-e", CLIENT, socketTarget, message.toString("base64"), String(TIMEOUT_MS)], {
    stdio: "ignore",
    timeout: TIMEOUT_MS + 2000,
    env: { ...process.env, BUN_BE_BUN: "1" },
  });
  return result.status ?? 5;
}

function messageFor(argv: string[], cwd: string, data: unknown) {
  const parts: Buffer[] = [Buffer.from(["START", cwd, String(argv.length), ...argv].join("\0"), "utf8")];
  if (data !== undefined) {
    const encoded = encodeV8Value(data);
    parts.push(Buffer.from(`\0${encoded.length}\0`, "utf8"), encoded);
  }
  return Buffer.concat(parts);
}

/** Parses a message from either app (Electron's format, or plain Chromium's without argc). */
export function parseSingletonMessage(raw: Buffer): SecondInstance | null {
  const tokens: Buffer[] = [];
  let start = 0;
  for (let i = 0; i <= raw.length; i++) {
    if (i === raw.length || raw[i] === 0) { tokens.push(raw.subarray(start, i)); start = i + 1; }
  }
  if (tokens.length < 3 || tokens[0]!.toString("latin1") !== "START") return null;
  const cwd = tokens[1]!.toString("utf8");
  const rest = tokens.slice(2);
  const argc = Number(rest[0]!.toString("latin1"));
  if (!/^\d+$/.test(rest[0]!.toString("latin1")) || argc > rest.length - 1) {
    return { argv: rest.map((t) => t.toString("utf8")), cwd, data: null };
  }
  const argv = rest.slice(1, 1 + argc).map((t) => t.toString("utf8"));
  let data: unknown = null;
  if (rest.length - 1 - argc >= 2) {
    const size = Number(rest[1 + argc]!.toString("latin1"));
    const payload = Buffer.concat(rest.slice(2 + argc).flatMap((t, i) => (i ? [Buffer.from([0]), t] : [t])));
    if (Number.isInteger(size) && size <= payload.length) {
      try { data = decodeV8Value(payload.subarray(0, size)); } catch { data = null; }
    }
  }
  return { argv, cwd, data };
}

export class ProcessSingleton {
  private server: net.Server | null = null;
  private socketDir: string | null = null;
  private lockContent = "";
  private readonly lockPath: string;
  private readonly socketPath: string;
  private readonly cookiePath: string;

  constructor(private readonly userData: string, private readonly onMessage: (m: SecondInstance) => boolean) {
    this.lockPath = path.join(userData, LOCK);
    this.socketPath = path.join(userData, SOCKET);
    this.cookiePath = path.join(userData, COOKIE);
  }

  get held() { return this.server !== null; }

  /** Electron's NotifyOtherProcessOrCreate: true when this process now holds the lock. */
  acquire(argv: string[], cwd: string, data: unknown, lockPid: number): boolean {
    const message = messageFor(argv, cwd, data);
    for (let attempt = 0; attempt < 2; attempt++) {
      const other = this.notifyOther(message);
      if (other !== "none") return false;
      if (this.create(lockPid)) return true;
    }
    return false;
  }

  private notifyOther(message: Buffer): "notified" | "in-use" | "none" {
    const sleep = TIMEOUT_MS / RETRY_ATTEMPTS;
    for (let retries = 0; retries <= RETRY_ATTEMPTS; retries++) {
      const sent = notifySocket(this.userData, message);
      if (sent === 0) return "notified";
      if (sent === 4) return "none";
      if (sent === 5 || sent === 6) return "in-use";
      const lock = parseLock(this.lockPath);
      if (!lock) return "none";
      if (!lock.hostname) { unlink(this.lockPath); return "none"; }
      if (lock.hostname !== os.hostname()) return "in-use";
      if (!alive(lock.pid) || lock.pid === process.pid) { unlink(this.lockPath); return "none"; }
      if (retries === RETRY_ATTEMPTS) return "in-use";
      Bun.sleepSync(sleep);
    }
    return "in-use";
  }

  private create(lockPid: number): boolean {
    this.lockContent = `${os.hostname()}-${lockPid}`;
    try {
      symlinkSync(this.lockContent, this.lockPath);
    } catch {
      return false;
    }
    try {
      this.socketDir = mkdtempSync(path.join(os.tmpdir(), ".org.chromium.Chromium."));
      const socketTarget = path.join(this.socketDir, SOCKET);
      const cookie = BigInt.asUintN(64, BigInt(`0x${Buffer.from(crypto.getRandomValues(new Uint8Array(8))).toString("hex")}`)).toString();
      unlink(this.socketPath);
      unlink(this.cookiePath);
      symlinkSync(socketTarget, this.socketPath);
      symlinkSync(cookie, this.cookiePath);
      symlinkSync(cookie, path.join(this.socketDir, COOKIE));
      this.server = net.createServer((socket) => this.serve(socket));
      this.server.on("error", (error) => console.error("[app] single-instance socket failed:", error));
      this.server.listen(socketTarget);
      this.server.unref();
    } catch (error) {
      console.error("[app] could not set up the single-instance lock:", error);
      this.release();
      return false;
    }
    process.once("exit", () => this.release());
    return true;
  }

  private serve(socket: net.Socket) {
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => socket.destroy(), TIMEOUT_MS);
    socket.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_MESSAGE) { clearTimeout(timer); socket.destroy(); return; }
      chunks.push(chunk);
    });
    socket.on("end", () => {
      clearTimeout(timer);
      const message = parseSingletonMessage(Buffer.concat(chunks));
      if (!message) { socket.destroy(); return; }
      let handled = true;
      try { handled = this.onMessage(message); } catch (error) { console.error("[app] second-instance handler failed:", error); }
      socket.end(handled ? "ACK" : "SHUTDOWN");
    });
    socket.on("error", () => clearTimeout(timer));
  }

  release() {
    const server = this.server;
    this.server = null;
    server?.close();
    if (this.lockContent && readLink(this.lockPath) === this.lockContent) {
      unlink(this.socketPath);
      unlink(this.cookiePath);
      unlink(this.lockPath);
    }
    this.lockContent = "";
    if (this.socketDir) rmSync(this.socketDir, { recursive: true, force: true });
    this.socketDir = null;
  }
}
