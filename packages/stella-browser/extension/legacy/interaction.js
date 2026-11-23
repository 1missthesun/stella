import { getActiveTab } from "../commands/tabs.js";
import {
  resolveSelector,
  buildResolvedElementMatcherScript,
  buildRoleMatcherScript,
  buildComposedCssMatcherScript,
  buildTopLevelRectSource,
} from "./selector.js";
import { ensureDebugger, evaluateRuntime } from "./page-debugger.js";
import { callExactElement, exactElementPoint } from "./frame-elements.js";
import { trackAgentCursorTab } from "./agent-cursor-overlay.js";
import { AIM_POINT_SOURCE } from "./aim.js";
import { keyDefinition, withHumanInput } from "./human-input.js";
import {
  abortableCommandDelay,
  markCommandMutationDispatched,
  throwIfCommandAborted,
} from "./cancellation.js";

/**
 * Run code on the element the selector resolves to, in Stella's isolated
 * world (same DOM, none of the page's JavaScript).
 */
async function injectScript(tabId, resolved, actionScript, options) {
  if (resolved.exactNode)
    return callExactElement(tabId, resolved, actionScript, options);
  const finderScript = buildResolvedElementMatcherScript(resolved);
  const missingMessage = resolved.isRef
    ? "Element not found"
    : `Element not found: ${resolved.css}`;
  const script = `
    (() => {
      const el = ${finderScript.trim()};
      if (!el) throw new Error(${JSON.stringify(missingMessage)});
      ${actionScript}
    })()
  `;

  return evaluateRuntime(tabId, script, options);
}

const VIEWPORT_MARGIN = 8;

/**
 * Where the element is now, in top-level viewport coordinates, without
 * scrolling anything; plus a point over its nearest scrollable ancestor,
 * where a wheel gesture scrolls the right container.
 */
async function locate(tabId, resolved) {
  if (resolved.exactNode) {
    const box = await exactElementPoint(tabId, resolved, {
      boxOnly: true,
      scroll: false,
    });
    const viewport = await evaluateRuntime(
      tabId,
      "({ width: innerWidth, height: innerHeight })",
    );
    return {
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
      viewport,
      framed: false,
      wheelAt: null,
    };
  }
  return injectScript(
    tabId,
    resolved,
    `
    if (el.getClientRects().length === 0) throw new Error('Element has no clickable area');
    const framed = (el.ownerDocument?.defaultView || window) !== window;
    ${buildTopLevelRectSource("el")}
    const viewport = { width: innerWidth, height: innerHeight };
    let wheelAt = null;
    if (!framed) {
      for (let node = el.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
        const style = getComputedStyle(node);
        const scrollsY = /(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1;
        const scrollsX = /(auto|scroll|overlay)/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 1;
        if (!scrollsY && !scrollsX) continue;
        const r = node.getBoundingClientRect();
        const left = Math.max(0, r.left), top = Math.max(0, r.top);
        const right = Math.min(innerWidth, r.right), bottom = Math.min(innerHeight, r.bottom);
        if (right - left > 4 && bottom - top > 4) {
          wheelAt = { x: left + (right - left) * (0.35 + Math.random() * 0.3), y: top + (bottom - top) * (0.35 + Math.random() * 0.3), cx: (left + right) / 2, cy: (top + bottom) / 2 };
        }
        break;
      }
    }
    return { left: topX, top: topY, width: localRect.width, height: localRect.height, viewport, framed, wheelAt };
  `,
  );
}

function inView(box) {
  const { width, height } = box.viewport;
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const fitsY =
    box.height > height - 2 * VIEWPORT_MARGIN
      ? cy >= VIEWPORT_MARGIN && cy <= height - VIEWPORT_MARGIN
      : box.top >= VIEWPORT_MARGIN && box.top + box.height <= height - VIEWPORT_MARGIN;
  const fitsX = cx >= VIEWPORT_MARGIN && cx <= width - VIEWPORT_MARGIN;
  return fitsX && fitsY;
}

async function scrollSettled(tabId, resolved, before) {
  let previous = before;
  for (let i = 0; i < 12; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 45));
    const box = await locate(tabId, resolved);
    if (
      Math.abs(box.top - previous.top) < 0.5 &&
      Math.abs(box.left - previous.left) < 0.5
    ) {
      return box;
    }
    previous = box;
  }
  return previous;
}

/**
 * Bring the element into view the way a person does, with the mouse wheel
 * over whatever scrolls it. Elements in frames, and pages that ignore the
 * wheel, fall back to scrolling it into view directly.
 */
