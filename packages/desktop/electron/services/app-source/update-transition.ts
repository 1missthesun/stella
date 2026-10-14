import { existsSync, promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import {
  type BrowserWindow,
  type MouseInputEvent,
  type NativeImage,
  WebContentsView,
} from "electron";
import { APP_RELAUNCHING_EVENT } from "@stella/contracts/desktop/app-source";
import { springEasing } from "@stella/contracts/desktop/spring";
import { STELLA_STAR_PATH } from "@stella/contracts/stella-mark";
import { diffRegions, type LiveRect, type Rect } from "./picture-diff.js";
import { TRANSITION_PAGE_URL } from "./update-transition-page.js";
import type {
  FocusInMotion,
  FocusPullMotion,
  FrostMotion,
  HoldOptions,
  MotionTiming,
  RevealItem,
  UpdateTransitionApi,
} from "./update-transition-protocol.js";

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

const STEP_TIMEOUT_MS = 6_000;
const CAPTURE_TIMEOUT_MS = 2_000;
const READY_TIMEOUT_MS = 8_000;
const HOLD_MAX_AGE_MS = 60_000;
const LABEL_DELAY_MS = 700;
const HOLD_RECORD = "update-hold.json";
const HOLD_IMAGE = "update-hold.jpg";
const HOLD_MARK = "update-hold-mark.png";
const HOLD_MARK_PX = 102;

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

const jpegUrl = (image: NativeImage) =>
  `data:image/jpeg;base64,${image.toJPEG(100).toString("base64")}`;

const quarter = (image: NativeImage) => {
  const { width, height } = image.getSize();
  const w = Math.max(1, Math.round(width / 4));
  const h = Math.max(1, Math.round(height / 4));
  return { w, h, pixels: image.resize({ width: w, height: h, quality: "good" }).toBitmap() };
};

const FEATHER = 28;

const grow = (rect: Rect, margin: number, vw: number, vh: number): Rect => {
  const x = Math.max(0, rect.x - margin);
  const y = Math.max(0, rect.y - margin);
  return {
    x,
    y,
    w: Math.min(vw, rect.x + rect.w + margin) - x,
    h: Math.min(vh, rect.y + rect.h + margin) - y,
  };
};

const edges = (rect: Rect, feather: number, vw: number, vh: number): RevealItem["feather"] => [
  rect.x <= 0 ? 0 : feather,
  rect.y <= 0 ? 0 : feather,
  rect.x + rect.w >= vw ? 0 : feather,
  rect.y + rect.h >= vh ? 0 : feather,
];

const VISIBLE_REST = 0.01;

const spring = (
  duration: number,
  bounce: number,
  extra: Pick<MotionTiming, "delay" | "fill"> = {},
): MotionTiming => {
  const { easing, ms } = springEasing(duration, bounce, VISIBLE_REST);
  return { duration: ms, easing, ...extra };
};

const focusPull = (): FocusPullMotion => ({
  out: {
    keyframes: [
      { opacity: 1, filter: "blur(0px)", easing: "cubic-bezier(.5,0,.9,.5)" },
      { opacity: 1, filter: "blur(12px)", offset: 0.55, easing: "linear" },
      { opacity: 0, filter: "blur(14px)" },
    ],
    timing: { duration: 180, fill: "forwards" },
  },
  in: {
    keyframes: [{ filter: "blur(12px)" }, { filter: "blur(0px)" }],
    timing: spring(0.34, 0, { delay: 90, fill: "both" }),
  },
});

const FROST_BLUR = 26;
const FROST_SATURATE = 1.6;
const FROST_SPRING = 0.34;
/** When a critically damped spring of `duration` s is within 2% of rest:
 * (1 + x)e^-x = 0.02 at x = 5.83, x being ω0·t. */
const nearlySettledMs = (duration: number) => Math.round((5.83 * duration * 1000) / (2 * Math.PI));
const frost = (): FrostMotion => ({
  frost: {
    keyframes: [
      { filter: "blur(0px) saturate(1)" },
      { filter: `blur(${FROST_BLUR}px) saturate(${FROST_SATURATE})` },
    ],
    timing: spring(FROST_SPRING, 0, { fill: "forwards" }),
  },
  shownMs: nearlySettledMs(FROST_SPRING),
  tintLight: "rgba(255, 255, 255, 0.46)",
  tintDark: "rgba(28, 28, 30, 0.40)",
  blur: FROST_BLUR,
  saturate: FROST_SATURATE,
});

const appear = () => ({
  keyframes: [
    { opacity: 0, filter: "blur(6px)", transform: "scale(0.96)" },
    { opacity: 1, filter: "blur(0px)", transform: "scale(1)" },
  ],
  timing: spring(0.4, 0),
});

const focusIn = (): FocusInMotion => ({
  focus: {
    keyframes: [
      { filter: "blur(18px)", transform: "scale(1.014)" },
      { filter: "blur(0px)", transform: "scale(1)" },
    ],
    timing: spring(0.4, 0, { delay: 40, fill: "both" }),
  },
  fade: {
    keyframes: [{ opacity: 1 }, { opacity: 0 }],
    timing: { duration: 300, delay: 40, easing: "cubic-bezier(.2,.6,.3,1)", fill: "forwards" },
  },
  leave: {
    keyframes: [
      { opacity: 1, filter: "blur(0px)", transform: "scale(1)" },
      { opacity: 0, filter: "blur(6px)", transform: "scale(0.97)" },
    ],
    timing: { duration: 160, easing: "ease-in", fill: "forwards" },
  },
});

const MARK_SVG = `<svg aria-hidden="true" viewBox="-7.4 -7.48 243.33 243.33"><defs><linearGradient id="ut-ink" gradientUnits="userSpaceOnUse" x1="114.2705" y1="212.54313000000002" x2="114.2705" y2="15.99787"><stop offset="0" stop-color="#00aad8"/><stop offset="0.25" stop-color="#3493d9"/><stop offset="0.5" stop-color="#4878db"/><stop offset="0.75" stop-color="#7449c5"/><stop offset="1" stop-color="#be57a4"/></linearGradient><radialGradient id="ut-core" gradientUnits="userSpaceOnUse" cx="114.2705" cy="114.2705" r="105.12886"><stop offset="0" stop-color="#fff" stop-opacity="0.26"/><stop offset="0.32" stop-color="#fff" stop-opacity="0.09"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><path fill="url(#ut-ink)" d="${STELLA_STAR_PATH}"/><path fill="url(#ut-core)" d="${STELLA_STAR_PATH}"/><path fill="#fff" d="M102.13 111.6L102.12 114.49L102.1 117.47L102.01 120.61L101.7 123.93L100.94 127.21L99.49 130.03L97.37 131.95L94.88 132.95L92.38 133.36L90.01 133.49L87.76 133.52L85.58 133.52L83.4 133.52L81.15 133.49L78.78 133.36L76.28 132.95L73.79 131.95L71.67 130.03L70.22 127.21L69.47 123.93L69.15 120.61L69.06 117.47L69.04 114.49L69.03 111.6L69.04 108.71L69.06 105.73L69.15 102.59L69.47 99.27L70.22 95.99L71.67 93.17L73.79 91.25L76.28 90.25L78.78 89.84L81.15 89.71L83.4 89.68L85.58 89.68L87.76 89.68L90.01 89.71L92.38 89.84L94.88 90.25L97.37 91.25L99.49 93.17L100.94 95.99L101.7 99.27L102.01 102.59L102.1 105.73L102.12 108.71Z"/><path fill="#fff" d="M159.37 111.6L159.37 114.49L159.35 117.47L159.25 120.61L158.94 123.93L158.18 127.21L156.74 130.03L154.61 131.95L152.13 132.95L149.63 133.36L147.25 133.49L145 133.52L142.83 133.52L140.65 133.52L138.4 133.49L136.02 133.36L133.52 132.95L131.04 131.95L128.91 130.03L127.47 127.21L126.71 123.93L126.4 120.61L126.3 117.47L126.28 114.49L126.28 111.6L126.28 108.71L126.3 105.73L126.4 102.59L126.71 99.27L127.47 95.99L128.91 93.17L131.04 91.25L133.52 90.25L136.02 89.84L138.4 89.71L140.65 89.68L142.83 89.68L145 89.68L147.25 89.71L149.63 89.84L152.13 90.25L154.61 91.25L156.74 93.17L158.18 95.99L158.94 99.27L159.25 102.59L159.35 105.73L159.37 108.71Z"/></svg>`;

const FREEZE_SCRIPT = `(() => {
  const isLive = (node) => Boolean(node && node.closest && node.closest('[data-update-transition="live"]'));
  const style = document.createElement("style");
  style.textContent = "*, *::before, *::after { caret-color: transparent !important; }";
  document.head.append(style);
  const paused = document.getAnimations().filter((a) => a.playState === "running" && !isLive(a.effect && a.effect.target));
  for (const a of paused) a.pause();
  window.__stellaUpdateThaw = () => {
    style.remove();
    for (const a of paused) if (a.playState === "paused") a.play();
    delete window.__stellaUpdateThaw;
  };
  return {
    visible: document.visibilityState === "visible",
    live: [...document.querySelectorAll('[data-update-transition="live"]')].map((el) => {
      const r = el.getBoundingClientRect();
      return [Math.floor(r.left) - 2, Math.floor(r.top) - 2, Math.ceil(r.width) + 4, Math.ceil(r.height) + 4];
    }),
  };
})()`;

const THAW_SCRIPT = "window.__stellaUpdateThaw?.()";

const PAINTED_SCRIPT =
  "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))";

const LIVE_SCRIPT = `(() => {
  const splash = document.getElementById("stella-launch");
  if (splash?.dataset.exiting === "true") splash.remove();
  return document.readyState === "complete" && !document.getElementById("stella-launch");
})()`;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type PendingHold = { backgroundColor: string; image: string };

const HELD_FRAME_ID = "stella-update-hold";

export const pendingHold = (holdDir: string): PendingHold | null => {
  try {
    const hold = JSON.parse(readFileSync(path.join(holdDir, HOLD_RECORD), "utf8")) as UpdateHold;
    if (Date.now() - hold.since > HOLD_MAX_AGE_MS || !existsSync(hold.image)) return null;
    return { backgroundColor: hold.dark ? "#1c1c1e" : "#f2f2f3", image: hold.image };
  } catch {
    return null;
  }
};

export const heldFirstPage = (html: string, hold: PendingHold) => {
  let image: string;
  try {
    image = readFileSync(hold.image).toString("base64");
  } catch {
    return html;
  }
  const frame = `<div id="${HELD_FRAME_ID}" aria-hidden="true" style="position:fixed;inset:0;z-index:2147483647;pointer-events:none;background:${hold.backgroundColor} url(data:image/jpeg;base64,${image}) 0 0 / 100% 100% no-repeat"></div>`;
  return html.includes("</body>") ? html.replace("</body>", `${frame}\n</body>`) : `${html}${frame}`;
};

const REMOVE_HELD_FRAME = `document.getElementById(${JSON.stringify(HELD_FRAME_ID)})?.remove()`;

export class UpdateTransition {
  private readonly options: UpdateTransitionOptions;
  private view: WebContentsView | null = null;
  private host: BrowserWindow | null = null;
  private viewLoad: Promise<void> | null = null;
  private holdPlaying: Promise<void> | null = null;

  constructor(options: UpdateTransitionOptions) {
    this.options = options;
  }

  prewarm() {
    if (!this.view || this.view.webContents.isDestroyed()) this.createView();
  }

  async cover(): Promise<CoveredWindow | null> {
    const win = this.visibleWindow();
    if (!win) return null;
    const started = performance.now();
    let view: WebContentsView;
    let before: NativeImage;
    let live: LiveRect[];
    let coverSplit = "";
    try {
      const frozen = await this.freeze(win);
      if (!frozen) {
        await win.webContents.executeJavaScript(THAW_SCRIPT).catch(() => {});
        return null;
      }
      const frozenAt = performance.now();
      live = frozen;
      view = await this.attach(win);
      const attachedAt = performance.now();
      before = await this.capture(win);
      const capturedAt = performance.now();
      await this.call(view, "cover", jpegUrl(before), live);
      coverSplit = `freeze ${Math.round(frozenAt - started)} attach ${Math.round(attachedAt - frozenAt)} capture ${Math.round(capturedAt - attachedAt)} show ${Math.round(performance.now() - capturedAt)}`;
    } catch (error) {
      this.fail("cover", error);
      await this.uncover(win);
      return null;
    }
    const coverMs = Math.round(performance.now() - started);
    return {
      cancel: () => this.uncover(win),
      reveal: async <T>(swap: () => Promise<T>) => {
        let reloaded = false;
        const reloading = () => {
          reloaded = true;
          void this.call(view, "fillLive").catch(() => {});
        };
        win.webContents.once("did-start-loading", reloading);
        const swapStarted = performance.now();
        let result: T;
        let small: ReturnType<typeof quarter>;
        try {
          const swapping = swap();
          small = quarter(before);
          result = await swapping;
        } catch (error) {
          await this.uncover(win);
          throw error;
        } finally {
          win.webContents.removeListener("did-start-loading", reloading);
        }
        try {
          const swapped = performance.now();
          await this.waitUntilShown(win, { reloaded: () => reloaded });
          const shown = performance.now();
          const after = await this.capture(win);
          const capturedAt = performance.now();
          const { width: vw, height: vh } = win.getContentBounds();
          const dpr = after.getSize().width / vw;
          const next = quarter(after);
          const quarteredAt = performance.now();
          const sameSize = next.w === small.w && next.h === small.h;
          const { whole, regions } = sameSize
            ? diffRegions(small.pixels, next.pixels, next.w, next.h, 4 / dpr, { w: vw, h: vh }, live)
            : { whole: true, regions: [{ x: 0, y: 0, w: vw, h: vh }] };
          const diffedAt = performance.now();
          const items = regions.map((region): RevealItem => {
            const rect = whole ? region : grow(region, FEATHER, vw, vh);
            const crop = whole
              ? after
              : after.crop({
                  x: Math.round(rect.x * dpr),
                  y: Math.round(rect.y * dpr),
                  width: Math.round(rect.w * dpr),
                  height: Math.round(rect.h * dpr),
                });
            return { rect, feather: whole ? [0, 0, 0, 0] : edges(rect, FEATHER, vw, vh), after: jpegUrl(crop) };
          });
          const compared = performance.now();
          const letThrough = this.letInputThrough(view, win);
          const report = items.length
            ? await this.call(view, "reveal", items, whole, focusPull()).finally(letThrough)
            : null;
          if (!items.length) letThrough();
          this.options.log("app-source.transition", {
            coverMs,
            coverSplit,
            swapMs: Math.round(swapped - swapStarted),
            paintMs: Math.round(shown - swapped),
            compareMs: Math.round(compared - shown),
            split: `capture ${Math.round(capturedAt - shown)} quarter ${Math.round(quarteredAt - capturedAt)} diff ${Math.round(diffedAt - quarteredAt)} crops ${Math.round(compared - diffedAt)}`,
            prepMs: report?.prepMs ?? 0,
            regions: regions.length,
            whole,
            rects: regions.map((r) => `${r.x},${r.y} ${r.w}x${r.h}`).join(" | "),
            totalMs: Math.round(performance.now() - started),
          });
        } catch (error) {
          this.fail("reveal", error);
        } finally {
          await this.uncover(win);
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
      if (!(await this.freeze(win))) {
        await win.webContents.executeJavaScript(THAW_SCRIPT).catch(() => {});
        return null;
      }
      step("freeze");
      const view = await this.attach(win);
      step("attach");
      const before = await this.capture(win);
      step("capture");
      await this.call(view, "cover", jpegUrl(before), []);
      step("show");
      const { frosted, dark } = await this.call(view, "frost", frost());
      step("frost");
      const mark = await this.call(view, "renderMark", MARK_SVG, dark, HOLD_MARK_PX);
      const hold: UpdateHold = {
        image: path.join(this.options.holdDir, HOLD_IMAGE),
        mark: path.join(this.options.holdDir, HOLD_MARK),
        label: this.options.holdLabel(),
        since,
        dark,
        frame: win.getContentBounds(),
      };
      await fs.mkdir(this.options.holdDir, { recursive: true });
      await Promise.all([
        fs.writeFile(hold.image, Buffer.from(frosted, "base64")),
        fs.writeFile(hold.mark, Buffer.from(mark, "base64")),
        fs.writeFile(path.join(this.options.holdDir, HOLD_RECORD), JSON.stringify(hold)),
      ]);
      void this.call(view, "hold", `data:image/jpeg;base64,${frosted}`, this.holdOptions(hold)).catch(() => {});
      step("files");
      const played = this.call(view, "frosted")
        .catch(() => {})
        .then(() => {
          step("played");
          this.options.log("app-source.hold", { ms: Date.now() - since, split: split.join(" | ") });
        });
      this.holdPlaying = played;
      return {
        commit: async () => {
          await timeout(
            win.webContents.executeJavaScript(
              `window.dispatchEvent(new Event(${JSON.stringify(APP_RELAUNCHING_EVENT)}))`,
            ),
            1_000,
            "Telling the window",
          ).catch(() => {});
          this.options.onHold?.(hold);
        },
        release: async () => {
          await this.uncover(win);
          await Promise.all(
            [path.join(this.options.holdDir, HOLD_RECORD), hold.image, hold.mark].map((file) =>
              fs.rm(file, { force: true }),
            ),
          );
        },
      };
    } catch (error) {
      this.fail("hold", error);
      await this.uncover(win);
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

  async resumeAfterRelaunch(win: BrowserWindow): Promise<void> {
    const record = path.join(this.options.holdDir, HOLD_RECORD);
    const hold = await fs
      .readFile(record, "utf8")
      .then((text) => JSON.parse(text) as UpdateHold)
      .catch(() => null);
    await fs.rm(record, { force: true });
    if (!hold || Date.now() - hold.since > HOLD_MAX_AGE_MS) return;
    let view: WebContentsView;
    const removeHeldFrame = () =>
      win.isDestroyed() ? Promise.resolve() : win.webContents.executeJavaScript(REMOVE_HELD_FRAME).catch(() => {});
    try {
      const started = Date.now();
      const image = await fs.readFile(hold.image);
      view = await this.attach(win);
      const attached = Date.now();
      await this.call(view, "hold", `data:image/jpeg;base64,${image.toString("base64")}`, this.holdOptions(hold));
      void removeHeldFrame();
      this.options.log("app-source.resume-hold", {
        attachMs: attached - started,
        holdMs: Date.now() - attached,
      });
    } catch (error) {
      this.fail("resume-hold", error);
      await removeHeldFrame();
      await this.uncover(win);
      return;
    }
    void (async () => {
      try {
        await this.waitUntilShown(win, { reloaded: () => true });
        await removeHeldFrame();
        const after = await this.capture(win);
        await this.call(view, "focusIn", jpegUrl(after), focusIn());
        this.options.log("app-source.relaunch-transition", {
          heldMs: Date.now() - hold.since,
        });
      } catch (error) {
        this.fail("focus-in", error);
      } finally {
        await removeHeldFrame();
        await this.uncover(win);
        await fs.rm(hold.image, { force: true });
        await fs.rm(hold.mark, { force: true });
      }
    })();
  }

  private holdOptions(hold: UpdateHold): HoldOptions {
    return {
      labelDelayMs: hold.since + LABEL_DELAY_MS - Date.now(),
      heldMs: Date.now() - hold.since,
      dark: hold.dark,
      label: this.options.holdLabel(),
      markSvg: MARK_SVG,
      appear: appear(),
    };
  }

  private visibleWindow() {
    const win = this.options.getWindow();
    if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) return null;
    return win;
  }

  private createView() {
    if (this.view && this.host && !this.host.isDestroyed()) {
      this.host.contentView.removeChildView(this.view);
    }
    this.host = null;
    const view = new WebContentsView({
      webPreferences: {
        partition: this.options.partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        spellcheck: false,
      },
    });
    view.setBackgroundColor("#00000000");
    this.view = view;
    this.viewLoad = view.webContents.loadURL(TRANSITION_PAGE_URL);
    return view;
  }

  private async attach(win: BrowserWindow): Promise<WebContentsView> {
    const view =
      this.view && !this.view.webContents.isDestroyed() ? this.view : this.createView();
    await timeout(this.viewLoad!, STEP_TIMEOUT_MS, "Loading the transition page");
    if (this.host && this.host !== win && !this.host.isDestroyed()) {
      this.host.contentView.removeChildView(view);
    }
    this.host = win;
    win.contentView.addChildView(view);
    const { width, height } = win.getContentBounds();
    view.setBounds({ x: 0, y: 0, width, height });
    view.setVisible(true);
    return view;
  }

  private letInputThrough(view: WebContentsView, win: BrowserWindow) {
    const contents = view.webContents;
    const forward = (event: Electron.Event, mouse: MouseInputEvent) => {
      event.preventDefault();
      if (!win.isDestroyed()) win.webContents.sendInputEvent(mouse);
    };
    const refocus = () => {
      if (!win.isDestroyed()) win.webContents.focus();
    };
    contents.on("before-mouse-event", forward);
    contents.on("focus", refocus);
    if (contents.isFocused()) refocus();
    return () => {
      contents.removeListener("before-mouse-event", forward);
      contents.removeListener("focus", refocus);
    };
  }

  private async uncover(win: BrowserWindow) {
    const view = this.view;
    if (!view || view.webContents.isDestroyed()) return;
    await view.webContents.executeJavaScript("window.__updateTransition?.clear()").catch(() => {});
    view.setVisible(false);
    if (!win.isDestroyed()) {
      await win.webContents.executeJavaScript(THAW_SCRIPT).catch(() => {});
    }
  }

  private async freeze(win: BrowserWindow): Promise<LiveRect[] | null> {
    const { visible, live } = (await timeout(
      win.webContents.executeJavaScript(FREEZE_SCRIPT),
      STEP_TIMEOUT_MS,
      "Freezing the window",
    )) as { visible: boolean; live: LiveRect[] };
    if (!visible) return null;
    const zoom = win.webContents.getZoomFactor();
    return live.map(([x, y, w, h]) => [x * zoom, y * zoom, w * zoom, h * zoom]);
  }

  private capture(win: BrowserWindow) {
    return timeout(win.webContents.capturePage(), CAPTURE_TIMEOUT_MS, "Capturing the window");
  }

  private async waitUntilShown(win: BrowserWindow, { reloaded }: { reloaded: () => boolean }) {
    const contents = win.webContents;
    if (!reloaded() && !contents.isLoading()) {
      const painted = await timeout(contents.executeJavaScript(PAINTED_SCRIPT), 1_000, "Waiting for paint")
        .then(() => true, () => false);
      if (painted && !reloaded() && !contents.isLoading()) return;
    }
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const isLive = await timeout(
        contents.executeJavaScript(LIVE_SCRIPT) as Promise<boolean>,
        1_000,
        "Checking the window",
      ).catch(() => false);
      if (isLive) break;
      await delay(60);
    }
    await timeout(contents.executeJavaScript(PAINTED_SCRIPT), 1_000, "Waiting for paint").catch(() => {});
  }

  private call<Method extends keyof UpdateTransitionApi>(
    view: WebContentsView,
    method: Method,
    ...args: Parameters<UpdateTransitionApi[Method]>
  ): Promise<Awaited<ReturnType<UpdateTransitionApi[Method]>>> {
    const script = `window.__updateTransition.${method}(...${JSON.stringify(args)})`;
    return timeout(view.webContents.executeJavaScript(script), STEP_TIMEOUT_MS, `Transition ${method}`);
  }

  private fail(step: string, error: unknown) {
    this.options.log("app-source.transition-failed", {
      step,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
