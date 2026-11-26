// Rune's `UpdateTransition`. Electron main covers the window with a WebContentsView page that holds a
// capturePage still; in Rune the full window draws the scene itself (ui/shell/update-transition)
// from engine frame captures, so the cover, the focus pull onto the new interface, the frosted hold
// before a relaunch and the focus-in after it keep Electron's timings without a Chromium page.

import { existsSync, mkdirSync, promises as fs, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BrowserWindow } from "electron";
import { APP_RELAUNCHING_EVENT } from "@stella/contracts/desktop/app-source";
import { springEasing } from "@stella/contracts/desktop/spring";
import { savedAgeMs } from "@stella/contracts/server-clock";
import { engine } from "../bridge";
import { setTransitionScene, subscribeTransition, transitionAppLive, transitionScene } from "./update-transition-scene";

export type CoveredWindow = {
  reveal<T>(swap: () => Promise<T>): Promise<T>;
  cancel(): Promise<void>;
};

export type RelaunchHold = {
  commit(): Promise<void>;
  release(): Promise<void>;
};

export type UpdateHold = {
  image: string;
  mark: string;
  label: string;
  since: number;
  dark: boolean;
  frame: { x: number; y: number; width: number; height: number };
};

type UpdateTransitionOptions = {
  getWindow: () => BrowserWindow | null;
  partition: string;
  holdDir: string;
  holdLabel: () => string;
  onHold?: (hold: UpdateHold) => void;
  log: (event: string, data: Record<string, unknown>) => void;
};

const CAPTURE_TIMEOUT_MS = 2_000;
const READY_TIMEOUT_MS = 8_000;
const HOLD_MAX_AGE_MS = 60_000;
const LABEL_DELAY_MS = 700;
const HOLD_RECORD = "update-hold.json";
const HOLD_MARK = "update-hold-mark.png";
const MARK_ASSET = path.resolve(import.meta.dir, "../assets/update-hold-mark.png");
const PAINT_MS = 48;
const STILL_DECODE_MS = 120;
const VISIBLE_REST = 0.01;

const FROST_SPRING = 0.34;
const CRITICAL_SPRING_TWO_PERCENT_OMEGA_T = 5.83;
const FROST_SHOWN_MS = Math.round((CRITICAL_SPRING_TWO_PERCENT_OMEGA_T * FROST_SPRING * 1000) / (2 * Math.PI));
const TINT_LIGHT = "rgba(255, 255, 255, 0.46)";
const TINT_DARK = "rgba(28, 28, 30, 0.40)";

const PULL_OUT_MS = 180;
const PULL_IN = { blur: 12, spring: 0.34, delayMs: 90 };
const FOCUS_IN = { blur: 18, scale: 1.014, spring: 0.4, delayMs: 40, fadeMs: 300 };

const springMs = (duration: number) => springEasing(duration, 0, VISIBLE_REST).ms;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const timeout = <T>(promise: Promise<T>, ms: number, what: string) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

type FrostReply = { dark: boolean; jpeg?: Uint8Array } | { error: string };

/** The frosted still a relaunch holds on, made off the UI thread: the frame blurred and saturated under the tint, as JPEG, and whether it reads dark. */
function frostFrame(file: string, scale: number, onDark: (dark: boolean) => void): Promise<{ jpeg: Uint8Array; dark: boolean }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(import.meta.dir, "update-frost-worker.ts"));
    const done = () => worker.terminate();
    worker.onmessage = (e: MessageEvent<FrostReply>) => {
      const reply = e.data;
      if ("error" in reply) {
        done();
        reject(new Error(reply.error));
      } else if (!reply.jpeg) {
        onDark(reply.dark);
      } else {
        done();
        resolve({ jpeg: reply.jpeg, dark: reply.dark });
      }
    };
    worker.onerror = (e) => {
      done();
      reject(new Error(e.message));
    };
    worker.postMessage({ file, scale });
  });
}