async function bringIntoView(command, tabId, resolved, input) {
  let box = await locate(tabId, resolved);
  if (inView(box)) return box;
  if (!box.framed) {
    for (let attempt = 0; attempt < 5 && !inView(box); attempt += 1) {
      throwIfCommandAborted(command);
      const { width, height } = box.viewport;
      const anchor = box.wheelAt ?? {
        x: width * (0.4 + Math.random() * 0.2),
        y: height * (0.4 + Math.random() * 0.2),
        cx: width / 2,
        cy: height / 2,
      };
      const dy = box.top + box.height / 2 - anchor.cy;
      const dx =
        box.left + box.width / 2 < VIEWPORT_MARGIN ||
        box.left + box.width / 2 > width - VIEWPORT_MARGIN
          ? box.left + box.width / 2 - anchor.cx
          : 0;
      const at = input.pointer && box.wheelAt == null ? input.pointer : anchor;
      await input.wheel(at, Math.round(dx), Math.round(dy));
      const next = await scrollSettled(tabId, resolved, box);
      const moved =
        Math.abs(next.top - box.top) > 1 || Math.abs(next.left - box.left) > 1;
      box = next;
      if (!moved) break;
    }
    if (inView(box)) return box;
  }
  await injectScript(
    tabId,
    resolved,
    `
    const frames = [];
    for (let w = el.ownerDocument?.defaultView; w && w !== w.top; ) {
      let frame;
      try { frame = w.frameElement; } catch (_) { frame = null; }
      if (!frame) break;
      frames.push(frame);
      w = frame.ownerDocument?.defaultView;
    }
    for (const frame of frames.reverse()) frame.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    return true;
  `,
  );
  return locate(tabId, resolved);
}

/** The element's clickable point, which must be the element itself (not something covering it). */
/**
 * Where to click the element: a human-like point on it (see aim.js), in
 * top-level viewport coordinates, plus its centre and size to check it
 * hasn't moved by the time the pointer arrives.
 */
async function clickablePoint(tabId, resolved) {
  if (resolved.exactNode) {
    const point = await exactElementPoint(tabId, resolved, { scroll: false });
    return {
      x: point.x,
      y: point.y,
      cx: point.cx,
      cy: point.cy,
      width: point.width,
      height: point.height,
    };
  }
  const point = await injectScript(
    tabId,
    resolved,
    `
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      throw new Error('Element has no clickable area');
    }
    const elementWindow = el.ownerDocument?.defaultView || window;
    const elementRoot = el.getRootNode ? el.getRootNode() : el.ownerDocument;
    const hitSource = typeof elementRoot?.elementFromPoint === 'function'
      ? elementRoot
      : el.ownerDocument;
    ${AIM_POINT_SOURCE}
    const aim = aimPoint(el, rect, hitSource, elementWindow.innerWidth, elementWindow.innerHeight);
    if (!aim) {
      throw new Error('Element is not clickable at its center point');
    }
    ${buildTopLevelRectSource("el")}
    return {
      x: topX + (aim.x - rect.left),
      y: topY + (aim.y - rect.top),
      cx: topX + rect.width / 2,
      cy: topY + rect.height / 2,
      width: rect.width,
      height: rect.height,
    };
  `,
  );
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error("Failed to resolve a clickable point");
  }
  return point;
}

function humanInputOptions(command, tabId) {
  trackAgentCursorTab(command.ownerId, tabId);
  return {
    showCursor: true,
    abortCheck: () => throwIfCommandAborted(command),
  };
}

/** Scroll the element into view, move to it and click it with real mouse input. */
async function clickElement(command, tabId, resolved, { count = 1, button = "left" } = {}) {
  await ensureDebugger(tabId);
  return withHumanInput(tabId, humanInputOptions(command, tabId), async (input) => {
    await bringIntoView(command, tabId, resolved, input);
    const point = await clickablePoint(tabId, resolved);
    await input.click(point, {
      exact: true,
      button,
      count,
      beforePress: async () => {
        const now = await clickablePoint(tabId, resolved);
        if (Math.abs(now.cx - point.cx) > 2 || Math.abs(now.cy - point.cy) > 2) {
          throw new Error(
            "Element moved while the pointer travelled to it. Observe and retry the click.",
          );
        }
      },
      onPress: () => markCommandMutationDispatched(command),
    });
    return point;
  });
}

export async function handleClick(command) {
  throwIfCommandAborted(command);
  const tab = await getActiveTab(command);
  const selector = command.selector || command.ref;
  if (!selector) throw new Error("Selector is required for click");

  const resolved = resolveSelector(selector, command.ownerId, tab.id);
  await clickElement(command, tab.id, resolved, {
    button: command.button || "left",
    count: command.clickCount || 1,
  });

  return { id: command.id, success: true, data: { clicked: true } };
}

