import { launch } from "@cloudflare/playwright";
import type { BrowserGatewayEnv } from "./profile-session-core.js";
import { GatewayError } from "./errors.js";

/**
 * Screenshots (and an optional short recording) of one Stella site, for Crew
 * agents' visual proof. The caller (cloud-builder, over the service binding)
 * checks the site belongs to the asking workspace and, for members-only
 * sites, passes a short-lived sign-in URL that lands on the page. Each view
 * gets its own throwaway browser context with no profile.
 *
 * A recording is the page's own screencast frames, replayed onto a canvas in
 * a second page and encoded there with MediaRecorder: Browser Run has no
 * ffmpeg, so the browser encodes its own video.
 */
const NAVIGATION_TIMEOUT_MS = 25_000;
const SETTLE_MS = 1_200;
const MAX_VIEWS = 4;
const MAX_FULL_PAGE_HEIGHT = 8_000;
const MAX_STEPS = 20;
const MAX_RECORDING_MS = 20_000;

type View = {
  name: string;
  width: number;
  height: number;
  scale: number;
  mobile: boolean;
  fullPage: boolean;
};

type Step =
  | { action: "click" | "hover"; selector: string }
  | { action: "type"; selector: string; text: string }
  | { action: "press"; key: string }
  | { action: "scroll"; y: number }
  | { action: "wait"; ms: number };

type CaptureRequest = {
  url: string;
  views: View[];
  waitFor: string | null;
  recording: { view: View; steps: Step[]; ms: number } | null;
};

const text = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.length > 0 && value.length <= max ? value : null;

const clampInt = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;

const parseView = (raw: unknown, index: number): View => {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const name = text(value.name, 40);
  return {
    name: name && /^[a-z0-9-]+$/u.test(name) ? name : `view-${index + 1}`,
    width: clampInt(value.width, 320, 2560, 1440),
    height: clampInt(value.height, 480, 1600, 900),
    scale: clampInt(value.scale, 1, 3, 1),
    mobile: value.mobile === true,
    fullPage: value.fullPage === true,
  };
};

const parseStep = (raw: unknown): Step => {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const selector = text(value.selector, 500);
  switch (value.action) {
    case "click":
    case "hover":
      if (!selector) break;
      return { action: value.action, selector };
    case "type": {
      const typed = typeof value.text === "string" ? value.text.slice(0, 500) : null;
      if (!selector || typed === null) break;
      return { action: "type", selector, text: typed };
    }
    case "press": {
      const key = text(value.key, 40);
      if (!key) break;
      return { action: "press", key };
    }
    case "scroll":
      return { action: "scroll", y: clampInt(value.y, -20_000, 20_000, 600) };
    case "wait":
      return { action: "wait", ms: clampInt(value.ms, 0, 10_000, 1_000) };
  }
  throw new GatewayError("bad_request", 400);
};

const parseRequest = (body: unknown): CaptureRequest => {
  const value = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const raw = text(value.url, 4096);
  let url: URL;
  try {
    url = new URL(raw ?? "");
  } catch {
    throw new GatewayError("bad_request", 400);
  }
  if (url.protocol !== "https:") throw new GatewayError("bad_request", 400);
  const views = Array.isArray(value.views) ? value.views.slice(0, MAX_VIEWS).map(parseView) : [];
  let recording: CaptureRequest["recording"] = null;
  if (value.recording && typeof value.recording === "object") {
    const rec = value.recording as Record<string, unknown>;
    const steps = Array.isArray(rec.steps) ? rec.steps.slice(0, MAX_STEPS).map(parseStep) : [];
    recording = {
      view: parseView({ ...(rec.view as object), fullPage: false }, 0),
      steps,
      ms: clampInt(rec.ms, 1_000, MAX_RECORDING_MS, 6_000),
    };
  }
  if (views.length === 0 && !recording) throw new GatewayError("bad_request", 400);
  return { url: url.toString(), views, waitFor: text(value.waitFor, 500), recording };
};

const base64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

type Browser = Awaited<ReturnType<typeof launch>>;
type Page = Awaited<ReturnType<Awaited<ReturnType<Browser["newContext"]>>["newPage"]>>;

const open = async (browser: Browser, request: CaptureRequest, view: View): Promise<Page> => {
  const context = await browser.newContext({
    viewport: { width: view.width, height: view.height },
    deviceScaleFactor: view.scale,
    isMobile: view.mobile,
    hasTouch: view.mobile,
  });
  const page = await context.newPage();
  await page.goto(request.url, { waitUntil: "load", timeout: NAVIGATION_TIMEOUT_MS }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => undefined);
  if (request.waitFor) await page.waitForSelector(request.waitFor, { timeout: 10_000 }).catch(() => undefined);
  await page.waitForTimeout(SETTLE_MS);
  return page;
};

const runStep = async (page: Page, step: Step): Promise<void> => {
  switch (step.action) {
    case "click":
      await page.click(step.selector, { timeout: 5_000 });
      return;
    case "hover":
      await page.hover(step.selector, { timeout: 5_000 });
      return;
    case "type":
      await page.fill(step.selector, step.text, { timeout: 5_000 });
      return;
    case "press":
      await page.keyboard.press(step.key);
      return;
    case "scroll":
      await page.mouse.wheel(0, step.y);
      return;
    case "wait":
      await page.waitForTimeout(step.ms);
      return;
  }
};

