// The TS side of the bridge: a binary command buffer to the Rune engine (our stdout) and JSON
// events from it (our stdin). One React commit = one length-prefixed frame.

export const now = () => performance.timeOrigin + performance.now();

const OP = { CREATE: 1, PROPS: 2, APPEND: 4, INSERT: 5, REMOVE: 6, COMMIT: 9, CMD: 10 } as const;

const enc = new TextEncoder();
let buf = new Uint8Array(1 << 16);
let view = new DataView(buf.buffer);
let len = 4; // first 4 bytes are the frame length

function ensure(n: number) {
  if (len + n <= buf.length) return;
  let size = buf.length * 2;
  while (size < len + n) size *= 2;
  const next = new Uint8Array(size);
  next.set(buf.subarray(0, len));
  buf = next;
  view = new DataView(buf.buffer);
}
const u8 = (v: number) => { ensure(1); buf[len++] = v; };
const u32 = (v: number) => { ensure(4); view.setUint32(len, v, true); len += 4; };
const f64 = (v: number) => { ensure(8); view.setFloat64(len, v, true); len += 8; };
function bytes(b: Uint8Array) { ensure(b.length); buf.set(b, len); len += b.length; }

export const stats = { frames: 0, bytes: 0, ops: 0 };

export const ops = {
  create(id: number, type: string) { const t = enc.encode(type); u8(OP.CREATE); u32(id); u8(t.length); bytes(t); stats.ops++; },
  props(id: number, json: string) { const j = enc.encode(json); u8(OP.PROPS); u32(id); u32(j.length); bytes(j); stats.ops++; },
  append(parent: number, child: number) { u8(OP.APPEND); u32(parent); u32(child); stats.ops++; },
  insert(parent: number, child: number, before: number) { u8(OP.INSERT); u32(parent); u32(child); u32(before); stats.ops++; },
  remove(parent: number, child: number) { u8(OP.REMOVE); u32(parent); u32(child); stats.ops++; },
  cmd(v: unknown) { const j = enc.encode(JSON.stringify(v)); u8(OP.CMD); u32(j.length); bytes(j); stats.ops++; },
};

/** What the next commit answers: which engine event (ack), when the work started (t0), and kind (1 = hot swap). */
export const commitCtx = { ack: 0, t0: 0, kind: 0 };
let generation = 0;

const out = Bun.stdout.writer();

/** Seals the pending ops as one frame and writes it. */
export function flushFrame(commit = true) {
  if (commit) {
    u8(OP.COMMIT); u32(++generation); u32(commitCtx.ack); f64(commitCtx.t0 || now()); u8(commitCtx.kind);
    commitCtx.ack = 0; commitCtx.t0 = 0; commitCtx.kind = 0;
  }
  if (len === 4) return;
  view.setUint32(0, len - 4, true);
  out.write(buf.slice(0, len));
  out.flush();
  stats.frames++; stats.bytes += len;
  len = 4;
}

/** Sends an imperative command (scroll, resize, metrics) right away, outside a commit. */
export function command(v: Record<string, unknown>) {
  ops.cmd(v);
  flushFrame(false);
}

export type EngineEvent = { t: string; key: string; seq: number; at: number; input?: number; value?: string; result?: unknown };

export async function listen(on: (e: EngineEvent) => void) {
  const dec = new TextDecoder();
  let pending = "";
  for await (const chunk of Bun.stdin.stream()) {
    pending += dec.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, nl);
      pending = pending.slice(nl + 1);
      if (!line) continue;
      try { on(JSON.parse(line)); } catch (err) { console.error("[ui] bad event", line, err); }
    }
  }
  // The engine closed our stdin: it quit.
  process.exit(0);
}
