// The UI as live modules (built by ui-modules-build.ts). Each module is its own factory, evaluated
// in a ui-scope generation of its own, so a hot swap re-evaluates only what changed and every
// other module keeps its state: stores, caches, loaded conversations, object URLs. What a module
// imports is another's stable facade, read live, so importers see new exports without being
// evaluated again.
//
// Components swap in place, as Fast Refresh does, without React's development-only hooks: a
// module's top-level components (exported, or rendered by it as JSX) are handed out as stable
// stand-ins that render its current implementation, so the tree keeps its fibers, engine nodes,
// state, scroll offsets and focus. After a swap every stand-in re-renders (they read
// RefreshContext), and the effects, memos and callbacks of a component whose code changed run
// again (their deps carry its family's epoch). A module that exports anything but components
// re-evaluates its importers too, up to modules of components only. When a re-evaluated module's
// hook calls change, the root remounts (keyed), still over the kept modules. A failed evaluation
// puts every touched module back.

import type * as ReactNS from "react";
import path from "node:path";
import { evaluateInScope, mapFileLines, type UiScope } from "./ui-scope";
import { declaredExports, DEPS_KEY, type DepsInfo, type ModuleNode } from "./ui-modules-format";

type React = typeof ReactNS;
type Factory = (exports: object, require: Require, module: { exports: any }, filename: string, dirname: string) => void;
type Require = ((id: string) => unknown) & { dynamic(id: string): PromiseLike<unknown>; component(value: unknown, name: string): unknown };
/** A module's code: factory source to evaluate, or a factory from a loaded file (the boot file). */
export type ModuleCode = string | Factory;
export type RegistryBuild = {
  entry: string;
  graph: { [file: string]: ModuleNode };
  code: { [file: string]: ModuleCode };
  names: { [file: string]: string[] };
  exports?: { [file: string]: string[] };
  helpers?: { hashes: { [name: string]: string }; code?: ModuleCode };
  deps: DepsInfo & { code?: ModuleCode };
};

type Instance = {
  gen: number;
  module: { exports: any };
  scope: UiScope | null;
  code: ModuleCode;
  hooks?: string;
  names: Set<string>;
  keys: string;
  require: Require;
  /** Its top-level components that it renders as JSX, by local name. */
  locals: Map<string, unknown>;
};

type Entry = {
  file: string;
  hash: string;
  code: ModuleCode | null;
  names: string[];
  /** Its declared export names, from the build (null: read them from its code). */
  exports: string[] | null;
  instance: Instance | null;
  /** Its instance is out of date: the next require evaluates it again. */
  pending: boolean;
  facade: { [key: string]: unknown };
  families: Map<string, Family>;
  cjs: boolean;
};

type Family = {
  id: string;
  current: any;
  /** Bumped when its implementation changes: its components' effects and memos run again. */
  epoch: number;
  standIn: any;
  kind: "function" | "memo" | "forwardRef";
};

export type SwapResult = { kind: "boot" | "refresh" | "remount"; evaluated: number; changed: number; reason?: string };

