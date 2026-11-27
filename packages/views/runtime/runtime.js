// Stella Views runtime: runs inside a PsychoScript live run, before the view's own code.
// It gives the view React-style components and hooks, renders them to the host-node tree of
// `src/protocol.ts`, and talks to the host only through `__host` (post, receive, sleep, now).
// `scripts/gen-runtime.ts` turns this file into `src/runtime.gen.ts`; run `bun run gen` after
// changing it.
const __sv_main = (() => {
  "use strict";
  const PROTOCOL = 1;
  const post = (message) => {
    __host.post(message);
  };

  // ------------------------------------------------------------------ elements

  const FRAGMENT = { $$frag: 1 };
  const host = (name) => ({ $$host: name });

  function h(type, props) {
    const all = props ? { ...props } : {};
    const count = arguments.length - 2;
    if (count === 1) all.children = arguments[2];
    else if (count > 1) {
      const children = [];
      for (let i = 2; i < arguments.length; i++) children.push(arguments[i]);
      all.children = children;
    }
    const key = all.key;
    if (key !== undefined) delete all.key;
    return { $$v: 1, type, props: all, key: key === undefined || key === null ? null : key };
  }

  const isElement = (value) => value !== null && typeof value === "object" && value.$$v === 1;

  function createContext(defaultValue) {
    const context = { $$context: 1, value: defaultValue };
    context.Provider = { $$provider: context };
    return context;
  }

  function memo(component, equal) {
    return { $$memo: component, equal: equal || shallowEqual };
  }

  function shallowEqual(a, b) {
    if (Object.is(a, b)) return true;
    if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    for (const k of ak) if (!Object.is(a[k], b[k])) return false;
    return true;
  }

  // ------------------------------------------------------------------ state

  let input = null;
  let root = null;
  let viewport = { width: 0, height: 0 };
  let theme = { dark: false, accent: "#3b82f6", platform: "desktop" };
  let storage = {};
  let data = null;
  let restore = {};

  /** Component instances by path: { type, hooks, out (last host children), props }. */
  let instances = new Map();
  let seen = new Set();
  const dirty = new Set();
  let current = null;
  let hookIndex = 0;
  /** Signature the compiler stamps on the next useState/useReducer call (its binding and initial value). */
  let pendingKey = null;
  const hookKey = (key) => { pendingKey = key; };
  let contextStack = [];
  let effects = [];

  /** Handler ids stay the same for the same node path and prop, so unchanged nodes stay equal. */
  let handlerIds = new Map();
  let usedHandlerIds = new Map();
  let handlers = new Map();
  let nextHandlerId = 1;
  let keyHandlers = new Map();
  let rev = 0;
  let scheduled = false;
  let renderAll = true;
  let lastKeys = "";

  function handlerFor(path, prop, fn) {
    const name = path + "#" + prop;
    let id = handlerIds.get(name);
    if (id === undefined) id = nextHandlerId++;
    usedHandlerIds.set(name, id);
    handlers.set(id, fn);
    return id;
  }

  function schedule(instancePath) {
    if (instancePath !== undefined) dirty.add(instancePath);
    else renderAll = true;
    if (scheduled) return;
    scheduled = true;
    Promise.resolve().then(flush);
  }

  // ------------------------------------------------------------------ render

  const describe = (value) => {
    if (value === null) return "null";
    if (Array.isArray(value)) return "an array";
    if (typeof value === "object") return "an object (" + Object.keys(value).slice(0, 4).join(", ") + ")";
    return typeof value;
  };

  const childPath = (path, child, index) => (isElement(child) && child.key !== null ? path + "/k" + child.key : path + "/" + index);

  function renderInto(node, path, out) {
    if (node === null || node === undefined || node === false || node === true) return;
    if (typeof node === "string") {
      out.push(node);
      return;
    }
    if (typeof node === "number") {
      out.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) renderInto(node[i], childPath(path, node[i], i), out);
      return;
    }
    if (!isElement(node)) {
      throw new TypeError("A view can render elements, strings and numbers, not " + describe(node) + ".");
    }
    const type = node.type;
    if (type === FRAGMENT) {
      renderInto(node.props.children, path + "/f", out);
      return;
    }
    if (type && type.$$host) {
      out.push(renderHost(type.$$host, node, path));
      return;
    }
    if (type && type.$$provider) {
      contextStack.push({ context: type.$$provider, value: node.props.value });
      try {
        renderInto(node.props.children, path + "/p", out);
      } finally {
        contextStack.pop();
      }
      return;
    }
    if (typeof type === "function" || (type && type.$$memo)) {
      renderComponent(type, node.props, path, out);
      return;
    }
    throw new TypeError("Unknown element type: " + describe(type) + ". Import components from \"@stella/view\".");
  }

  function isDirtyBelow(path) {
    if (renderAll) return true;
    for (const p of dirty) if (p === path || p.startsWith(path + "/")) return true;
    return false;
  }

  function renderComponent(type, props, path, out) {
    const fn = type.$$memo || type;
    const name = fn.name || "C";
    const ipath = path + ":" + name;
    seen.add(ipath);
    let inst = instances.get(ipath);
    if (!inst || inst.fn !== fn) {
      if (inst) unmount(ipath, inst);
      inst = { fn, hooks: [], out: null, props: null, contexts: null };
      instances.set(ipath, inst);
    } else if (type.$$memo && inst.out && type.equal(inst.props, props) && !isDirtyBelow(ipath) && sameContexts(inst)) {
      markSeenBelow(ipath);
      for (const child of inst.out) out.push(child);
      return;
    }
    const saved = current;
    const savedIndex = hookIndex;
    current = { path: ipath, inst, keys: {} };
    hookIndex = 0;
    inst.contexts = [];
    let result;
    try {
      result = fn(props);
    } finally {
      current = saved;
      hookIndex = savedIndex;
    }
    const mine = [];
    renderInto(result, ipath, mine);
    inst.out = mine;
    inst.props = props;
    for (const child of mine) out.push(child);
  }

  function sameContexts(inst) {
    if (!inst.contexts) return true;
    for (const entry of inst.contexts) if (!Object.is(readContext(entry.context), entry.value)) return false;
    return true;
  }

  function markSeenBelow(path) {
    for (const p of instances.keys()) if (p === path || p.startsWith(path + "/")) seen.add(p);
    for (const [name, id] of handlerIds) if (name.startsWith(path)) usedHandlerIds.set(name, id);
  }

  /** Function props a host node calls while rendering (not handlers). */
  const RENDER_PROPS = { renderItem: 1, renderCell: 1, itemKey: 1, draw: 1 };

  function renderHost(type, element, path) {
    const props = element.props;
    const node = { t: type };
    if (element.key !== null) node.k = element.key;
    let p = null;
    let hs = null;
    for (const name in props) {
      if (name === "children") continue;
      const value = props[name];
      if (value === undefined) continue;
      if (RENDER_PROPS[name] === 1 && typeof value === "function") continue;
      if (typeof value === "function") {
        (hs || (hs = {}))[name] = handlerFor(path, name, wrapHandler(type, name, value, props));
        continue;
      }
      if (isElement(value) || (Array.isArray(value) && value.some(isElement))) {
        const slot = [];
        renderInto(value, path + "@" + name, slot);
        (p || (p = {}))[name] = { $slot: slot };
        continue;
      }
      (p || (p = {}))[name] = value;
    }
    if (type === "Canvas" && typeof props.draw === "function") (p || (p = {})).commands = drawCommands(props);
    if (type === "List" && Array.isArray(props.items) && typeof props.renderItem === "function") {
      const keyOf = typeof props.itemKey === "function" ? props.itemKey : (item, i) => (item && (item.id ?? item.key)) ?? i;
      const rows = [];
      const keys = [];
      for (let i = 0; i < props.items.length; i++) {
        const item = props.items[i];
        const key = keyOf(item, i);
        keys.push(key);
        const row = [];
        renderInto(props.renderItem(item, i), path + "/r" + key, row);
        rows.push(row);
      }
      p = p || {};
      delete p.items;
      p.rows = rows;
      p.rowKeys = keys;
    }
    if (type === "Table" && Array.isArray(props.rows) && typeof props.renderCell === "function") {
      const columns = Array.isArray(props.columns) ? props.columns : [];
      const cells = [];
      for (let r = 0; r < props.rows.length; r++) {
        const row = [];
        for (let c = 0; c < columns.length; c++) {
          const made = props.renderCell(props.rows[r], columns[c], r);
          if (made === undefined || made === null) {
            row.push(null);
            continue;
          }
          const slot = [];
          renderInto(made, path + "/c" + r + "." + c, slot);
          row.push(slot);
        }
        cells.push(row);
      }
      (p || (p = {})).cells = cells;
    }
    if (p) node.p = p;
    if (hs) node.h = hs;
    if (props.children !== undefined && props.children !== null) {
      const c = [];
      renderInto(props.children, path, c);
      if (c.length) node.c = c;
    }
    return node;
  }

  /** Host events carry one JSON value; handlers that take richer arguments are adapted here. */
  function wrapHandler(type, name, fn, props) {
    if (type === "Table" && name === "onRowPress") {
      const rows = props.rows || [];
      return (index) => fn(rows[index], index);
    }
    if (type === "Table" && name === "onSort") return (v) => fn(v && v.key, v && v.direction);
    return fn;
  }

  function drawCommands(props) {
    const commands = [];
    const push = (cmd) => {
      commands.push(cmd);
      return g;
    };
    const num = (v) => (typeof v === "number" && isFinite(v) ? Math.round(v * 100) / 100 : 0);
    const g = {
      width: props.width || 0,
      height: props.height || 0,
      clear: (color) => push(["clear", color || null]),
      rect: (x, y, w, h, style) => push(["rect", num(x), num(y), num(w), num(h), style || {}]),
      circle: (x, y, r, style) => push(["circle", num(x), num(y), num(r), style || {}]),
      ellipse: (x, y, rx, ry, style) => push(["ellipse", num(x), num(y), num(rx), num(ry), style || {}]),
      line: (x1, y1, x2, y2, style) => push(["line", num(x1), num(y1), num(x2), num(y2), style || {}]),
      path: (d, style) => push(["path", String(d), style || {}]),
      polyline: (points, style) => push(["poly", (points || []).map(num), style || {}]),
      text: (text, x, y, style) => push(["text", String(text), num(x), num(y), style || {}]),
      image: (src, x, y, w, h) => push(["image", String(src), num(x), num(y), num(w), num(h)]),
      save: () => push(["save"]),
      restore: () => push(["restore"]),
      translate: (x, y) => push(["translate", num(x), num(y)]),
      rotate: (radians) => push(["rotate", num(radians * 1000) / 1000]),
      scale: (x, y) => push(["scale", num(x), num(y === undefined ? x : y)]),
      alpha: (a) => push(["alpha", num(a)]),
    };
    props.draw(g);
    return commands;
  }

  function unmount(path, inst) {
    for (const hook of inst.hooks) {
      if (hook && hook.k === "effect" && typeof hook.cleanup === "function") {
        const cleanup = hook.cleanup;
        hook.cleanup = null;
        guard("effect", cleanup);
      }
    }
    instances.delete(path);
  }

  function flush() {
    scheduled = false;
    if (!root) return;
    seen = new Set();
    usedHandlerIds = new Map();
    handlers = new Map();
    keyHandlers = new Map();
    effects = [];
    const out = [];
    try {
      renderInto(h(root, null), "", out);
    } catch (error) {
      dirty.clear();
      renderAll = false;
      fail("render", error);
      return;
    }
    dirty.clear();
    renderAll = false;
    handlerIds = usedHandlerIds;
    for (const [path, inst] of instances) if (!seen.has(path)) unmount(path, inst);
    rev += 1;
    const keys = Array.from(keyHandlers.keys());
    const message = { t: "render", rev, tree: out.length === 0 ? null : out.length === 1 ? out[0] : { t: "Column", c: out } };
    const keyList = keys.join("\n");
    if (keyList !== lastKeys) {
      message.keys = keys;
      lastKeys = keyList;
    }
    post(message);
    const run = effects;
    effects = [];
    for (const effect of run) {
      if (typeof effect.hook.cleanup === "function") guard("effect", effect.hook.cleanup);
      effect.hook.cleanup = null;
      guard("effect", () => {
        const cleanup = effect.fn();
        effect.hook.cleanup = typeof cleanup === "function" ? cleanup : null;
      });
    }
  }

  // ------------------------------------------------------------------ hooks

  function hook(kind, make) {
    if (!current) throw new Error("Hooks can only be called inside a component, while it renders.");
    const inst = current.inst;
    const index = hookIndex++;
    // A hot swap carries state by signature, not position, like React Fast Refresh: a hook the
    // agent adds, removes or reorders doesn't shift values into the wrong hooks, and one whose
    // initial value changed starts fresh. Repeats (a custom hook called twice) count up.
    const base = (kind === "state" || kind === "reducer") && pendingKey !== null ? kind + ":" + pendingKey : kind;
    pendingKey = null;
    const seen = (current.keys[base] = (current.keys[base] || 0) + 1);
    const key = base + "~" + seen;
    let slot = inst.hooks[index];
    if (!slot || slot.k !== kind || slot.key !== key) {
      slot = make(restored(current.path, key));
      slot.k = kind;
      slot.key = key;
      inst.hooks[index] = slot;
    }
    return slot;
  }

  function restored(path, key) {
    const saved = restore[path];
    if (!saved || !Object.prototype.hasOwnProperty.call(saved, key)) return undefined;
    return { value: saved[key] };
  }

  function useState(initial) {
    const path = current && current.path;
    const slot = hook("state", (prior) => {
      const s = { v: prior ? prior.value : typeof initial === "function" ? initial() : initial };
      s.set = (next) => {
        const value = typeof next === "function" ? next(s.v) : next;
        if (Object.is(value, s.v)) return;
        s.v = value;
        schedule(path);
      };
      return s;
    });
    return [slot.v, slot.set];
  }

  function useReducer(reducer, initialArg, init) {
    const path = current && current.path;
    const slot = hook("reducer", (prior) => {
      const s = { v: prior ? prior.value : init ? init(initialArg) : initialArg };
      s.dispatch = (action) => {
        const value = s.reducer(s.v, action);
        if (Object.is(value, s.v)) return;
        s.v = value;
        schedule(path);
      };
      return s;
    });
    slot.reducer = reducer;
    return [slot.v, slot.dispatch];
  }

  const depsChanged = (a, b) => !a || !b || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));

  function useEffect(fn, deps) {
    const slot = hook("effect", () => ({ deps: undefined, cleanup: null, first: true }));
    if (slot.first || deps === undefined || depsChanged(slot.deps, deps)) {
      slot.first = false;
      slot.deps = deps;
      effects.push({ hook: slot, fn });
    }
  }

  function useMemo(make, deps) {
    const slot = hook("memo", () => ({ deps: undefined, v: undefined, first: true }));
    if (slot.first || depsChanged(slot.deps, deps)) {
      slot.first = false;
      slot.deps = deps;
      slot.v = make();
    }
    return slot.v;
  }

  const useCallback = (fn, deps) => useMemo(() => fn, deps);

  function useRef(initial) {
    return hook("ref", () => ({ current: initial }));
  }

  function readContext(context) {
    for (let i = contextStack.length - 1; i >= 0; i--) if (contextStack[i].context === context) return contextStack[i].value;
    return context.value;
  }

  function useContext(context) {
    const value = readContext(context);
    if (current) current.inst.contexts.push({ context, value });
    return value;
  }

  function useStorage(key, initial) {
    const k = String(key);
    const value = Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : initial;
    const set = (next) => {
      const prev = Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : initial;
      const v = typeof next === "function" ? next(prev) : next;
      if (Object.is(v, prev)) return;
      storage[k] = v;
      call("storage.set", [k, v]).catch(() => {});
      schedule();
    };
    return [value, set];
  }

  const useData = () => data;
  const useViewport = () => viewport;
  const useTheme = () => theme;

  function useFrame(fn) {
    const ref = useRef(fn);
    ref.current = fn;
    useEffect(() => {
      let live = true;
      let last = null;
      const tick = (time) => {
        if (!live) return;
        const dt = last === null ? 0 : time - last;
        last = time;
        ref.current(dt, time);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      return () => {
        live = false;
      };
    }, []);
  }

  function useInterval(fn, ms) {
    const ref = useRef(fn);
    ref.current = fn;
    useEffect(() => {
      if (ms === null || ms === undefined) return undefined;
      const id = setInterval(() => ref.current(), ms);
      return () => clearInterval(id);
    }, [ms]);
  }

  function useKey(chords, fn) {
    const list = Array.isArray(chords) ? chords : [chords];
    for (const chord of list) keyHandlers.set(String(chord), fn);
  }

  // ------------------------------------------------------------------ timers

  let timerSeq = 0;
  const timers = new Set();

  function setTimeout(fn, ms, ...args) {
    const id = ++timerSeq;
    timers.add(id);
    __host.sleep(Math.max(0, Number(ms) || 0)).then(() => {
      if (!timers.delete(id)) return;
      guard("timer", () => fn.apply(null, args));
    });
    return id;
  }

  function setInterval(fn, ms) {
    const id = ++timerSeq;
    const every = Math.max(4, Number(ms) || 0);
    timers.add(id);
    const tick = () =>
      __host.sleep(every).then(() => {
        if (!timers.has(id)) return;
        guard("timer", fn);
        tick();
      });
    tick();
    return id;
  }

  const clearTimeout = (id) => {
    timers.delete(id);
  };
  // Intervals share the timer ids, so clearing one is the same call.
  const clearInterval = clearTimeout;

  let frameCallbacks = [];
  let frameRequested = false;
  let frameSeq = 0;

  function requestAnimationFrame(fn) {
    const id = ++frameSeq;
    frameCallbacks.push({ id, fn });
    if (!frameRequested) {
      frameRequested = true;
      post({ t: "frame" });
    }
    return id;
  }

  function cancelAnimationFrame(id) {
    frameCallbacks = frameCallbacks.filter((entry) => entry.id !== id);
  }

  // ------------------------------------------------------------------ host calls

  let callSeq = 0;
  const calls = new Map();

  function call(method, args) {
    const id = ++callSeq;
    post({ t: "call", id, m: method, a: args || [] });
    return new Promise((resolve, reject) => {
      calls.set(id, { resolve, reject });
    });
  }

  function response(reply) {
    const status = reply.status;
    const body = typeof reply.body === "string" ? reply.body : "";
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: reply.statusText || "",
      headers: reply.headers || {},
      url: reply.url,
      text: () => Promise.resolve(body),
      json: () => Promise.resolve(JSON.parse(body)),
    };
  }

  const stella = {
    storage: {
      get: (key) => storage[String(key)],
      set: (key, value) => {
        storage[String(key)] = value;
        schedule();
        return call("storage.set", [String(key), value]);
      },
      remove: (key) => {
        delete storage[String(key)];
        schedule();
        return call("storage.remove", [String(key)]);
      },
      keys: () => Object.keys(storage),
      clear: () => {
        storage = {};
        schedule();
        return call("storage.clear", []);
      },
    },
    fetch: (url, init) => call("fetch", [String(url), init || {}]).then(response),
    clipboard: {
      writeText: (text) => call("clipboard.writeText", [String(text)]),
      readText: () => call("clipboard.readText", []),
    },
    openUrl: (url) => call("openUrl", [String(url)]),
    notify: (title, options) => call("notify", [String(title), options || {}]),
    haptic: (kind) => call("haptic", [kind || "light"]).catch(() => undefined),
    share: (content) => call("share", [content]),
    pickFile: (options) => call("pickFile", [options || {}]),
    saveFile: (name, content, options) => call("saveFile", [String(name), content, options || {}]),
    ask: (prompt, options) => call("ask", [String(prompt), options || {}]),
    send: (message) => call("send", [message]),
    location: () => call("location", []),
    get platform() {
      return theme.platform;
    },
  };

  // ------------------------------------------------------------------ errors and logs

  function fail(phase, error) {
    const message = error && error.message ? (error.name && error.name !== "Error" ? error.name + ": " : "") + error.message : String(error);
    // The stack's frames say where in the view it happened; the host maps them to its source.
    let stack;
    try {
      stack = error && typeof error.stack === "string" ? error.stack.slice(0, 4000) : undefined;
    } catch (e) {
      stack = undefined;
    }
    post(stack ? { t: "error", phase, message, stack } : { t: "error", phase, message });
  }

  function guard(phase, fn) {
    try {
      return fn();
    } catch (error) {
      fail(phase, error);
      return undefined;
    }
  }

  const format = (value) => {
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value);
    } catch (e) {
      return String(value);
    }
  };
  const log = (level) =>
    function () {
      const parts = [];
      for (let i = 0; i < arguments.length; i++) parts.push(format(arguments[i]));
      post({ t: "log", level, text: parts.join(" ") });
    };
  const consoleShim = { log: log("log"), info: log("info"), warn: log("warn"), error: log("error"), debug: log("debug") };

  // ------------------------------------------------------------------ messages

  function saveState() {
    const hooks = {};
    for (const [path, inst] of instances) {
      const values = {};
      let any = false;
      for (const slot of inst.hooks) {
        if (slot && (slot.k === "state" || slot.k === "reducer")) {
          try {
            values[slot.key] = JSON.parse(JSON.stringify(slot.v === undefined ? null : slot.v));
            any = true;
          } catch (e) {}
        }
      }
      if (any) hooks[path] = values;
    }
    post({ t: "state", hooks });
  }

  function handle(message) {
    switch (message && message.t) {
      case "event": {
        const fn = handlers.get(message.h);
        if (fn) guard("event", () => fn(message.v));
        return;
      }
      case "frame": {
        frameRequested = false;
        const run = frameCallbacks;
        frameCallbacks = [];
        for (const entry of run) guard("timer", () => entry.fn(message.time));
        return;
      }
      case "reply": {
        const pending = calls.get(message.id);
        if (!pending) return;
        calls.delete(message.id);
        if (message.ok) pending.resolve(message.v);
        else pending.reject(new Error(message.e || "The call failed"));
        return;
      }
      case "viewport":
        if (message.width !== viewport.width || message.height !== viewport.height) {
          viewport = { width: message.width, height: message.height };
          schedule();
        }
        return;
      case "theme":
        theme = message.theme;
        schedule();
        return;
      case "data":
        data = message.data;
        schedule();
        return;
      case "storage":
        if (message.value === undefined || message.value === null) delete storage[message.key];
        else storage[message.key] = message.value;
        schedule();
        return;
      case "key": {
        const fn = keyHandlers.get(message.chord);
        if (fn) guard("event", () => fn(message.key));
        return;
      }
      case "save":
        saveState();
        return;
      default:
        return;
    }
  }

  // ------------------------------------------------------------------ module

  const api = {
    h,
    createElement: h,
    Fragment: FRAGMENT,
    createContext,
    memo,
    useState,
    useReducer,
    useEffect,
    useLayoutEffect: useEffect,
    useMemo,
    useCallback,
    useRef,
    useContext,
    useStorage,
    useData,
    useViewport,
    useTheme,
    useFrame,
    useInterval,
    useKey,
    stella,
  };
  for (const name of [
    "Column", "Row", "Stack", "Grid", "Scroll", "Spacer", "Divider", "Pressable",
    "Text", "Markdown", "Image", "Icon", "Code", "Video", "Audio",
    "Button", "TextField", "Checkbox", "Switch", "Slider", "Select", "Segmented",
    "Tabs", "Disclosure", "Modal", "Table", "List", "Chart", "Canvas", "Progress",
  ]) api[name] = host(name);

  function requireModule(name) {
    if (name === "@stella/view" || name === "react" || name === "react/jsx-runtime") return api;
    throw new Error("A view can import only \"@stella/view\" (it asked for \"" + name + "\").");
  }

  return async function main(given, factory) {
    input = given || {};
    if (input.protocol !== undefined && input.protocol !== PROTOCOL) {
      post({ t: "error", phase: "main", message: "This view needs a different version of Stella (view protocol " + PROTOCOL + ", host " + input.protocol + ")." });
      return null;
    }
    if (input.viewport) viewport = input.viewport;
    if (input.theme) theme = input.theme;
    storage = input.storage && typeof input.storage === "object" ? { ...input.storage } : {};
    data = input.data === undefined ? null : input.data;
    restore = input.restore || {};
    const module = { exports: {} };
    try {
      factory(requireModule, module.exports, module, consoleShim, stella, setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame, cancelAnimationFrame, h, FRAGMENT, hookKey);
      const exported = module.exports;
      root = typeof exported === "function" ? exported : exported.default || exported.App || null;
      if (typeof root !== "function") throw new Error("A view must `export default` its root component.");
    } catch (error) {
      fail("main", error);
      root = null;
    }
    if (root) flush();
    restore = {};
    for (;;) {
      const message = await __host.receive();
      handle(message);
    }
  };
})();
