import type { AtspiNode, AtspiRef, Rect } from "./atspi.js";

/**
 * Turns an AT-SPI tree into the numbered element lines agents read, in the
 * same shape as the macOS and Windows states: one line per element,
 * tab-indented, `<index> <role> <label>, Value: …, Secondary Actions: …`.
 */

export type LinuxElement = Readonly<{
  index: number;
  ref: AtspiRef;
  role: string;
  name: string;
  states: ReadonlySet<string>;
  interfaces: ReadonlySet<string>;
  bounds: Rect | null;
  actions: readonly string[];
  text?: string;
  textLength?: number;
  caretOffset?: number;
  value?: AtspiNode["value"];
  /** Index of the nearest listed ancestor, if any. */
  parentIndex: number | null;
  depth: number;
}>;

export type FormattedTree = {
  lines: string[];
  elements: LinuxElement[];
  focused: LinuxElement | null;
};

/** Containers that say nothing on their own; their children move up. */
const TRANSPARENT_ROLES = new Set([
  "panel",
  "filler",
  "grouping",
  "generic",
  "section",
  "layered pane",
  "redundant object",
  "unknown",
  "invalid",
  "glass pane",
  "root pane",
  "viewport",
  "block quote",
  "static",
]);

/**
 * Chromium appends a live memory figure to tab names ("Docs - Memory usage -
 * 25.9 MB"); it changes every few seconds and would make every observation
 * stale, so it is left out.
 */
const TAB_MEMORY_SUFFIX = / - Memory usage - [\d.,]+\s?[KMGT]?B$/;
const stableLabel = (role: string, label: string) =>
  role === "page tab" ? label.replace(TAB_MEMORY_SUFFIX, "") : label;

/** Toolkit-internal action names (GTK 4 lists its whole action muxer). */
export const isInternalAction = (action: string) =>
  action.includes(".") || action.trim() === "";

export const PRIMARY_ACTIONS = [
  "click",
  "press",
  "check",
  "uncheck",
  "activate",
  "toggle",
  "jump",
  "open",
  "select",
  "invoke",
  "default",
];

export const primaryAction = (actions: readonly string[]) => {
  const lowered = actions.map((action) => action.toLowerCase());
  for (const wanted of PRIMARY_ACTIONS) {
    const at = lowered.indexOf(wanted);
    if (at >= 0) return { name: actions[at]!, index: at };
  }
  return null;
};

const CHECKABLE_ROLES = new Set([
  "check box",
  "checkbox",
  "radio button",
  "toggle button",
  "check menu item",
  "radio menu item",
  "switch",
]);

const truncate = (value: string, limit: number) => {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
};

const annotations = (node: AtspiNode) => {
  const notes: string[] = [];
  const s = node.states;
  const interactive =
    node.actions.some((action) => !isInternalAction(action)) ||
    s.has("focusable") ||
    s.has("editable");
  if (interactive && !(s.has("enabled") || s.has("sensitive")))
    notes.push("disabled");
  if (CHECKABLE_ROLES.has(node.role) || s.has("checkable")) {
    notes.push(
      s.has("checked")
        ? "checked"
        : s.has("indeterminate")
          ? "mixed"
          : "unchecked",
    );
  } else if (s.has("checked") || s.has("pressed")) {
    notes.push(s.has("pressed") ? "pressed" : "checked");
  }
  if (s.has("selected")) notes.push("selected");
  if (s.has("expandable"))
    notes.push(s.has("expanded") ? "expanded" : "collapsed");
  if (s.has("focused")) notes.push("focused");
  if (s.has("editable") && !s.has("read-only")) notes.push("editable");
  if (s.has("modal")) notes.push("modal");
  return notes.length > 0 ? ` (${notes.join(", ")})` : "";
};

const formatNumber = (value: number) =>
  Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/\.?0+$/, "");

