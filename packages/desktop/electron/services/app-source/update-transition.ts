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
import { diffRegions, type LiveRect, type Rect } from "./picture-diff.js";
import {
  TRANSITION_PAGE_URL,
  type FocusInMotion,
  type FocusPullMotion,
  type FrostMotion,
  type HoldOptions,
  type RevealItem,
  type RevealReport,
} from "./update-transition-page.js";

/**
 * How a change to Stella takes effect on screen, using nothing but pictures
 * of the window: no knowledge of what changed or how the UI is built.
 *
 * Renderer changes: picture the window, cover it with that picture (a
 * transparent view laid over the window, so the swap underneath never
 * flashes), swap, picture it again, and hand both pictures to the cover,
 * which focus-pulls only where they differ (the whole window when most of it
 * does) and gets out of the way. Captures stay JPEG end to end: encoding
 * costs ~11 ms where a raw bitmap costs ~40 ms on a Retina window.
 *
 * Restarts: picture and frost the window, keep the frosted frame on disk and
 * with the launcher while the process restarts, show it again with the mark
 * and "Updating Stella" when the next process opens its window, and focus
 * into the live window once it is ready.
 */

/** A window under its own picture, ready for the swap. */
export type CoveredWindow = {
  /** Run the swap, then focus-pull from the old picture to the new window. */
  reveal<T>(swap: () => Promise<T>): Promise<T>;
  /** Uncover without swapping. */
  cancel(): Promise<void>;
};

/** A window frosted for a relaunch that has not been committed to yet. */
export type RelaunchHold = {
  /** The relaunch is certain: hand the frame to the launcher once the
   * window shows it too. */
  commit(): Promise<void>;
  /** The relaunch is off: uncover the window and drop the frame. */
  release(): Promise<void>;
};

export type UpdateHold = {
  /** The frosted frame, a JPEG beside the hold record. */
  image: string;
  /** The mark in the hold's colors, a PNG for the launcher. */
  mark: string;
  /** "Updating Stella", in the user's language. */
  label: string;
  /** When the update started holding, ms since epoch: paces the label. */
  since: number;
  dark: boolean;
  /** The window's frame in screen coordinates, for the launcher. */
  frame: { x: number; y: number; width: number; height: number };
};

type UpdateTransitionOptions = {
  getWindow: () => BrowserWindow | null;
  /** The main window's session partition: the overlay shares it. */
  partition: string;
  /** Directory for the hold carried across a restart. */
  holdDir: string;
  /** "Updating Stella", in the user's language. */
  holdLabel: () => string;
  /** Tell the launcher to hold the frame between processes (no-op without one). */
  onHold?: (hold: UpdateHold) => void;
  log: (event: string, data: Record<string, unknown>) => void;
};

/** Longest a step may take before the transition gives up and uncovers. */
const STEP_TIMEOUT_MS = 6_000;
/** Longest a window capture may take. */
const CAPTURE_TIMEOUT_MS = 2_000;
/** Longest a reload or relaunch may keep the window covered. */
const READY_TIMEOUT_MS = 8_000;
/** A hold older than this is from a restart that never came back. */
const HOLD_MAX_AGE_MS = 60_000;
/** The mark and label wait this long, so a quick restart never shows them. */
const LABEL_DELAY_MS = 700;
const HOLD_RECORD = "update-hold.json";
const HOLD_IMAGE = "update-hold.jpg";
const HOLD_MARK = "update-hold-mark.png";
/** The mark's pixel size for the launcher: 34 pt at up to 3x. */
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

/** A quarter-resolution bitmap of a picture, for comparing (~5 ms on Retina). */
const quarter = (image: NativeImage) => {
  const { width, height } = image.getSize();
  const w = Math.max(1, Math.round(width / 4));
  const h = Math.max(1, Math.round(height / 4));
  return { w, h, pixels: image.resize({ width: w, height: h, quality: "good" }).toBitmap() };
};

/** The focus pull feathers out over this margin (CSS px) around a region. */
const FEATHER = 28;

/** A region grown by `margin` on every side, kept inside the window. */
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

/** Feather per side (left, top, right, bottom): none where the window's edge is. */
const edges = (rect: Rect, feather: number, vw: number, vh: number): RevealItem["feather"] => [
  rect.x <= 0 ? 0 : feather,
  rect.y <= 0 ? 0 : feather,
  rect.x + rect.w >= vw ? 0 : feather,
  rect.y + rect.h >= vh ? 0 : feather,
];