type Frame = { data: string; at: number };

const ENCODE_SCRIPT = `async ({ width, height }) => {
  const holder = globalThis;
  const list = holder.__frames;
  const types = ["video/mp4;codecs=avc1.42E01E", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  const mimeType = types.find((type) => MediaRecorder.isTypeSupported(type));
  if (!mimeType) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  document.body.append(canvas);
  const draw = canvas.getContext("2d");
  const images = [];
  for (const frame of list) {
    const bytes = Uint8Array.from(atob(frame.data), (c) => c.charCodeAt(0));
    images.push(await createImageBitmap(new Blob([bytes], { type: "image/jpeg" })));
  }
  draw.drawImage(images[0], 0, 0, width, height);
  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
  const chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  const stopped = new Promise((resolve) => {
    recorder.onstop = () => resolve();
  });
  recorder.start(250);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  for (let i = 0; i < images.length; i += 1) {
    draw.drawImage(images[i], 0, 0, width, height);
    const next = list[i + 1];
    const gap = next ? Math.min(2_000, Math.max(16, (next.at - list[i].at) * 1000)) : 1_000;
    await sleep(gap);
  }
  recorder.stop();
  await stopped;
  const blob = new Blob(chunks, { type: mimeType.split(";")[0] });
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buffer.length; i += 0x8000) binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
  return { contentType: mimeType.split(";")[0], data: btoa(binary) };
}`;


const encodeFrames = async (
  browser: Browser,
  frames: Frame[],
  width: number,
  height: number,
): Promise<{ contentType: string; data: string } | null> => {
  if (frames.length === 0) return null;
  const context = await browser.newContext({ viewport: { width: 320, height: 240 } });
  const page = await context.newPage();
  await page.setContent("<!doctype html><title>encode</title>");
  for (let i = 0; i < frames.length; i += 20) {
    await page.evaluate((chunk) => {
      const holder = globalThis as unknown as { __frames?: Frame[] };
      (holder.__frames ??= []).push(...chunk);
    }, frames.slice(i, i + 20));
  }
  const result = (await page.evaluate(
    `(${ENCODE_SCRIPT})(${JSON.stringify({ width, height })})`,
  )) as { contentType: string; data: string } | null;
  await context.close().catch(() => undefined);
  return result;
};

const record = async (
  browser: Browser,
  request: CaptureRequest,
  recording: NonNullable<CaptureRequest["recording"]>,
): Promise<{ contentType: string; data: string; steps: string[] } | null> => {
  const page = await open(browser, request, recording.view);
  const cdp = await page.context().newCDPSession(page);
  const frames: Frame[] = [];
  const failed: string[] = [];
  cdp.on("Page.screencastFrame", (event: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
    frames.push({ data: event.data, at: event.metadata.timestamp ?? Date.now() / 1000 });
    void cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => undefined);
  });
  const width = recording.view.width;
  const height = recording.view.height;
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 75, maxWidth: width, maxHeight: height, everyNthFrame: 1 });
  const started = Date.now();
  await page.waitForTimeout(600);
  for (const [index, step] of recording.steps.entries()) {
    if (Date.now() - started > recording.ms) break;
    await runStep(page, step).catch(() => failed.push(`step ${index + 1} (${step.action})`));
    await page.waitForTimeout(400);
  }
  const left = recording.ms - (Date.now() - started);
  if (left > 0) await page.waitForTimeout(left);
  await cdp.send("Page.stopScreencast").catch(() => undefined);
  const video = await encodeFrames(browser, frames, width, height);
  return video ? { ...video, steps: failed } : null;
};

export async function captureSite(env: BrowserGatewayEnv, body: unknown): Promise<Response> {
  const request = parseRequest(body);
  const browser = await launch(env.BROWSER, { keep_alive: 30_000 }).catch(() => {
    throw new GatewayError("browser_unavailable", 503);
  });
  try {
    const shots: Array<{ name: string; contentType: string; data: string; width: number; title: string }> = [];
    for (const view of request.views) {
      const page = await open(browser, request, view);
      let fullPage = view.fullPage;
      if (fullPage) {
        const height = Number(await page.evaluate("document.documentElement.scrollHeight").catch(() => 0));
        if (height > MAX_FULL_PAGE_HEIGHT) fullPage = false;
      }
      const image = await page.screenshot({ type: "png", fullPage });
      shots.push({
        name: view.name,
        contentType: "image/png",
        data: base64(new Uint8Array(image)),
        width: view.width,
        title: (await page.title().catch(() => "")).slice(0, 200),
      });
      await page.context().close().catch(() => undefined);
    }
    const recording = request.recording ? await record(browser, request, request.recording) : null;
    return Response.json(
      { shots, ...(recording ? { recording } : request.recording ? { recordingError: "The browser couldn't encode a video." } : {}) },
      { headers: { "cache-control": "no-store" } },
    );
  } finally {
    await browser.close().catch(() => undefined);
  }
}
