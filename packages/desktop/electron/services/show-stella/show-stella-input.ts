import type { ShowStellaInk } from "@stella/contracts/desktop/show-stella";

/**
 * Turns global pointer and key events into Show Stella's timeline: ink drawn
 * while ⇧ is held, ⇧-click pins, clicks, drags, scrolls, shortcuts and the
 * cursor. Points are screen points (DIP); the timeline stores them normalized
 * to the recorded display, the way Scrawl's builder reads them. A ⇧ still held
 * from the shortcut was pressed before this listened, so it draws nothing.
 */

const SCALE = 10_000;
const KEY_SHIFT_L = 42;
const KEY_SHIFT_R = 54;
const KEY_CTRL_L = 29;
const KEY_CTRL_R = 3613;
const KEY_ALT_L = 56;
const KEY_ALT_R = 3640;
const KEY_META_L = 3675;
const KEY_META_R = 3676;
const SHIFT_KEYS = new Set([KEY_SHIFT_L, KEY_SHIFT_R]);
const MODIFIER_KEYS = new Set([
  KEY_SHIFT_L,
  KEY_SHIFT_R,
  KEY_CTRL_L,
  KEY_CTRL_R,
  KEY_ALT_L,
  KEY_ALT_R,
  KEY_META_L,
  KEY_META_R,
]);
/** A ⇧ press that moves less than this and lets go within PIN_MAX_MS is a pin. */
const PIN_SLOP_PT = 12;
const PIN_MAX_MS = 1_000;
const DRAG_MIN_PT = 8;
const MIN_STROKE_PT = 6;
const CURSOR_INTERVAL_MS = 66;
const SCROLL_MERGE_MS = 400;
const POINT_MIN_PT = 1.5;
const WHEEL_HORIZONTAL = 4;

/** uiohook's key codes for letters and digits, for naming shortcuts. */
const KEY_NAMES: Record<number, string> = {
  30: "A", 48: "B", 46: "C", 32: "D", 18: "E", 33: "F", 34: "G", 35: "H",
  23: "I", 36: "J", 37: "K", 38: "L", 50: "M", 49: "N", 24: "O", 25: "P",
  16: "Q", 19: "R", 31: "S", 20: "T", 22: "U", 47: "V", 17: "W", 45: "X",
  21: "Y", 44: "Z", 2: "1", 3: "2", 4: "3", 5: "4", 6: "5", 7: "6", 8: "7",
  9: "8", 10: "9", 11: "0", 28: "Return", 15: "Tab", 57: "Space", 14: "Delete",
};

export type HookEvent = {
  x?: number;
  y?: number;
  button?: number;
  keycode?: number;
  shiftKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  rotation?: number;
  direction?: number;
  amount?: number;
};

export type Point = { x: number; y: number };
export type DisplayRect = { x: number; y: number; width: number; height: number };

type Stroke = {
  t0: number;
  t1: number;
  fw: number;
  fh: number;
  pin?: number;
  pts: number[];
};

type TimelineEvent =
  | { kind: "click"; t: number; x: number; y: number; button?: string }
  | {
      kind: "drag";
      t: number;
      t1: number;
      x0: number;
      y0: number;
      x1: number;
      y1: number;
      path?: Array<[number, number]>;
    }
  | { kind: "scroll"; t: number; x: number; y: number; dx: number; dy: number }
  | { kind: "key"; t: number; shortcut: string };

type LiveStroke = { id: number; t0: number; points: Array<{ p: Point; t: number }> };

type Press = {
  t: number;
  p: Point;
  button: number;
  shift: boolean;
  drewBefore: boolean;
  path: Point[];
  moved: boolean;
};

export type CaptureTimeline = {
  strokes: Stroke[];
  events: TimelineEvent[];
  cursor: Array<[number, number, number]>;
};

type InputOptions = {
  display: DisplayRect;
  now: () => number;
  /** Converts a hook point to a screen point (DIP); identity on macOS. */
  toScreen: (point: Point) => Point;
  /** Screen point to the overlay's coordinates. */
  toOverlay: (point: Point) => Point;
  inkEnabled: boolean;
  onInk: (ink: ShowStellaInk) => void;
  onInkChanged: (hasInk: boolean) => void;
  isMac: boolean;
};

export class ShowStellaInput {
  private readonly strokes: Array<Stroke & { id: number }> = [];
  private readonly events: TimelineEvent[] = [];
  private readonly cursor: Array<[number, number, number]> = [];
  private readonly pressed = new Set<number>();
  private live: LiveStroke | null = null;
  private press: Press | null = null;
  private nextId = 1;
  private lastCursorAt = -Infinity;
  private lastPoint: Point | null = null;
  private drewThisHold = false;

  constructor(private readonly options: InputOptions) {}

  handle(type: string, event: HookEvent): void {
    switch (type) {
      case "keydown":
        this.keydown(event);
        break;
      case "keyup":
        this.keyup(event);
        break;
      case "mousemove":
        this.move(event);
        break;
      case "mousedown":
        this.mousedown(event);
        break;
      case "mouseup":
        this.mouseup(event);
        break;
      case "wheel":
        this.wheel(event);
        break;
    }
  }

