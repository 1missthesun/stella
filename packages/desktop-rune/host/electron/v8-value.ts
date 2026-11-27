// The structured-clone bytes Electron passes as single-instance `additionalData`: V8's
// ValueSerializer format (version 15) inside Blink's version envelope, as Electron's
// shell/common/v8_util.cc writes it. Covers what structured clone gives plain data: primitives,
// strings, objects, arrays, dates, maps, sets and back-references.

const BLINK_VERSION = 19;
const V8_VERSION = 15;

class Writer {
  private bytes: number[] = [];
  byte(b: number) { this.bytes.push(b); }
  varint(n: number) {
    do {
      let b = n & 0x7f;
      n = Math.floor(n / 128);
      if (n) b |= 0x80;
      this.bytes.push(b);
    } while (n);
  }
  double(n: number) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, n, true);
    this.bytes.push(...b);
  }
  raw(data: Uint8Array) { for (const b of data) this.bytes.push(b); }
  get length() { return this.bytes.length; }
  done() { return Buffer.from(this.bytes); }
}

const varintSize = (n: number) => { let s = 1; while (n >= 128) { n = Math.floor(n / 128); s++; } return s; };

export function encodeV8Value(value: unknown): Buffer {
  const w = new Writer();
  w.byte(0xff); w.varint(BLINK_VERSION);
  w.byte(0xff); w.varint(V8_VERSION);
  const seen = new Map<object, number>();
  let nextId = 0;
  const str = (s: string) => {
    if (/^[\u0000-ÿ]*$/.test(s)) {
      w.byte(0x22); w.varint(s.length); w.raw(Buffer.from(s, "latin1"));
      return;
    }
    const data = Buffer.from(s, "utf16le");
    if ((w.length + 1 + varintSize(data.length)) & 1) w.byte(0x00);
    w.byte(0x63); w.varint(data.length); w.raw(data);
  };
  const write = (v: unknown): void => {
    if (v === undefined) return w.byte(0x5f);
    if (v === null) return w.byte(0x30);
    if (v === true) return w.byte(0x54);
    if (v === false) return w.byte(0x46);
    if (typeof v === "number") {
      if (Number.isInteger(v) && v >= -0x80000000 && v <= 0x7fffffff && !Object.is(v, -0)) {
        w.byte(0x49); w.varint(((v << 1) ^ (v >> 31)) >>> 0);
      } else {
        w.byte(0x4e); w.double(v);
      }
      return;
    }
    if (typeof v === "string") return str(v);
    if (typeof v !== "object") throw new TypeError(`An object could not be cloned (${typeof v}).`);
    const ref = seen.get(v);
    if (ref !== undefined) { w.byte(0x5e); w.varint(ref); return; }
    seen.set(v, nextId++);
    if (v instanceof Date) { w.byte(0x44); w.double(v.getTime()); return; }
    if (Array.isArray(v)) {
      w.byte(0x41); w.varint(v.length);
      for (let i = 0; i < v.length; i++) write(v[i]);
      w.byte(0x24); w.varint(0); w.varint(v.length);
      return;
    }
    if (v instanceof Map) {
      w.byte(0x3b);
      for (const [k, val] of v) { write(k); write(val); }
      w.byte(0x3a); w.varint(v.size * 2);
      return;
    }
    if (v instanceof Set) {
      w.byte(0x27);
      for (const k of v) write(k);
      w.byte(0x2c); w.varint(v.size);
      return;
    }
    w.byte(0x6f);
    const entries = Object.entries(v);
    for (const [k, val] of entries) { str(k); write(val); }
    w.byte(0x7b); w.varint(entries.length);
  };
  write(value);
  return w.done();
}

export function decodeV8Value(data: Uint8Array): unknown {
  let at = 0;
  const byte = () => { if (at >= data.length) throw new Error("truncated"); return data[at++]!; };
  const varint = () => { let n = 0; let mul = 1; for (;;) { const b = byte(); n += (b & 0x7f) * mul; if (!(b & 0x80)) return n; mul *= 128; } };
  const double = () => { const v = new DataView(data.buffer, data.byteOffset + at, 8).getFloat64(0, true); at += 8; return v; };
  const take = (n: number) => { const s = data.subarray(at, at + n); at += n; return Buffer.from(s); };
  const objects: unknown[] = [];
  if (data[at] === 0xff) {
    at++;
    const blink = varint();
    if (blink >= 21) { byte(); at += 8; }
  }
  if (data[at] === 0xff) { at++; varint(); }
  const read = (): unknown => {
    const tag = byte();
    switch (tag) {
      case 0x00: return read();
      case 0x5f: return undefined;
      case 0x30: return null;
      case 0x54: return true;
      case 0x46: return false;
      case 0x49: { const z = varint(); return (z >>> 1) ^ -(z & 1); }
      case 0x55: return varint();
      case 0x4e: return double();
      case 0x22: return take(varint()).toString("latin1");
      case 0x53: return take(varint()).toString("utf8");
      case 0x63: return take(varint()).toString("utf16le");
      case 0x5e: return objects[varint()];
      case 0x44: { const d = new Date(double()); objects.push(d); return d; }
      case 0x6f: {
        const o: Record<string, unknown> = {};
        objects.push(o);
        while (data[at] !== 0x7b) { const k = read(); o[String(k)] = read(); }
        at++; varint();
        return o;
      }
      case 0x41: {
        const length = varint();
        const a: unknown[] = new Array(length);
        objects.push(a);
        for (let i = 0; i < length; i++) a[i] = read();
        while (data[at] !== 0x24) { const k = read(); (a as unknown as Record<string, unknown>)[String(k)] = read(); }
        at++; varint(); varint();
        return a;
      }
      case 0x61: {
        const length = varint();
        const a: unknown[] = new Array(length);
        objects.push(a);
        while (data[at] !== 0x40) { const k = read(); (a as unknown as Record<string, unknown>)[String(k)] = read(); }
        at++; varint(); varint();
        return a;
      }
      case 0x3b: {
        const m = new Map();
        objects.push(m);
        while (data[at] !== 0x3a) { const k = read(); m.set(k, read()); }
        at++; varint();
        return m;
      }
      case 0x27: {
        const s = new Set();
        objects.push(s);
        while (data[at] !== 0x2c) s.add(read());
        at++; varint();
        return s;
      }
      default: throw new Error(`Unsupported clone tag 0x${tag.toString(16)}`);
    }
  };
  return read();
}
