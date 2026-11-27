/// <reference path="../../js/natives.d.ts" />
// Requests the phone app answers itself (ios/StellaRune/PhoneRequests.swift): `{cmd, id, ...}`
// out through `__native.post`, `{t:"phone.reply", id, ok, value|error, code?}` back on the
// engine's event stream. Events the app raises on its own arrive as `phone.<name>`.

import { onEngineEvent } from "../../../desktop-rune/host/bridge";

export class PhoneRequestError extends Error {
  constructor(message: string, readonly code: string | null) {
    super(message);
  }
}

type Waiter = { resolve: (v: unknown) => void; reject: (e: Error) => void };
type Reply = { id: number; ok: boolean; value?: unknown; error?: string; code?: string };

let nextId = 1;
const waiting = new Map<number, Waiter>();
let listening = false;

function listen() {
  if (listening) return;
  listening = true;
  onEngineEvent("phone.reply" as never, ((e: Reply) => {
    const w = waiting.get(e.id);
    if (!w) return;
    waiting.delete(e.id);
    if (e.ok) w.resolve(e.value ?? null);
    else w.reject(new PhoneRequestError(e.error ?? "The app couldn't do that.", e.code ?? null));
  }) as never);
}

export const isPhoneApp = (): boolean => typeof __native !== "undefined";

export function phonePost(m: Record<string, unknown>): void {
  __native.post(JSON.stringify(m));
}

export function phoneRequest<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  listen();
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
    phonePost({ ...args, cmd, id });
  });
}

export function onPhoneEvent<T>(name: string, fn: (e: T) => void): () => void {
  return onEngineEvent(`phone.${name}` as never, fn as never);
}
