// `uiohook-napi` for master's Electron main: the addon's libuv calls crash Bun, so global input
// comes from the engine (engine/src/inputhook.rs) in the addon's event shape.

import { EventEmitter } from "node:events";
import { engine, onEngine } from "./engine";

export const UiohookKey = {
  Backspace: 14, Tab: 15, Enter: 28, CapsLock: 58, Escape: 1, Space: 57,
  ArrowLeft: 57419, ArrowUp: 57416, ArrowRight: 57421, ArrowDown: 57424, Delete: 3667,
  0: 11, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 7, 7: 8, 8: 9, 9: 10,
  A: 30, B: 48, C: 46, D: 32, E: 18, F: 33, G: 34, H: 35, I: 23, J: 36, K: 37, L: 38, M: 50,
  N: 49, O: 24, P: 25, Q: 16, R: 19, S: 31, T: 20, U: 22, V: 47, W: 17, X: 45, Y: 21, Z: 44,
  F1: 59, F2: 60, F3: 61, F4: 62, F5: 63, F6: 64, F7: 65, F8: 66, F9: 67, F10: 68, F11: 87, F12: 88,
  Ctrl: 29, CtrlRight: 3613, Alt: 56, AltRight: 3640, Shift: 42, ShiftRight: 54, Meta: 3675, MetaRight: 3676,
} as const;

export const EventType = {
  EVENT_KEY_PRESSED: 4,
  EVENT_KEY_RELEASED: 5,
  EVENT_MOUSE_CLICKED: 6,
  EVENT_MOUSE_PRESSED: 7,
  EVENT_MOUSE_RELEASED: 8,
  EVENT_MOUSE_MOVED: 9,
  EVENT_MOUSE_WHEEL: 11,
} as const;

class InputHook extends EventEmitter {
  private unsubscribe: (() => void) | null = null;

  start(): void {
    const e = engine();
    if (!e || (process.platform !== "darwin" && process.platform !== "win32")) throw new Error("global input listening is not available on this platform");
    if (this.unsubscribe) return;
    this.unsubscribe = onEngine("inputhook", ({ t: _t, type, ...event }) => {
      this.emit("input", event);
      this.emit(type, event);
    });
    e.inputHook.start().catch((error: Error) => {
      console.warn("[uiohook] the engine could not listen to input:", error.message);
      this.stop();
    });
  }

  stop(): void {
    if (!this.unsubscribe) return;
    this.unsubscribe();
    this.unsubscribe = null;
    void engine()?.inputHook.stop().catch(() => {});
  }
}

export const uIOhook = new InputHook();
