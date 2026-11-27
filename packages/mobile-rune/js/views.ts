// `globalThis.stella.views` on the phone: Stella Views run here as on the Rune desktop, each view's
// program a PsychoScript run on an engine thread (replace/web/views/wasm-vm.ts → engine/src/views.rs)
// and its trees drawn by the shared UI (desktop-rune/ui/views) through Rune. A phone has no view
// files, so the host is the web's (web/views/views-host.ts), which runs the newest version each
// conversation (or the Apps list's view index) carries; storage, capabilities and the VM are the
// phone's own (js/replace/web/views/*). History, undo and share links are that host's and the UI's.
import { createWebViewsHost } from "../../desktop-rune/web/views/views-host";
import { engine, onEngineEvent } from "../../desktop-rune/host/bridge";
import type { ViewSnapshot } from "@stella/views/session";
import type { ViewTheme } from "@stella/views/protocol";

/** A frame the engine doesn't answer in time comes from a timer. */
const FRAME_FALLBACK_MS = 50;

/**
 * The views' frame clock: each request asks the engine for the next display-link tick
 * (`views.frame`, engine/src/mobile/view_frames.rs), so `useFrame` steps with the display.
 */
function displayFrameClock() {
  let queue: Array<(time: number) => void> = [];
  let asked = false;
  let fallback: ReturnType<typeof setTimeout> | null = null;
  let last = -Infinity;
  const run = () => {
    asked = false;
    if (fallback) clearTimeout(fallback);
    fallback = null;
    const callbacks = queue;
    queue = [];
    const time = Math.max(performance.now(), last);
    last = time;
    for (const fn of callbacks) fn(time);
  };
  onEngineEvent("views", (event) => {
    if (event.kind === "frame" && event.id === "" && asked) run();
  });
  return (fn: (time: number) => void) => {
    queue.push(fn);
    if (asked) return;
    asked = true;
    engine.views.frame();
    fallback = setTimeout(run, FRAME_FALLBACK_MS);
  };
}

/** `STELLA_VIEWS_LOG=1` (a launch extra in dev builds): each view's first tree, swaps and problems in the app log, as on the desktop. */
const LOG = __native.env.env.STELLA_VIEWS_LOG === "1";

/** What was last logged for each view (its card and its screen share one run, so one line each). */
const seen = new Map<string, { first: number | null; swap: number | null; problem: string | null }>();

function logged(filePath: string, listener: (snapshot: ViewSnapshot) => void): (snapshot: ViewSnapshot) => void {
  if (!LOG) return listener;
  const name = filePath.split("/").pop();
  return (s) => {
    const was = seen.get(filePath) ?? { first: null, swap: null, problem: null };
    if (s.firstRenderMs !== was.first && s.firstRenderMs !== null) console.info(`[views] ${name} first tree in ${s.firstRenderMs.toFixed(2)} ms`);
    if (s.swapMs !== was.swap && s.swapMs !== null) console.info(`[views] ${name} new source to tree in ${s.swapMs.toFixed(2)} ms`);
    if (s.problem && s.problem.message !== was.problem) console.warn(`[views] ${name} ${s.problem.phase}: ${s.problem.message}`);
    seen.set(filePath, { first: s.firstRenderMs ?? was.first, swap: s.swapMs ?? was.swap, problem: s.problem?.message ?? null });
    listener(s);
  };
}

export function createPhoneViews() {
  const host = createWebViewsHost({ platform: __native.env.platform, requestFrame: displayFrameClock() });
  return {
    ...host,
    subscribe: (filePath: string, theme: ViewTheme, listener: (snapshot: ViewSnapshot) => void) => host.subscribe(filePath, theme, logged(filePath, listener)),
    /** Calls `listener` with each file whose history or preview changed (the web's API: "*" once, as the host is ready). */
    onHistory(listener: (filePath: string) => void): () => void {
      const off = host.onHistory(listener);
      listener("*");
      return off;
    },
    connectBackend: (client: Parameters<typeof host.connectBackend>[0], account?: string | null) => host.connectBackend(client, account ?? null),
  };
}