export async function handleDblclick(command) {
  throwIfCommandAborted(command);
  const tab = await getActiveTab(command);
  const selector = command.selector || command.ref;
  if (!selector) throw new Error("Selector is required for dblclick");

  const resolved = resolveSelector(selector, command.ownerId, tab.id);
  await clickElement(command, tab.id, resolved, { count: 2 });

  return { id: command.id, success: true, data: { dblclicked: true } };
}

export async function handleHover(command) {
  throwIfCommandAborted(command);
  const tab = await getActiveTab(command);
  const selector = command.selector || command.ref;
  if (!selector) throw new Error("Selector is required for hover");

  const resolved = resolveSelector(selector, command.ownerId, tab.id);
  await ensureDebugger(tab.id);
  await withHumanInput(tab.id, humanInputOptions(command, tab.id), async (input) => {
    await bringIntoView(command, tab.id, resolved, input);
    const point = await clickablePoint(tab.id, resolved);
    markCommandMutationDispatched(command);
    await input.moveTo(point, { exact: true });
  });

  return { id: command.id, success: true, data: { hovered: true } };
}

export async function handleScrollIntoView(command) {
  throwIfCommandAborted(command);
  const tab = await getActiveTab(command);
  const selector = command.selector || command.ref;
  if (!selector) throw new Error("Selector is required for scrollintoview");

  const resolved = resolveSelector(selector, command.ownerId, tab.id);
  await ensureDebugger(tab.id);
  await withHumanInput(tab.id, humanInputOptions(command, tab.id), (input) =>
    bringIntoView(command, tab.id, resolved, input),
  );
  return { id: command.id, success: true, data: { scrolled: true } };
}

const FOCUS_STATE = `
  const root = el.getRootNode ? el.getRootNode() : document;
  const active = (root && root.activeElement) || document.activeElement;
  const focused = active === el || (el.contains && el.contains(active));
  const tag = (el.tagName || '').toLowerCase();
  const inputType = tag === 'input' ? String(el.type || 'text').toLowerCase() : null;
  return { focused, tag, inputType, editable: !!el.isContentEditable, value: el.isContentEditable ? (el.textContent || '') : String(el.value ?? '') };
`;

const TYPEABLE_INPUTS = new Set([
  "text",
  "search",
  "email",
  "password",
  "tel",
  "url",
  "number",
]);

const isTypeable = (state) =>
  state.editable ||
  state.tag === "textarea" ||
  (state.tag === "input" && TYPEABLE_INPUTS.has(state.inputType));

/**
 * Put the keyboard focus in the element the way a person does: click it if
 * it isn't focused yet, then make sure typing continues at the end of its text.
 */
async function focusByClick(command, tabId, resolved, input) {
  const state = await injectScript(tabId, resolved, FOCUS_STATE);
  if (!state.focused) {
    await bringIntoView(command, tabId, resolved, input);
    let point = null;
    try {
      point = await clickablePoint(tabId, resolved);
    } catch {
      point = null;
    }
    if (point) {
      markCommandMutationDispatched(command);
      await input.click(point, { exact: true });
    }
    const after = await injectScript(tabId, resolved, FOCUS_STATE);
    if (!after.focused) {
      await injectScript(tabId, resolved, "el.focus(); return true;");
    }
  }
  return state;
}

async function moveCaretToEnd(tabId, resolved) {
  await injectScript(
    tabId,
    resolved,
    `
    const root = el.getRootNode ? el.getRootNode() : document;
    const target = (root && root.activeElement && el.contains(root.activeElement)) ? root.activeElement : el;
    if (typeof target.setSelectionRange === 'function' && typeof target.value === 'string') {
      try { target.setSelectionRange(target.value.length, target.value.length); } catch (_) {}
    } else if (target.isContentEditable) {
      const selection = (target.ownerDocument.defaultView || window).getSelection();
      const range = target.ownerDocument.createRange();
      range.selectNodeContents(target);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    return true;
  `,
  ).catch(() => undefined);
}

const FILL_SETTLE_POLLS = 8;
const FILL_SETTLE_INTERVAL_MS = 40;

/**
 * Page-side check of the filled value. Controlled inputs (React, Fluent and
 * similar) can commit the value a task later or move focus to a replacement
 * input, so the element that now has focus counts as the target too.
 */
