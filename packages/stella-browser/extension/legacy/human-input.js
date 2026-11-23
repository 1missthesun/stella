/**
 * Input the way a person produces it, sent through chrome.debugger so every
 * event is trusted. A naive driver teleports the pointer to the exact centre
 * of a target and presses and releases in the same millisecond, inserts text
 * with no key presses, and scrolls by setting the scroll position; behavioural
 * bot detection scores exactly those patterns.
 *
 * Pointer paths follow a bowed cubic Bezier with a minimum-jerk velocity
 * profile, ~60-120 Hz samples, a little tremor and an occasional overshoot,
 * taking longer for longer moves (Fitts' law). Presses land slightly off
 * centre after a short settle and are held 45-110 ms. Keys are paced like
 * typing; wheel scrolls glide in eased ~60 Hz frames.
 *
 * Adapted from OpenCode Browse (github.com/anomalyco/browse, MIT),
 * rust/crates/browse-page/src/human.rs and input.rs.
 */

import { overlayScaleFromLayoutMetrics } from "../lib/agent-cursor.js";
import { drawAgentCursor } from "./agent-cursor-overlay.js";

const sleep = (ms) =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
const random = (min, max) => min + Math.random() * (max - min);
const noise = (scale) =>
  (Math.random() + Math.random() + Math.random() - 1.5) * scale;
/**
 * Timing of the input model, in ms: a quick, practised user. Typing comes out
 * around 150-160 wpm with natural variation; Castle's behavioural check
 * passed at this pace and at slower ones alike, so it is as fast as stays
 * comfortably human.
 */
const PACE = Object.freeze({
  moveBase: 45,
  movePerDoubling: 65,
  moveMax: 420,
  settle: [25, 70],
  hold: [40, 90],
  afterKeys: [90, 220],
  typingLead: [110, 260],
  typingInterval: 85,
  keyDwell: [45, 100],
});

const minimumJerk = (t) => t * t * t * (10 - 15 * t + 6 * t * t);
const round1 = (value) => Math.round(value * 10) / 10;

function bezier(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

/** Samples (with the delay before each, in ms) of one movement, excluding `to`. */
function trajectory(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 2) return [];
  const duration = Math.min(
    (PACE.moveBase + PACE.movePerDoubling * Math.log2(distance / 40 + 1)) *
      random(0.85, 1.15),
    PACE.moveMax,
  );
  const normal = { x: -dy / distance, y: dx / distance };
  const bow = (Math.random() < 0.5 ? -1 : 1) * random(0.04, 0.16) * distance;
  const c1 = {
    x: from.x + dx * random(0.2, 0.35) + normal.x * bow,
    y: from.y + dy * random(0.2, 0.35) + normal.y * bow,
  };
  const c2 = {
    x: from.x + dx * random(0.65, 0.8) + normal.x * bow * 0.6,
    y: from.y + dy * random(0.65, 0.8) + normal.y * bow * 0.6,
  };
  const overshoot = distance > 250 && Math.random() < 0.2;
  const end = overshoot
    ? {
        x: to.x + (dx / distance) * random(4, 10),
        y: to.y + (dy / distance) * random(4, 10),
      }
    : to;
  const points = [];
  let elapsed = 0;
  while (elapsed < duration) {
    const step = random(9, 17);
    elapsed = Math.min(elapsed + step, duration);
    const s = minimumJerk(elapsed / duration);
    const p = bezier(from, c1, c2, end, s);
    const tremor = (1 - s) * 0.9;
    points.push([{ x: p.x + noise(tremor), y: p.y + noise(tremor) }, step]);
  }
  if (overshoot) {
    const back = Math.max(3, Math.round(random(3, 6)));
    for (let i = 1; i <= back; i += 1) {
      const s = minimumJerk(i / back);
      points.push([
        { x: end.x + (to.x - end.x) * s, y: end.y + (to.y - end.y) * s },
        random(10, 18),
      ]);
    }
  }
  points.pop();
  return points.map(([p, delay]) => [{ x: round1(p.x), y: round1(p.y) }, delay]);
}

