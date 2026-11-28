// Short pairing codes' mailbox. A computer opens a slot with its first key-exchange message; one
// device may claim it with its own; the computer then leaves its sealed pairing code for that
// device alone. Every blob is opaque here: the code's password never reaches this worker.
// Slots hold at most a few hundred bytes and are deleted when read, cancelled or five minutes old.
import { DurableObject } from "cloudflare:workers";

type Env = {
  SLOTS: DurableObjectNamespace<Slot>;
  OPEN_LIMITER: RateLimit;
  CLAIM_LIMITER: RateLimit;
  LOOKUP_LIMITER: RateLimit;
};

const TTL_MS = 5 * 60 * 1000;
const MAX_BLOB = 2048;
// Five Crockford symbols: 2^25 slot names, so the few live at once can't be found by trying names
// at the lookup and claim rates allowed (the code's last four symbols, its password, stay on the devices).
const SLOT = /^[0-9A-HJKMNP-TV-Z]{5}$/;
const B64 = /^[A-Za-z0-9_-]+$/;

type State = {
  a: string;
  computer: string;
  expiresAt: number;
  b?: string;
  confirm?: string;
  device?: string;
  sealed?: string;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const empty = (status: number) => new Response(null, { status, headers: { "cache-control": "no-store" } });

const token = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

const blob = (body: Record<string, unknown>, key: string) => {
  const value = body[key];
  return typeof value === "string" && value.length > 0 && value.length <= MAX_BLOB && B64.test(value) ? value : null;
};

const same = (a: string | undefined, b: string | null) => {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

export class Slot extends DurableObject<Env> {
  private async state(): Promise<State | null> {
    const state = (await this.ctx.storage.get<State>("slot")) ?? null;
    if (state && state.expiresAt <= Date.now()) {
      await this.clear();
      return null;
    }
    return state;
  }

  private async clear() {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }

  async open(a: string): Promise<Response> {
    if (await this.state()) return empty(409);
    const state: State = { a, computer: token(), expiresAt: Date.now() + TTL_MS };
    await this.ctx.storage.put("slot", state);
    await this.ctx.storage.setAlarm(state.expiresAt);
    return json({ token: state.computer, expiresAt: state.expiresAt }, 201);
  }

  async peek(): Promise<Response> {
    const state = await this.state();
    return state ? json({ a: state.a }) : empty(404);
  }

  async claim(b: string, confirm: string): Promise<Response> {
    const state = await this.state();
    if (!state) return empty(404);
    // One claim per slot: whoever guesses at a code gets one try, then the code is spent.
    if (state.device) return empty(409);
    state.b = b;
    state.confirm = confirm;
    state.device = token();
    await this.ctx.storage.put("slot", state);
    return json({ token: state.device });
  }

  async answer(bearer: string | null): Promise<Response> {
    const state = await this.state();
    if (!state) return empty(404);
    if (!same(state.computer, bearer)) return empty(403);
    return state.b ? json({ b: state.b, confirm: state.confirm }) : empty(204);
  }

  async leave(bearer: string | null, sealed: string): Promise<Response> {
    const state = await this.state();
    if (!state) return empty(404);
    if (!same(state.computer, bearer) || !state.device) return empty(403);
    state.sealed = sealed;
    await this.ctx.storage.put("slot", state);
    return empty(204);
  }

  async collect(bearer: string | null): Promise<Response> {
    const state = await this.state();
    if (!state) return empty(404);
    if (!same(state.device, bearer)) return empty(403);
    if (!state.sealed) return empty(204);
    await this.clear();
    return json({ sealed: state.sealed });
  }

  async close(bearer: string | null): Promise<Response> {
    const state = await this.state();
    if (!state) return empty(204);
    if (!same(state.computer, bearer) && !same(state.device, bearer)) return empty(403);
    await this.clear();
    return empty(204);
  }
}

type SlotRpc = Pick<Slot, "open" | "peek" | "claim" | "answer" | "leave" | "collect" | "close">;

const body = async (request: Request): Promise<Record<string, unknown> | null> => {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > 4 * MAX_BLOB) return null;
  try {
    const value = await request.json();
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/") return new Response("Stella pairing mailbox\n", { headers: { "content-type": "text/plain" } });
    const match = /^\/v1\/slots\/([^/]+)(?:\/(b|offer))?$/.exec(url.pathname);
    if (!match || !SLOT.test(match[1]!)) return empty(404);
    const [, name, part] = match;
    // The RPC stub's inferred type is too deep for tsc; its methods are exactly the class's.
    const slot = env.SLOTS.get(env.SLOTS.idFromName(name!)) as unknown as SlotRpc;
    const bearer = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? null;
    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    const method = request.method;

    if (!part && method === "PUT") {
      if (!(await env.OPEN_LIMITER.limit({ key: ip })).success) return empty(429);
      const a = blob((await body(request)) ?? {}, "a");
      return a ? slot.open(a) : empty(400);
    }
    // Looking a slot up (and claiming one) answers whether that name is live: both are limited
    // per address, so nobody walks the names to find live codes or spend them with junk claims.
    if (!part && method === "GET") {
      if (!(await env.LOOKUP_LIMITER.limit({ key: ip })).success) return empty(429);
      return slot.peek();
    }
    if (!part && method === "DELETE") return slot.close(bearer);
    if (part === "b" && method === "POST") {
      if (!(await env.CLAIM_LIMITER.limit({ key: ip })).success) return empty(429);
      const parsed = (await body(request)) ?? {};
      const b = blob(parsed, "b");
      const confirm = blob(parsed, "confirm");
      return b && confirm ? slot.claim(b, confirm) : empty(400);
    }
    if (part === "b" && method === "GET") return slot.answer(bearer);
    if (part === "offer" && method === "POST") {
      const sealed = blob((await body(request)) ?? {}, "sealed");
      return sealed ? slot.leave(bearer, sealed) : empty(400);
    }
    if (part === "offer" && method === "GET") return slot.collect(bearer);
    return empty(405);
  },
} satisfies ExportedHandler<Env>;