function fillCheckSource(nextValueJs) {
  return `
    const nextValue = ${nextValueJs};
    const valueOf = (node) => node && (node.isContentEditable ? (node.textContent || '') : String(node.value ?? ''));
    const editableNode = (node) => node && (node.isContentEditable || 'value' in node) ? node : null;
    const current = () => {
      const focused = editableNode(document.activeElement);
      if (el.isConnected && valueOf(el) === nextValue) return el;
      if (focused && valueOf(focused) === nextValue) return focused;
      return el.isConnected ? el : (focused || el);
    };
    const settle = async () => {
      for (let attempt = 0; attempt < ${FILL_SETTLE_POLLS}; attempt += 1) {
        const target = current();
        if (valueOf(target) === nextValue) return target;
        await new Promise((resolve) => setTimeout(resolve, ${FILL_SETTLE_INTERVAL_MS}));
      }
      return current();
    };
    const report = (target, extra) => {
      const actual = valueOf(target);
      const tag = (target.tagName || '').toLowerCase();
      return Object.assign({
        ok: actual === nextValue,
        reason: actual === nextValue ? null : 'value-mismatch',
        tag,
        inputType: tag === 'input' ? String(target.type || 'text').toLowerCase() : null,
        actualLength: [...actual].length,
      }, extra || {});
    };
  `;
}


export async function handleFill(command) {
  throwIfCommandAborted(command);
  const tab = await getActiveTab(command);
  const selector = command.selector || command.ref;
  const value = String(command.value ?? "");
  if (!selector) throw new Error("Selector is required for fill");

  const resolved = resolveSelector(selector, command.ownerId, tab.id);
  const nextValueJs = JSON.stringify(value);
  await ensureDebugger(tab.id);
  const state = await injectScript(tab.id, resolved, FOCUS_STATE);
  if (isTypeable(state)) {
    const typed = await withHumanInput(
      tab.id,
      humanInputOptions(command, tab.id),
      async (input) => {
        await focusByClick(command, tab.id, resolved, input);
        const current = await injectScript(tab.id, resolved, FOCUS_STATE);
        if (current.value !== value) {
          markCommandMutationDispatched(command);
          if (current.value.length > 0) {
            await input.press("ControlOrMeta+a");
            await input.press("Backspace");
          }
          if (value.length > 0) await input.typeText(value);
        }
        return injectScript(
          tab.id,
          resolved,
          `
          ${fillCheckSource(nextValueJs)}
          return settle().then((target) => report(target, { method: 'typed' }));
        `,
        ).catch(() => null);
      },
    );
    if (typed?.ok) {
      return { id: command.id, success: true, data: { filled: true } };
    }
  }

  markCommandMutationDispatched(command);
  const outcome = await setValueDirectly(tab.id, resolved, nextValueJs);
  if (outcome?.ok) {
    return { id: command.id, success: true, data: { filled: true, method: "set" } };
  }
  throw new Error(fillFailureMessage(outcome, value, selector));
}

/**
 * Set the value programmatically, for inputs typing can't fill (dates,
 * colours, ranges) or that rewrite typed text.
 */
async function setValueDirectly(tabId, resolved, nextValueJs) {
  return injectScript(
    tabId,
    resolved,
    `
    el.focus();
    ${fillCheckSource(nextValueJs)}
    const tag = (el.tagName || '').toLowerCase();
    const inputType = tag === 'input' ? String(el.type || 'text').toLowerCase() : null;
    const editable = el.isContentEditable;
    if (!editable && !('value' in el)) {
      return { ok: false, reason: 'not-editable', tag, inputType, actualLength: 0 };
    }
    const dispatchInput = (type, init) => {
      try { return el.dispatchEvent(new InputEvent(type, init)); }
      catch (_) { return el.dispatchEvent(new Event(type, init)); }
    };
    dispatchInput('beforeinput', { bubbles: true, cancelable: true, composed: true, data: nextValue, inputType: 'insertReplacementText' });
    if (editable) el.textContent = nextValue;
    else el.value = nextValue;
    dispatchInput('input', { bubbles: true, composed: true, data: nextValue, inputType: 'insertReplacementText' });
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    return settle().then((target) => report(target));
  `,
  );
}

function fillFailureMessage(outcome, value, selector) {
  return (
    `Fill did not replace the element value (reason=${outcome?.reason || "unknown"}, ` +
    `tag=${outcome?.tag || "unknown"}, input_type=${outcome?.inputType || "n/a"}, ` +
    `expected_chars=${[...String(value)].length}, actual_chars=${outcome?.actualLength ?? "unknown"}): ${selector}. ` +
    "Both a direct value set and typed input were tried; the page may rewrite this field, or focus moved to another element. " +
    "Click the field and use locator.type() or tab.keyboard.type(), then read inputValue()."
  );
}