/** Per-frame wheel deltas for one scroll gesture: quick start, eased stop. */
function glide(dx, dy) {
  const distance = Math.hypot(dx, dy);
  if (distance < 40) return [{ x: dx, y: dy }];
  const frames = Math.max(
    4,
    Math.round(
      (Math.min(120 + distance * 0.3, 480) * random(0.85, 1.15)) / 16.7,
    ),
  );
  const ease = (t) => 1 - (1 - t) ** 3;
  const out = [];
  let sentX = 0;
  let sentY = 0;
  for (let i = 0; i < frames; i += 1) {
    const a = ease((i + 1) / frames);
    const x = Math.round(dx * a * 100) / 100;
    const y = Math.round(dy * a * 100) / 100;
    out.push({ x: x - sentX, y: y - sentY });
    sentX = x;
    sentY = y;
  }
  return out;
}

const clampToViewport = (point, viewport) => {
  const maxX = viewport ? Math.max(0, viewport.width - 1) : Infinity;
  const maxY = viewport ? Math.max(0, viewport.height - 1) : Infinity;
  return {
    x: Math.max(0, Math.min(maxX, point.x)),
    y: Math.max(0, Math.min(maxY, point.y)),
  };
};

const ALT = 1;
const CONTROL = 2;
const META = 4;
const SHIFT = 8;

const def = (key, code, keyCode, text = "", location = 0) => ({
  key,
  code,
  keyCode,
  text,
  location,
});

const NAMED_KEYS = {
  Enter: def("Enter", "Enter", 13, "\r"),
  Return: def("Enter", "Enter", 13, "\r"),
  NumpadEnter: def("Enter", "NumpadEnter", 13, "\r", 3),
  Tab: def("Tab", "Tab", 9),
  Backspace: def("Backspace", "Backspace", 8),
  Escape: def("Escape", "Escape", 27),
  Esc: def("Escape", "Escape", 27),
  Delete: def("Delete", "Delete", 46),
  Insert: def("Insert", "Insert", 45),
  Home: def("Home", "Home", 36),
  End: def("End", "End", 35),
  PageUp: def("PageUp", "PageUp", 33),
  PageDown: def("PageDown", "PageDown", 34),
  ArrowLeft: def("ArrowLeft", "ArrowLeft", 37),
  ArrowUp: def("ArrowUp", "ArrowUp", 38),
  ArrowRight: def("ArrowRight", "ArrowRight", 39),
  ArrowDown: def("ArrowDown", "ArrowDown", 40),
  Space: def(" ", "Space", 32, " "),
  " ": def(" ", "Space", 32, " "),
  CapsLock: def("CapsLock", "CapsLock", 20),
  ContextMenu: def("ContextMenu", "ContextMenu", 93),
  Shift: def("Shift", "ShiftLeft", 16, "", 1),
  Control: def("Control", "ControlLeft", 17, "", 1),
  Alt: def("Alt", "AltLeft", 18, "", 1),
  Meta: def("Meta", "MetaLeft", 91, "", 1),
};

const SHIFTED_DIGITS = { ")": "0", "!": "1", "@": "2", "#": "3", $: "4", "%": "5", "^": "6", "&": "7", "*": "8", "(": "9" };
const PUNCTUATION = [
  ["`", "~", "Backquote", 192],
  ["-", "_", "Minus", 189],
  ["=", "+", "Equal", 187],
  ["[", "{", "BracketLeft", 219],
  ["]", "}", "BracketRight", 221],
  ["\\", "|", "Backslash", 220],
  [";", ":", "Semicolon", 186],
  ["'", '"', "Quote", 222],
  [",", "<", "Comma", 188],
  [".", ">", "Period", 190],
  ["/", "?", "Slash", 191],
];

