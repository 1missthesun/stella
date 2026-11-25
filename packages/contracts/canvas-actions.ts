export type CanvasAction = {
  id: string;
  label: string;
};

export type CanvasActionEvent = {
  canvas: string;
  title: string;
  id: string;
  label: string;
  fields?: Record<string, string>;
};

export const CANVAS_ACTION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,95}$/u;
export const MAX_CANVAS_ACTIONS = 200;
const MAX_LABEL_CHARS = 200;
const MAX_FIELDS = 20;
const MAX_FIELD_NAME_CHARS = 64;
const MAX_FIELD_CHARS = 4_000;
const MAX_FIELDS_TOTAL_CHARS = 8_000;

const cleanLabel = (value: string): string =>
  value.replace(/[\u0000-\u001f\u007f]+/gu, " ").replace(/\s+/gu, " ").trim().slice(0, MAX_LABEL_CHARS);

export const parseCanvasActions = (value: unknown): CanvasAction[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: CanvasAction[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const label = typeof record.label === "string" ? cleanLabel(record.label) : "";
    if (!CANVAS_ACTION_ID_RE.test(id) || !label || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label });
    if (out.length >= MAX_CANVAS_ACTIONS) break;
  }
  return out;
};

export const canvasActionsProblem = (value: unknown): string | null => {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return "actions must be a list of { id, label }.";
  if (value.length > MAX_CANVAS_ACTIONS) return `A canvas declares at most ${MAX_CANVAS_ACTIONS} actions.`;
  const ids = new Set<string>();
  for (const entry of value) {
    const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
    const id = typeof record?.id === "string" ? record.id.trim() : "";
    if (!CANVAS_ACTION_ID_RE.test(id)) {
      return `Action id ${JSON.stringify(id)} must be 1-96 letters, digits, ':', '.', '_' or '-', starting with a letter or digit.`;
    }
    if (ids.has(id)) return `Action id ${id} is declared twice.`;
    ids.add(id);
    if (typeof record?.label !== "string" || !cleanLabel(record.label)) return `Action ${id} needs a label.`;
  }
  return null;
};

const MANIFEST_OPEN = "<!--stella-actions ";
const MANIFEST_CLOSE = "-->";
const MANIFEST_ANYWHERE = /<!--stella-actions [\s\S]*?-->\n?/gu;

const commentSafeJson = (value: unknown): string =>
  JSON.stringify(value).replace(/[<>-]/gu, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);

export const withCanvasActionManifest = (html: string, actions: readonly CanvasAction[]): string => {
  const body = html.replace(MANIFEST_ANYWHERE, "");
  return actions.length > 0 ? `${MANIFEST_OPEN}${commentSafeJson(actions)}${MANIFEST_CLOSE}\n${body}` : body;
};

export const readCanvasActionManifest = (html: string): CanvasAction[] => {
  const start = html.charCodeAt(0) === 0xfeff ? 1 : 0;
  if (!html.startsWith(MANIFEST_OPEN, start)) return [];
  const end = html.indexOf(MANIFEST_CLOSE, start + MANIFEST_OPEN.length);
  if (end < 0) return [];
  try {
    return parseCanvasActions(JSON.parse(html.slice(start + MANIFEST_OPEN.length, end)));
  } catch {
    return [];
  }
};

export const CANVAS_ACTION_MANIFEST_MAX_BYTES = 64 * 1024;

export const cleanCanvasActionFields = (value: unknown): Record<string, string> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  let total = 0;
  let count = 0;
  for (const [rawName, rawValue] of Object.entries(value as Record<string, unknown>)) {
    if (count >= MAX_FIELDS) break;
    const name = rawName.replace(/[^\w.:-]+/gu, "_").slice(0, MAX_FIELD_NAME_CHARS);
    if (!name || typeof rawValue !== "string") continue;
    const text = rawValue.replace(/\r\n?/gu, "\n").slice(0, MAX_FIELD_CHARS);
    if (!text.trim()) continue;
    if (total + text.length > MAX_FIELDS_TOTAL_CHARS) break;
    total += text.length;
    count += 1;
    out[name] = text;
  }
  return count > 0 ? out : undefined;
};

const TAG = "canvas-action";
const attr = (value: string): string =>
  value.replace(/&/gu, "&amp;").replace(/"/gu, "&quot;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/\n/gu, " ");
const unattr = (value: string): string =>
  value.replace(/&quot;/gu, '"').replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&amp;/gu, "&");

export const canvasActionMessage = (event: CanvasActionEvent): string => {
  const head = `<${TAG} canvas="${attr(event.canvas)}" title="${attr(event.title)}" id="${attr(event.id)}" label="${attr(event.label)}">`;
  const fields = event.fields
    ? Object.entries(event.fields).map(([name, value]) => `<field name="${attr(name)}">${value.replace(/<\/field>/giu, "</ field>")}</field>`)
    : [];
  return [head, ...fields, `</${TAG}>`].join("\n");
};

