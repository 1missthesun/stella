import { flushViewState, readViewState, writeViewState } from "./view-state";

/**
 * What the page itself holds and no component owns: how far each scrolling
 * element is scrolled, text typed into fields, and where the caret is. It is
 * recorded while the user scrolls and types and put back after the next mount,
 * so new UI keeps its place without doing anything.
 *
 * `data-view-state="off"` on an element leaves it and its descendants out.
 * `data-view-scope="<id>"` ties what is under it to that id: it is put back
 * only under the same id (a different conversation keeps its own place).
 */
const DOM_KEY = "dom";
const CAPTURE_DELAY_MS = 400;
const RESTORE_DEADLINE_MS = 3_000;
const RESTORE_MISSING_GRACE_MS = 1_200;
const RESTORE_STILL_MS = 200;
const RESTORE_QUIET_MS = 300;
const RESTORE_TICK_MS = 50;
const AT_EDGE_PX = 2;
const MAX_FIELD_CHARS = 200_000;
const OFF = '[data-view-state="off"]';
const TEXT_INPUT_TYPES = new Set(["", "text", "search", "url", "email", "tel", "number"]);
const SECRET_HINT = /pass|secret|token|api.?key|credential|otp|\bcode\b|card|cvc|cvv/i;

type Scroll = {
  path: string;
  mark: string;
  scope: string | null;
  top: number;
  left: number;
  fromBottom: number;
};

type Field = {
  path: string;
  mark: string;
  scope: string | null;
  value: string;
};

type Focus = {
  path: string;
  mark: string;
  scope: string | null;
  start: number | null;
  end: number | null;
  direction: "forward" | "backward" | "none" | null;
};

type DomState = { scroll: Scroll[]; fields: Field[]; focus: Focus | null };

type TextField = HTMLInputElement | HTMLTextAreaElement;

const pathOf = (element: Element): string => {
  const segments: string[] = [];
  let node: Element | null = element;
  while (node && node !== document.body) {
    const parent: Element | null = node.parentElement;
    if (!parent) break;
    let index = 0;
    for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
      if (sibling.tagName === node.tagName) index += 1;
    }
    segments.push(`${node.tagName.toLowerCase()}:${index}`);
    node = parent;
  }
  return segments.reverse().join("/");
};

const atPath = (path: string): Element | null => {
  let node: Element = document.body;
  for (const segment of path.split("/")) {
    const [tag, index] = segment.split(":");
    let seen = 0;
    let found: Element | null = null;
    for (const child of node.children) {
      if (child.tagName.toLowerCase() !== tag) continue;
      if (seen === Number(index)) {
        found = child;
        break;
      }
      seen += 1;
    }
    if (!found) return null;
    node = found;
  }
  return node;
};

const scopeOf = (element: Element) =>
  element.closest<HTMLElement>("[data-view-scope]")?.dataset.viewScope ?? null;

const KEYED = "key|";

/**
 * `data-view-key` names a field whose place in the page or placeholder
 * changes with what is around it. Fields sharing a key show the same value.
 */
const fieldMark = (field: TextField) =>
  field.dataset.viewKey
    ? `${KEYED}${field.dataset.viewKey}`
    : [
        field.tagName.toLowerCase(),
        field instanceof HTMLInputElement ? field.type : "",
        field.name,
        field.placeholder,
        field.getAttribute("aria-label") ?? "",
      ].join("|");

const scrollMark = (element: Element) =>
  `${element.tagName.toLowerCase()}|${element.classList[0] ?? ""}`;

const isTextField = (element: Element | null): element is TextField =>
  element instanceof HTMLTextAreaElement ||
  (element instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(element.type));

const mayHoldSecret = (field: TextField) =>
  SECRET_HINT.test(
    `${field.name} ${field.id} ${field.placeholder} ${field.getAttribute("aria-label") ?? ""} ${field.autocomplete}`,
  );

const recordable = (field: TextField) =>
  !field.closest(OFF) && !field.readOnly && !field.disabled && !mayHoldSecret(field);

