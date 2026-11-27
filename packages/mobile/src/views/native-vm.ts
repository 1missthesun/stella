// Stella Views' VM on the phone: the StellaViews native module (modules/stella-views) runs each
// program in a psychoscript-mobile live run on a thread of its own, never on the JS thread. One
// `onRun` event carries a wake-up's posts as a JSON array text.
import { requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";
import type { ViewExit, ViewRun, ViewVm } from "@stella/views/session";
import type { ViewMessage, ViewPost } from "@stella/views/protocol";

type RunEvent =
  | { id: string; gen: number; kind: "posts"; posts: string }
  | { id: string; gen: number; kind: "warning"; message: string }
  | { id: string; gen: number; kind: "exit"; exit: ViewExit["kind"]; message?: string };

type StellaViewsNative = {
  start(id: string, program: string, input: string, sliceMs: number, heapBytes: number): Promise<number>;
  deliver(id: string, messages: string[]): void;
  stop(id: string): void;
  pause(id: string): boolean;
  resume(id: string): boolean;
  addListener(event: "onRun", listener: (event: RunEvent) => void): EventSubscription;
};

const native = requireOptionalNativeModule<StellaViewsNative>("StellaViews");

export const viewsAvailable = (): boolean => native !== null;

type Listener = { gen: number | null; events: Parameters<ViewVm["start"]>[2]; early: RunEvent[] };
const listeners = new Map<string, Listener>();
let subscription: EventSubscription | null = null;

const route = (listener: Listener, event: RunEvent) => {
  if (event.kind === "posts") {
    let posts: ViewPost[];
    try {
      posts = JSON.parse(event.posts) as ViewPost[];
    } catch {
      return;
    }
    listener.events.posts(posts);
  } else if (event.kind === "warning") {
    listener.events.warning?.(event.message);
  } else {
    listeners.delete(event.id);
    listener.events.exit({ kind: event.exit, ...(event.message ? { message: event.message } : {}) });
  }
};

const onRun = (event: RunEvent) => {
  const listener = listeners.get(event.id);
  if (!listener) return;
  // Posts can arrive before `start` resolves with the run's generation.
  if (listener.gen === null) {
    listener.early.push(event);
    return;
  }
  if (event.gen !== listener.gen) return;
  route(listener, event);
};

let seq = 0;

export const nativeViewVm: ViewVm = {
  async start(program, input, events, limits) {
    if (!native) throw new Error("Stella Views need a newer version of the app.");
    subscription ??= native.addListener("onRun", onRun);
    const id = `view-${++seq}-${Date.now().toString(36)}`;
    const listener: Listener = { gen: null, events, early: [] };
    listeners.set(id, listener);
    let gen: number;
    try {
      gen = await native.start(id, program, JSON.stringify(input), limits.sliceMs, limits.heapBytes);
    } catch (error) {
      listeners.delete(id);
      // Expo wraps a native error as "Calling the 'start' function has failed → Caused by: <reason>".
      throw error instanceof Error ? new Error(error.message.split("Caused by: ").at(-1)!.trim()) : error;
    }
    listener.gen = gen;
    for (const event of listener.early.splice(0)) if (event.gen === gen) route(listener, event);
    const run: ViewRun = {
      deliver: (messages: ViewMessage[]) => {
        if (!listeners.has(id)) return;
        try {
          native.deliver(id, messages.map((message) => JSON.stringify(message)));
        } catch {
          // The run ended between the check and the call; its exit event says how.
        }
      },
      stop: () => {
        listeners.delete(id);
        native.stop(id);
      },
    };
    return run;
  },
};
