// An inert element tree: enough of Element/Document for code that toggles classes, data
// attributes and CSS variables, or creates detached elements. Nothing is laid out or painted.

type Listener = () => void;

export class DomTokenList {
  private readonly tokens = new Set<string>();
  constructor(private readonly onChange: Listener) {}
  get length() { return this.tokens.size; }
  get value() { return [...this.tokens].join(" "); }
  set value(next: string) { this.tokens.clear(); for (const t of String(next).split(/\s+/)) if (t) this.tokens.add(t); this.onChange(); }
  contains(token: string) { return this.tokens.has(token); }
  add(...tokens: string[]) { for (const t of tokens) this.tokens.add(t); this.onChange(); }
  remove(...tokens: string[]) { for (const t of tokens) this.tokens.delete(t); this.onChange(); }
  toggle(token: string, force?: boolean) {
    const on = force ?? !this.tokens.has(token);
    if (on) this.tokens.add(token); else this.tokens.delete(token);
    this.onChange();
    return on;
  }
  replace(from: string, to: string) {
    if (!this.tokens.delete(from)) return false;
    this.tokens.add(to);
    this.onChange();
    return true;
  }
  item(index: number) { return [...this.tokens][index] ?? null; }
  forEach(cb: (token: string, index: number) => void) { [...this.tokens].forEach(cb); }
  [Symbol.iterator]() { return this.tokens[Symbol.iterator](); }
  toString() { return this.value; }
}

const kebab = (name: string) => name.startsWith("--") ? name : name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export type DomStyle = {
  setProperty(name: string, value: string | null, priority?: string): void;
  getPropertyValue(name: string): string;
  removeProperty(name: string): string;
  readonly cssText: string;
  readonly length: number;
  item(index: number): string;
  [prop: string]: any;
};

function createStyle(onChange: (name: string) => void): DomStyle {
  const values = new Map<string, string>();
  const api = {
    setProperty(name: string, value: string | null) {
      const key = kebab(name);
      if (value === null || value === "") values.delete(key); else values.set(key, String(value));
      onChange(key);
    },
    getPropertyValue(name: string) { return values.get(kebab(name)) ?? ""; },
    removeProperty(name: string) {
      const key = kebab(name);
      const old = values.get(key) ?? "";
      values.delete(key);
      onChange(key);
      return old;
    },
    get cssText() { return [...values].map(([k, v]) => `${k}: ${v};`).join(" "); },
    set cssText(text: string) {
      values.clear();
      for (const decl of String(text).split(";")) {
        const at = decl.indexOf(":");
        if (at > 0) values.set(decl.slice(0, at).trim(), decl.slice(at + 1).trim());
      }
      onChange("*");
    },
    get length() { return values.size; },
    item(index: number) { return [...values.keys()][index] ?? ""; },
    entries() { return values.entries(); },
  };
  return new Proxy(api as DomStyle, {
    get(target, prop, receiver) {
      if (typeof prop !== "string" || prop in target) return Reflect.get(target, prop, receiver);
      return values.get(kebab(prop)) ?? "";
    },
    set(target, prop, value) {
      if (typeof prop !== "string" || prop in target) return Reflect.set(target, prop, value);
      api.setProperty(prop, value === undefined ? null : String(value));
      return true;
    },
  });
}