/** The element saved at `path`, or the only one on the page with the same mark (the first, for a keyed one). */
const find = <T extends Element>(
  entry: { path: string; mark: string; scope: string | null },
  markOf: (element: T) => string,
  candidates: () => Iterable<T>,
): T | null => {
  const matches = (element: Element | null): element is T =>
    element !== null && markOf(element as T) === entry.mark && scopeOf(element) === entry.scope;
  const direct = atPath(entry.path);
  if (matches(direct)) return direct;
  let only: T | null = null;
  for (const candidate of candidates()) {
    if (!matches(candidate)) continue;
    if (only) return entry.mark.startsWith(KEYED) ? only : null;
    only = candidate;
  }
  return only;
};

const scrollers = new Set<Element>();
const touchedFields = new Set<TextField>();

const capture = (): DomState => {
  const scroll: Scroll[] = [];
  for (const element of scrollers) {
    if (!element.isConnected || element.closest(OFF)) {
      scrollers.delete(element);
      continue;
    }
    const range = element.scrollHeight - element.clientHeight;
    if (range <= 0 && element.scrollWidth <= element.clientWidth) continue;
    scroll.push({
      path: pathOf(element),
      mark: scrollMark(element),
      scope: scopeOf(element),
      top: Math.round(element.scrollTop),
      left: Math.round(element.scrollLeft),
      fromBottom: Math.round(range - element.scrollTop),
    });
  }
  const fields: Field[] = [];
  for (const field of touchedFields) {
    if (!field.isConnected) {
      touchedFields.delete(field);
      continue;
    }
    if (!recordable(field) || field.value.length > MAX_FIELD_CHARS) continue;
    if (field.value === field.defaultValue && field.value === "") continue;
    fields.push({
      path: pathOf(field),
      mark: fieldMark(field),
      scope: scopeOf(field),
      value: field.value,
    });
  }
  const active = document.activeElement;
  let focus: Focus | null = null;
  if (isTextField(active) && !active.closest(OFF)) {
    const selectable = active.type !== "number";
    focus = {
      path: pathOf(active),
      mark: fieldMark(active),
      scope: scopeOf(active),
      start: selectable ? active.selectionStart : null,
      end: selectable ? active.selectionEnd : null,
      direction: selectable ? active.selectionDirection : null,
    };
  }
  return { scroll, fields, focus };
};

let captureTimer: ReturnType<typeof setTimeout> | null = null;
let restoring = false;

const save = () => {
  if (captureTimer !== null) {
    clearTimeout(captureTimer);
    captureTimer = null;
  }
  if (restoring) return;
  writeViewState(DOM_KEY, capture());
};

const saveBeforeLeaving = () => {
  save();
  flushViewState();
};

const saveSoon = () => {
  captureTimer ??= setTimeout(save, CAPTURE_DELAY_MS);
};

const setFieldValue = (field: TextField, value: string) => {
  if (field.value === value) return;
  const prototype =
    field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
};

const allScrollable = function* (): Iterable<Element> {
  for (const element of document.body.querySelectorAll("*")) {
    if (element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth) yield element;
  }
};

const allFields = () => document.body.querySelectorAll<TextField>("input, textarea");

type Placement = "placed" | "waiting" | "missing";

const placeScroll = (entry: Scroll): Placement => {
  const element = find(entry, scrollMark, allScrollable);
  if (!element) return "missing";
  const range = element.scrollHeight - element.clientHeight;
  const nearEnd = entry.fromBottom <= AT_EDGE_PX || entry.fromBottom < entry.top;
  const top = nearEnd ? range - entry.fromBottom : entry.top;
  if (top < 0 || top > range + AT_EDGE_PX) return "waiting";
  if (Math.abs(element.scrollTop - top) > 1) element.scrollTop = top;
  if (Math.abs(element.scrollLeft - entry.left) > 1) element.scrollLeft = entry.left;
  scrollers.add(element);
  return Math.abs(element.scrollTop - top) <= 1 ? "placed" : "waiting";
};

const placeField = (entry: Field): Placement => {
  const field = find(entry, fieldMark, allFields);
  if (!field || !recordable(field)) return "missing";
  setFieldValue(field, entry.value);
  touchedFields.add(field);
  return field.value === entry.value ? "placed" : "waiting";
};

/** A field that cannot take focus yet (inert, disabled) is asked again on each pass, never waited for. */
const placeFocus = (entry: Focus): Placement => {
  const element = find(entry, fieldMark, allFields);
  if (!element) return "missing";
  if (document.activeElement !== element) element.focus({ preventScroll: true });
  if (entry.start !== null && entry.end !== null) {
    const length = element.value.length;
    try {
      element.setSelectionRange(
        Math.min(entry.start, length),
        Math.min(entry.end, length),
        entry.direction ?? "none",
      );
    } catch {
      // Some input types have no selection.
    }
  }
  return "placed";
};