export async function handleType(command) {
  throwIfCommandAborted(command);
  const tab = await getActiveTab(command);
  const text = String(command.text || "");
  await ensureDebugger(tab.id);
  await withHumanInput(tab.id, humanInputOptions(command, tab.id), async (input) => {
    if (command.selector || command.ref) {
      const resolved = resolveSelector(
        command.selector || command.ref,
        command.ownerId,
        tab.id,
      );
      const before = await focusByClick(command, tab.id, resolved, input);
      if (!before.focused) await moveCaretToEnd(tab.id, resolved);
    }
    markCommandMutationDispatched(command);
    await input.typeText(text);
  });

  return { id: command.id, success: true, data: { typed: true } };
}

export async function handleInsertText(command) {
  throwIfCommandAborted(command);
  const tab = await getActiveTab(command);
  const text = command.text;
  if (text == null) throw new Error("Text is required for inserttext");

  await ensureDebugger(tab.id);
  await withHumanInput(tab.id, humanInputOptions(command, tab.id), async (input) => {
    markCommandMutationDispatched(command);
    await input.typeText(String(text));
  });

  return { id: command.id, success: true, data: { inserted: true } };
}

export async function handlePress(command) {
  throwIfCommandAborted(command);
  const tab = await getActiveTab(command);
  const key = command.key;
  if (!key) throw new Error("Key is required for press");

  await ensureDebugger(tab.id);
  await withHumanInput(tab.id, humanInputOptions(command, tab.id), async (input) => {
    if (command.selector || command.ref) {
      const resolved = resolveSelector(
        command.selector || command.ref,
        command.ownerId,
        tab.id,
      );
      const state = await injectScript(tab.id, resolved, FOCUS_STATE);
      if (!state.focused) {
        await injectScript(tab.id, resolved, "el.focus(); return true;");
      }
    }
    markCommandMutationDispatched(command);
    await input.press(key);
  });

  return { id: command.id, success: true, data: { pressed: key } };
}

async function scrollPosition(tabId, resolved) {
  if (resolved) {
    return injectScript(tabId, resolved, "return { x: el.scrollLeft, y: el.scrollTop };").catch(() => null);
  }
  return evaluateRuntime(tabId, "({ x: scrollX, y: scrollY })").catch(() => null);
}

async function waitForScrollToSettle(tabId, resolved) {
  let previous = await scrollPosition(tabId, resolved);
  for (let i = 0; i < 12; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 45));
    const current = await scrollPosition(tabId, resolved);
    if (current && previous && current.x === previous.x && current.y === previous.y) return current;
    previous = current;
  }
  return previous;
}

export async function handleScroll(command) {
  throwIfCommandAborted(command);
  const tab = await getActiveTab(command);
  const x = Number(command.x ?? 0) || 0;
  const y = Number(command.y ?? 0) || 0;
  const resolved =
    command.selector || command.ref
      ? resolveSelector(command.selector || command.ref, command.ownerId, tab.id)
      : null;

  await ensureDebugger(tab.id);
  const result = await withHumanInput(
    tab.id,
    humanInputOptions(command, tab.id),
    async (input) => {
      let at;
      if (resolved) {
        const box = await bringIntoView(command, tab.id, resolved, input);
        at = {
          x: box.left + box.width * (0.35 + Math.random() * 0.3),
          y: box.top + box.height * (0.35 + Math.random() * 0.3),
        };
      } else {
        const viewport = await evaluateRuntime(
          tab.id,
          "({ width: innerWidth, height: innerHeight })",
        );
        at = input.pointer ?? {
          x: viewport.width * (0.4 + Math.random() * 0.2),
          y: viewport.height * (0.4 + Math.random() * 0.2),
        };
      }
      const before = await scrollPosition(tab.id, resolved);
      markCommandMutationDispatched(command);
      await input.wheel(at, x, y);
      const after = await waitForScrollToSettle(tab.id, resolved);
      return { before, after };
    },
  );
  const moved =
    result.before &&
    result.after &&
    (result.before.x !== result.after.x || result.before.y !== result.after.y);
  if (!moved && (x !== 0 || y !== 0)) {
    if (resolved) {
      await injectScript(tab.id, resolved, `el.scrollBy(${x}, ${y}); return true;`);
    } else {
      await evaluateRuntime(tab.id, `scrollBy(${x}, ${y}); true`);
    }
  }

  return { id: command.id, success: true, data: { scrolled: true } };
}