const dataKey = (prop: string) => `data-${prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
const dataProp = (attr: string) => attr.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

export type ElementChange = { element: DomElement; kind: "class" | "attribute" | "style"; name: string };
const changeListeners = new Set<(change: ElementChange) => void>();

/** Observes class, attribute and style changes on any element (the UI kit reads theme variables from the root). */
export function onElementChange(listener: (change: ElementChange) => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

const notify = (change: ElementChange) => {
  for (const listener of changeListeners) listener(change);
};

export class DomElement extends EventTarget {
  readonly tagName: string;
  readonly nodeName: string;
  readonly nodeType = 1;
  readonly attributes = new Map<string, string>();
  readonly classList: DomTokenList;
  readonly style: DomStyle;
  readonly dataset: Record<string, string>;
  readonly childNodes: DomElement[] = [];
  parentNode: DomElement | null = null;
  textContent = "";
  innerHTML = "";
  ownerDocument: unknown = null;
  value = "";
  hidden = false;
  tabIndex = -1;
  scrollTop = 0;
  scrollLeft = 0;

  constructor(tagName = "div", readonly namespaceURI: string | null = null) {
    super();
    this.tagName = tagName.toUpperCase();
    this.nodeName = this.tagName;
    this.classList = new DomTokenList(() => {
      this.attributes.set("class", this.classList.value);
      notify({ element: this, kind: "class", name: "class" });
    });
    this.style = createStyle((name) => notify({ element: this, kind: "style", name }));
    this.dataset = new Proxy({} as Record<string, string>, {
      get: (_t, prop) => typeof prop === "string" ? this.attributes.get(dataKey(prop)) : undefined,
      set: (_t, prop, value) => { if (typeof prop === "string") this.setAttribute(dataKey(prop), String(value)); return true; },
      deleteProperty: (_t, prop) => { if (typeof prop === "string") this.removeAttribute(dataKey(prop)); return true; },
      has: (_t, prop) => typeof prop === "string" && this.attributes.has(dataKey(prop)),
      ownKeys: () => [...this.attributes.keys()].filter((k) => k.startsWith("data-")).map(dataProp),
      getOwnPropertyDescriptor: (_t, prop) => typeof prop === "string" && this.attributes.has(dataKey(prop))
        ? { enumerable: true, configurable: true, value: this.attributes.get(dataKey(prop)) }
        : undefined,
    });
  }

  get className() { return this.classList.value; }
  set className(next: string) { this.classList.value = next; }
  get id() { return this.attributes.get("id") ?? ""; }
  set id(next: string) { this.setAttribute("id", next); }
  get children() { return this.childNodes; }
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] ?? null; }
  get parentElement() { return this.parentNode; }
  get isConnected() { return false; }

  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  hasAttribute(name: string) { return this.attributes.has(name); }
  setAttribute(name: string, value: string) {
    if (name === "class") { this.classList.value = value; return; }
    this.attributes.set(name, String(value));
    notify({ element: this, kind: "attribute", name });
  }
  removeAttribute(name: string) {
    if (name === "class") { this.classList.value = ""; return; }
    this.attributes.delete(name);
    notify({ element: this, kind: "attribute", name });
  }
  toggleAttribute(name: string, force?: boolean) {
    const on = force ?? !this.attributes.has(name);
    if (on) this.setAttribute(name, ""); else this.removeAttribute(name);
    return on;
  }
  appendChild<T extends DomElement>(child: T): T {
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
  append(...nodes: Array<DomElement | string>) { for (const n of nodes) if (typeof n !== "string") this.appendChild(n); }
  prepend(...nodes: Array<DomElement | string>) { for (const n of nodes.reverse()) if (typeof n !== "string") this.insertBefore(n, this.firstChild); }
  insertBefore<T extends DomElement>(child: T, ref: DomElement | null): T {
    child.parentNode?.removeChild(child);
    const at = ref ? this.childNodes.indexOf(ref) : -1;
    child.parentNode = this;
    if (at < 0) this.childNodes.push(child); else this.childNodes.splice(at, 0, child);
    return child;
  }
  removeChild<T extends DomElement>(child: T): T {
    const at = this.childNodes.indexOf(child);
    if (at >= 0) this.childNodes.splice(at, 1);
    child.parentNode = null;
    return child;
  }
  remove() { this.parentNode?.removeChild(this); }
  replaceChildren(...nodes: DomElement[]) { this.childNodes.length = 0; for (const n of nodes) this.appendChild(n); }
  contains(other: unknown): boolean {
    if (other === this) return true;
    return this.childNodes.some((c) => c.contains(other));
  }
  cloneNode() { return new DomElement(this.tagName, this.namespaceURI); }
  querySelector(_selector: string): DomElement | null { return null; }
  querySelectorAll(_selector: string): DomElement[] { return []; }
  getElementsByTagName(_name: string): DomElement[] { return []; }
  getElementsByClassName(_name: string): DomElement[] { return []; }
  closest(_selector: string): DomElement | null { return null; }
  matches(_selector: string) { return false; }
  getBoundingClientRect() { return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() { return this; } }; }
  getClientRects() { return []; }
  get clientWidth() { return 0; }
  get clientHeight() { return 0; }
  get offsetWidth() { return 0; }
  get offsetHeight() { return 0; }
  get scrollWidth() { return 0; }
  get scrollHeight() { return 0; }
  focus() {}
  blur() {}
  click() { this.dispatchEvent(new Event("click")); }
  scrollIntoView() {}
  scrollTo() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() { return false; }
  animate() { return { finished: Promise.resolve(), cancel() {}, finish() {}, play() {}, pause() {}, addEventListener() {}, onfinish: null }; }
  getAnimations() { return []; }
  attachShadow() { return new DomElement("shadow-root"); }
}

export class DomCanvasElement extends DomElement {
  width = 300;
  height = 150;
  getContext() { return null; }
  toDataURL() { return "data:,"; }
  toBlob(callback: (blob: Blob | null) => void) { callback(null); }
}

export class DomDocument extends EventTarget {
  readonly nodeType = 9;
  readonly documentElement = new DomElement("html");
  readonly head = new DomElement("head");
  readonly body = new DomElement("body");
  visibilityState: "visible" | "hidden" = "visible";
  focused = true;
  readyState = "complete";
  cookie = "";
  referrer = "";
  dir = "ltr";
  fonts = { ready: Promise.resolve(), check: () => true, load: async () => [], addEventListener() {}, removeEventListener() {} };

  constructor(public title: string) {
    super();
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.documentElement.ownerDocument = this;
  }

  get hidden() { return this.visibilityState === "hidden"; }
  get activeElement() { return this.body; }
  get defaultView() { return globalThis; }
  get fullscreenElement() { return null; }
  hasFocus() { return this.focused; }
  createElement(tag: string) { const el = tag.toLowerCase() === "canvas" ? new DomCanvasElement(tag) : new DomElement(tag); el.ownerDocument = this; return el; }
  createElementNS(ns: string | null, tag: string) { const el = new DomElement(tag, ns); el.ownerDocument = this; return el; }
  createTextNode(text: string) { const el = new DomElement("#text"); el.textContent = text; return el; }
  createDocumentFragment() { return new DomElement("#document-fragment"); }
  createComment(text: string) { const el = new DomElement("#comment"); el.textContent = text; return el; }
  createEvent() { return new Event(""); }
  createRange() {
    return {
      setStart() {}, setEnd() {}, selectNode() {}, selectNodeContents() {}, collapse() {},
      getBoundingClientRect: () => this.body.getBoundingClientRect(), getClientRects: () => [],
      cloneContents: () => this.createDocumentFragment(), toString: () => "",
    };
  }
  getElementById(id: string): DomElement | null {
    const find = (el: DomElement): DomElement | null => el.id === id ? el : el.childNodes.map(find).find(Boolean) ?? null;
    return find(this.documentElement);
  }
  querySelector(_selector: string): DomElement | null { return null; }
  querySelectorAll(_selector: string): DomElement[] { return []; }
  getElementsByTagName(_name: string): DomElement[] { return []; }
  getElementsByClassName(_name: string): DomElement[] { return []; }
  elementFromPoint() { return null; }
  elementsFromPoint() { return []; }
  getSelection() {
    return { toString: () => "", rangeCount: 0, isCollapsed: true, removeAllRanges() {}, addRange() {}, getRangeAt: () => null, collapse() {}, empty() {} };
  }
  execCommand() { return false; }
  queryCommandSupported() { return false; }
  exitFullscreen() { return Promise.resolve(); }
  hasStorageAccess() { return Promise.resolve(true); }
}

export function createDomDocument(options: { title: string }): DomDocument {
  return new DomDocument(options.title);
}