const appShown = () => {
  const splash = document.getElementById("stella-launch");
  return !splash || splash.dataset.exiting === "true";
};

let settle: (() => void) | null = null;
let restored: Promise<void> = Promise.resolve();

const isDomState = (value: unknown): value is DomState =>
  typeof value === "object" &&
  value !== null &&
  Array.isArray((value as DomState).scroll) &&
  Array.isArray((value as DomState).fields);

/**
 * Puts the saved page state back as the page fills in, and resolves once
 * everything is in place and stays there, the user starts doing something, or
 * the wait runs out.
 */
export const restoreDomState = (state: unknown = readViewState(DOM_KEY)): Promise<void> => {
  settle?.();
  if (!isDomState(state) || (state.scroll.length === 0 && state.fields.length === 0 && !state.focus)) {
    restoring = false;
    return (restored = Promise.resolve());
  }
  restoring = true;
  const startedAt = performance.now();
  restored = new Promise<void>((resolve) => {
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let quietSince: number | null = null;
    const quietMs = state.scroll.length > 0 ? RESTORE_QUIET_MS : 0;
    let changedAt = startedAt;
    const changes = new MutationObserver(() => {
      changedAt = performance.now();
    });
    changes.observe(document.body, { childList: true, subtree: true });
    const interrupted = () => finish();
    const interruptions = ["wheel", "pointerdown", "keydown", "touchstart"] as const;
    const finish = () => {
      if (settle !== finish) return;
      settle = null;
      cancelAnimationFrame(frame);
      changes.disconnect();
      if (timer !== null) clearTimeout(timer);
      for (const name of interruptions) window.removeEventListener(name, interrupted, true);
      restoring = false;
      resolve();
    };
    settle = finish;
    for (const name of interruptions) window.addEventListener(name, interrupted, { capture: true, passive: true });
    const tick = () => {
      const elapsed = performance.now() - startedAt;
      const placements = [
        ...state.fields.map(placeField),
        ...state.scroll.map(placeScroll),
        ...(state.focus ? [placeFocus(state.focus)] : []),
      ];
      const missingAllowed =
        appShown() &&
        (elapsed >= RESTORE_MISSING_GRACE_MS || performance.now() - changedAt >= RESTORE_STILL_MS);
      const inPlace = placements.every(
        (placement) => placement === "placed" || (placement === "missing" && missingAllowed),
      );
      if (inPlace) {
        quietSince ??= elapsed;
        if (elapsed - quietSince >= quietMs) return finish();
      } else {
        quietSince = null;
      }
      if (elapsed >= RESTORE_DEADLINE_MS) return finish();
      if (inPlace) {
        frame = requestAnimationFrame(tick);
        return;
      }
      timer = setTimeout(() => {
        frame = requestAnimationFrame(tick);
      }, RESTORE_TICK_MS);
    };
    frame = requestAnimationFrame(tick);
  });
  return restored;
};

export const whenDomStateRestored = () => restored;

declare global {
  interface Window {
    /** Resolves once the page is back where the user left it; the update cover waits for it. */
    __stellaViewRestored?: () => Promise<void>;
  }
}

/** Records the page now, for a remount that follows at once. */
export const captureDomStateNow = (): unknown => {
  const state = capture();
  if (!restoring) writeViewState(DOM_KEY, state);
  flushViewState();
  return state;
};

let started = false;

export const startDomState = () => {
  if (started || typeof window === "undefined") return;
  started = true;
  window.__stellaViewRestored = whenDomStateRestored;
  document.addEventListener(
    "scroll",
    (event) => {
      if (event.target instanceof Element) scrollers.add(event.target);
      saveSoon();
    },
    { capture: true, passive: true },
  );
  document.addEventListener(
    "input",
    (event) => {
      if (isTextField(event.target as Element | null)) touchedFields.add(event.target as TextField);
      saveSoon();
    },
    { capture: true, passive: true },
  );
  for (const name of ["selectionchange", "focusin", "keyup", "pointerup"] as const) {
    document.addEventListener(name, saveSoon, { capture: true, passive: true });
  }
  window.addEventListener("pagehide", saveBeforeLeaving, { capture: true });
  void restoreDomState();
};
