// Stella Views' VM on the phone, in place of the web's WebAssembly workers (web/views/wasm-vm.ts):
// each run is a PsychoScript live run on an engine thread of its own (desktop-rune/engine/src/views.rs,
// compiled into the phone's engine), exactly as on the Rune desktop, so a view runs native bytecode
// with no WebView and no WebAssembly. The names stay the web module's, which the shared web views
// host (web/views/views-host.ts) imports.
import type { ViewRun, ViewVm } from "@stella/views/session";
import type { ViewMessage, ViewPost } from "@stella/views/protocol";
import { engine, onEngineEvent } from "../../../../../desktop-rune/host/bridge";

let seq = 0;

export function createWasmVm(): ViewVm {
  return {
    async start(program, input, events, limits) {
      const id = `view-${++seq}-${Date.now().toString(36)}`;
      const off = onEngineEvent("views", (event) => {
        if (event.id !== id) return;
        if (event.kind === "posts") events.posts((event.posts ?? []) as ViewPost[]);
        else if (event.kind === "warning") events.warning?.(event.message ?? "");
        else if (event.kind === "exit") {
          off();
          events.exit({ kind: event.exit ?? "stopped", ...(event.message ? { message: event.message } : {}) });
        }
      });
      try {
        await engine.views.start({ id, program, input, sliceMs: limits.sliceMs, heapBytes: limits.heapBytes });
      } catch (error) {
        off();
        throw error;
      }
      const run: ViewRun = {
        deliver: (messages: ViewMessage[]) => engine.views.deliver(id, messages),
        stop: () => {
          off();
          engine.views.stop(id);
        },
      };
      return run;
    },
  };
}

/** Nothing to warm up: the engine's interpreter is part of the app. */
export function preloadViews(): void {}
