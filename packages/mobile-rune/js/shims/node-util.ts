export const promisify = (fn: any) => (...a: any[]) => new Promise((res, rej) => fn(...a, (e: unknown, v: unknown) => (e ? rej(e) : res(v))));
export const inspect = (v: unknown) => { try { return JSON.stringify(v); } catch { return String(v); } };
export const format = (...a: unknown[]) => a.map((x) => (typeof x === "string" ? x : inspect(x))).join(" ");
export const types = { isUint8Array: (v: unknown) => v instanceof Uint8Array };
export const TextEncoder = globalThis.TextEncoder;
export const TextDecoder = globalThis.TextDecoder;
export default { promisify, inspect, format, types, TextEncoder, TextDecoder };