export async function handleClear(command) {
  throwIfCommandAborted(command);
  const tab = await getActiveTab(command);
  const selector = command.selector || command.ref;
  if (!selector) throw new Error("Selector is required for clear");

  const resolved = resolveSelector(selector, command.ownerId, tab.id);
  await ensureDebugger(tab.id);
  const state = await injectScript(tab.id, resolved, FOCUS_STATE);
  if (isTypeable(state)) {
    const cleared = await withHumanInput(
      tab.id,
      humanInputOptions(command, tab.id),
      async (input) => {
        await focusByClick(command, tab.id, resolved, input);
        const current = await injectScript(tab.id, resolved, FOCUS_STATE);
        if (current.value.length === 0) return true;
        markCommandMutationDispatched(command);
        await input.press("ControlOrMeta+a");
        await input.press("Backspace");
        const after = await injectScript(tab.id, resolved, FOCUS_STATE);
        return after.value.length === 0;
      },
    );
    if (cleared) return { id: command.id, success: true, data: { cleared: true } };
  }
  markCommandMutationDispatched(command);
  const outcome = await setValueDirectly(tab.id, resolved, '""');
  if (!outcome?.ok) throw new Error(fillFailureMessage(outcome, "", selector));
  return { id: command.id, success: true, data: { cleared: true } };
}

async function setCheckedState(command, desired) {
  throwIfCommandAborted(command);
  const tab = await getActiveTab(command);
  const selector = command.selector || command.ref;
  if (!selector) {
    throw new Error(`Selector is required for ${desired ? "check" : "uncheck"}`);
  }

  const resolved = resolveSelector(selector, command.ownerId, tab.id);
  const readChecked = () =>
    injectScript(
      tab.id,
      resolved,
      "return el.checked ?? (el.getAttribute('aria-checked') === 'true');",
    );
  if ((await readChecked()) !== desired) {
    await clickElement(command, tab.id, resolved);
    await new Promise((resolve) => setTimeout(resolve, 30));
    if ((await readChecked()) !== desired) {
      await injectScript(
        tab.id,
        resolved,
        `if (Boolean(el.checked) !== ${desired}) el.click(); return true;`,
      );
    }
  }
  return desired;
}

export async function handleCheck(command) {
  await setCheckedState(command, true);
  return { id: command.id, success: true, data: { checked: true } };
}

export async function handleUncheck(command) {
  await setCheckedState(command, false);
  return { id: command.id, success: true, data: { unchecked: true } };
}

export async function handleSelect(command) {
  throwIfCommandAborted(command);
  const tab = await getActiveTab(command);
  const selector = command.selector || command.ref;
  const values = (command.values || [command.value]).map((value) => String(value));
  if (!selector) throw new Error("Selector is required for select");

  const resolved = resolveSelector(selector, command.ownerId, tab.id);
  const valuesJs = JSON.stringify(values);
  const plan = await injectScript(
    tab.id,
    resolved,
    `
    const values = ${valuesJs};
    if (!el.options) throw new Error('Element is not a <select>');
    const options = Array.from(el.options);
    const matches = options.filter((o) => values.includes(o.value) || values.includes(o.textContent.trim()));
    const label = matches[0] ? matches[0].textContent.trim() : '';
    const unique = !!label && options.filter((o) => o.textContent.trim().toLowerCase() === label.toLowerCase()).length === 1;
    const done = matches.length > 0 && matches.every((o) => o.selected) && options.filter((o) => o.selected).length === matches.length;
    return { multiple: el.multiple || el.size > 1, multi: el.multiple, disabled: el.disabled, label, unique, done, value: matches[0]?.value ?? null, indices: matches.map((o) => o.index) };
  `,
  );
  if (plan.done) {
    return { id: command.id, success: true, data: { selected: values } };
  }

  if (!plan.multiple && !plan.disabled && plan.unique && values.length === 1) {
    await ensureDebugger(tab.id);
    const chosen = await withHumanInput(
      tab.id,
      humanInputOptions(command, tab.id),
      async (input) => {
        await bringIntoView(command, tab.id, resolved, input);
        const point = await clickablePoint(tab.id, resolved).catch(() => null);
        if (point) await input.moveTo(point, { exact: true });
        await injectScript(tab.id, resolved, "el.focus(); return true;");
        markCommandMutationDispatched(command);
        await input.typeText(plan.label, { meanIntervalMs: 60 });
        return injectScript(tab.id, resolved, "return el.value;");
      },
    );
    if (chosen === plan.value) {
      return { id: command.id, success: true, data: { selected: values } };
    }
  }

  const count = plan.indices.length;
  if (plan.multiple && !plan.disabled && count > 0 && (count === 1 || plan.multi)) {
    await ensureDebugger(tab.id);
    const picked = await withHumanInput(
      tab.id,
      humanInputOptions(command, tab.id),
      (input) => clickListOptions(command, tab.id, resolved, input, plan.indices),
    );
    if (picked) {
      return { id: command.id, success: true, data: { selected: values } };
    }
  }

  markCommandMutationDispatched(command);
  await injectScript(
    tab.id,
    resolved,
    `
    const values = ${valuesJs};
    for (const option of el.options) {
      option.selected = values.includes(option.value) || values.includes(option.textContent.trim());
    }
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return Array.from(el.selectedOptions).map(o => o.value);
  `,
  );

  return { id: command.id, success: true, data: { selected: values } };
}