const MESSAGE_RE = new RegExp(
  `^\\s*<${TAG} canvas="([^"]*)" title="([^"]*)" id="([^"]*)" label="([^"]*)">\\n?([\\s\\S]*?)\\n?</${TAG}>\\s*$`,
  "u",
);
const FIELD_RE = /<field name="([^"]*)">([\s\S]*?)<\/field>/gu;

export const parseCanvasActionMessage = (text: string): CanvasActionEvent | null => {
  const match = MESSAGE_RE.exec(text);
  if (!match) return null;
  const fields: Record<string, string> = {};
  for (const field of match[5]!.matchAll(FIELD_RE)) fields[unattr(field[1]!)] = field[2]!;
  return {
    canvas: unattr(match[1]!),
    title: unattr(match[2]!),
    id: unattr(match[3]!),
    label: unattr(match[4]!),
    ...(Object.keys(fields).length > 0 ? { fields } : {}),
  };
};

export type CanvasActionDisplay = {
  canvas: string;
  chip: string;
  text: string;
};

export const canvasActionDisplay = (text: string): CanvasActionDisplay | null => {
  const event = parseCanvasActionMessage(text);
  if (!event) return null;
  const typed = Object.values(event.fields ?? {}).filter((value) => value.trim()).join("\n");
  return {
    canvas: event.canvas,
    chip: typed ? `${event.title} · ${event.label}` : event.title,
    text: typed || event.label,
  };
};

export const canvasActionBridgeSource = (transport: string): string => String.raw`
(() => {
  const apply = Reflect.apply;
  const closest = Element.prototype.closest;
  const getAttribute = Element.prototype.getAttribute;
  const setAttribute = Element.prototype.setAttribute;
  const hasAttribute = Element.prototype.hasAttribute;
  const queryAll = Document.prototype.querySelectorAll;
  const addListener = EventTarget.prototype.addEventListener;
  const dispatch = EventTarget.prototype.dispatchEvent;
  const preventDefault = Event.prototype.preventDefault;
  const stopPropagation = Event.prototype.stopPropagation;
  const targetOf = Object.getOwnPropertyDescriptor(Event.prototype, "target").get;
  const submitterOf = typeof SubmitEvent === "function" ? (Object.getOwnPropertyDescriptor(SubmitEvent.prototype, "submitter") || {}).get : undefined;
  const tagNameOf = Object.getOwnPropertyDescriptor(Element.prototype, "tagName").get;
  const formOfButton = Object.getOwnPropertyDescriptor(HTMLButtonElement.prototype, "form").get;
  const formOfInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "form").get;
  const FormDataCtor = FormData;
  const formDataEntries = FormData.prototype.entries;
  const iteratorNext = Object.getPrototypeOf(apply(formDataEntries, new FormDataCtor(), [])).next;
  const CustomEventCtor = CustomEvent;
  const StringCtor = String;
  const cssEscape = CSS.escape;
  const doc = document;
  const win = window;
  const transport = ${transport};
  if (!transport) return;

  const style = doc.createElement("style");
  style.textContent = '[data-stella-state="sending"],[data-stella-state="sent"]:not([data-stella-repeat]){pointer-events:none;opacity:.55}';
  const addStyle = () => {
    const parent = doc.head || doc.documentElement;
    if (parent) parent.appendChild(style);
    return Boolean(parent);
  };
  if (!addStyle()) apply(addListener, doc, ["DOMContentLoaded", addStyle]);

  const actionOf = (node) => {
    try {
      return node ? apply(closest, node, ["[data-stella-action]"]) : null;
    } catch {
      return null;
    }
  };

  const fieldsOf = (form, element) => {
    const out = {};
    let count = 0;
    if (form) {
      try {
        const entries = apply(formDataEntries, new FormDataCtor(form), []);
        for (;;) {
          const step = apply(iteratorNext, entries, []);
          if (step.done || count >= 20) break;
          const pair = step.value;
          if (typeof pair[1] !== "string") continue;
          out[StringCtor(pair[0])] = pair[1];
          count += 1;
        }
      } catch {}
    }
    const value = element ? apply(getAttribute, element, ["data-stella-value"]) : null;
    if (value !== null && count < 20) out.value = value;
    return out;
  };

  const marked = (id) => {
    try {
      return apply(queryAll, doc, ['[data-stella-action="' + cssEscape(id) + '"]']);
    } catch {
      return [];
    }
  };

  const setState = (id, state) => {
    const nodes = marked(id);
    for (let i = 0; i < nodes.length; i += 1) apply(setAttribute, nodes[i], ["data-stella-state", state]);
    apply(dispatch, doc, [new CustomEventCtor("stella:action", { detail: { id, state } })]);
  };

  const fire = (element, form, submitter) => {
    const id = apply(getAttribute, element, ["data-stella-action"]) || "";
    if (!id) return;
    if (apply(getAttribute, element, ["data-stella-state"]) === "sending") return;
    const fields = fieldsOf(form, submitter || element);
    setState(id, "sending");
    transport.send({ type: "action", id, fields });
  };

  apply(addListener, win, ["click", (event) => {
    if (!event.isTrusted) return;
    const element = actionOf(apply(targetOf, event, []));
    if (!element) return;
    const tag = apply(tagNameOf, element, []);
    if (tag === "FORM") return;
    let form = null;
    try {
      form = tag === "BUTTON" ? apply(formOfButton, element, []) : tag === "INPUT" ? apply(formOfInput, element, []) : null;
    } catch {}
    apply(preventDefault, event, []);
    apply(stopPropagation, event, []);
    fire(element, form, element);
  }, true]);

  apply(addListener, win, ["submit", (event) => {
    const form = apply(targetOf, event, []);
    let declared = false;
    try {
      declared = Boolean(form) && apply(hasAttribute, form, ["data-stella-action"]);
    } catch {}
    if (!declared) return;
    apply(preventDefault, event, []);
    apply(stopPropagation, event, []);
    if (!event.isTrusted) return;
    let submitter = null;
    try {
      if (submitterOf) submitter = apply(submitterOf, event, []);
    } catch {}
    fire(form, form, submitter);
  }, true]);

  transport.listen((message) => {
    if (!message || typeof message !== "object") return;
    if (message.type === "state" && typeof message.id === "string" && typeof message.state === "string") {
      setState(message.id, message.state);
    } else if (message.type === "data") {
      apply(dispatch, win, [new CustomEventCtor("stella:data", { detail: message.data })]);
    }
  });
})();
`;

