/// <reference path="../natives.d.ts" />
// `node:fs` on the phone: the bridge's frame writes (host/bridge.ts writeSync to the bridge fd)
// go to the engine; files are the app's own (sandbox paths) through the natives.
const enc = new TextEncoder();
const bytesOf = (d: unknown): Uint8Array => (typeof d === "string" ? enc.encode(d) : d instanceof Uint8Array ? d : new Uint8Array(d as ArrayBuffer));

export function writeSync(fd: number, buf: Uint8Array | string, off = 0, len?: number): number {
  const b = bytesOf(buf);
  const n = len ?? b.length - off;
  if (fd === 1 || fd === 2) { __native.log("log", new TextDecoder().decode(b.subarray(off, off + n))); return n; }
  __native.push(off === 0 && n === b.length ? b : b.subarray(off, off + n));
  return n;
}
export const existsSync = (p: string) => __native.readFile(String(p)) !== null;
export const mkdirSync = () => undefined;
export const rmSync = () => undefined;
export const unlinkSync = () => undefined;
export function readFileSync(p: string, opts?: string | { encoding?: string }) {
  const b = __native.readFile(String(p));
  if (!b) { const e: any = new Error(`ENOENT: no such file, open '${p}'`); e.code = "ENOENT"; throw e; }
  const encoding = typeof opts === "string" ? opts : opts?.encoding;
  return encoding ? new TextDecoder().decode(b) : b;
}
export const writeFileSync = (p: string, d: unknown) => { __native.writeFile(String(p), bytesOf(d)); };
export const statSync = (p: string) => {
  const b = __native.readFile(String(p));
  if (!b) { const e: any = new Error(`ENOENT: ${p}`); e.code = "ENOENT"; throw e; }
  return { size: b.length, mtimeMs: 0, isFile: () => true, isDirectory: () => false };
};
export const readdirSync = () => [];
export const watch = () => ({ close() {} });
export const promises = {
  mkdtemp: async (prefix: string) => `${__native.env.tmp}${prefix}${Math.random().toString(36).slice(2)}`,
  mkdir: async () => undefined,
  readdir: async () => [],
  readFile: async (p: string, o?: any) => readFileSync(p, o),
  writeFile: async (p: string, d: unknown) => writeFileSync(p, d),
  rm: async () => undefined,
  unlink: async () => undefined,
  stat: async (p: string) => statSync(p),
};
export const { mkdtemp, readdir, readFile, rm, writeFile, stat, mkdir, unlink } = promises;
export default { writeSync, existsSync, mkdirSync, rmSync, unlinkSync, readFileSync, writeFileSync, statSync, readdirSync, watch, promises };