  private t(): number {
    return Math.max(0, Math.round(this.options.now()));
  }

  private point(event: HookEvent): Point | null {
    if (typeof event.x !== "number" || typeof event.y !== "number") return null;
    return this.options.toScreen({ x: event.x, y: event.y });
  }

  private norm(p: Point): [number, number] {
    const d = this.options.display;
    return [
      Math.min(1, Math.max(0, (p.x - d.x) / d.width)),
      Math.min(1, Math.max(0, (p.y - d.y) / d.height)),
    ];
  }

  private inside(p: Point): boolean {
    const d = this.options.display;
    return p.x >= d.x && p.y >= d.y && p.x <= d.x + d.width && p.y <= d.y + d.height;
  }

  private shiftHeld(): boolean {
    return [...this.pressed].some((k) => SHIFT_KEYS.has(k));
  }

  private otherModifierHeld(): boolean {
    return [...this.pressed].some((k) => MODIFIER_KEYS.has(k) && !SHIFT_KEYS.has(k));
  }

  private keydown(event: HookEvent): void {
    const code = event.keycode ?? -1;
    const repeat = this.pressed.has(code);
    this.pressed.add(code);
    if (SHIFT_KEYS.has(code)) {
      if (!repeat && !this.otherModifierHeld()) this.beginInk();
      return;
    }
    if (MODIFIER_KEYS.has(code) || repeat) return;
    // Shortcuts only (⌘S, Ctrl+C), never typed text.
    const command = this.options.isMac
      ? this.pressed.has(KEY_META_L) || this.pressed.has(KEY_META_R)
      : this.pressed.has(KEY_CTRL_L) || this.pressed.has(KEY_CTRL_R);
    const name = KEY_NAMES[code];
    if (!command || !name) return;
    if (this.live) this.dropLive();
    const parts: string[] = [];
    if (this.options.isMac) {
      if (this.pressed.has(KEY_CTRL_L) || this.pressed.has(KEY_CTRL_R)) parts.push("⌃");
      if (this.pressed.has(KEY_ALT_L) || this.pressed.has(KEY_ALT_R)) parts.push("⌥");
      if (this.shiftHeld()) parts.push("⇧");
      parts.push("⌘");
      this.events.push({ kind: "key", t: this.t(), shortcut: `${parts.join("")}${name}` });
    } else {
      parts.push("Ctrl");
      if (this.pressed.has(KEY_ALT_L) || this.pressed.has(KEY_ALT_R)) parts.push("Alt");
      if (this.shiftHeld()) parts.push("Shift");
      parts.push(name);
      this.events.push({ kind: "key", t: this.t(), shortcut: parts.join("+") });
    }
  }

  private keyup(event: HookEvent): void {
    const code = event.keycode ?? -1;
    this.pressed.delete(code);
    if (!SHIFT_KEYS.has(code)) return;
    if (!this.shiftHeld()) {
      this.finishInk();
      this.drewThisHold = false;
    }
  }

  private beginInk(): void {
    if (!this.options.inkEnabled || !this.lastPoint || !this.inside(this.lastPoint)) return;
    this.live = { id: this.nextId++, t0: this.t(), points: [{ p: this.lastPoint, t: this.t() }] };
  }