/**
 * Blur, opacity and a scale of a percent or two read as still once a spring
 * is within 1% of rest; the 0.2% tail after that only holds the cover longer.
 */
const VISIBLE_REST = 0.01;

const spring = (duration: number, bounce: number, extra: KeyframeTiming = {}) => {
  const { easing, ms } = springEasing(duration, bounce, VISIBLE_REST);
  return { duration: ms, easing, ...extra };
};
type KeyframeTiming = { delay?: number; fill?: string };

/** The old frame defocuses first; the two trade places only while both are
 * soft, so there is never a legible double image; then the new one sharpens. */
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

/** The Stella mark (packages/desktop-ui/public/stella-logo.svg), inline. */
const MARK_SVG = `<svg aria-hidden="true" viewBox="-7.4 -7.48 243.33 243.33"><defs><linearGradient id="ut-ink" gradientUnits="userSpaceOnUse" x1="114.2705" y1="212.54313000000002" x2="114.2705" y2="15.99787"><stop offset="0" stop-color="#00aad8"/><stop offset="0.25" stop-color="#3493d9"/><stop offset="0.5" stop-color="#4878db"/><stop offset="0.75" stop-color="#7449c5"/><stop offset="1" stop-color="#be57a4"/></linearGradient><radialGradient id="ut-core" gradientUnits="userSpaceOnUse" cx="114.2705" cy="114.2705" r="105.12886"><stop offset="0" stop-color="#fff" stop-opacity="0.26"/><stop offset="0.32" stop-color="#fff" stop-opacity="0.09"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><path fill="url(#ut-ink)" d="M186.31 114.27C186.27 115.88 186.83 117.38 187.75 119.09C188.68 120.79 190.29 122.54 191.87 124.49C193.44 126.43 195.39 128.52 197.2 130.77C199 133.01 200.93 135.42 202.7 137.96C204.46 140.51 206.27 143.23 207.78 146.01C209.3 148.8 210.82 151.79 211.8 154.67C212.78 157.54 213.63 160.62 213.65 163.28C213.67 165.94 213.12 168.55 211.91 170.64C210.7 172.73 208.72 174.51 206.4 175.83C204.09 177.14 201 177.94 198.02 178.53C195.04 179.13 191.69 179.31 188.52 179.38C185.35 179.46 182.09 179.26 179 179C175.92 178.75 172.87 178.28 170.01 177.83C167.16 177.39 164.37 176.74 161.89 176.33C159.41 175.92 157.07 175.38 155.12 175.4C153.16 175.42 151.55 175.64 150.16 176.44C148.77 177.24 147.77 178.5 146.77 180.18C145.78 181.85 145.07 184.14 144.18 186.48C143.29 188.83 142.46 191.56 141.42 194.25C140.38 196.93 139.25 199.8 137.94 202.59C136.62 205.39 135.16 208.3 133.51 211C131.86 213.7 130.03 216.5 128.03 218.78C126.03 221.06 123.8 223.32 121.51 224.67C119.21 226.01 116.68 226.84 114.27 226.84C111.86 226.84 109.33 226.01 107.03 224.67C104.74 223.32 102.51 221.06 100.51 218.78C98.51 216.5 96.68 213.7 95.03 211C93.38 208.3 91.92 205.38 90.6 202.59C89.29 199.8 88.16 196.93 87.12 194.25C86.08 191.58 85.24 188.85 84.34 186.52C83.44 184.19 82.73 181.93 81.72 180.28C80.7 178.63 79.68 177.4 78.26 176.64C76.84 175.89 75.2 175.71 73.21 175.73C71.21 175.75 68.83 176.34 66.3 176.79C63.77 177.23 60.93 177.92 58.02 178.41C55.12 178.89 52.01 179.39 48.86 179.68C45.72 179.97 42.39 180.2 39.16 180.14C35.93 180.09 32.51 179.93 29.46 179.34C26.42 178.76 23.27 177.97 20.91 176.65C18.56 175.33 16.53 173.53 15.31 171.41C14.09 169.29 13.54 166.63 13.57 163.93C13.6 161.23 14.5 158.1 15.51 155.18C16.53 152.25 18.1 149.21 19.67 146.38C21.24 143.56 23.1 140.79 24.92 138.21C26.75 135.63 28.73 133.19 30.6 130.91C32.47 128.64 34.49 126.52 36.14 124.56C37.8 122.59 39.5 120.82 40.51 119.1C41.53 117.39 42.2 115.88 42.25 114.27C42.3 112.66 41.75 111.16 40.83 109.46C39.91 107.76 38.3 106.01 36.74 104.06C35.17 102.12 33.23 100.04 31.43 97.79C29.63 95.55 27.71 93.14 25.95 90.6C24.19 88.07 22.39 85.35 20.88 82.57C19.37 79.79 17.86 76.8 16.88 73.93C15.91 71.06 15.06 68 15.05 65.34C15.03 62.68 15.58 60.08 16.78 57.99C17.99 55.9 19.97 54.12 22.28 52.81C24.59 51.49 27.67 50.69 30.64 50.1C33.62 49.51 36.96 49.32 40.12 49.24C43.28 49.16 46.54 49.36 49.61 49.61C52.69 49.87 55.74 50.33 58.58 50.77C61.43 51.21 64.21 51.86 66.69 52.26C69.16 52.66 71.5 53.19 73.44 53.17C75.39 53.14 76.99 52.91 78.38 52.1C79.76 51.3 80.76 50.02 81.75 48.33C82.75 46.65 83.44 44.35 84.34 42C85.23 39.65 86.05 36.91 87.09 34.21C88.13 31.52 89.26 28.64 90.58 25.84C91.89 23.04 93.35 20.12 95 17.41C96.66 14.71 98.49 11.9 100.49 9.61C102.49 7.33 104.73 5.05 107.02 3.7C109.32 2.36 111.85 1.53 114.27 1.53C116.69 1.53 119.22 2.36 121.52 3.7C123.81 5.05 126.05 7.33 128.05 9.61C130.05 11.9 131.88 14.71 133.54 17.41C135.19 20.12 136.65 23.04 137.96 25.84C139.28 28.64 140.41 31.52 141.45 34.21C142.49 36.89 143.32 39.63 144.22 41.96C145.12 44.3 145.83 46.57 146.84 48.22C147.85 49.88 148.88 51.12 150.29 51.88C151.71 52.64 153.35 52.83 155.34 52.81C157.33 52.78 159.71 52.2 162.24 51.75C164.77 51.31 167.61 50.62 170.52 50.13C173.42 49.65 176.53 49.15 179.68 48.86C182.82 48.57 186.15 48.34 189.38 48.4C192.61 48.46 196.04 48.61 199.08 49.2C202.12 49.78 205.27 50.57 207.63 51.89C209.99 53.22 212.01 55.02 213.23 57.14C214.46 59.26 215 61.91 214.97 64.61C214.94 67.32 214.05 70.44 213.03 73.36C212.01 76.29 210.44 79.33 208.87 82.16C207.3 84.99 205.44 87.75 203.62 90.33C201.8 92.91 199.81 95.35 197.94 97.63C196.07 99.9 194.05 102.02 192.4 103.98C190.75 105.95 189.05 107.72 188.03 109.44C187.02 111.15 186.36 112.66 186.31 114.27Z"/><path fill="url(#ut-core)" d="M186.31 114.27C186.27 115.88 186.83 117.38 187.75 119.09C188.68 120.79 190.29 122.54 191.87 124.49C193.44 126.43 195.39 128.52 197.2 130.77C199 133.01 200.93 135.42 202.7 137.96C204.46 140.51 206.27 143.23 207.78 146.01C209.3 148.8 210.82 151.79 211.8 154.67C212.78 157.54 213.63 160.62 213.65 163.28C213.67 165.94 213.12 168.55 211.91 170.64C210.7 172.73 208.72 174.51 206.4 175.83C204.09 177.14 201 177.94 198.02 178.53C195.04 179.13 191.69 179.31 188.52 179.38C185.35 179.46 182.09 179.26 179 179C175.92 178.75 172.87 178.28 170.01 177.83C167.16 177.39 164.37 176.74 161.89 176.33C159.41 175.92 157.07 175.38 155.12 175.4C153.16 175.42 151.55 175.64 150.16 176.44C148.77 177.24 147.77 178.5 146.77 180.18C145.78 181.85 145.07 184.14 144.18 186.48C143.29 188.83 142.46 191.56 141.42 194.25C140.38 196.93 139.25 199.8 137.94 202.59C136.62 205.39 135.16 208.3 133.51 211C131.86 213.7 130.03 216.5 128.03 218.78C126.03 221.06 123.8 223.32 121.51 224.67C119.21 226.01 116.68 226.84 114.27 226.84C111.86 226.84 109.33 226.01 107.03 224.67C104.74 223.32 102.51 221.06 100.51 218.78C98.51 216.5 96.68 213.7 95.03 211C93.38 208.3 91.92 205.38 90.6 202.59C89.29 199.8 88.16 196.93 87.12 194.25C86.08 191.58 85.24 188.85 84.34 186.52C83.44 184.19 82.73 181.93 81.72 180.28C80.7 178.63 79.68 177.4 78.26 176.64C76.84 175.89 75.2 175.71 73.21 175.73C71.21 175.75 68.83 176.34 66.3 176.79C63.77 177.23 60.93 177.92 58.02 178.41C55.12 178.89 52.01 179.39 48.86 179.68C45.72 179.97 42.39 180.2 39.16 180.14C35.93 180.09 32.51 179.93 29.46 179.34C26.42 178.76 23.27 177.97 20.91 176.65C18.56 175.33 16.53 173.53 15.31 171.41C14.09 169.29 13.54 166.63 13.57 163.93C13.6 161.23 14.5 158.1 15.51 155.18C16.53 152.25 18.1 149.21 19.67 146.38C21.24 143.56 23.1 140.79 24.92 138.21C26.75 135.63 28.73 133.19 30.6 130.91C32.47 128.64 34.49 126.52 36.14 124.56C37.8 122.59 39.5 120.82 40.51 119.1C41.53 117.39 42.2 115.88 42.25 114.27C42.3 112.66 41.75 111.16 40.83 109.46C39.91 107.76 38.3 106.01 36.74 104.06C35.17 102.12 33.23 100.04 31.43 97.79C29.63 95.55 27.71 93.14 25.95 90.6C24.19 88.07 22.39 85.35 20.88 82.57C19.37 79.79 17.86 76.8 16.88 73.93C15.91 71.06 15.06 68 15.05 65.34C15.03 62.68 15.58 60.08 16.78 57.99C17.99 55.9 19.97 54.12 22.28 52.81C24.59 51.49 27.67 50.69 30.64 50.1C33.62 49.51 36.96 49.32 40.12 49.24C43.28 49.16 46.54 49.36 49.61 49.61C52.69 49.87 55.74 50.33 58.58 50.77C61.43 51.21 64.21 51.86 66.69 52.26C69.16 52.66 71.5 53.19 73.44 53.17C75.39 53.14 76.99 52.91 78.38 52.1C79.76 51.3 80.76 50.02 81.75 48.33C82.75 46.65 83.44 44.35 84.34 42C85.23 39.65 86.05 36.91 87.09 34.21C88.13 31.52 89.26 28.64 90.58 25.84C91.89 23.04 93.35 20.12 95 17.41C96.66 14.71 98.49 11.9 100.49 9.61C102.49 7.33 104.73 5.05 107.02 3.7C109.32 2.36 111.85 1.53 114.27 1.53C116.69 1.53 119.22 2.36 121.52 3.7C123.81 5.05 126.05 7.33 128.05 9.61C130.05 11.9 131.88 14.71 133.54 17.41C135.19 20.12 136.65 23.04 137.96 25.84C139.28 28.64 140.41 31.52 141.45 34.21C142.49 36.89 143.32 39.63 144.22 41.96C145.12 44.3 145.83 46.57 146.84 48.22C147.85 49.88 148.88 51.12 150.29 51.88C151.71 52.64 153.35 52.83 155.34 52.81C157.33 52.78 159.71 52.2 162.24 51.75C164.77 51.31 167.61 50.62 170.52 50.13C173.42 49.65 176.53 49.15 179.68 48.86C182.82 48.57 186.15 48.34 189.38 48.4C192.61 48.46 196.04 48.61 199.08 49.2C202.12 49.78 205.27 50.57 207.63 51.89C209.99 53.22 212.01 55.02 213.23 57.14C214.46 59.26 215 61.91 214.97 64.61C214.94 67.32 214.05 70.44 213.03 73.36C212.01 76.29 210.44 79.33 208.87 82.16C207.3 84.99 205.44 87.75 203.62 90.33C201.8 92.91 199.81 95.35 197.94 97.63C196.07 99.9 194.05 102.02 192.4 103.98C190.75 105.95 189.05 107.72 188.03 109.44C187.02 111.15 186.36 112.66 186.31 114.27Z"/><path fill="#fff" d="M102.13 111.6L102.12 114.49L102.1 117.47L102.01 120.61L101.7 123.93L100.94 127.21L99.49 130.03L97.37 131.95L94.88 132.95L92.38 133.36L90.01 133.49L87.76 133.52L85.58 133.52L83.4 133.52L81.15 133.49L78.78 133.36L76.28 132.95L73.79 131.95L71.67 130.03L70.22 127.21L69.47 123.93L69.15 120.61L69.06 117.47L69.04 114.49L69.03 111.6L69.04 108.71L69.06 105.73L69.15 102.59L69.47 99.27L70.22 95.99L71.67 93.17L73.79 91.25L76.28 90.25L78.78 89.84L81.15 89.71L83.4 89.68L85.58 89.68L87.76 89.68L90.01 89.71L92.38 89.84L94.88 90.25L97.37 91.25L99.49 93.17L100.94 95.99L101.7 99.27L102.01 102.59L102.1 105.73L102.12 108.71Z"/><path fill="#fff" d="M159.37 111.6L159.37 114.49L159.35 117.47L159.25 120.61L158.94 123.93L158.18 127.21L156.74 130.03L154.61 131.95L152.13 132.95L149.63 133.36L147.25 133.49L145 133.52L142.83 133.52L140.65 133.52L138.4 133.49L136.02 133.36L133.52 132.95L131.04 131.95L128.91 130.03L127.47 127.21L126.71 123.93L126.4 120.61L126.3 117.47L126.28 114.49L126.28 111.6L126.28 108.71L126.3 105.73L126.4 102.59L126.71 99.27L127.47 95.99L128.91 93.17L131.04 91.25L133.52 90.25L136.02 89.84L138.4 89.71L140.65 89.68L142.83 89.68L145 89.68L147.25 89.71L149.63 89.84L152.13 90.25L154.61 91.25L156.74 93.17L158.18 95.99L158.94 99.27L159.25 102.59L159.35 105.73L159.37 108.71Z"/></svg>`;