const readHold = (holdDir: string): UpdateHold | null => {
  try {
    const hold = JSON.parse(readFileSync(path.join(holdDir, HOLD_RECORD), "utf8")) as UpdateHold;
    return savedAgeMs(hold.since) > HOLD_MAX_AGE_MS || !existsSync(hold.image) ? null : hold;
  } catch {
    return null;
  }
};

export class UpdateTransition {
  private readonly options: UpdateTransitionOptions;
  private readonly frames = mkdtempFrames();
  private shots = 0;
  private holdPlaying: Promise<void> | null = null;

  constructor(options: UpdateTransitionOptions) {
    this.options = options;
    const hold = readHold(options.holdDir);
    if (hold) setTransitionScene({ kind: "hold", frosted: hold.image, dark: hold.dark, label: options.holdLabel(), ...this.holdTiming(hold) });
  }

  prewarm() {}

  async cover(): Promise<CoveredWindow | null> {
    const win = this.visibleWindow();
    if (!win) return null;
    const started = performance.now();
    let before: string;
    try {
      before = (await this.shoot()).file;
      setTransitionScene({ kind: "cover", before });
      await delay(STILL_DECODE_MS);
    } catch (error) {
      this.fail("cover", error);
      this.uncover();
      return null;
    }
    const coverMs = Math.round(performance.now() - started);
    return {
      cancel: async () => this.uncover(),
      reveal: async <T>(swap: () => Promise<T>) => {
        const swapStarted = performance.now();
        let result: T;
        try {
          result = await swap();
        } catch (error) {
          this.uncover();
          throw error;
        }
        try {
          const swapped = performance.now();
          await this.waitUntilShown();
          const shown = performance.now();
          setTransitionScene({ kind: "reveal", before }, { blur: PULL_IN.blur, scale: 1 });
          await delay(PAINT_MS);
          setTransitionScene({ kind: "reveal", before }, { blur: 0, scale: 1, dur: PULL_IN.spring, delayMs: PULL_IN.delayMs });
          await delay(Math.max(PULL_OUT_MS, PULL_IN.delayMs + springMs(PULL_IN.spring)));
          this.options.log("app-source.transition", {
            coverMs,
            swapMs: Math.round(swapped - swapStarted),
            paintMs: Math.round(shown - swapped),
            whole: true,
            totalMs: Math.round(performance.now() - started),
          });
        } catch (error) {
          this.fail("reveal", error);
        } finally {
          this.uncover();
        }
        return result;
      },
    };
  }

  async holdForRelaunch(): Promise<RelaunchHold | null> {
    const win = this.visibleWindow();
    if (!win) return null;
    const since = Date.now();
    const split: string[] = [];
    let lap = since;
    const step = (name: string) => {
      const now = Date.now();
      split.push(`${name} ${now - lap}`);
      lap = now;
    };
    try {
      const shot = await this.shoot();
      setTransitionScene({ kind: "cover", before: shot.file });
      step("capture");
      let frostShown = Promise.resolve();
      const { jpeg, dark } = await frostFrame(shot.file, shot.scale, (dark) => {
        setTransitionScene({ kind: "frost", before: shot.file, tint: dark ? TINT_DARK : TINT_LIGHT, dur: FROST_SPRING });
        frostShown = delay(FROST_SHOWN_MS);
      });
      step("frost-image");
      const hold: UpdateHold = {
        image: path.join(this.options.holdDir, `update-hold-${since}.jpg`),
        mark: path.join(this.options.holdDir, HOLD_MARK),
        label: this.options.holdLabel(),
        since,
        dark,
        frame: win.getContentBounds(),
      };
      await fs.mkdir(this.options.holdDir, { recursive: true });
      await Promise.all([
        fs.writeFile(hold.image, jpeg),
        fs.copyFile(MARK_ASSET, hold.mark),
        fs.writeFile(path.join(this.options.holdDir, HOLD_RECORD), JSON.stringify(hold)),
      ]);
      step("files");
      const played = frostShown.then(() => {
        if (transitionScene()?.kind !== "frost") return;
        setTransitionScene({ kind: "hold", frosted: hold.image, dark, label: hold.label, ...this.holdTiming(hold) });
        step("played");
        this.options.log("app-source.hold", { ms: Date.now() - since, split: split.join(" | ") });
      });
      this.holdPlaying = played;
      return {
        commit: async () => {
          await timeout(
            win.webContents.executeJavaScript(`window.dispatchEvent(new Event(${JSON.stringify(APP_RELAUNCHING_EVENT)}))`),
            1_000,
            "Telling the window",
          ).catch(() => {});
          this.options.onHold?.(hold);
        },
        release: async () => {
          this.uncover();
          await Promise.all([path.join(this.options.holdDir, HOLD_RECORD), hold.image, hold.mark].map((file) => fs.rm(file, { force: true })));
        },
      };
    } catch (error) {
      this.fail("hold", error);
      this.uncover();
      return null;
    }
  }