  private move(event: HookEvent): void {
    const p = this.point(event);
    if (!p) return;
    this.lastPoint = p;
    const t = this.t();
    if (this.inside(p) && t - this.lastCursorAt >= CURSOR_INTERVAL_MS) {
      this.lastCursorAt = t;
      const [x, y] = this.norm(p);
      this.cursor.push([t, round4(x), round4(y)]);
    }
    if (this.press) {
      const from = this.press.p;
      if (Math.hypot(p.x - from.x, p.y - from.y) > DRAG_MIN_PT) this.press.moved = true;
      const last = this.press.path[this.press.path.length - 1];
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 4) this.press.path.push(p);
    }
    if (!this.live && this.shiftHeld() && !this.otherModifierHeld()) {
      this.beginInk();
    }
    if (this.live) {
      const last = this.live.points[this.live.points.length - 1]!;
      if (Math.hypot(p.x - last.p.x, p.y - last.p.y) < POINT_MIN_PT) return;
      this.live.points.push({ p, t });
      if (this.travel(this.live) >= MIN_STROKE_PT) {
        this.drewThisHold = true;
        this.sendLive(false);
      }
    }
  }

  private travel(stroke: LiveStroke): number {
    let total = 0;
    for (let i = 1; i < stroke.points.length; i += 1) {
      const a = stroke.points[i - 1]!.p;
      const b = stroke.points[i]!.p;
      total += Math.hypot(b.x - a.x, b.y - a.y);
    }
    return total;
  }

  private sendLive(done: boolean): void {
    if (!this.live) return;
    this.options.onInk({
      kind: "stroke",
      id: this.live.id,
      points: this.live.points.map(({ p }) => {
        const o = this.options.toOverlay(p);
        return [o.x, o.y];
      }),
      done,
    });
  }

  private dropLive(): void {
    if (!this.live) return;
    this.options.onInk({ kind: "undo", id: this.live.id });
    this.live = null;
  }

  private finishInk(): void {
    const live = this.live;
    this.live = null;
    if (!live) return;
    if (this.travel(live) < MIN_STROKE_PT) {
      this.options.onInk({ kind: "undo", id: live.id });
      return;
    }
    this.live = live;
    this.sendLive(true);
    this.live = null;
    const d = this.options.display;
    const pts: number[] = [];
    for (const { p, t } of live.points) {
      const [x, y] = this.norm(p);
      pts.push(Math.round(x * SCALE), Math.round(y * SCALE), Math.max(0, t - live.t0));
    }
    const last = live.points[live.points.length - 1]!;
    this.strokes.push({
      id: live.id,
      t0: live.t0,
      t1: last.t,
      fw: Math.round(d.width),
      fh: Math.round(d.height),
      pts,
    });
    this.options.onInkChanged(true);
  }

  private mousedown(event: HookEvent): void {
    const p = this.point(event);
    if (!p) return;
    this.lastPoint = p;
    this.press = {
      t: this.t(),
      p,
      button: event.button ?? 1,
      shift: this.shiftHeld(),
      drewBefore: this.drewThisHold,
      path: [p],
      moved: false,
    };
  }

  private mouseup(event: HookEvent): void {
    const press = this.press;
    this.press = null;
    const p = this.point(event) ?? press?.p;
    if (!press || !p || !this.inside(press.p)) return;
    const t = this.t();
    if (press.shift && this.options.inkEnabled) {
      const still = Math.hypot(p.x - press.p.x, p.y - press.p.y) < PIN_SLOP_PT;
      if (still && t - press.t <= PIN_MAX_MS && !press.drewBefore) {
        this.dropLive();
        this.addPin(press.t, t, press.p);
      }
      return;
    }
    const [x0, y0] = this.norm(press.p);
    const button = press.button === 2 ? "right" : press.button === 3 ? "middle" : undefined;
    if (press.moved) {
      const [x1, y1] = this.norm(p);
      const step = Math.max(1, Math.ceil(press.path.length / 24));
      this.events.push({
        kind: "drag",
        t: press.t,
        t1: t,
        x0: round4(x0),
        y0: round4(y0),
        x1: round4(x1),
        y1: round4(y1),
        path: press.path
          .filter((_, i) => i % step === 0)
          .map((q) => {
            const [qx, qy] = this.norm(q);
            return [round4(qx), round4(qy)] as [number, number];
          }),
      });
      return;
    }
    this.events.push({
      kind: "click",
      t: press.t,
      x: round4(x0),
      y: round4(y0),
      ...(button ? { button } : {}),
    });
  }

  private addPin(t0: number, t1: number, at: Point): void {
    const number = this.strokes.filter((s) => s.pin !== undefined).length + 1;
    const [x, y] = this.norm(at);
    const d = this.options.display;
    const id = this.nextId++;
    this.strokes.push({
      id,
      t0,
      t1,
      fw: Math.round(d.width),
      fh: Math.round(d.height),
      pin: number,
      pts: [Math.round(x * SCALE), Math.round(y * SCALE), 0],
    });
    const o = this.options.toOverlay(at);
    this.options.onInk({ kind: "pin", id, number, x: o.x, y: o.y });
    this.options.onInkChanged(true);
  }

  private wheel(event: HookEvent): void {
    const p = this.point(event) ?? this.lastPoint;
    if (!p || !this.inside(p)) return;
    const t = this.t();
    const amount = (event.rotation ?? 0) * (event.amount ?? 1);
    const vertical = event.direction !== WHEEL_HORIZONTAL;
    const dx = vertical ? 0 : amount;
    const dy = vertical ? amount : 0;
    const last = this.events[this.events.length - 1];
    if (last?.kind === "scroll" && t - last.t < SCROLL_MERGE_MS) {
      last.dx += dx;
      last.dy += dy;
      return;
    }
    const [x, y] = this.norm(p);
    this.events.push({ kind: "scroll", t, x: round4(x), y: round4(y), dx, dy });
  }

  /** Removes the last stroke or pin. Returns false when there was none. */
  undo(): boolean {
    const stroke = this.strokes.pop();
    if (!stroke) return false;
    this.options.onInk({ kind: "undo", id: stroke.id });
    this.options.onInkChanged(this.strokes.length > 0);
    return true;
  }

  hasInk(): boolean {
    return this.strokes.length > 0;
  }

  finish(): CaptureTimeline {
    this.finishInk();
    return {
      strokes: this.strokes.map(({ id: _id, ...stroke }) => stroke),
      events: [...this.events],
      cursor: [...this.cursor],
    };
  }
}

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;
