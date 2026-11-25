// A React host config whose host components are Rune elements: <row>, <col>, <box>, <text>, <input>.
// Mutations become bridge ops; the engine keeps the retained tree.

import Reconciler from "react-reconciler";
import { DefaultEventPriority } from "react-reconciler/constants";
import { createContext } from "react";
import { commitCtx, flushFrame, ops } from "./bridge";

type Instance = { id: number; type: string; json: string; key?: string };
type Container = { id: 0 };

let nextId = 1;
/** Handlers by element key; the engine reports presses/edits by key. */
export const handlers = new Map<string, { onPress?: () => void; onInput?: (v: string) => void; onSubmit?: (v: string) => void }>();

function textOf(children: unknown): string | undefined {
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children) && children.every((c) => typeof c === "string" || typeof c === "number")) return children.join("");
  return undefined;
}

function serialize(inst: Instance, props: Record<string, any>): string {
  const out: Record<string, unknown> = {};
  let key: string | undefined = props.id;
  const h: { onPress?: any; onInput?: any; onSubmit?: any } = {};
  for (const k in props) {
    const v = props[k];
    if (k === "children" || v === undefined || v === null || v === false) continue;
    if (k === "onPress" || k === "onInput" || k === "onSubmit") { (h as any)[k] = v; continue; }
    out[k] = v;
  }
  if (inst.type === "text") {
    const t = textOf(props.children);
    if (t !== undefined) out.content = t;
  }
  if (h.onPress || h.onInput || h.onSubmit) {
    if (!key) { key = `h${inst.id}`; out.id = key; }
    handlers.set(key, h);
    if (h.onPress) out.onPress = true;
  }
  if (inst.key && inst.key !== key) handlers.delete(inst.key);
  inst.key = key;
  return JSON.stringify(out);
}

let currentPriority = DefaultEventPriority;

const config: any = {
  rendererPackageName: "stella-rune",
  rendererVersion: "0.0.1",
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
    const inst: Instance = { id: nextId++, type, json: "" };
    ops.create(inst.id, type);
    inst.json = serialize(inst, props);
    ops.props(inst.id, inst.json);
    return inst;
  },
  createTextInstance(text: string): Instance {
    // A bare string outside <text>: draw it as a text node.
    const inst: Instance = { id: nextId++, type: "text", json: JSON.stringify({ content: text }) };
    ops.create(inst.id, "text");
    ops.props(inst.id, inst.json);
    return inst;
  },
  shouldSetTextContent: (type: string, props: any) => type === "text" || textOf(props.children) !== undefined && type !== "row" && type !== "col",
  appendInitialChild: (p: Instance, c: Instance) => ops.append(p.id, c.id),
  appendChild: (p: Instance, c: Instance) => ops.append(p.id, c.id),
  appendChildToContainer: (_: Container, c: Instance) => ops.append(0, c.id),
  insertBefore: (p: Instance, c: Instance, b: Instance) => ops.insert(p.id, c.id, b.id),
  insertInContainerBefore: (_: Container, c: Instance, b: Instance) => ops.insert(0, c.id, b.id),
  removeChild: (p: Instance, c: Instance) => { if (c.key) handlers.delete(c.key); ops.remove(p.id, c.id); },
  removeChildFromContainer: (_: Container, c: Instance) => { if (c.key) handlers.delete(c.key); ops.remove(0, c.id); },
  commitUpdate(inst: Instance, _type: string, _old: any, next: any) {
    const json = serialize(inst, next);
    if (json !== inst.json) { inst.json = json; ops.props(inst.id, json); }
  },
  commitTextUpdate(inst: Instance, _old: string, text: string) {
    inst.json = JSON.stringify({ content: text });
    ops.props(inst.id, inst.json);
  },
  finalizeInitialChildren: () => false,
  commitMount() {},
  resetTextContent() {},
  clearContainer() {},
  hideInstance() {}, unhideInstance() {}, hideTextInstance() {}, unhideTextInstance() {},
  detachDeletedInstance() {},
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

// @types/react-reconciler (0.32) lags the 0.33 runtime's sync APIs; type what we use.
const reconciler = Reconciler(config) as ReturnType<typeof Reconciler> & {
  updateContainerSync(el: React.ReactNode, root: unknown, parent: null, cb: null): void;
  flushSyncWork(): void;
};
const container: Container = { id: 0 };
// Legacy root: updates outside React events render synchronously, so one engine event = one commit.
const root = reconciler.createContainer(container, 0, null, false, null, "", console.error, console.error, console.error, () => {}, null);

export function render(el: React.ReactNode, ctx?: Partial<typeof commitCtx>) {
  if (ctx) Object.assign(commitCtx, ctx);
  reconciler.updateContainerSync(el, root, null, null);
  reconciler.flushSyncWork();
}

export const batched = (fn: () => void) => reconciler.batchedUpdates(fn, null);