  async finishHold(): Promise<void> {
    const playing = this.holdPlaying;
    if (!playing) return;
    await timeout(playing, 1_000, "Frosting the window").catch(() => {});
  }

  hasPendingHold() {
    return existsSync(path.join(this.options.holdDir, HOLD_RECORD));
  }

  async resumeAfterRelaunch(_win: BrowserWindow): Promise<void> {
    const record = path.join(this.options.holdDir, HOLD_RECORD);
    const hold = readHold(this.options.holdDir);
    await fs.rm(record, { force: true });
    if (!hold) {
      this.uncover();
      return;
    }
    try {
      await this.waitUntilShown();
      setTransitionScene({ kind: "focusIn", frosted: hold.image, dark: hold.dark, label: hold.label }, { blur: FOCUS_IN.blur, scale: FOCUS_IN.scale });
      await delay(PAINT_MS);
      setTransitionScene(
        { kind: "focusIn", frosted: hold.image, dark: hold.dark, label: hold.label },
        { blur: 0, scale: 1, dur: FOCUS_IN.spring, delayMs: FOCUS_IN.delayMs },
      );
      await delay(FOCUS_IN.delayMs + Math.max(FOCUS_IN.fadeMs, springMs(FOCUS_IN.spring)));
      this.options.log("app-source.relaunch-transition", { heldMs: Date.now() - hold.since });
    } catch (error) {
      this.fail("focus-in", error);
    } finally {
      this.uncover();
      await fs.rm(hold.image, { force: true });
      await fs.rm(hold.mark, { force: true });
    }
  }

  private holdTiming(hold: UpdateHold) {
    return { labelDelayMs: Math.max(0, Math.min(LABEL_DELAY_MS, hold.since + LABEL_DELAY_MS - Date.now())), heldMs: Date.now() - hold.since };
  }

  private visibleWindow() {
    const win = this.options.getWindow();
    if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) return null;
    return win;
  }

  private uncover() {
    setTransitionScene(null);
    for (const name of safeList(this.frames)) rmSync(path.join(this.frames, name), { force: true });
  }

  private async shoot(): Promise<{ file: string; scale: number }> {
    const file = path.join(this.frames, `frame-${++this.shots}.png`);
    const shot = await timeout(engine.control.screenshot(file, "main"), CAPTURE_TIMEOUT_MS, "Capturing the window");
    return { file, scale: shot.scale };
  }

  private async waitUntilShown() {
    if (transitionAppLive()) return delay(PAINT_MS);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, READY_TIMEOUT_MS);
      const off = subscribeTransition(() => {
        if (transitionAppLive()) done();
      });
      function done() {
        clearTimeout(timer);
        off();
        resolve();
      }
    });
    await delay(PAINT_MS);
  }

  private fail(step: string, error: unknown) {
    this.options.log("app-source.transition-failed", { step, message: error instanceof Error ? error.message : String(error) });
  }
}

function mkdtempFrames() {
  const dir = path.join(os.tmpdir(), `stella-rune-update-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
