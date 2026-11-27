/** What the iOS app (ios/StellaRune/JSRuntime.swift) gives the JS thread. Android gives the same. */
declare const __native: {
  env: {
    resources: string;
    documents: string;
    caches: string;
    tmp: string;
    platform: "ios" | "android";
    osVersion: string;
    model: string;
    scale: number;
    width: number;
    height: number;
    dark: boolean;
    processStartMs: number;
    locale: string;
    args: string[];
    env: Record<string, string>;
  };
  /** Engine frames: one or more `[u32 LE length][ops…]` frames. */
  push(frame: Uint8Array): void;
  log(level: string, message: string): void;
  now(): number;
  epochNow(): number;
  setTimer(id: number, ms: number, repeats: boolean): void;
  clearTimer(id: number): void;
  /** An app command (JSON): share, openURL, haptic, perf.start/stop, firstContent, ... */
  post(json: string): void;
  storageGet(key: string): string | null;
  storageSet(key: string, value: string): void;
  storageRemove(key: string): void;
  storageKeys(): string[];
  random(count: number): Uint8Array;
  digest(alg: string, data: Uint8Array): Uint8Array;
  hmac(alg: string, key: Uint8Array, data: Uint8Array): Uint8Array;
  readFile(path: string): Uint8Array | null;
  readText(path: string): string | null;
  writeFile(path: string, data: Uint8Array | string): boolean;
  fetch(id: number, req: { url: string; method: string; headers: Record<string, string>; redirect?: string }, body: Uint8Array | string | undefined): void;
  fetchAbort(id: number): void;
  wsOpen(id: number, url: string, protocols: string[]): void;
  wsSend(id: number, data: string | Uint8Array): void;
  wsClose(id: number, code: number, reason: string): void;
};
