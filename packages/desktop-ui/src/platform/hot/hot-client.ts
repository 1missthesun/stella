import RefreshRuntime from "react-refresh/runtime";

type HotCallback = (module: unknown) => void;

type HotRecord = {
  data: Record<string, unknown>;
  disposers: Array<(data: Record<string, unknown>) => void>;
  accepted: Map<string, HotCallback[]>;
};

type HotUpdate =
  | { type: "self"; id: string; url: string }
  | { type: "dep"; id: string; spec: string; url: string }
  | { type: "css"; id: string; url: string };

export type HotPayload = {
  updates: HotUpdate[];
  stale: string[];
};

RefreshRuntime.injectIntoGlobalHook(window);

const records = new Map<string, HotRecord>();
const idOf = (url: string) => decodeURIComponent(new URL(url).pathname);

const hotContext = (url: string) => {
  const id = idOf(url);
  const record: HotRecord = {
    data: records.get(id)?.data ?? {},
    disposers: [],
    accepted: new Map(),
  };
  records.set(id, record);
  const acceptDep = (spec: string, callback: HotCallback) => {
    record.accepted.set(spec, [...(record.accepted.get(spec) ?? []), callback]);
  };
  return {
    data: record.data,
    accept(deps?: string | string[] | HotCallback, callback?: (module: unknown) => void) {
      if (typeof deps === "string") acceptDep(deps, (module) => callback?.(module));
      if (Array.isArray(deps)) {
        deps.forEach((dep, index) =>
          acceptDep(dep, (module) => callback?.(deps.map((_, slot) => (slot === index ? module : undefined)))),
        );
      }
    },
    dispose(callback: (data: Record<string, unknown>) => void) {
      record.disposers.push(callback);
    },
    invalidate() {
      location.reload();
    },
    on() {
      // No server events: updates arrive through `update()`.
    },
    register(type: unknown, name: string) {
      RefreshRuntime.register(type, `${id} ${name}`);
    },
    signature: RefreshRuntime.createSignatureFunctionForTransform,
  };
};

const isRefreshBoundary = (module: Record<string, unknown>) => {
  const values = Object.values(module);
  return values.length > 0 && values.every((value) => RefreshRuntime.isLikelyComponentType(value));
};

const apply = async ({ updates, stale }: HotPayload) => {
  const relevant = updates.filter((update) => records.has(update.id));
  if (relevant.length === 0) return;
  try {
    for (const id of stale) {
      const record = records.get(id);
      if (!record) continue;
      const disposers = record.disposers.splice(0);
      for (const dispose of disposers) dispose(record.data);
    }
    for (const update of relevant) {
      const module = (await import(/* @vite-ignore */ update.url)) as Record<string, unknown>;
      if (update.type === "self" && !isRefreshBoundary(module)) {
        location.reload();
        return;
      }
      if (update.type === "dep") {
        for (const callback of records.get(update.id)?.accepted.get(update.spec) ?? []) callback(module);
      }
    }
    RefreshRuntime.performReactRefresh();
  } catch (error) {
    console.error("[hot] update failed, reloading:", error);
    location.reload();
  }
};

let queue = Promise.resolve();

declare global {
  var __stellaHot: {
    module: typeof hotContext;
    update: (payload: HotPayload) => Promise<void>;
  };
}

globalThis.__stellaHot = {
  module: hotContext,
  update: (payload) => (queue = queue.then(() => apply(payload))),
};