/**
 * Runs in the main window before the "before" picture: everything that
 * animates on its own pauses and the caret hides, so the two pictures differ
 * only where the change did. Elements marked `data-update-transition="live"`
 * (the Update card's progress) keep running and stay out of the comparison;
 * their rects come back in CSS px, with whether the page is on screen at all.
 */
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

/** Two frames: whatever the last change rendered is now on screen. */
const PAINTED_SCRIPT =
  "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))";

/**
 * Live: the page finished loading and its launch splash is gone. A splash
 * already fading out is removed here: the window is under the cover, so
 * nobody would see the fade.
 */
const LIVE_SCRIPT = `(() => {
  const splash = document.getElementById("stella-launch");
  if (splash?.dataset.exiting === "true") splash.remove();
  return document.readyState === "complete" && !document.getElementById("stella-launch");
})()`;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type PendingHold = { backgroundColor: string; image: string };

/** The held frame inside the window's own first page (see `heldFirstPage`). */
const HELD_FRAME_ID = "stella-update-hold";

/**
 * A restart left a hold for this process to show (cheap, synchronous: read
 * before the window is made). The window then opens in the hold's colors,
 * and its first page shows the held frame (`heldFirstPage`) until the
 * overlay holds it.
 */
export const pendingHold = (holdDir: string): PendingHold | null => {
  try {
    const hold = JSON.parse(readFileSync(path.join(holdDir, HOLD_RECORD), "utf8")) as UpdateHold;
    if (Date.now() - hold.since > HOLD_MAX_AGE_MS || !existsSync(hold.image)) return null;
    return { backgroundColor: hold.dark ? "#1c1c1e" : "#f2f2f3", image: hold.image };
  } catch {
    return null;
  }
};