/**
 * Clicks the wanted rows of a list box like a person: a plain click on the first, then
 * Cmd/Ctrl-click on the rest. Returns false when a row is scrolled out of the box or the
 * clicks did not produce the wanted selection.
 */
async function clickListOptions(command, tabId, resolved, input, indices) {
  await bringIntoView(command, tabId, resolved, input);
  const select = await clickablePoint(tabId, resolved).catch(() => null);
  if (!select) return false;
  const rows = await injectScript(
    tabId,
    resolved,
    `
    const box = el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const cx = (Math.max(box.left, 0) + Math.min(box.right, vw)) / 2;
    const cy = (Math.max(box.top, 0) + Math.min(box.bottom, vh)) / 2;
    const top = Math.max(box.top + el.clientTop, 0), bottom = Math.min(box.top + el.clientTop + el.clientHeight, vh);
    const left = Math.max(box.left + el.clientLeft, 0), right = Math.min(box.left + el.clientLeft + el.clientWidth, vw);
    const rows = ${JSON.stringify(indices)}.map((i) => {
      const r = el.options[i].getBoundingClientRect();
      if (r.height < 4 || r.top < top || r.bottom > bottom) return null;
      const from = Math.max(r.left, left), width = Math.min(r.right, right) - from;
      if (width < 8) return null;
      return { dx: from + width * (0.12 + Math.random() * 0.5) - cx, dy: r.top + r.height * (0.3 + Math.random() * 0.4) - cy };
    });
    return rows.every(Boolean) ? rows : null;
  `,
  );
  if (!rows) return false;
  const toggle = keyDefinition(input.mac ? "Meta" : "Control");
  markCommandMutationDispatched(command);
  try {
    for (const [n, row] of rows.entries()) {
      if (n === 1) await input.keyDown(toggle);
      await input.click({ x: select.cx + row.dx, y: select.cy + row.dy }, { exact: true });
    }
  } finally {
    if (rows.length > 1) await input.keyUp(toggle);
  }
  const picked = await injectScript(
    tabId,
    resolved,
    "return Array.from(el.selectedOptions).map((o) => o.index);",
  );
  return JSON.stringify(picked) === JSON.stringify(indices);
}

export async function handleFocus(command) {
  throwIfCommandAborted(command);
  const tab = await getActiveTab(command);
  const selector = command.selector || command.ref;
  if (!selector) throw new Error("Selector is required for focus");

  const resolved = resolveSelector(selector, command.ownerId, tab.id);
  markCommandMutationDispatched(command);
  await injectScript(
    tab.id,
    resolved,
    `
    el.focus();
    return true;
  `,
  );

  return { id: command.id, success: true, data: { focused: true } };
}


export async function handleWait(command) {
  throwIfCommandAborted(command);
  const tab = await getActiveTab(command);
  const selector = command.selector || command.ref;
  const timeout = command.timeout || 30000;

  if (!selector) {
    await abortableCommandDelay(command, timeout);
    return { id: command.id, success: true, data: { waited: true } };
  }

  const resolved = resolveSelector(selector, command.ownerId, tab.id);

  if (resolved.exactNode) {
    await callExactElement(tab.id, resolved, "return true;");
    return {
      id: command.id,
      success: true,
      data: { waited: true, found: true },
    };
  }
  const startTime = Date.now();
  const pollInterval = 200;

  while (Date.now() - startTime < timeout) {
    throwIfCommandAborted(command);
    try {
      if (resolved.isRef) {
        const script = buildRoleMatcherScript(
          resolved.role,
          resolved.name,
          resolved.nth,
        );
        const found = await evaluateRuntime(tab.id, `!!(${script.trim()})`);
        if (found) {
          return {
            id: command.id,
            success: true,
            data: { waited: true, found: true },
          };
        }
      } else {
        const finder = buildComposedCssMatcherScript(resolved.css);
        const found = await evaluateRuntime(tab.id, `!!(${finder.trim()})`);
        if (found) {
          return {
            id: command.id,
            success: true,
            data: { waited: true, found: true },
          };
        }
      }
    } catch {
      // Page might be navigating
    }

    await abortableCommandDelay(command, pollInterval);
  }

  throw new Error(`Timeout waiting for selector: ${selector}`);
}


