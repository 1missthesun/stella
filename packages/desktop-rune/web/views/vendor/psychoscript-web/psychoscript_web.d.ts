// Types for the wasm-bindgen glue beside it (the parts the views worker uses). See README.md.
export class LiveRun {
  free(): void;
  /** -3 ended (see exit()), -2 still computing: pump again soon, -1 waiting with no timer, else ms until its next timer. */
  pump(maxMs: number): number;
  deliver(messageJson: string): void;
  /** JSON array: { type: "post", message } | { type: "warning", message } | { type: "fetch", … } | { type: "cancel", id }. */
  takeOutbox(): string;
  takeBytes(): Uint8Array;
  fetchDone(id: number, metaJson: string, body: Uint8Array): void;
  fetchFailed(id: number, kind: "Network" | "Timeout" | "TooLarge", message: string): void;
  pause(): void;
  resume(): void;
  stop(): void;
  isPaused(): boolean;
  nowMs(): number;
  /** { type: "finished", result } | { type: "failed", error } | { type: "stopped" }, as JSON; undefined while it runs. */
  exit(): string | undefined;
}
export class Program {
  free(): void;
  constructor(source: string, inputName?: string | null);
  run(inputJson: string, timeoutMs?: number | null, maxOutputBytes?: number | null): string;
  startLive(
    inputJson: string,
    options?: { sliceBudgetMs?: number; maxPostsPerSecond?: number; httpsHosts?: string[]; allowLocalNetwork?: boolean; native?: boolean },
  ): LiveRun;
}
export function initSync(module: { module: WebAssembly.Module | BufferSource }): unknown;
export default function init(moduleOrPath?: { module_or_path: RequestInfo | URL | Response | BufferSource | WebAssembly.Module }): Promise<unknown>;
