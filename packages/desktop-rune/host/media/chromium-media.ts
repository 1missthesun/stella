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
  "--disable-gpu",
];

/** Binaries that could not start sandboxed in this host process. */
const UNSANDBOXED = new Set<string>();
const NO_USABLE_SANDBOX = /No usable sandbox|apparmor-userns-restrictions|SUID sandbox|try using --no-sandbox/;

export type ChromiumMediaCallbacks = {
  source(): Promise<string>;
  message(data: unknown): void;
  failed(error: string): void;
};

export type ChromiumMediaStats = { pid: number | undefined; stage: string; launchMs: number | null; pageMs: number | null };

export class ChromiumMediaHost {
  private proc: ChromiumProcess | null = null;
  private sessionId: string | null = null;
  private profileDir: string | null = null;
  private stopped = false;
  private readonly startedAt = performance.now();
  private launchedAt: number | null = null;
  private pageAt: number | null = null;
  private stage = "starting";
  private launching = false;
  private lastStderr = "";

  constructor(private readonly callbacks: ChromiumMediaCallbacks) {}

  start() {
    void this.run();
  }

  /**
   * Chromium refuses to start where the kernel blocks its sandbox (Ubuntu 23.10+ AppArmor without a
   * profile for that binary); the page then runs unsandboxed, as Playwright's Chromium does.
   */
  private async run() {
    const binary = resolveChromium();
    try {
      await this.launch(binary && UNSANDBOXED.has(binary) ? ["--no-sandbox"] : []);
    } catch (error) {
      if (this.stopped) return;
      if (!binary || UNSANDBOXED.has(binary) || !NO_USABLE_SANDBOX.test(this.lastStderr)) return this.fail(error as Error);
      console.error("[media] Chromium has no usable sandbox here; starting it with --no-sandbox");
      UNSANDBOXED.add(binary);
      try {
        await this.launch(["--no-sandbox"]);
      } catch (retryError) {
        if (!this.stopped) this.fail(retryError as Error);
      }
    }
  }

  private fail(error: Error) {
    this.callbacks.failed(`Chromium media page: ${error?.message ?? String(error)}`);
    this.stop();
  }

  private async launch(extraArgs: string[]) {
    this.stage = "starting";
    this.launching = true;
    const binary = resolveChromium();
    if (!binary) throw new Error("no Chromium or Chrome was found (set STELLA_RUNE_CHROMIUM or install Chrome)");
    this.profileDir = mkdtempSync(path.join(os.tmpdir(), "stella-media-"));
    const profileDir = this.profileDir;
    const proc = new ChromiumProcess(profileDir, binary, (exit) => {
      rmSync(profileDir, { recursive: true, force: true });
      if (this.stopped) return;
      this.lastStderr = proc.stderrTail();
      console.error(`[media] chromium (${binary}) exited ${exit} at stage ${this.stage}; stderr:\n${this.lastStderr}`);
      if (!this.launching) this.callbacks.failed(`Chromium media page exited (${exit})`);
    }, [...CHROMIUM_ARGS, ...extraArgs]);
    this.proc = proc;
    const killOnExit = () => {
      if (!proc.exited) proc.child.kill("SIGKILL");
      rmSync(profileDir, { recursive: true, force: true });
    };
    process.once("exit", killOnExit);
    proc.once("exit", () => process.off("exit", killOnExit));
    this.stage = "connecting";
    await proc.send("Browser.getVersion");
    if (this.stopped) return;
    await proc.send("Browser.grantPermissions", { origin: ORIGIN, permissions: ["audioCapture"] });
    this.stage = "attaching";
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
    this.stage = "navigating";
    await proc.send("Page.navigate", { url: `${ORIGIN}${PAGE_PATH}` }, sessionId);
    this.launching = false;
  }

  private onEvent(m: CdpMessage) {
    const params = m.params ?? {};
    switch (m.method) {
      case "Runtime.bindingCalled":
        if (params.name !== BINDING) return;
        if (this.pageAt === null) {
          this.pageAt = performance.now();
          this.stage = "running";
        }
        try {
          this.callbacks.message(JSON.parse(String(params.payload)));
        } catch {}
        return;
      case "Runtime.exceptionThrown":
        console.error("[media] chromium page exception:", (params.exceptionDetails as { exception?: { description?: string }; text?: string })?.exception?.description ?? (params.exceptionDetails as { text?: string })?.text);
        return;
      case "Runtime.consoleAPICalled":
        if (params.type === "error" || params.type === "warning") console.error(`[media] chromium page ${params.type}:`, ((params.args as { value?: unknown; description?: string }[]) ?? []).map((a) => a.value ?? a.description).join(" "));
        return;
      case "Fetch.requestPaused":
        if (this.stage === "navigating") this.stage = "loading";
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
      stage: this.stage,
      launchMs: this.launchedAt === null ? null : this.launchedAt - this.startedAt,
      pageMs: this.pageAt === null ? null : this.pageAt - this.startedAt,
    };
  }

  /** The end of Chromium's stderr while it runs. */
  stderrTail() {
    return this.proc?.stderrTail() ?? "";
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.proc?.stop();
    this.proc = null;
    this.sessionId = null;
  }
}