export async function handleClipboard(command) {
  throwIfCommandAborted(command);
  const tab = await getActiveTab(command);
  const operation = command.operation;
  if (!operation)
    throw new Error("Operation is required for clipboard (copy/paste/read)");

  switch (operation) {
    case "copy":
    case "paste": {
      await ensureDebugger(tab.id);
      await withHumanInput(tab.id, humanInputOptions(command, tab.id), async (input) => {
        markCommandMutationDispatched(command);
        await input.press(operation === "copy" ? "ControlOrMeta+c" : "ControlOrMeta+v");
      });
      return {
        id: command.id,
        success: true,
        data: operation === "copy" ? { copied: true } : { pasted: true },
      };
    }
    case "read": {
      throwIfCommandAborted(command);
      const text = await evaluateRuntime(
        tab.id,
        "navigator.clipboard.readText().catch(() => null)",
        { timeoutMs: 5_000 },
      ).catch(() => null);
      return {
        id: command.id,
        success: true,
        data: { text: text ?? "" },
      };
    }
    default:
      throw new Error(`Unknown clipboard operation: ${operation}`);
  }
}

function coordinates(command, xKey = "x", yKey = "y") {
  return { x: Number(command[xKey] ?? 0), y: Number(command[yKey] ?? 0) };
}

export async function handleMouseMove(command) {
  throwIfCommandAborted(command);
  const tab = await getActiveTab(command);
  const point = coordinates(command);

  await ensureDebugger(tab.id);
  await withHumanInput(tab.id, humanInputOptions(command, tab.id), async (input) => {
    markCommandMutationDispatched(command);
    await input.moveTo(point, { exact: true });
  });

  return { id: command.id, success: true, data: { moved: true, ...point } };
}

export async function handleMouseDown(command) {
  throwIfCommandAborted(command);
  const tab = await getActiveTab(command);
  const point = coordinates(command);
  const button = command.button || "left";

  await ensureDebugger(tab.id);
  await withHumanInput(tab.id, humanInputOptions(command, tab.id), async (input) => {
    await input.moveTo(point, { exact: true });
    markCommandMutationDispatched(command);
    await input.down(button, 1);
  });

  return { id: command.id, success: true, data: { pressed: true, ...point } };
}

export async function handleMouseUp(command) {
  throwIfCommandAborted(command);
  const tab = await getActiveTab(command);
  const point = coordinates(command);
  const button = command.button || "left";

  await ensureDebugger(tab.id);
  await withHumanInput(tab.id, humanInputOptions(command, tab.id), async (input) => {
    await input.moveTo(point, { exact: true });
    markCommandMutationDispatched(command);
    await input.up(button, 1);
  });

  return { id: command.id, success: true, data: { released: true, ...point } };
}

export async function handleDrag(command) {
  throwIfCommandAborted(command);
  const tab = await getActiveTab(command);
  const { startX, startY, endX, endY } = command;
  if (startX == null || startY == null || endX == null || endY == null) {
    throw new Error("startX, startY, endX, endY are required for drag");
  }

  await ensureDebugger(tab.id);
  await withHumanInput(tab.id, humanInputOptions(command, tab.id), async (input) => {
    await input.moveTo({ x: startX, y: startY }, { exact: true });
    markCommandMutationDispatched(command);
    await input.down("left", 1);
    await input.moveTo({ x: endX, y: endY }, { exact: true });
    await input.up("left", 1);
  });

  return { id: command.id, success: true, data: { dragged: true } };
}

function keyForCommand(key) {
  const definition = keyDefinition(key);
  if (!definition) throw new Error(`Unknown key "${key}"`);
  return definition;
}

export async function handleKeyDown(command) {
  throwIfCommandAborted(command);
  const tab = await getActiveTab(command);
  const key = command.key;
  if (!key) throw new Error("Key is required for keydown");

  await ensureDebugger(tab.id);
  await withHumanInput(tab.id, humanInputOptions(command, tab.id), async (input) => {
    markCommandMutationDispatched(command);
    await input.keyDown(keyForCommand(key));
  });

  return { id: command.id, success: true, data: { keydown: key } };
}

export async function handleKeyUp(command) {
  throwIfCommandAborted(command);
  const tab = await getActiveTab(command);
  const key = command.key;
  if (!key) throw new Error("Key is required for keyup");

  await ensureDebugger(tab.id);
  await withHumanInput(tab.id, humanInputOptions(command, tab.id), async (input) => {
    markCommandMutationDispatched(command);
    await input.keyUp(keyForCommand(key), { holdMs: 0 });
  });

  return { id: command.id, success: true, data: { keyup: key } };
}