export const CANVAS_ACTION_FRAME_BRIDGE = canvasActionBridgeSource(String.raw`(() => {
    const addListener = EventTarget.prototype.addEventListener;
    const stopImmediate = Event.prototype.stopImmediatePropagation;
    const sourceOf = Object.getOwnPropertyDescriptor(MessageEvent.prototype, "source").get;
    const dataOf = Object.getOwnPropertyDescriptor(MessageEvent.prototype, "data").get;
    const portsOf = Object.getOwnPropertyDescriptor(MessageEvent.prototype, "ports").get;
    const portPost = MessagePort.prototype.postMessage;
    const portStart = MessagePort.prototype.start;
    const originOf = Object.getOwnPropertyDescriptor(MessageEvent.prototype, "origin").get;
    const parentWindow = window.parent;
    // In a viewer window of its own, the host is the app window that opened it.
    const hostWindow = parentWindow.opener;
    const hostOrigin = location.ancestorOrigins && location.ancestorOrigins[0];
    let port = null;
    let receive = null;
    const queued = [];
    apply(addListener, window, ["message", (event) => {
      const source = apply(sourceOf, event, []);
      const fromHost = source === parentWindow ||
        (Boolean(source) && source === hostWindow && apply(originOf, event, []) === hostOrigin);
      if (!fromHost) return;
      const data = apply(dataOf, event, []);
      if (!data || data.type !== "stella:canvas-port") return;
      // Every port the host hands over is the bridge's; the page never sees one.
      apply(stopImmediate, event, []);
      const ports = apply(portsOf, event, []);
      if (!ports || !ports[0]) return;
      port = ports[0];
      apply(addListener, port, ["message", (portEvent) => {
        if (receive) receive(apply(dataOf, portEvent, []));
      }]);
      apply(portStart, port, []);
      while (queued.length) apply(portPost, port, [queued.shift()]);
    }, true]);
    return {
      send: (message) => {
        if (port) apply(portPost, port, [message]);
        else if (queued.length < 4) queued.push(message);
      },
      listen: (handler) => {
        receive = handler;
      },
    };
  })()`);

export const CANVAS_ACTION_FRAME_BRIDGE_TAG = `<script>${CANVAS_ACTION_FRAME_BRIDGE}</script>`;

const LEADING_PREAMBLE = /^﻿?\s*(?:<!--[\s\S]*?-->\s*)*(?:<!doctype[^>]*>)?/iu;

export const injectCanvasActionBridge = (html: string, bridgeTag = CANVAS_ACTION_FRAME_BRIDGE_TAG): string => {
  const preamble = LEADING_PREAMBLE.exec(html)?.[0] ?? "";
  return `${preamble}${bridgeTag}${html.slice(preamble.length)}`;
};

export type CanvasBridgeMessage = { type: "action"; id: string; fields?: unknown };

export const isCanvasBridgeAction = (value: unknown): value is CanvasBridgeMessage =>
  Boolean(value) &&
  typeof value === "object" &&
  (value as { type?: unknown }).type === "action" &&
  typeof (value as { id?: unknown }).id === "string";
