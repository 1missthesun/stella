// What the page and a view's worker (view-worker.ts) say to each other.

export type ToViewWorker =
  | { t: "init"; module: WebAssembly.Module }
  /** `input` is the run's input as JSON (`__input()`). */
  | { t: "start"; program: string; input: string; sliceMs: number; heapBytes: number }
  | { t: "deliver"; messages: unknown[] }
  | { t: "pause" }
  | { t: "resume" }
  | { t: "stop" };

export type FromViewWorker =
  | { t: "ready" }
  | { t: "initFailed"; message: string }
  | { t: "started" }
  | { t: "startFailed"; message: string }
  /** One slice's posts, in order. */
  | { t: "posts"; posts: unknown[] }
  | { t: "warning"; message: string }
  | { t: "paused"; paused: boolean }
  | { t: "exit"; kind: "finished" | "failed" | "stopped"; message?: string };
