// A React host config whose host components are Rune elements (host/ELEMENTS.md). Mutations
// become bridge ops; the engine keeps the retained tree. `on*` function props become handlers:
// the engine wires only the ones an element has and reports them by node id.

import Reconciler from "react-reconciler";
import { ConcurrentRoot, ContinuousEventPriority, DefaultEventPriority, DiscreteEventPriority } from "react-reconciler/constants";
import { createContext, type ReactNode } from "react";
import { blob, command, commitCtx, flushFrame, ops, opsPending, setElementDispatch, type ElementEvent } from "./bridge";

type Handlers = Record<string, (...args: any[]) => void>;
/** Props set through a ref, outside React. They stay over React's until set again. */
type Direct = Record<string, unknown>;

class Instance {
  json = "";
  handlers: Handlers = {};
  blob?: { src: string; id: number };
  direct?: Direct;
  react: Record<string, any> = {};
  constructor(readonly id: number, readonly type: string) {}

  /** Changes props without a React render, as code writing the DOM in rAF does: patches made in one task go to the engine as one frame. */
  set(patch: Direct) {
    if (!instances.has(this.id)) return;
    this.direct = { ...this.direct, ...patch };
    const json = serialize(this, this.react);
    if (json === this.json) return;
    this.json = json;
    ops.props(this.id, json);
    scheduleDirectFlush();
  }
}

let directFlush = false;
function scheduleDirectFlush() {
  if (directFlush) return;
  directFlush = true;
  queueMicrotask(() => {
    directFlush = false;
    if (opsPending()) flushFrame(true);
  });
}
type Container = { id: 0 };

let nextId = 1;
const instances = new Map<number, Instance>();

function textOf(children: unknown): string | undefined {
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children) && children.every((c) => typeof c === "string" || typeof c === "number")) return children.join("");
  return undefined;
}

const eventName = (prop: string) => prop[2].toLowerCase() + prop.slice(3);

/** What each event hands its `on*` prop. Events not listed pass the whole payload. */
const ARGS: Record<string, (e: ElementEvent) => unknown[]> = {
  press: () => [], doublePress: () => [], dismiss: () => [], ready: () => [],
  hover: (e) => [e.inside], focus: (e) => [e.focused, e.visible], focusWithin: (e) => [e.within],
  input: (e) => [e.value], submit: (e) => [e.value], link: (e) => [e.href], dropFiles: (e) => [e.paths],
  dropHover: (e) => [e.over], atBottom: (e) => [e.atBottom], farFromBottom: (e) => [e.far], title: (e) => [e.title], error: (e) => [e.error],
  layout: (e) => [{ x: e.x, y: e.y, w: e.w, h: e.h }],
};

function payload(e: ElementEvent): unknown[] {
  const pick = ARGS[e.e];
  if (pick) return pick(e);
  const { t: _t, n: _n, e: _e, seq: _s, at: _a, input: _i, ...rest } = e;
  return [rest];
}

const BYTES_SRC = /^(data:|https?:|blob:[0-9a-f]{8}-)/i;
const APP_SCHEME_SRC = /^(?!file:|blob:)[a-z][a-z0-9+.-]*:\/\//i;

async function fetchSrc(src: string): Promise<Response> {
  if (!APP_SCHEME_SRC.test(src) || /^(https?|blob):/i.test(src)) return fetch(src);
  const { fetchProtocol } = await import("./electron/session");
  const response = await fetchProtocol("", new Request(src));
  if (!response) throw new Error(`no protocol handler for ${src}`);
  return response;
}

/** `<image src>` that the engine can't read itself (data:, http(s), object URLs and app-scheme URLs like stella-media:) goes over as a blob. */
function resolveSrc(inst: Instance, src: string): string {
  if (!BYTES_SRC.test(src) && !APP_SCHEME_SRC.test(src)) return src;
  if (inst.blob?.src === src) return `blob:${inst.blob.id}`;
  if (src.startsWith("data:")) {
    inst.blob = { src, id: blob(bytesOf(src)) };
    return `blob:${inst.blob.id}`;
  }
  void fetchSrc(src).then(async (r) => {
    if (!r.ok || !instances.has(inst.id)) return;
    inst.blob = { src, id: blob(new Uint8Array(await r.arrayBuffer())) };
    inst.json = serialize(inst, inst.react);
    ops.props(inst.id, inst.json);
    flushFrame(true);
  }).catch((err) => console.error("[ui] image fetch failed", src, err));
  return "";
}

function bytesOf(src: string): Uint8Array {
  const comma = src.indexOf(",");
  const meta = src.slice(5, comma);
  const body = src.slice(comma + 1);
  return meta.endsWith(";base64") ? Uint8Array.from(atob(body), (c) => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(body));
}

const fetchedImages = new Map<string, number | null>();
const imageWaiters = new Map<string, Set<Instance>>();