/**
 * The window's first page after an update restart, with the held frame over
 * its launch splash: the page paints well before the overlay can, and the
 * splash would otherwise be the first thing on screen. The overlay takes the
 * hold over and this frame is removed under it.
 */
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

  constructor(options: UpdateTransitionOptions) {
    this.options = options;
  }

  /** Load the overlay ahead of time while an update waits, so a click doesn't pay for it. */
  prewarm() {
    if (!this.view || this.view.webContents.isDestroyed()) this.createView();
  }

  /**
   * Picture the window and cover it with that picture. Null when there is
   * nothing to cover (no visible window) or covering failed; the swap then
   * runs plain. Covering can start before the swap is ready to run (main
   * starts it while the launcher signs the change): nothing on screen moves
   * in between.
   */
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
        // A swap the page can't take hot reloads it: what was live under the
        // cover goes, so the cover shows it pictured instead.
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
          // Off the critical path: the swap is mostly waiting on the renderer.
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
          // The live window under the reveal already shows the change: the
          // pointer and the keyboard go to it while the reveal plays.
          const letThrough = this.letInputThrough(view, win);
          const report = items.length
            ? ((await this.call(view, "reveal", items, whole, focusPull()).finally(letThrough)) as RevealReport)
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

  /**
   * Before a relaunch: frost the window, keep the frosted frame for the next
   * process, and start the label. The launcher is handed the frame only on
   * `commit`, once the relaunch is certain; `release` uncovers the window when
   * the update fails before it. Never throws; null when nothing was held.
   */
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
      const { frosted, dark } = (await this.call(view, "frost", frost())) as {
        frosted: string;
        dark: boolean;
      };
      step("frost");
      const mark = (await this.call(view, "renderMark", MARK_SVG, dark, HOLD_MARK_PX)) as string;
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
      // The old window keeps holding until the process exits.
      void this.call(view, "hold", `data:image/jpeg;base64,${frosted}`, this.holdOptions(hold)).catch(() => {});
      step("files");
      const played = this.call(view, "frosted")
        .catch(() => {})
        .then(() => {
          step("played");
          this.options.log("app-source.hold", { ms: Date.now() - since, split: split.join(" | ") });
        });
      return {
        commit: async () => {
          await Promise.all([
            played,
            timeout(
              win.webContents.executeJavaScript(
                `window.dispatchEvent(new Event(${JSON.stringify(APP_RELAUNCHING_EVENT)}))`,
              ),
              1_000,
              "Telling the window",
            ).catch(() => {}),
          ]);
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

  /** A restart left a hold for this process (cheap, synchronous). */
  hasPendingHold() {
    return existsSync(path.join(this.options.holdDir, HOLD_RECORD));
  }

  /**
   * In the process after a relaunch, with the main window just created and
   * not yet shown: if a fresh hold is waiting, show it over the window.
   * Returns once the hold is on screen (or there is none); the focus-in runs
   * on its own once the window is live.
   */
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
      // The overlay holds the frame now; the page's copy goes from under it.
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

  /** The overlay, on top of `win`'s views, sized to it, loaded and visible. */
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
    // It stays in its window, hidden, between updates; a new window takes it.
    if (this.host && this.host !== win && !this.host.isDestroyed()) {
      this.host.contentView.removeChildView(view);
    }
    this.host = win;
    // Adding a child that is already there moves it to the top.
    win.contentView.addChildView(view);
    const { width, height } = win.getContentBounds();
    view.setBounds({ x: 0, y: 0, width, height });
    view.setVisible(true);
    return view;
  }

  /**
   * Hand the overlay's mouse input to the window under it, and keep keyboard
   * focus there, until the returned function is called.
   */
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

  /**
   * Freeze the window for its pictures. Null when its page isn't on screen
   * (covered, on another space, the display asleep): it paints no frames then,
   * and nobody would see a transition anyway.
   */
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

  /** A picture of the window; bounded, since a window that stops painting never answers. */
  private capture(win: BrowserWindow) {
    return timeout(win.webContents.capturePage(), CAPTURE_TIMEOUT_MS, "Capturing the window");
  }

  /**
   * Until what the swap rendered is on screen: two frames after a hot
   * update; after a reload (or in a fresh process), until the page is live
   * again and has painted.
   */
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
    // A page that stops painting (covered mid-swap) never answers; go on.
    await timeout(contents.executeJavaScript(PAINTED_SCRIPT), 1_000, "Waiting for paint").catch(() => {});
  }

  private call(view: WebContentsView, method: string, ...args: unknown[]) {
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