const MEMO = Symbol.for("react.memo");
const FORWARD_REF = Symbol.for("react.forward_ref");
const HOOK_CALL = /\buse[A-Z][\w$]*\s*\(/g;
const DEPS_HOOKS = ["useEffect", "useLayoutEffect", "useInsertionEffect", "useMemo", "useCallback"] as const;

export type UiRegistryOptions = {
  /** The host's require: React and Node builtins resolve here. */
  hostRequire: NodeRequire;
  /** Free identifiers each factory sees in place of the host's globals (a draft preview's). */
  globals?: () => { [name: string]: unknown };
  /** A fresh ui-scope generation id. */
  nextGeneration: () => number;
  /** The code of a module the build left out of `code` (a lazy group of the boot file), loaded on its first require. */
  lazy?: (file: string) => { code: { [file: string]: ModuleCode }; names: { [file: string]: string[] } } | null;
};

export function createUiRegistry(options: UiRegistryOptions) {
  const React = options.hostRequire("react") as React;
  const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE as { H: any } | undefined;
  const RefreshContext = React.createContext(0);
  const entries = new Map<string, Entry>();
  let importers = new Map<string, Set<string>>();
  let entryFile = "";
  let deps: { info: DepsInfo; exports: any; scope: UiScope | null; gen: number } | null = null;
  /** Bun's runtime helpers the factories share (ui-modules-build.ts `shareHelpers`). */
  let helpers: { hashes: { [name: string]: string }; value: object } | null = null;
  const depValues = new Map<string, unknown>();
  let refreshEpoch = 0;
  let remountEpoch = 0;
  /** The family whose component is rendering now (effects and memos read its epoch). */
  let rendering: Family | null = null;
  const replaced: UiScope[] = [];
  const aliveReplaced = new Map<number, number>();
  const collected = new FinalizationRegistry<number>((gen) => {
    const left = (aliveReplaced.get(gen) ?? 1) - 1;
    if (left <= 0) aliveReplaced.delete(gen);
    else aliveReplaced.set(gen, left);
  });
  /** Generations of modules evaluated from a file of many (`?swapfile`), by the line their factory starts on. */
  const fileOwners = new Map<string, { starts: number[]; files: string[]; gens: Map<string, number> }>();

  // ---------------------------------------------------------------- React as the UI sees it
  const isRendering = () => {
    const H = internals?.H;
    return H != null && H.useState !== H.useEffect;
  };
  const withEpoch = (list: unknown) => (Array.isArray(list) ? [...list, rendering ? rendering.epoch : 0] : list);
  const uiReact: any = Object.assign(Object.create(null), React);
  for (const name of DEPS_HOOKS) {
    const hook = (React as any)[name];
    uiReact[name] = (fn: unknown, list?: unknown) => hook(fn, withEpoch(list));
  }
  const useImperativeHandle = React.useImperativeHandle as any;
  uiReact.useImperativeHandle = (ref: unknown, create: unknown, list?: unknown) => useImperativeHandle(ref, create, withEpoch(list));

  // ---------------------------------------------------------------- stand-ins
  const standIns = new WeakSet<object>();
  const kinds = new WeakMap<object, Family["kind"] | null>();
  const families = new Map<string, Family>();
  /** Families whose next implementation gets a new stand-in: their hook calls changed, so they remount. */
  const resets = new Set<string>();

  const callAs = (family: Family, impl: () => unknown) => {
    if (isRendering()) React.use(RefreshContext);
    const previous = rendering;
    rendering = family;
    try {
      return impl();
    } finally {
      rendering = previous;
    }
  };

  const kindOf = (value: unknown, name: string): Family["kind"] | null => {
    if (typeof value === "function") {
      if (!/^[A-Z]/.test(value.name || name)) return null;
      const proto = (value as { prototype?: object }).prototype;
      if (proto && ((proto as any).isReactComponent || Object.getOwnPropertyNames(proto).length > 1)) return null;
      // A class's prototype is read-only (and toString would keep its source text alive).
      if (Object.getOwnPropertyDescriptor(value, "prototype")?.writable === false) return null;
      return "function";
    }
    const type = (value as { $$typeof?: symbol }).$$typeof;
    if (type === MEMO) return typeof (value as { type?: unknown }).type === "function" ? "memo" : null;
    if (type === FORWARD_REF) return "forwardRef";
    return null;
  };
  const componentKind = (value: unknown, name: string): Family["kind"] | null => {
    if (value === null || (typeof value !== "function" && typeof value !== "object")) return null;
    if (standIns.has(value as object)) return null;
    let kind = kinds.get(value as object);
    if (kind === undefined) kinds.set(value as object, (kind = kindOf(value, name)));
    return kind;
  };

  const forwardStatics = (standIn: any, family: Family) => {
    const impl = family.current;
    if (typeof impl !== "function") return;
    for (const key of Object.keys(impl)) {
      if (Object.prototype.hasOwnProperty.call(standIn, key)) continue;
      Object.defineProperty(standIn, key, { get: () => family.current?.[key], enumerable: true, configurable: true });
    }
  };

  const functionStandIn = (family: Family, name: string) => {
    const standIn = function (this: unknown, props: unknown, second: unknown) {
      return callAs(family, () => family.current.call(this, props, second));
    };
    Object.defineProperty(standIn, "name", { value: name });
    standIns.add(standIn);
    return standIn;
  };

  /** The family for component `id` now implemented by `value`; null when `value` isn't a component. */
  function familyFor(id: string, value: any, inner = false): Family | null {
    const kind = inner ? (typeof value === "function" ? "function" : null) : componentKind(value, id.slice(id.lastIndexOf("#") + 1));
    if (!kind) return null;
    let family = families.get(id);
    if (family && (family.kind !== kind || (resets.has(id) && family.current !== value))) family = undefined;
    resets.delete(id);
    if (!family) {
      family = { id, current: value, epoch: 0, standIn: null, kind };
      if (kind === "function") {
        family.standIn = functionStandIn(family, value.name || id.slice(id.lastIndexOf("#") + 1));
        forwardStatics(family.standIn, family);
      } else if (kind === "memo") {
        const inner = familyFor(`${id}.type`, value.type, true)!;
        value.type = inner.standIn;
        family.standIn = value;
      } else {
        const inner: Family = { id: `${id}.render`, current: value.render, epoch: 0, standIn: null, kind: "function" };
        inner.standIn = function (props: unknown, ref: unknown) {
          return callAs(inner, () => inner.current(props, ref));
        };
        families.set(inner.id, inner);
        value.render = inner.standIn;
        family.standIn = value;
      }
      standIns.add(family.standIn);
      families.set(id, family);
      return family;
    }
    if (family.current === value) return family;
    family.current = value;
    if (kind === "function") {
      family.epoch++;
      forwardStatics(family.standIn, family);
    } else if (kind === "memo") {
      const inner = familyFor(`${id}.type`, value.type, true)!;
      family.standIn.compare = value.compare;
      family.standIn.type = inner.standIn;
    } else {
      const inner = families.get(`${id}.render`)!;
      if (inner.current !== value.render) {
        inner.current = value.render;
        inner.epoch++;
      }
    }
    return family;
  }

  const exported = (entry: Entry, key: string) => {
    const value = entry.instance?.module.exports?.[key];
    if (value === null || (typeof value !== "function" && typeof value !== "object") || standIns.has(value)) {
      entry.families.delete(key);
      return value;
    }
    const known = entry.families.get(key);
    if (known && known.current === value) return known.standIn;
    const local = typeof value === "function" && entry.instance?.names.has(value.name) ? value.name : key;
    const family = familyFor(`${entry.file}#${local}`, value);
    if (family) entry.families.set(key, family);
    else entry.families.delete(key);
    return family ? family.standIn : value;
  };

  // ---------------------------------------------------------------- modules
  const entryOf = (file: string): Entry => {
    let entry = entries.get(file);
    if (!entry) {
      const facade = {};
      Object.defineProperty(facade, "__esModule", { value: true });
      entry = { file, hash: "", code: null, names: [], exports: null, instance: null, pending: false, facade, families: new Map(), cjs: false };
      entries.set(file, entry);
    }
    return entry;
  };

  const defineKey = (entry: Entry, key: string) => {
    if (key === "__esModule" || Object.prototype.hasOwnProperty.call(entry.facade, key)) return;
    Object.defineProperty(entry.facade, key, { get: () => exported(entry, key), enumerable: true, configurable: true });
  };

  /** Export names a Bun factory declares up front (`__export(exports_x, { a: () => a, ... })`), so a cycle sees them early. */
  const syncFacade = (entry: Entry) => {
    const exports = entry.instance?.module.exports;
    entry.cjs = exports == null || (typeof exports !== "object" && typeof exports !== "function") || !exports.__esModule;
    if (entry.cjs) return;
    const keys = Object.getOwnPropertyNames(exports).filter((k) => k !== "__esModule");
    for (const key of Object.keys(entry.facade)) if (!keys.includes(key)) delete entry.facade[key];
    for (const key of keys) defineKey(entry, key);
  };

  const sourceOf = (code: ModuleCode) => (typeof code === "function" ? `(${Function.prototype.toString.call(code)})` : code);
  const hooksOf = (instance: Instance) => (instance.hooks ??= (sourceOf(instance.code).match(HOOK_CALL) ?? []).join(","));

  /** Hook calls of each top-level declaration of a factory, by name (`""`: those outside any). */
  const hooksByDeclaration = (instance: Instance): Map<string, string> => {
    const source = sourceOf(instance.code);
    const body = source.indexOf("{") + 1;
    const indent = /\n?([ \t]*)\S/.exec(source.slice(body))?.[1] ?? "";
    const decl = new RegExp(`^${indent}(?:export )?(?:async )?(?:function\\*? |var |let |const |class )([\\w$]+)`, "gm");
    const starts: Array<{ name: string; at: number }> = [{ name: "", at: 0 }];
    for (const match of source.matchAll(decl)) starts.push({ name: match[1]!, at: match.index! });
    const out = new Map<string, string>();
    starts.forEach((start, n) => {
      const text = source.slice(start.at, starts[n + 1]?.at ?? source.length);
      const hooks = (text.match(HOOK_CALL) ?? []).join(",");
      out.set(start.name, out.has(start.name) ? `${out.get(start.name)};${hooks}` : hooks);
    });
    return out;
  };

  /** Families of `file` to remount because their hook calls changed; null when a change is outside its components. */
  const changedHookFamilies = (file: string, was: Instance, now: Instance): string[] | null => {
    const before = hooksByDeclaration(was);
    const after = hooksByDeclaration(now);
    const names = new Set([...before.keys(), ...after.keys()]);
    const changed: string[] = [];
    for (const name of names) {
      if ((before.get(name) ?? "") === (after.get(name) ?? "")) continue;
      if (!now.names.has(name) && !was.names.has(name) && !componentKind(now.module.exports?.[name], name)) return null;
      changed.push(name);
    }
    const exports = now.module.exports ?? {};
    const ids: string[] = [];
    for (const key of Object.keys(exports)) {
      let value: any;
      try { value = exports[key]; } catch { continue; }
      const own = typeof value === "function" ? value.name : value?.type?.name ?? value?.render?.name;
      if (changed.includes(key) || (own && changed.includes(own))) ids.push(`${file}#${key}`);
    }
    for (const name of changed) ids.push(`${file}#${name}`);
    return ids;
  };

  const compile = (source: string, file: string, gen: number): Factory => {
    const globals = options.globals?.();
    const url = `//# sourceURL=${file}?swap=${gen}`;
    if (!globals) return (0, eval)(`${source}\n${url}`) as Factory;
    const names = Object.keys(globals).filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
    // Shadowed on the factory's first line, so its line numbers stay its own.
    const outer = (0, eval)(`(function (__globals) { var ${names.map((n) => `${n} = __globals.${n}`).join(", ")}; return (${source}\n); })\n${url}`);
    return outer(globals) as Factory;
  };

  const requireFor = (entry: Entry, instance: () => Instance): Require =>
    Object.assign((id: string) => resolve(id), {
      dynamic,
      helpers: helpers?.value,
      component(value: unknown, name: string) {
        const own = instance();
        if (entry.instance !== own) return families.get(`${entry.file}#${name}`)?.standIn ?? value;
        const known = own.locals.get(name);
        if (known !== undefined && families.get(`${entry.file}#${name}`)?.current === value) return known;
        const family = familyFor(`${entry.file}#${name}`, value);
        const standIn = family ? family.standIn : value;
        own.locals.set(name, standIn);
        return standIn;
      },
    });

  /** Evaluates `entry` as a new instance; the old one, if any, is the caller's to keep or retire. */
  const instantiate = (entry: Entry): Instance => {
    if (entry.code === null) {
      const loaded = options.lazy?.(entry.file);
      for (const [file, code] of Object.entries(loaded?.code ?? {})) {
        const other = entries.get(file);
        if (!other || other.code !== null) continue;
        other.code = code;
        other.names = loaded!.names[file] ?? [];
      }
      if (entry.code === null) throw new Error(`UI module ${entry.file} has no code`);
    }
    const gen = options.nextGeneration();
    const module = { exports: {} as any };
    const code = entry.code;
    let factory: Factory;
    // A file's factory runs as itself once (its lines map to this generation); again, it is evaluated anew.
    if (typeof code === "function" && !entry.instance && !booted.has(entry.file)) {
      factory = code;
      booted.add(entry.file);
      bootGen(entry.file, gen);
    } else {
      factory = compile(sourceOf(code), entry.file, gen);
    }
    const instance: Instance = { gen, module, scope: null, code, names: new Set(entry.names), keys: "", require: null!, locals: new Map() };
    instance.require = requireFor(entry, () => instance);
    const before = entry.instance;
    entry.instance = instance;
    entry.pending = false;
    // Never toString a boot factory here: JSC caches the text on the function for as long as it lives.
    for (const name of entry.exports ?? (typeof code === "string" ? declaredExports(code) : [])) defineKey(entry, name);
    try {
      const { scope } = evaluateInScope(gen, () => factory.call(module.exports, module.exports, instance.require, module, entry.file, path.dirname(entry.file)));
      instance.scope = scope;
    } catch (error) {
      entry.instance = before;
      throw error;
    }
    syncFacade(entry);
    instance.keys = Object.keys(entry.facade).sort().join(",");
    return instance;
  };

  let txn: { touched: Map<Entry, { instance: Instance | null; code: ModuleCode | null; names: string[]; exports: string[] | null; hash: string; pending: boolean }>; evaluated: Set<Entry> } | null = null;
  const touch = (entry: Entry) => {
    if (txn && !txn.touched.has(entry)) txn.touched.set(entry, { instance: entry.instance, code: entry.code, names: entry.names, exports: entry.exports, hash: entry.hash, pending: entry.pending });
  };

  const ensure = (entry: Entry) => {
    if (entry.instance && !entry.pending) return;
    touch(entry);
    instantiate(entry);
    txn?.evaluated.add(entry);
  };

  const depValue = (file: string, kind: "d" | "r"): unknown => {
    const key = `${kind}:${file}`;
    if (depValues.has(key)) return depValues.get(key);
    const info = deps?.info.entries[file];
    if (!deps || !info) throw new Error(`UI package ${file} isn't in the deps bundle`);
    const ns = deps.exports[info.name];
    let value: unknown = ns;
    if (kind === "r" && info.cjs) value = ns?.default;
    else if (ns && !ns.__esModule) {
      const facade = {};
      Object.defineProperty(facade, "__esModule", { value: true });
      for (const name of Object.getOwnPropertyNames(ns)) Object.defineProperty(facade, name, { get: () => ns[name], enumerable: true });
      value = facade;
    }
    depValues.set(key, value);
    return value;
  };

  const host = (spec: string) => (spec === "react" ? uiReact : options.hostRequire(spec));

  function resolve(id: string): unknown {
    const raw = id.charCodeAt(0) === 0 ? id.slice(1) : id;
    if (raw[1] !== ":") return host(raw);
    const tag = raw[0];
    const target = raw.slice(2);
    if (tag === "x") return host(target);
    if (tag === "d" || tag === "r") return depValue(target, tag);
    const entry = entries.get(target);
    if (!entry) throw new Error(`UI module ${target} isn't in the build`);
    ensure(entry);
    return entry.cjs ? entry.instance!.module.exports : entry.facade;
  }

  /** `import()` of a UI module, loaded now: an already-fulfilled thenable that `use()` reads on the same render. */
  function dynamic(id: string): PromiseLike<unknown> {
    try {
      const value = resolve(id);
      return Object.assign(Promise.resolve(value), { status: "fulfilled", value });
    } catch (error) {
      const rejected = Object.assign(Promise.reject(error), { status: "rejected", reason: error });
      rejected.catch(() => {});
      return rejected;
    }
  }

  // ---------------------------------------------------------------- files of many modules
  const booted = new Set<string>();
  function bootGen(file: string, gen: number) {
    for (const owner of fileOwners.values()) owner.gens.set(file, gen);
  }

  /** Code from `url` (`?swapfile`): `starts` gives each module's first line there. */
  function mapFile(url: string, starts: { [file: string]: number }) {
    const sorted = Object.entries(starts).sort((a, b) => a[1] - b[1]);
    const owner = { starts: sorted.map(([, line]) => line), files: sorted.map(([file]) => file), gens: new Map<string, number>() };
    fileOwners.set(url, owner);
    mapFileLines(url, (line) => {
      let lo = 0;
      let hi = owner.starts.length - 1;
      let at = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (owner.starts[mid]! <= line) { at = mid; lo = mid + 1; } else hi = mid - 1;
      }
      return at < 0 ? undefined : owner.gens.get(owner.files[at]!);
    });
  }

  // ---------------------------------------------------------------- builds
  const setGraph = (graph: { [file: string]: ModuleNode }) => {
    const next = new Map<string, Set<string>>();
    for (const [file, node] of Object.entries(graph)) {
      for (const id of node.imports) {
        if (id[0] !== "m" && id[0] !== "i") continue;
        const target = id.slice(2);
        let set = next.get(target);
        if (!set) next.set(target, (set = new Set()));
        set.add(file);
      }
    }
    importers = next;
  };

  const loadDeps = (info: DepsInfo, code: ModuleCode) => {
    const gen = options.nextGeneration();
    const module = { exports: {} as any };
    const file = path.join(path.dirname(entryFile), "ui-packages.js");
    const realRequire = ((spec: string) => options.hostRequire(spec)) as Require;
    if (typeof code === "function") bootGen(DEPS_KEY, gen);
    const factory = typeof code === "function" ? code : compile(code, file, gen);
    const { scope } = evaluateInScope(gen, () => factory.call(module.exports, module.exports, realRequire, module, file, path.dirname(file)));
    deps = { info, exports: module.exports, scope, gen };
    depValues.clear();
  };

  const isBoundary = (entry: Entry, keysBefore: string) => {
    if (entry.cjs) return false;
    const keys = Object.keys(entry.facade).sort();
    if (keys.length === 0 || keys.join(",") !== keysBefore) return false;
    const exports = entry.instance!.module.exports;
    return keys.every((key) => {
      const value = exports[key];
      return value !== null && (typeof value === "function" || typeof value === "object") && (standIns.has(value) || componentKind(value, key) !== null);
    });
  };

  function retireLater(instance: Instance) {
    if (instance.scope) replaced.push(instance.scope);
    let n = 0;
    const exports = instance.module.exports;
    if (exports && typeof exports === "object") {
      for (const key of Object.getOwnPropertyNames(exports)) {
        let value: unknown;
        try { value = exports[key]; } catch { continue; }
        if (typeof value === "function" && !standIns.has(value)) {
          collected.register(value, instance.gen);
          n++;
        }
      }
    }
    if (n > 0) aliveReplaced.set(instance.gen, n);
  }

  function rollback(t: NonNullable<typeof txn>) {
    resets.clear();
    for (const [entry, old] of t.touched) {
      const fresh = entry.instance;
      entry.instance = old.instance;
      entry.code = old.code;
      entry.names = old.names;
      entry.exports = old.exports;
      entry.hash = old.hash;
      entry.pending = old.pending;
      if (fresh && fresh !== old.instance) fresh.scope?.dispose();
    }
    for (const entry of t.touched.keys()) {
      if (!entry.instance) continue;
      syncFacade(entry);
      for (const key of Object.keys(entry.facade)) exported(entry, key);
    }
  }

  return {
    /** What the builder is told the registry has: every module's hash, and the deps bundle's. */
    have() {
      const out: { [file: string]: string } = {};
      // A module whose code is still in an unopened lazy file counts: the builder need not send it.
      for (const [file, entry] of entries) if (entry.hash) out[file] = entry.hash;
      return { have: out, deps: deps?.info.hash ?? null, helpers: helpers?.hashes ?? null };
    },
    /** Whether `build` can swap into this registry (its packages are the same). */
    accepts(build: RegistryBuild) {
      return !deps || build.deps.hash === deps.info.hash;
    },
    /** Lines of a `?swapfile` file of factories (the boot file), for ui-scope. */
    mapFile,
    sharedHelpers: () => helpers,
    adoptHelpers(other: { sharedHelpers(): typeof helpers }) {
      helpers ??= other.sharedHelpers();
    },
    /** Applies a build: the first one boots, later ones swap what changed. */
    apply(build: RegistryBuild): SwapResult {
      const booting = !deps;
      if (booting) {
        if (!build.deps.code) throw new Error("the first UI build has no packages bundle");
        entryFile = build.entry;
        loadDeps(build.deps, build.deps.code);
        if (build.helpers?.code) {
          const code = build.helpers.code;
          const make = (typeof code === "function" ? code : (0, eval)(`${code}\n//# sourceURL=stella-ui-helpers.js`)) as () => object;
          helpers = { hashes: build.helpers.hashes, value: make() };
        }
      } else if (build.deps.hash !== deps!.info.hash) {
        throw new Error("the UI's packages changed; it needs a fresh registry");
      }
      txn = booting ? null : { touched: new Map(), evaluated: new Set() };
      const t = txn;
      const changed: Entry[] = [];
      for (const [file, node] of Object.entries(build.graph)) {
        const entry = entryOf(file);
        const code = build.code[file];
        if (code === undefined) {
          entry.hash ||= node.hash;
          if (entry.code === null && build.exports?.[file]) entry.exports = build.exports[file]!;
          continue;
        }
        if (entry.hash === node.hash && entry.code !== null) continue;
        touch(entry);
        entry.hash = node.hash;
        entry.code = code;
        entry.names = build.names[file] ?? [];
        entry.exports = build.exports ? (build.exports[file] ?? []) : null;
        if (entry.instance) {
          entry.pending = true;
          changed.push(entry);
        }
      }
      setGraph(build.graph);
      entryFile = build.entry;
      if (booting || !t) {
        ensure(entries.get(entryFile)!);
        return { kind: "boot", evaluated: entries.size, changed: 0 };
      }
      let remount: string | undefined;
      try {
        const queue = [...changed];
        const before = new Map<Entry, Instance>();
        for (const entry of changed) before.set(entry, entry.instance!);
        while (queue.length > 0) {
          const entry = queue.shift()!;
          ensure(entry);
          const was = before.get(entry)!;
          const boundary = isBoundary(entry, was.keys);
          if (hooksOf(was) !== hooksOf(entry.instance!)) {
            // Its components remount where they are; hooks others call remount the app.
            const ids = boundary ? changedHookFamilies(entry.file, was, entry.instance!) : null;
            if (ids) for (const id of families.keys()) { if (ids.some((own) => id === own || id.startsWith(`${own}.`))) resets.add(id); }
            else remount ??= `${path.basename(entry.file)} changed its hook calls`;
          }
          if (boundary) continue;
          for (const file of importers.get(entry.file) ?? []) {
            const other = entries.get(file);
            if (!other?.instance || t.evaluated.has(other) || other.pending) continue;
            touch(other);
            before.set(other, other.instance);
            other.pending = true;
            queue.push(other);
          }
        }
        if (entries.get(entryFile)!.pending || !entries.get(entryFile)!.instance) ensure(entries.get(entryFile)!);
        // Stand-ins captured at module level (memo(X), maps of components) never read the facade again.
        for (const entry of t.evaluated) for (const key of Object.keys(entry.facade)) exported(entry, key);
      } catch (error) {
        rollback(t);
        txn = null;
        throw error;
      }
      for (const [entry, old] of t.touched) if (old.instance && old.instance !== entry.instance) retireLater(old.instance);
      for (const [file, entry] of entries) {
        if (file in build.graph) continue;
        if (entry.instance) retireLater(entry.instance);
        entries.delete(file);
      }
      txn = null;
      refreshEpoch++;
      if (remount) remountEpoch++;
      return { kind: remount ? "remount" : "refresh", evaluated: t.evaluated.size, changed: changed.length, reason: remount };
    },
    /** The entry module's exports (stand-ins for its components). */
    entry(): { [key: string]: any } {
      const entry = entries.get(entryFile);
      if (!entry) throw new Error("no UI entry");
      ensure(entry);
      return entry.cjs ? entry.instance!.module.exports : entry.facade;
    },
    /** The app's tree under the refresh context, keyed by remounts. */
    wrap(node: ReactNS.ReactNode): ReactNS.ReactElement {
      return React.createElement(RefreshContext.Provider, { value: refreshEpoch }, React.createElement(React.Fragment, { key: `r${remountEpoch}` }, node));
    },
    /** Undoes what replaced instances registered; call once the swap's tree has committed and its effects ran. */
    retireReplaced() {
      for (const scope of replaced.splice(0)) scope.dispose();
    },
    /** Every module and the packages too: the UI is gone. */
    retireAll() {
      this.retireReplaced();
      for (const entry of entries.values()) entry.instance?.scope?.dispose();
      deps?.scope?.dispose();
      for (const url of fileOwners.keys()) mapFileLines(url, null);
      fileOwners.clear();
      entries.clear();
      deps = null;
    },
    /** Generations of replaced instances that are still reachable: a leak once swaps settle. */
    leaked(): number[] {
      return [...aliveReplaced.keys()];
    },
    size: () => entries.size,
  };
}

export type UiRegistry = ReturnType<typeof createUiRegistry>;