/** The US-layout key for a typed character and whether it needs Shift. */
function charDefinition(c) {
  if (/^[a-z]$/.test(c)) return [def(c, `Key${c.toUpperCase()}`, c.toUpperCase().charCodeAt(0), c), false];
  if (/^[A-Z]$/.test(c)) return [def(c, `Key${c}`, c.charCodeAt(0), c), true];
  if (/^[0-9]$/.test(c)) return [def(c, `Digit${c}`, c.charCodeAt(0), c), false];
  if (SHIFTED_DIGITS[c]) {
    const digit = SHIFTED_DIGITS[c];
    return [def(c, `Digit${digit}`, digit.charCodeAt(0), c), true];
  }
  for (const [plain, shifted, code, keyCode] of PUNCTUATION) {
    if (c === plain) return [def(c, code, keyCode, c), false];
    if (c === shifted) return [def(c, code, keyCode, c), true];
  }
  if (c === " ") return [NAMED_KEYS.Space, false];
  if (c === "\n" || c === "\r") return [NAMED_KEYS.Enter, false];
  if (c === "\t") return [NAMED_KEYS.Tab, false];
  return null;
}

export function keyDefinition(name) {
  if (NAMED_KEYS[name]) return NAMED_KEYS[name];
  const fn = /^F([1-9]|1[0-2])$/.exec(name);
  if (fn) return def(name, name, 111 + Number(fn[1]));
  const keyLetter = /^Key([A-Z])$/.exec(name);
  if (keyLetter) return keyDefinition(keyLetter[1].toLowerCase());
  const digit = /^Digit([0-9])$/.exec(name);
  if (digit) return keyDefinition(digit[1]);
  if ([...name].length === 1) return charDefinition(name)?.[0] ?? null;
  return null;
}

const MODIFIER_BITS = { Alt: ALT, Control: CONTROL, Meta: META, Shift: SHIFT };
const MODIFIER_ALIASES = {
  ctrl: "Control",
  control: "Control",
  cmd: "Meta",
  command: "Meta",
  meta: "Meta",
  super: "Meta",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
};