/** `<markdown images>` targets the engine can't read itself load as blobs, as `<image src>` does, once per source. */
function resolveImages(inst: Instance, images: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [written, target] of Object.entries(images)) {
    if (typeof target !== "string" || (!BYTES_SRC.test(target) && !APP_SCHEME_SRC.test(target))) {
      out[written] = target;
      continue;
    }
    if (!fetchedImages.has(target)) {
      if (target.startsWith("data:")) fetchedImages.set(target, blob(bytesOf(target)));
      else {
        fetchedImages.set(target, null);
        imageWaiters.set(target, new Set());
        void fetchSrc(target)
          .then(async (r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            fetchedImages.set(target, blob(new Uint8Array(await r.arrayBuffer())));
            for (const waiting of imageWaiters.get(target) ?? []) {
              if (!instances.has(waiting.id)) continue;
              waiting.json = serialize(waiting, waiting.react);
              ops.props(waiting.id, waiting.json);
            }
            flushFrame(true);
          })
          .catch((err) => console.error("[ui] image fetch failed", target, err))
          .finally(() => imageWaiters.delete(target));
      }
    }
    const id = fetchedImages.get(target);
    if (id === null || id === undefined) imageWaiters.get(target)?.add(inst);
    else out[written] = `blob:${id}`;
  }
  return out;
}

/** Props where `false` differs from leaving them out. */
const KEEPS_FALSE = new Set(["visible", "resizable", "spellcheck", "dark", "checked", "expanded", "selected", "growth"]);

function serialize(inst: Instance, reactProps: Record<string, any>): string {
  inst.react = reactProps;
  const props = inst.direct ? { ...reactProps, ...inst.direct } : reactProps;
  const out: Record<string, unknown> = {};
  const on: string[] = [];
  inst.handlers = {};
  for (const k in props) {
    const v = props[k];
    if (k === "children" || k === "ref" || v === undefined || v === null || (v === false && !KEEPS_FALSE.has(k))) continue;
    if (typeof v === "function" && k.length > 2 && k.startsWith("on") && k[2] === k[2].toUpperCase()) {
      const name = eventName(k);
      inst.handlers[name] = v;
      on.push(name);
      continue;
    }
    out[k] = v;
  }
  if (on.length) out.on = on;
  if (inst.type === "text") {
    const t = textOf(props.children);
    if (t !== undefined) out.content = t;
  }
  if (inst.type === "image" && typeof out.src === "string") out.src = resolveSrc(inst, out.src);
  if (inst.type === "markdown" && out.images && typeof out.images === "object") out.images = resolveImages(inst, out.images as Record<string, unknown>);
  return JSON.stringify(out);
}

/** Event priorities as React DOM assigns them: user actions commit before the handler returns,
 *  pointer motion and scrolling batch per task, and everything the engine reports by itself
 *  (layout, scroll position, page state) waits for the next default render. */
const DISCRETE = new Set(["press", "doublePress", "dismiss", "input", "submit", "key", "keyRaw", "paste", "link", "linkContextMenu", "contextMenu", "dropFiles", "focus", "focusWithin", "selection"]);
const CONTINUOUS = new Set(["hover", "scroll", "wheel", "pointer", "dropHover", "drag"]);

setElementDispatch((e) => {
  const inst = instances.get(e.n);
  const fn = inst?.handlers[e.e];
  if (!fn) return;
  const discrete = DISCRETE.has(e.e);
  const previous = currentPriority;
  currentPriority = discrete ? DiscreteEventPriority : CONTINUOUS.has(e.e) ? ContinuousEventPriority : DefaultEventPriority;
  try {
    batched(() => {
      if (discrete) {
        commitCtx.ack = e.seq;
        commitCtx.t0 = e.at;
      }
      fn(...payload(e));
    });
    if (discrete) reconciler.flushSyncWork();
  } finally {
    currentPriority = previous;
  }
});

let currentPriority = DefaultEventPriority;

function release(inst: Instance) {
  instances.delete(inst.id);
}