export const formatTree = (
  root: AtspiNode,
  maxLines = 1_500,
): FormattedTree => {
  const lines: string[] = [];
  const elements: LinuxElement[] = [];
  let focused: LinuxElement | null = null;
  let nextIndex = 0;
  let truncated = 0;

  const visit = (
    node: AtspiNode,
    depth: number,
    parentIndex: number | null,
    parentName: string,
  ) => {
    const visibleActions = node.actions.filter(
      (action) => !isInternalAction(action),
    );
    const label = stableLabel(
      node.role,
      node.name.trim() || node.description.trim(),
    );
    const textValue =
      node.text !== undefined && node.text.trim() !== label
        ? node.text
        : undefined;
    const meaningful =
      depth === 0 ||
      label !== "" ||
      visibleActions.length > 0 ||
      node.value !== undefined ||
      textValue !== undefined ||
      node.states.has("editable") ||
      node.states.has("focused") ||
      node.states.has("selected") ||
      !TRANSPARENT_ROLES.has(node.role);
    // A label repeating its parent's name (GTK buttons) adds nothing.
    const redundantLabel =
      (node.role === "label" || node.role === "static") &&
      label !== "" &&
      label === parentName &&
      visibleActions.length === 0 &&
      node.children.length === 0;
    if (!meaningful || redundantLabel) {
      for (const child of node.children)
        visit(child, depth, parentIndex, parentName);
      return;
    }
    if (lines.length >= maxLines) {
      truncated += 1;
      return;
    }
    const index = nextIndex++;
    const element: LinuxElement = {
      index,
      ref: node.ref,
      role: node.role,
      name: label,
      states: node.states,
      interfaces: node.interfaces,
      bounds: node.bounds,
      actions: node.actions,
      ...(node.text !== undefined ? { text: node.text } : {}),
      ...(node.textLength !== undefined ? { textLength: node.textLength } : {}),
      ...(node.caretOffset !== undefined
        ? { caretOffset: node.caretOffset }
        : {}),
      ...(node.value ? { value: node.value } : {}),
      parentIndex,
      depth,
    };
    elements.push(element);
    if (
      node.states.has("focused") &&
      (!focused || node.states.has("editable"))
    ) {
      focused = element;
    }
    const extras: string[] = [];
    if (textValue !== undefined) {
      const shown = truncate(textValue, 200);
      const more =
        node.textLength !== undefined && node.textLength > textValue.length
          ? ` (+${node.textLength - textValue.length} more characters)`
          : "";
      extras.push(`Value: ${shown ? JSON.stringify(shown) : '""'}${more}`);
    }
    if (node.value) {
      const { current, min, max } = node.value;
      const range =
        Number.isFinite(min) && Number.isFinite(max) && max > min
          ? ` (${formatNumber(min)}–${formatNumber(max)})`
          : "";
      extras.push(`Value: ${formatNumber(current)}${range}`);
    }
    const primary = primaryAction(visibleActions);
    const secondary = visibleActions.filter(
      (action, at) =>
        action !== primary?.name && visibleActions.indexOf(action) === at,
    );
    if (secondary.length > 0)
      extras.push(`Secondary Actions: ${secondary.join(", ")}`);
    if (node.omittedChildren > 0)
      extras.push(`${node.omittedChildren} more children not listed`);
    let line = `${"\t".repeat(depth)}${index} ${node.role}${annotations(node)}`;
    if (label) line += ` ${truncate(label, 120)}`;
    if (extras.length > 0) line += `${label ? "," : ""} ${extras.join(", ")}`;
    lines.push(line);
    for (const child of node.children) visit(child, depth + 1, index, label);
  };

  visit(root, 0, null, "");
  if (truncated > 0) {
    lines.push(
      `… ${truncated} more elements not listed; act on what is shown or scroll.`,
    );
  }
  return { lines, elements, focused };
};

/** The deepest listed element whose bounds contain the point (window px). */
export const elementAtPoint = (
  elements: readonly LinuxElement[],
  x: number,
  y: number,
): LinuxElement | null => {
  let best: LinuxElement | null = null;
  for (const element of elements) {
    const bounds = element.bounds;
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) continue;
    if (
      x < bounds.x ||
      y < bounds.y ||
      x >= bounds.x + bounds.width ||
      y >= bounds.y + bounds.height
    ) {
      continue;
    }
    // Later elements are deeper or drawn above earlier siblings.
    if (!best || element.depth >= best.depth) best = element;
  }
  return best;
};
