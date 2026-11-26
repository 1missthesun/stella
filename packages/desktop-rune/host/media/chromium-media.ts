// The media page in its own headless Chromium, for systems whose WebView has no WebRTC (stock
// WebKitGTK). The page is served at a private https origin through request interception, so it is a
// secure context; the microphone is granted to that origin only; its bridge (`__stellaBridge`, as in
// the engine's WebViews) reaches the host through a CDP binding. Chromium runs only while the page
// is mounted and takes its temporary profile with it.

import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ChromiumProcess, resolveChromium, type CdpMessage } from "../electron/chromium";
import type { ToPage } from "./protocol";
import { pageHtml } from "./media-page";

const ORIGIN = "https://stella-media.localhost";
const PAGE_PATH = "/index.html";
const BINDING = "__stellaMediaPost";
const BRIDGE_SCRIPT = `(() => {
  if (window.__stellaBridge) return;
  const post = (data) => window.${BINDING}(JSON.stringify(data));
  window.__stellaBridge = { post, receive(data, origin) { window.dispatchEvent(new MessageEvent("message", { data, origin: origin ?? "stella://host" })); } };
})();`;

const CHROMIUM_ARGS = [
  "--autoplay-policy=no-user-gesture-required",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
  "--disable-extensions",
  "--disable-component-extensions-with-background-pages",
  "--disable-default-apps",
  "--disable-background-networking",
  "--disable-sync",
  "--disable-component-update",
  "--no-pings",
  "--no-service-autorun",
  "--disable-site-isolation-trials",
  "--renderer-process-limit=1",
  "--in-process-gpu",
  "--disable-gpu",
];

export type ChromiumMediaCallbacks = {
  source(): Promise<string>;
  message(data: unknown): void;
  failed(error: string): void;
};

export type ChromiumMediaStats = { pid: number | undefined; launchMs: number | null; pageMs: number | null };

export class ChromiumMediaHost {
  private proc: ChromiumProcess | null = null;
  private sessionId: string | null = null;
  private profileDir: string | null = null;
  private stopped = false;
  private readonly startedAt = performance.now();
  private launchedAt: number | null = null;
  private pageAt: number | null = null;

  constructor(private readonly callbacks: ChromiumMediaCallbacks) {}

  start() {
    void this.launch().catch((error: Error) => {
      if (!this.stopped) this.callbacks.failed(`Chromium media page: ${error?.message ?? String(error)}`);
      this.stop();
    });
  }

  private async launch() {
    const binary = resolveChromium();
    if (!binary) throw new Error("no Chromium or Chrome was found (set STELLA_RUNE_CHROMIUM or install Chrome)");
    this.profileDir = mkdtempSync(path.join(os.tmpdir(), "stella-media-"));
    const profileDir = this.profileDir;
    const proc = new ChromiumProcess(profileDir, binary, () => {
      rmSync(profileDir, { recursive: true, force: true });
      if (!this.stopped) this.callbacks.failed("Chromium media page exited");
    }, CHROMIUM_ARGS);
    this.proc = proc;
    const killOnExit = () => {
      if (!proc.exited) proc.child.kill("SIGKILL");
      rmSync(profileDir, { recursive: true, force: true });
    };
    process.once("exit", killOnExit);
    proc.once("exit", () => process.off("exit", killOnExit));
    await proc.send("Browser.getVersion");
    if (this.stopped) return;
    await proc.send("Browser.grantPermissions", { origin: ORIGIN, permissions: ["audioCapture"] });
    const { targetInfos } = await proc.send<{ targetInfos: { targetId: string; type: string }[] }>("Target.getTargets");
    const targetId = targetInfos.find((t) => t.type === "page")?.targetId
      ?? (await proc.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" })).targetId;
    const { sessionId } = await proc.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
    this.sessionId = sessionId;
    proc.onSession(sessionId, (m) => this.onEvent(m));
    this.launchedAt = performance.now();
    await Promise.all([
      proc.send("Runtime.enable", {}, sessionId),
      proc.send("Page.enable", {}, sessionId),
      proc.send("Inspector.enable", {}, sessionId),
      proc.send("Runtime.addBinding", { name: BINDING }, sessionId),
      proc.send("Page.addScriptToEvaluateOnNewDocument", { source: BRIDGE_SCRIPT }, sessionId),
      proc.send("Fetch.enable", { patterns: [{ urlPattern: `${ORIGIN}/*`, requestStage: "Request" }] }, sessionId),
    ]);
    if (this.stopped) return;
    await proc.send("Page.navigate", { url: `${ORIGIN}${PAGE_PATH}` }, sessionId);
  }

  private onEvent(m: CdpMessage) {
    const params = m.params ?? {};
    switch (m.method) {
      case "Runtime.bindingCalled":
        if (params.name !== BINDING) return;
        if (this.pageAt === null) this.pageAt = performance.now();
        try {
          this.callbacks.message(JSON.parse(String(params.payload)));
        } catch {}
        return;
      case "Fetch.requestPaused":
        return void this.serve(String(params.requestId), String((params.request as { url?: string })?.url ?? ""));
      case "Inspector.targetCrashed":
        if (!this.stopped) this.callbacks.failed("Chromium media page crashed");
        return;
    }
  }

  private async serve(requestId: string, url: string) {
    const proc = this.proc;
    const sessionId = this.sessionId;
    if (!proc || !sessionId) return;
    const fulfill = (status: number, contentType: string, body: string) =>
      proc.send("Fetch.fulfillRequest", {
        requestId,
        responseCode: status,
        responseHeaders: [{ name: "Content-Type", value: contentType }, { name: "Cache-Control", value: "no-store" }],
        body: Buffer.from(body, "utf8").toString("base64"),
      }, sessionId).catch(() => {});
    if (new URL(url).pathname !== PAGE_PATH) return fulfill(404, "text/plain", "Not found");
    try {
      await fulfill(200, "text/html; charset=utf-8", pageHtml(await this.callbacks.source()));
    } catch (error) {
      await fulfill(500, "text/plain", (error as Error).message);
    }
  }

  post(message: ToPage) {
    const proc = this.proc;
    const sessionId = this.sessionId;
    if (!proc || !sessionId || this.stopped) throw new Error("The media page is not running.");
    void proc.send("Runtime.evaluate", { expression: `window.__stellaBridge.receive(${JSON.stringify(message)})` }, sessionId)
      .catch((error: Error) => console.error("[media] post failed:", error.message));
  }

  /** Evaluates `expression` in the page (promises awaited, value by JSON); for checks from a session. */
  async evaluate(expression: string): Promise<unknown> {
    const proc = this.proc;
    const sessionId = this.sessionId;
    if (!proc || !sessionId) throw new Error("The media page is not running.");
    const { result, exceptionDetails } = await proc.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text ?? "evaluation failed");
    return result?.value;
  }

  stats(): ChromiumMediaStats {
    return {
      pid: this.proc?.child.pid,
      launchMs: this.launchedAt === null ? null : this.launchedAt - this.startedAt,
      pageMs: this.pageAt === null ? null : this.pageAt - this.startedAt,
    };
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.proc?.stop();
    this.proc = null;
    this.sessionId = null;
  }
}
