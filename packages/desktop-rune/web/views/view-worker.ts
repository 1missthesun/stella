// One Stella View's program on the web: a PsychoScript live run (WebAssembly, vendor/psychoscript-web)
// in a worker of its own, so a busy view never stalls the page or another view. The page compiles the
// module once and hands it to each worker; this side starts the run, pumps it in short slices from the
// worker's event loop (its timers too), and posts back what the program posts, as the desktop engine's
// runs do (engine/src/views.rs).
import { initSync, Program, type LiveRun } from "./vendor/psychoscript-web/psychoscript_web.js";
import type { FromViewWorker, ToViewWorker } from "./worker-protocol";

/** Longest one `pump` computes before the worker's event loop runs again (messages, timers). */
const PUMP_SLICE_MS = 8;
/** Room over the view's heap budget for the compiled program and the VM itself. */
const MEMORY_HEADROOM = 16 * 1024 * 1024;

const scope = self as unknown as { postMessage(message: FromViewWorker): void; onmessage: ((event: MessageEvent<ToViewWorker>) => void) | null };
const post = (message: FromViewWorker) => scope.postMessage(message);

let memory: WebAssembly.Memory | null = null;
let baseline = 0;
let run: LiveRun | null = null;
let program: Program | null = null;
let sliceMs = 100;
let heapBytes = 64 * 1024 * 1024;
let ended = false;
let scheduled = false;
let timer: ReturnType<typeof setTimeout> | undefined;

// A message to ourselves runs the next slice as soon as the event loop is free; setTimeout(0) would be
// clamped to 4 ms once nested.
const wake = new MessageChannel();
wake.port1.onmessage = () => pump();

function schedule() {
  if (scheduled || ended) return;
  scheduled = true;
  wake.port2.postMessage(0);
}

const errorText = (caught: unknown): string => {
  if (caught && typeof caught === "object" && "message" in caught) {
    const e = caught as { message: string; line?: number; column?: number };
    return e.line && !/\(line \d+, col \d+\)/u.test(e.message) ? `${e.message} (line ${e.line}, col ${e.column ?? 1})` : String(e.message);
  }
  return String(caught);
};

type ExitJson = { type: "finished" } | { type: "stopped" } | { type: "failed"; error: { type: string; message: string; line?: number; column?: number } };

/** How the run ended, in the desktop engine's words (engine/src/views.rs `message`). */
function exitOf(json: string | undefined): FromViewWorker & { t: "exit" } {
  const exit = json ? (JSON.parse(json) as ExitJson) : ({ type: "stopped" } as const);
  if (exit.type !== "failed") return { t: "exit", kind: exit.type };
  const error = exit.error;
  if (error.type === "sliceBudget" || error.type === "timeout") return { t: "exit", kind: "failed", message: `The view computed for more than ${sliceMs} ms without waiting` };
  return { t: "exit", kind: "failed", message: errorText(error) };
}

function end(exit: FromViewWorker & { t: "exit" }) {
  if (ended) return;
  ended = true;
  clearTimeout(timer);
  try {
    run?.free();
    program?.free();
  } catch {
    // A trapped instance can't free; the page ends this worker anyway.
  }
  run = null;
  program = null;
  post(exit);
}

/** What the program posted since the last slice, in one message. */
function flush(live: LiveRun) {
  const out = live.takeOutbox();
  if (out === "[]") return;
  const posts: unknown[] = [];
  for (const envelope of JSON.parse(out) as Array<{ type: string; message?: unknown }>) {
    if (envelope.type === "post") posts.push(envelope.message);
    else if (envelope.type === "warning") post({ t: "warning", message: String(envelope.message ?? "") });
  }
  if (posts.length) post({ t: "posts", posts });
}

function pump() {
  scheduled = false;
  const live = run;
  if (!live || ended) return;
  let next: number;
  try {
    next = live.pump(PUMP_SLICE_MS);
    flush(live);
  } catch (caught) {
    // A trap (an interpreter defect, or out of memory) leaves the instance unusable.
    return end({ t: "exit", kind: "failed", message: `The view's runtime stopped: ${errorText(caught)}` });
  }
  if (memory && memory.buffer.byteLength - baseline > heapBytes + MEMORY_HEADROOM) {
    live.stop();
    return end({ t: "exit", kind: "failed", message: `The view used more than ${Math.round(heapBytes / (1024 * 1024))} MB of memory` });
  }
  if (next === -3) return end(exitOf(live.exit()));
  if (next === -2) return schedule();
  clearTimeout(timer);
  timer = next >= 0 ? setTimeout(schedule, Math.max(0, next)) : undefined;
}

scope.onmessage = (event) => {
  const message = event.data;
  switch (message.t) {
    case "init": {
      try {
        const exports = initSync({ module: message.module }) as { memory?: WebAssembly.Memory };
        memory = exports.memory ?? null;
        baseline = memory?.buffer.byteLength ?? 0;
        post({ t: "ready" });
      } catch (caught) {
        post({ t: "initFailed", message: errorText(caught) });
      }
      return;
    }
    case "start": {
      if (run || ended) return post({ t: "startFailed", message: "This worker already ran a view" });
      sliceMs = message.sliceMs;
      heapBytes = message.heapBytes;
      try {
        program = new Program(message.program, "__input");
        run = program.startLive(message.input, { sliceBudgetMs: message.sliceMs });
      } catch (caught) {
        program?.free();
        program = null;
        return post({ t: "startFailed", message: errorText(caught) });
      }
      post({ t: "started" });
      return schedule();
    }
    case "deliver": {
      if (!run || ended) return;
      try {
        for (const m of message.messages) run.deliver(JSON.stringify(m));
      } catch (caught) {
        post({ t: "warning", message: errorText(caught) });
      }
      return schedule();
    }
    case "pause":
    case "resume": {
      if (!run || ended) return post({ t: "paused", paused: false });
      try {
        if (message.t === "pause") run.pause();
        else run.resume();
      } catch {
        // Already in that state.
      }
      post({ t: "paused", paused: run.isPaused() });
      return schedule();
    }
    case "stop": {
      if (!run || ended) return;
      run.stop();
      return end({ t: "exit", kind: "stopped" });
    }
  }
};