const config: any = {
  rendererPackageName: "stella-rune",
  rendererVersion: "1.0.0",
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: true,
  supportsMicrotasks: true,
  scheduleMicrotask: queueMicrotask,
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  noTimeout: -1,
  NotPendingTransition: null,
  HostTransitionContext: createContext(null),

  createInstance(type: string, props: any): Instance {
    const inst = new Instance(nextId++, type);
    instances.set(inst.id, inst);
    ops.create(inst.id, type);
    inst.json = serialize(inst, props);
    ops.props(inst.id, inst.json);
    return inst;
  },
  createTextInstance(text: string): Instance {
    const inst = new Instance(nextId++, "text");
    inst.json = JSON.stringify({ content: text });
    ops.create(inst.id, "text");
    ops.props(inst.id, inst.json);
    return inst;
  },
  shouldSetTextContent: (type: string, props: any) => type === "text" || (textOf(props.children) !== undefined && type !== "row" && type !== "col" && type !== "box" && type !== "window"),
  appendInitialChild: (p: Instance, c: Instance) => ops.append(p.id, c.id),
  appendChild: (p: Instance, c: Instance) => ops.append(p.id, c.id),
  appendChildToContainer: (_: Container, c: Instance) => ops.append(0, c.id),
  insertBefore: (p: Instance, c: Instance, b: Instance) => ops.insert(p.id, c.id, b.id),
  insertInContainerBefore: (_: Container, c: Instance, b: Instance) => ops.insert(0, c.id, b.id),
  removeChild: (p: Instance, c: Instance) => { release(c); ops.remove(p.id, c.id); },
  removeChildFromContainer: (_: Container, c: Instance) => { release(c); ops.remove(0, c.id); },
  commitUpdate(inst: Instance, _type: string, _old: any, next: any) {
    const json = serialize(inst, next);
    if (json !== inst.json) { inst.json = json; ops.props(inst.id, json); }
  },
  commitTextUpdate(inst: Instance, _old: string, text: string) {
    inst.json = JSON.stringify({ content: text });
    ops.props(inst.id, inst.json);
  },
  finalizeInitialChildren: (_inst: Instance, _type: string, props: any) => props.autoFocus === true,
  commitMount(inst: Instance) { command({ cmd: "focus", n: inst.id }); },
  resetTextContent() {},
  clearContainer() {},
  hideInstance(inst: Instance) { const j = JSON.parse(inst.json); j.hidden = true; ops.props(inst.id, JSON.stringify(j)); },
  unhideInstance(inst: Instance) { ops.props(inst.id, inst.json); },
  hideTextInstance(inst: Instance) { ops.props(inst.id, JSON.stringify({ content: "" })); },
  unhideTextInstance(inst: Instance) { ops.props(inst.id, inst.json); },
  detachDeletedInstance(inst: Instance) {
    instances.delete(inst.id);
  },
  getRootHostContext: () => ({}),
  getChildHostContext: (ctx: object) => ctx,
  getPublicInstance: (i: Instance) => i,
  prepareForCommit: () => null,
  resetAfterCommit: () => flushFrame(true),
  preparePortalMount() {},
  getCurrentUpdatePriority: () => currentPriority,
  setCurrentUpdatePriority: (p: number) => { currentPriority = p; },
  resolveUpdatePriority: () => currentPriority || DefaultEventPriority,
  resolveEventType: () => null,
  resolveEventTimeStamp: () => -1.1,
  shouldAttemptEagerTransition: () => false,
  trackSchedulerEvent() {},
  maySuspendCommit: () => false,
  maySuspendCommitOnUpdate: () => false,
  maySuspendCommitInSyncRender: () => false,
  preloadInstance: () => true,
  startSuspendingCommit() {},
  suspendOnActiveViewTransition() {},
  suspendInstance() {},
  waitForCommitToBeReady: () => null,
  getSuspendedCommitReason: () => null,
  requestPostPaintCallback() {},
  resetFormInstance() {},
  getInstanceFromNode: () => null,
  beforeActiveInstanceBlur() {}, afterActiveInstanceBlur() {},
  prepareScopeUpdate() {}, getInstanceFromScope: () => null,
  bindToConsole: (methodName: string, args: unknown[]) => (console as any)[methodName].bind(console, ...args),
};

// @types/react-reconciler (0.32) lags the 0.34 runtime's sync APIs; type what we use.
const reconciler = Reconciler(config) as ReturnType<typeof Reconciler> & {
  updateContainerSync(el: ReactNode, root: unknown, parent: null, cb: null): void;
  flushSyncWork(): void;
};
const container: Container = { id: 0 };
// A concurrent root batches a task's updates into one render, as createRoot does in a browser;
// discrete element events flush before returning, so each one is answered by its own commit.
const root = reconciler.createContainer(container, ConcurrentRoot, null, false, null, "", console.error, console.error, console.error, () => {}, null);

export function render(el: ReactNode, ctx?: Partial<typeof commitCtx>) {
  if (ctx) Object.assign(commitCtx, ctx);
  reconciler.updateContainerSync(el, root, null, null);
  reconciler.flushSyncWork();
}

export const batched = (fn: () => void) => reconciler.batchedUpdates(fn, null);

/** Renders `children` (a `<window>`) as a root child from anywhere in the tree, keeping context. */
export function windowPortal(children: ReactNode, key?: string | null): ReactNode {
  return reconciler.createPortal(children, container, null, key ?? null) as unknown as ReactNode;
}

/** What a ref to a host element gives. */
export type HostElement = Pick<Instance, "id" | "set">;

/** The engine node id of a host element (from a ref). */
export const nodeId = (ref: unknown): number | undefined => (ref as Instance | null)?.id;