/** Splits "Control+Shift+K" into modifiers and key; ControlOrMeta is Meta on macOS. */
function parseCombo(combo, mac) {
  const trimmed = String(combo).trim();
  if (!trimmed) throw new Error("Empty key");
  const parts = [];
  let current = "";
  for (const c of trimmed) {
    if (c === "+" && current) {
      parts.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  if (current) parts.push(current);
  let key = parts.pop();
  const modifiers = parts.map((part) => {
    if (/^(ControlOrMeta|CmdOrCtrl)$/i.test(part)) return mac ? "Meta" : "Control";
    const name = MODIFIER_ALIASES[part.toLowerCase()];
    if (!name) {
      throw new Error(
        `Unknown modifier "${part}" in "${combo}"; use Shift, Control, Alt, Meta or ControlOrMeta`,
      );
    }
    return name;
  });
  if (/^(ControlOrMeta|CmdOrCtrl)$/i.test(key)) key = mac ? "Meta" : "Control";
  return { modifiers, key };
}

/** macOS editing commands Chrome needs alongside key events for shortcuts to act on text fields. */
function macCommand(modifiers, code) {
  const shift = (modifiers & SHIFT) !== 0;
  const meta = (modifiers & META) !== 0;
  const alt = (modifiers & ALT) !== 0;
  const id = `${meta ? "M" : ""}${alt ? "A" : ""}${shift ? "S" : ""}:${code}`;
  return {
    "M:KeyA": "selectAll",
    "M:KeyC": "copy",
    "M:KeyX": "cut",
    "M:KeyV": "paste",
    "M:KeyZ": "undo",
    "MS:KeyZ": "redo",
    "M:Backspace": "deleteToBeginningOfLine",
    "A:Backspace": "deleteWordBackward",
    "M:ArrowLeft": "moveToBeginningOfLine",
    "M:ArrowRight": "moveToEndOfLine",
    "MS:ArrowLeft": "moveToBeginningOfLineAndModifySelection",
    "MS:ArrowRight": "moveToEndOfLineAndModifySelection",
    "M:ArrowUp": "moveToBeginningOfDocument",
    "M:ArrowDown": "moveToEndOfDocument",
    "A:ArrowLeft": "moveWordLeft",
    "A:ArrowRight": "moveWordRight",
  }[id];
}

const BUTTON_BITS = { left: 1, right: 2, middle: 4, back: 8, forward: 16 };

/**
 * Pointer and keyboard state per tab. The pointer position survives between
 * commands so each movement starts where the last one ended, as a real mouse
 * does; it resets when the document changes.
 */
const tabStates = new Map();

function tabState(tabId) {
  let state = tabStates.get(tabId);
  if (!state) {
    state = {
      pointer: null,
      documentKey: null,
      buttons: 0,
      modifiers: 0,
      aim: null,
      arrivedAt: 0,
      pressedAt: 0,
      releasedAt: 0,
      lastKeyAt: 0,
      queue: Promise.resolve(),
    };
    tabStates.set(tabId, state);
  }
  return state;
}

function forgetTabInput(tabId) {
  tabStates.delete(tabId);
}

chrome.tabs.onRemoved.addListener((tabId) => forgetTabInput(tabId));

let platformIsMac = null;
async function isMac() {
  if (platformIsMac == null) {
    const info = await chrome.runtime.getPlatformInfo().catch(() => null);
    platformIsMac = info?.os === "mac";
  }
  return platformIsMac;
}

/**
 * Input for one tab. Holding the tab's queue serialises input, so a press
 * never overtakes the movement before it.
 */
class HumanInput {
  constructor(tabId, options = {}) {
    this.tabId = tabId;
    this.state = tabState(tabId);
    this.cursor = options.cursor ?? null;
    this.abortCheck = options.abortCheck ?? (() => {});
    this.viewport = null;
    this.overlayScale = 1;
    this.mac = false;
  }

  static async open(tabId, options = {}) {
    const input = new HumanInput(tabId, options);
    input.mac = await isMac();
    const metrics = await chrome.debugger
      .sendCommand({ tabId }, "Page.getLayoutMetrics", {})
      .catch(() => null);
    input.overlayScale = overlayScaleFromLayoutMetrics(metrics);
    const layout = metrics?.cssLayoutViewport;
    if (layout?.clientWidth > 0 && layout?.clientHeight > 0) {
      input.viewport = { width: layout.clientWidth, height: layout.clientHeight };
    }
    const tree = await chrome.debugger
      .sendCommand({ tabId }, "Page.getFrameTree", {})
      .catch(() => null);
    const documentKey = tree?.frameTree?.frame?.loaderId ?? null;
    if (documentKey !== input.state.documentKey) {
      input.state.documentKey = documentKey;
      input.state.pointer = null;
      input.state.aim = null;
    }
    return input;
  }

  async send(method, params) {
    this.abortCheck();
    return chrome.debugger.sendCommand({ tabId: this.tabId }, method, params);
  }

  /**
   * Sends one sample of a gesture and waits until the next is due, never
   * longer: Chrome can hold the reply to a pointer event for a background tab
   * until its next frame.
   */
  async pace(gapMs, method, params) {
    this.abortCheck();
    const started = performance.now();
    const sent = chrome.debugger
      .sendCommand({ tabId: this.tabId }, method, params)
      .catch(() => undefined);
    await Promise.race([sent, sleep(gapMs)]);
    await sleep(gapMs - (performance.now() - started));
  }

  get pointer() {
    return this.state.pointer;
  }

  /** A person's small, consistent offset from the exact centre of a target. */
  aim(target, box) {
    const previous = this.state.aim;
    if (previous && Math.hypot(previous.x - target.x, previous.y - target.y) < 1) {
      return { x: round1(target.x + previous.dx), y: round1(target.y + previous.dy) };
    }
    const spreadX = box ? Math.min(2.4, Math.max(0, box.width / 2 - 2) / 3) : 2.2;
    const spreadY = box ? Math.min(1.8, Math.max(0, box.height / 2 - 2) / 3) : 1.6;
    const aim = { x: target.x, y: target.y, dx: noise(spreadX), dy: noise(spreadY) };
    this.state.aim = aim;
    return { x: round1(target.x + aim.dx), y: round1(target.y + aim.dy) };
  }

  startPoint(to) {
    if (this.state.pointer) return clampToViewport(this.state.pointer, this.viewport);
    const width = this.viewport?.width ?? 1200;
    const height = this.viewport?.height ?? 800;
    for (let i = 0; i < 8; i += 1) {
      const candidate = {
        x: width * random(0.2, 0.8),
        y: height * random(0.25, 0.75),
      };
      const distance = Math.hypot(candidate.x - to.x, candidate.y - to.y);
      if (distance > 120 && distance < 520) return candidate;
    }
    return clampToViewport(
      { x: to.x + random(-220, 220), y: to.y + random(60, 200) },
      this.viewport,
    );
  }

  pressedButtonName() {
    const b = this.state.buttons;
    if (b & 1) return "left";
    if (b & 2) return "right";
    if (b & 4) return "middle";
    return "none";
  }

  async moveSample(point, gapMs) {
    const params = {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
      button: this.pressedButtonName(),
      buttons: this.state.buttons,
      modifiers: this.state.modifiers,
    };
    if (this.cursor)
      void this.cursor(point, this.overlayScale).catch(() => undefined);
    if (gapMs == null) await this.send("Input.dispatchMouseEvent", params);
    else await this.pace(gapMs, "Input.dispatchMouseEvent", params);
  }

  /** Moves the pointer to `to` along a human path; returns where it landed. */
  async moveTo(to, { box = null, exact = false } = {}) {
    await sleep(random(...PACE.afterKeys) - (performance.now() - this.state.lastKeyAt));
    const target = exact ? to : this.aim(to, box);
    const from = this.startPoint(target);
    for (const [point, delay] of trajectory(from, target)) {
      await this.moveSample(clampToViewport(point, this.viewport), delay);
    }
    await this.moveSample(target, null);
    this.state.pointer = target;
    this.state.arrivedAt = performance.now();
    return target;
  }

  async down(button = "left", clickCount = 1) {
    const at = this.state.pointer ?? { x: 0, y: 0 };
    await sleep(random(...PACE.settle) - Math.min(1000, performance.now() - this.state.arrivedAt));
    this.state.pressedAt = performance.now();
    this.state.buttons |= BUTTON_BITS[button] ?? 0;
    await this.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: at.x,
      y: at.y,
      button,
      buttons: this.state.buttons,
      clickCount,
      modifiers: this.state.modifiers,
    });
  }

  async up(button = "left", clickCount = 1) {
    const at = this.state.pointer ?? { x: 0, y: 0 };
    await sleep(random(...PACE.hold) - (performance.now() - this.state.pressedAt));
    this.state.buttons &= ~(BUTTON_BITS[button] ?? 0);
    this.state.releasedAt = performance.now();
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: at.x,
      y: at.y,
      button,
      buttons: this.state.buttons,
      clickCount,
      modifiers: this.state.modifiers,
    });
  }

  /**
   * Moves to `point` and clicks. `beforePress` runs after the pointer arrives
   * and before the press, to confirm the target hasn't moved.
   */
  async click(
    point,
    { box = null, exact = false, button = "left", count = 1, beforePress = null, onPress = null } = {},
  ) {
    await this.moveTo(point, { box, exact });
    if (beforePress) await beforePress();
    for (let n = 1; n <= Math.max(1, count); n += 1) {
      if (n === 1 && onPress) onPress();
      await this.down(button, n);
      await this.up(button, n);
      if (n < count) await sleep(random(60, 120));
    }
  }

  /** A wheel gesture at `at`, gliding in ~60 Hz frames. */
  async wheel(at, dx, dy) {
    const point = await this.moveTo(at, { exact: !!this.state.pointer });
    for (const frame of glide(dx, dy)) {
      await this.pace(random(15.5, 18), "Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: point.x,
        y: point.y,
        deltaX: frame.x,
        deltaY: frame.y,
        modifiers: this.state.modifiers,
      });
    }
  }

  async keyDown(key, { paceMs = null } = {}) {
    const gap = paceMs ?? random(30, 110);
    const since = performance.now() - this.state.lastKeyAt;
    if (since < 1000) await sleep(gap - since);
    this.state.lastKeyAt = performance.now();
    await this.sendKeyDown(key);
  }

  async keyUp(key, { holdMs = null } = {}) {
    await sleep((holdMs ?? random(55, 110)) - (performance.now() - this.state.lastKeyAt));
    await this.sendKeyUp(key);
  }

  async sendKeyDown(key) {
    this.state.modifiers |= MODIFIER_BITS[key.key] ?? 0;
    const text =
      this.state.modifiers & (CONTROL | ALT | META) ? "" : key.text;
    const params = {
      type: text ? "keyDown" : "rawKeyDown",
      modifiers: this.state.modifiers,
      windowsVirtualKeyCode: key.keyCode,
      nativeVirtualKeyCode: key.keyCode,
      code: key.code,
      key: key.key,
      text,
      unmodifiedText: text,
      location: key.location,
      autoRepeat: false,
      isKeypad: key.location === 3,
    };
    if (this.mac) {
      const command = macCommand(this.state.modifiers, key.code);
      if (command) params.commands = [command];
    }
    await this.send("Input.dispatchKeyEvent", params);
  }

  async sendKeyUp(key) {
    this.state.modifiers &= ~(MODIFIER_BITS[key.key] ?? 0);
    await this.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      modifiers: this.state.modifiers,
      key: key.key,
      windowsVirtualKeyCode: key.keyCode,
      nativeVirtualKeyCode: key.keyCode,
      code: key.code,
      location: key.location,
    });
  }

  /**
   * Presses a combination like "Enter", "Control+A" or "ControlOrMeta+Shift+K".
   * A single character with no US key is inserted as text.
   */
  async press(combo) {
    if ([...combo].length === 1 && !charDefinition(combo) && !keyDefinition(combo)) {
      await this.insertText(combo);
      return;
    }
    const { modifiers, key } = parseCombo(combo, this.mac);
    let main = keyDefinition(key);
    if (!main) {
      throw new Error(
        `Unknown key "${key}". Use a character, or a name such as Enter, Tab, Escape, Backspace, ArrowDown, PageDown, F5`,
      );
    }
    const held = [];
    for (const name of modifiers) {
      const modifier = keyDefinition(name);
      await this.keyDown(modifier, { paceMs: random(20, 60) });
      held.push(modifier);
    }
    if (this.state.modifiers & SHIFT && /^[a-z]$/.test(main.key)) {
      main = { ...main, key: main.key.toUpperCase(), text: main.key.toUpperCase() };
    }
    if (modifiers.length === 0 && main.key.length === 1) {
      const [, needsShift] = charDefinition(main.key) ?? [null, false];
      if (needsShift) {
        await this.typeText(main.key);
        return;
      }
    }
    await this.keyDown(main, { paceMs: held.length ? random(30, 70) : null });
    await this.keyUp(main);
    for (const modifier of held.reverse()) {
      await this.keyUp(modifier, { holdMs: random(10, 40) });
    }
  }

  /**
   * Types text as a keystroke timeline: presses ~70-150 ms apart, each held
   * 55-120 ms so fast pairs overlap (rollover), Shift held across a run of
   * capitals. Long text speeds up, and past 160 characters the rest is
   * inserted in word-sized chunks.
   */
  async typeText(text, { meanIntervalMs = null } = {}) {
    const chars = [...String(text)];
    if (chars.length === 0) return;
    const KEYED_LIMIT = 160;
    const keyed = chars.slice(0, KEYED_LIMIT);
    const mean =
      meanIntervalMs ??
      Math.max(40, Math.min(PACE.typingInterval, (PACE.typingInterval * 30) / keyed.length));
    const events = [];
    const shift = NAMED_KEYS.Shift;
    let t = 0;
    let shiftUp = null;
    let previous = null;
    for (let i = 0; i < keyed.length; i += 1) {
      const c = keyed[i];
      const entry = charDefinition(c);
      const interval =
        i === 0 ? 0 : Math.max(mean * 0.45, mean * (0.6 + noise(0.5) + Math.random() * 0.5));
      t += interval;
      if (!entry) {
        events.push({ t, kind: "text", text: c });
        previous = null;
        continue;
      }
      const [key, needsShift] = entry;
      if (!needsShift && shiftUp && t < shiftUp.t + 10) {
        t = shiftUp.t + random(10, 35);
      }
      if (!needsShift) shiftUp = null;
      if (previous && previous.code === key.code && previous.upAt >= t) {
        t = previous.upAt + random(15, 40);
      }
      if (needsShift && !shiftUp) {
        events.push({ t: Math.max(0, t - random(30, 70)), kind: "down", key: shift });
        shiftUp = { t, kind: "up", key: shift };
        events.push(shiftUp);
      }
      const dwell = random(...PACE.keyDwell) * (mean < 70 ? 0.7 : 1);
      const upAt = t + dwell;
      events.push({ t, kind: "down", key });
      events.push({ t: upAt, kind: "up", key });
      if (needsShift) shiftUp.t = upAt + random(10, 40);
      previous = { code: key.code, upAt };
    }
    events.sort((x, y) => x.t - y.t);
    const since = performance.now() - this.state.lastKeyAt;
    const sinceClick = performance.now() - (this.state.releasedAt ?? 0);
    const lead = Math.max(
      since < 1000 ? random(60, 140) - since : 0,
      random(...PACE.typingLead) - sinceClick,
      0,
    );
    const start = performance.now() + lead;
    for (const event of events) {
      await sleep(start + event.t - performance.now());
      if (event.kind === "text") await this.insertText(event.text);
      else if (event.kind === "down") await this.sendKeyDown(event.key);
      else await this.sendKeyUp(event.key);
    }
    this.state.lastKeyAt = performance.now();
    const rest = chars.slice(KEYED_LIMIT).join("");
    for (const chunk of rest.match(/\S+\s*|\s+/g) ?? []) {
      await sleep(random(10, 25));
      await this.insertText(chunk);
    }
  }

  async insertText(text) {
    await this.send("Input.insertText", { text });
  }

  /** Releases held modifiers and buttons after a failed action. */
  async reset() {
    for (const name of ["Shift", "Control", "Alt", "Meta"]) {
      if (this.state.modifiers & MODIFIER_BITS[name]) {
        await this.keyUp(NAMED_KEYS[name], { holdMs: 0 }).catch(() => undefined);
      }
    }
    for (const button of ["left", "right", "middle"]) {
      if (this.state.buttons & BUTTON_BITS[button]) {
        await this.up(button).catch(() => undefined);
      }
    }
  }
}

/**
 * Runs `work` with exclusive input on the tab, presenting the agent cursor
 * at each pointer sample when `owner` is given.
 */
export async function withHumanInput(tabId, options, work) {
  const state = tabState(tabId);
  const previous = state.queue;
  let release;
  state.queue = new Promise((resolve) => {
    release = resolve;
  });
  await previous.catch(() => undefined);
  try {
    const cursor = options?.showCursor
      ? (point, overlayScale) => drawAgentCursor(tabId, point, overlayScale)
      : null;
    const input = await HumanInput.open(tabId, { ...options, cursor });
    try {
      return await work(input);
    } catch (error) {
      await input.reset();
      throw error;
    }
  } finally {
    release();
  }
}
