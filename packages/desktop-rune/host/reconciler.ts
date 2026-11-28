// A React host config whose host components are Rune elements (host/ELEMENTS.md). Mutations
// become bridge ops; the engine keeps the retained tree. `on*` function props become handlers:
// the engine wires only the ones an element has and reports them by node id.

import Reconciler from "react-reconciler";
import { ConcurrentRoot, ContinuousEventPriority, DefaultEventPriority, DiscreteEventPriority } from "react-reconciler/constants";
import { createContext, type ReactNode } from "react";
import { blob, command, commitCtx, flushFrame, freeBlob, joinTask, ops, opsPending, setElementDispatch, stats, type ElementEvent } from "./bridge";

type Handlers = Record<string, (...args: any[]) => void>;
/** Props set through a ref, outside React. They stay over React's until set again. */
type Direct = Record<string, unknown>;

class Instance {
  json = "";
  handlers: Handlers = {};
  /** Its root's scope (`createScopedRoot`): "" for the app's own tree. */
  scope = "";
  /** Props its root forces onto a `<window>`, and the prefix of its id. */
  forced?: Record<string, unknown>;
  prefix = "";
  /** The `<image src>` whose blob it holds (`srcBlobs`). */
  src?: string;
  direct?: Direct;
  /** The size `onSize` last heard. */
  sized?: { w: number; h: number };
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
/**
 * A root's container: every root's windows are children of the engine's root node. A scoped root
 * (the draft preview's) keys its elements' layouts apart and forces `window` props onto its
 * `<window>`s, its `windowPrefix` in front of each window id.
 */
type Container = { id: 0; scope: string; window?: Record<string, unknown>; windowPrefix?: string };

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

type SrcBlob = { id: number | null; holders: Set<Instance>; freeing?: ReturnType<typeof setTimeout> };
/** `<image src>` bytes the engine holds, one blob per source shared by the elements showing it, so an element remounted
 * with the same source reuses it; it is freed `SRC_BLOB_GRACE_MS` after the last element lets go, which outlasts a hot
 * swap's remount of data-loaded content. */
const srcBlobs = new Map<string, SrcBlob>();
const SRC_BLOB_GRACE_MS = 5000;

/** `<image src>` that the engine can't read itself (data:, http(s), object URLs and app-scheme URLs like stella-media:) goes over as a blob. */
function resolveSrc(inst: Instance, src: string): string {
  if (!BYTES_SRC.test(src) && !APP_SCHEME_SRC.test(src)) {
    dropSrc(inst);
    return src;
  }
  if (inst.src !== src) {
    dropSrc(inst);
    let entry = srcBlobs.get(src);
    if (!entry) {
      entry = { id: src.startsWith("data:") ? blob(bytesOf(src)) : null, holders: new Set() };
      srcBlobs.set(src, entry);
      if (entry.id === null) loadSrc(src, entry);
    }
    clearTimeout(entry.freeing);
    entry.freeing = undefined;
    entry.holders.add(inst);
    inst.src = src;
  }
  const id = srcBlobs.get(src)?.id;
  return id == null ? "" : `blob:${id}`;
}

function loadSrc(src: string, entry: SrcBlob) {
  void fetchSrc(src).then(async (r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (srcBlobs.get(src) !== entry) return;
    entry.id = blob(bytes);
    for (const inst of entry.holders) {
      if (!instances.has(inst.id)) continue;
      inst.json = serialize(inst, inst.react);
      ops.props(inst.id, inst.json);
    }
    flushFrame(true);
  }).catch((err) => {
    console.error("[ui] image fetch failed", src, err);
    // A later render of these elements tries again.
    if (srcBlobs.get(src) !== entry) return;
    srcBlobs.delete(src);
    for (const inst of entry.holders) inst.src = undefined;
  });
}

function dropSrc(inst: Instance) {
  const src = inst.src;
  if (src === undefined) return;
  inst.src = undefined;
  const entry = srcBlobs.get(src);
  if (!entry || !entry.holders.delete(inst) || entry.holders.size) return;
  entry.freeing = setTimeout(() => {
    if (srcBlobs.get(src) !== entry || entry.holders.size) return;
    srcBlobs.delete(src);
    if (entry.id !== null) freeBlob(entry.id);
  }, SRC_BLOB_GRACE_MS);
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
  let props = inst.direct ? { ...reactProps, ...inst.direct } : reactProps;
  if (inst.forced) props = { ...props, ...inst.forced, id: prefixed(inst.prefix, props.id) };
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
  const size = inst.handlers.size;
  if (size) {
    // `onSize` rides the engine's layout events and fires only when the size changes: content
    // moving under a scroll changes every rect it reports, never its size.
    delete inst.handlers.size;
    on.splice(on.indexOf("size"), 1);
    const layout = inst.handlers.layout;
    if (!layout) on.push("layout");
    inst.handlers.layout = (r: Rect) => {
      layout?.(r);
      if (inst.sized && inst.sized.w === r.w && inst.sized.h === r.h) return;
      inst.sized = { w: r.w, h: r.h };
      size({ w: r.w, h: r.h });
    };
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
const CONTINUOUS = new Set(["hover", "scroll", "wheel", "pointer", "dropHover", "drag", "edgeDrag", "magnify"]);

let pressKeys = false;

/** Whether the press being dispatched came from Return or Space on a focused control (a DOM `click` with `detail` 0), not the pointer. */
export const pressedByKeys = () => pressKeys;

type Rect = { x: number; y: number; w: number; h: number };
/** The rect each `id`'d element last reported (`owner` is its instance; null when two live elements share the id). */
const layoutById = new Map<string, { rect: Rect; owner: number | null }>();
const layoutKey = (inst: Instance): string | undefined => (typeof inst.react.id === "string" ? (inst.scope ? `${inst.scope}\0${inst.react.id}` : inst.react.id) : undefined);

function noteLayout(inst: Instance, e: ElementEvent) {
  const id = layoutKey(inst);
  if (id === undefined) return;
  const seen = layoutById.get(id);
  const owner = seen && seen.owner !== inst.id && seen.owner !== null && instances.has(seen.owner) ? null : inst.id;
  layoutById.set(id, { rect: { x: Number(e.x), y: Number(e.y), w: Number(e.w), h: Number(e.h) }, owner });
}

/** Rune reports an element's layout when its rect changes under the same key, and an `id` is the
 *  key: an element remounted under the same id in the same place is never told its rect. Each
 *  such element is handed the rect its predecessor last heard: when the predecessor went in the
 *  same commit (a loading placeholder and the list replacing it, sharing one id), and for every
 *  remount while `replayLayouts(true)` holds (a hot swap, whose old tree goes over several). */
let swapping = false;
let fresh: Instance[] = [];
/** The ids whose reporting element was released since the last replay. */
const gone = new Set<string>();
export function replayLayouts(on: boolean) {
  swapping = on;
  if (!on) for (const [id, seen] of layoutById) if (seen.owner !== null && !instances.has(seen.owner)) layoutById.delete(id);
}

function replayFresh() {
  const list = fresh;
  const left = [...gone];
  fresh = [];
  gone.clear();
  for (const inst of list) {
    const id = layoutKey(inst);
    const seen = id !== undefined ? layoutById.get(id) : undefined;
    if (id === undefined || !seen || seen.owner === null || seen.owner === inst.id || instances.has(seen.owner) || !instances.has(inst.id) || !inst.handlers.layout) continue;
    if (!swapping && !left.includes(id)) continue;
    layoutById.set(id, { rect: seen.rect, owner: inst.id });
    dispatchElement({ t: "ev", n: inst.id, e: "layout", seq: 0, at: performance.timeOrigin + performance.now(), ...seen.rect });
  }
  // Outside a swap, a rect no successor took is never handed on.
  if (!swapping) for (const id of left) { const seen = layoutById.get(id); if (seen && seen.owner !== null && !instances.has(seen.owner)) layoutById.delete(id); }
}

/** The live element holding each `id` with a layout handler, and the ids of released ones, so
 *  a layout reaching the host after its element was replaced under the same id (the engine drew
 *  the old element while the host was still committing its successor; Rune won't report the
 *  same key and rect again) goes to the successor, when that hasn't heard one yet. */
const layoutHolder = new Map<string, Instance>();
const releasedIds = new Map<number, string>();
/** Live host elements, for leak checks (the phone's dev JS perf log). */
export const liveInstances = () => instances.size;

function heir(e: ElementEvent): Instance | undefined {
  if (e.e !== "layout") return undefined;
  const id = releasedIds.get(e.n);
  const next = id !== undefined ? layoutHolder.get(id) : undefined;
  return next && layoutById.get(id!)?.owner !== next.id ? next : undefined;
}

setElementDispatch(dispatchElement);
function dispatchElement(e: ElementEvent) {
  let inst = instances.get(e.n);
  if (!inst && (inst = heir(e))) e = { ...e, n: inst.id };
  if (inst && e.e === "layout") noteLayout(inst, e);
  const fn = inst?.handlers[e.e];
  if (!fn) return;
  const discrete = DISCRETE.has(e.e);
  const previous = currentPriority;
  pressKeys = e.e === "press" && e.keys === true;
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
    pressKeys = false;
  }
}

let currentPriority = DefaultEventPriority;

function release(inst: Instance) {
  const id = layoutKey(inst);
  if (id !== undefined && layoutById.get(id)?.owner === inst.id) gone.add(id);
  if (id !== undefined && inst.handlers.layout) {
    if (layoutHolder.get(id) === inst) layoutHolder.delete(id);
    releasedIds.set(inst.id, id);
    if (releasedIds.size > 256) releasedIds.delete(releasedIds.keys().next().value!);
  }
  instances.delete(inst.id);
  dropSrc(inst);
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

  createInstance(type: string, props: any, root: Container): Instance {
    const inst = new Instance(nextId++, type);
    instances.set(inst.id, inst);
    if (root?.scope) {
      inst.scope = root.scope;
      if (type === "window") {
        inst.forced = root.window ?? {};
        inst.prefix = root.windowPrefix ?? "";
      }
    }
    ops.create(inst.id, type);
    inst.json = serialize(inst, props);
    ops.props(inst.id, inst.json);
    if (typeof props.id === "string" && inst.handlers.layout) {
      fresh.push(inst);
      layoutHolder.set(layoutKey(inst)!, inst);
    }
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
  appendChildToContainer: (p: Container | Instance, c: Instance) => ops.append(p.id, c.id),
  insertBefore: (p: Instance, c: Instance, b: Instance) => ops.insert(p.id, c.id, b.id),
  insertInContainerBefore: (p: Container | Instance, c: Instance, b: Instance) => ops.insert(p.id, c.id, b.id),
  removeChild: (p: Instance, c: Instance) => { release(c); ops.remove(p.id, c.id); },
  removeChildFromContainer: (p: Container | Instance, c: Instance) => { release(c); ops.remove(p.id, c.id); },
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
    release(inst);
  },
  getRootHostContext: () => ({}),
  getChildHostContext: (ctx: object) => ctx,
  getPublicInstance: (i: Instance) => i,
  prepareForCommit: () => null,
  resetAfterCommit: () => {
    stats.renders++;
    joinTask();
    flushFrame(true);
    if (fresh.length && (swapping || gone.size)) queueMicrotask(replayFresh);
    else if (!swapping) { fresh = []; gone.clear(); }
  },
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
const container: Container = { id: 0, scope: "" };
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

/**
 * Renders `children` inside the host element `host` (a ref's current) from anywhere in the tree,
 * keeping context: for content that must sit outside an ancestor's transform or clip (the phone's
 * drawers beside its sliding page). `host` renders no React children of its own.
 */
export function elementPortal(children: ReactNode, host: HostElement, key?: string | null): ReactNode {
  return reconciler.createPortal(children, host, null, key ?? null) as unknown as ReactNode;
}

const prefixed = (prefix: string, id: unknown) => {
  const own = typeof id === "string" ? id : "";
  return own.startsWith(prefix) ? own : `${prefix}${own}`;
};

export type ScopedRoot = {
  render(el: ReactNode): void;
  windowPortal(children: ReactNode, key?: string | null): ReactNode;
  unmount(): void;
};

/**
 * A root of its own beside the app's (the draft preview's): its windows get `window` props (an
 * isolated off-screen window), ids starting with `windowPrefix`, and its elements' layouts are
 * kept apart from the app's, which uses the same ids. A render that throws unmounts only this
 * root and reaches `onError`.
 */
export function createScopedRoot(scope: string, window: Record<string, unknown>, windowPrefix: string, onError: (error: unknown) => void): ScopedRoot {
  const own: Container = { id: 0, scope, window, windowPrefix };
  const report = (error: unknown) => onError(error);
  const r = reconciler.createContainer(own, ConcurrentRoot, null, false, null, `${scope}:`, report, report, console.error, () => {}, null);
  return {
    render(el) {
      reconciler.updateContainerSync(el, r, null, null);
      reconciler.flushSyncWork();
    },
    windowPortal(children, key) {
      return reconciler.createPortal(children, own, null, key ?? null) as unknown as ReactNode;
    },
    unmount() {
      reconciler.updateContainerSync(null, r, null, null);
      reconciler.flushSyncWork();
    },
  };
}

/** What a ref to a host element gives. */
export type HostElement = Pick<Instance, "id" | "set">;

/** The engine node id of a host element (from a ref). */
export const nodeId = (ref: unknown): number | undefined => (ref as Instance | null)?.id;

/**
 * Closes the innermost open modal (a dialog, sheet, menu or popover) through its `onDismiss`, as
 * Escape does: what a phone's back button closes first. False when none is open.
 */
export function dismissTopModal(): boolean {
  let top: Instance | undefined;
  for (const inst of instances.values()) {
    const p = inst.react;
    if (inst.scope !== "" || !p.modal || p.hidden || p.inert || !inst.handlers.dismiss) continue;
    if (!top || inst.id > top.id) top = inst;
  }
  const dismiss = top?.handlers.dismiss;
  if (!dismiss) return false;
  const previous = currentPriority;
  currentPriority = DiscreteEventPriority;
  try {
    batched(() => dismiss());
    reconciler.flushSyncWork();
  } finally {
    currentPriority = previous;
  }
  return true;
}
