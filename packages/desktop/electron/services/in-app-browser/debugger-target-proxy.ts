import { BrowserWindow, type Rectangle, type WebContentsView } from "electron";
import type {
  InAppBrowserDebuggerEvent,
  InAppBrowserDebuggerRecovery,
  InAppBrowserDebuggerTarget,
  InAppBrowserTabLifecycleEvent,
} from "../in-app-browser-cdp-adapter.js";
import type { InAppBrowserDrawableLease } from "../in-app-browser-service.js";
import { RENDERER_ORIGIN } from "../../source/origin.js";
import agentPageGuard from "browser-script:./agent-page-guard.page.ts";
import {
  MANUAL_OWNER_ID,
  readTabUrl,
  resolveOwnerId,
  type BrowserTabRegistry,
  type ManagedTab,
} from "./tab-registry.js";

type DrawableLease = {
  count: number;
  mountedInHiddenHost: boolean;
  expired: boolean;
  expiryTimer?: ReturnType<typeof setTimeout>;
};

export type FileChooserOpened = {
  tab: ManagedTab;
  sessionId?: string;
  params: Record<string, unknown>;
};

type DebuggerTargetProxyOptions = {
  tabs: BrowserTabRegistry;
  getAttachedView: () => WebContentsView | null;
  getPageBounds: () => Rectangle | undefined;
  attachActiveView: () => void;
  createDrawableHost?: () => BrowserWindow;
  hideDrawableHost: boolean;
  wait?: (delayMs: number) => Promise<void>;
  debuggerRecoveryTimeoutMs?: number;
  onFileChooserOpened?: (request: FileChooserOpened) => void;
};

export const isRendererUrl = (value: string) =>
  value.startsWith(`${RENDERER_ORIGIN}/`);
const DRAWABLE_HOST_BOUNDS: Rectangle = {
  x: -100_000,
  y: -100_000,
  width: 1280,
  height: 720,
};
const DRAWABLE_HOST_FRAME_PUMP_MS = 16;
const DEFAULT_DEBUGGER_RECOVERY_TIMEOUT_MS = 1_000;
// Longest a tab stays in the hidden host under one lease. A command that never
// settles would otherwise keep the tab there, and out of the panel, for good.
const HIDDEN_MOUNT_LIMIT_MS = 30_000;

// Chromium hands debugger events and replies to JS from inside its own call
// stacks, and Node drains microtasks before returning to them. A debugger call
// made from there re-enters Chromium mid-operation: answering a frame's
// Target.detachedFromTarget with Target.detachFromTarget freed the session
// Chromium was still detaching (SIGSEGV in TargetHandler::Session::Detach).
// Every native debugger call therefore starts from a fresh event-loop turn.
const leaveNativeStack = () =>
  new Promise<void>((resolve) => setImmediate(resolve));

const isAgentTab = (tab: ManagedTab) => tab.ownerId !== MANUAL_OWNER_ID;

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;

export class DebuggerTargetProxy {
  private readonly options: DebuggerTargetProxyOptions;
  private readonly drawableLeases = new Map<string, DrawableLease>();
  private readonly debuggerListeners = new Set<
    (event: InAppBrowserDebuggerEvent) => void
  >();
  private readonly lifecycleListeners = new Set<
    (event: InAppBrowserTabLifecycleEvent) => void
  >();
  private drawableHost: BrowserWindow | null = null;
  private readonly screenshotsInFlight = new Map<string, number>();
  private readonly pumpCaptures = new Map<string, Promise<unknown>>();
  private readonly pageGuards = new Map<string, Promise<void>>();
  private readonly guardSessions = new Map<string, Map<string, string>>();
  private readonly explicitAttaches = new Map<string, number>();

  constructor(options: DebuggerTargetProxyOptions) {
    this.options = options;
  }

  listTargets(ownerId?: string): InAppBrowserDebuggerTarget[] {
    const tabIds = this.options.tabs.ownerTabIds(resolveOwnerId(ownerId));
    if (!tabIds) return [];
    return tabIds.flatMap((tabId) => {
      const tab = this.options.tabs.get(tabId);
      if (!tab || tab.view.webContents.isDestroyed()) return [];
      return [{ id: tab.id, url: readTabUrl(tab), title: tab.title }];
    });
  }

  async sendCommand(
    tabId: string,
    method: string,
    params?: Record<string, unknown>,
    ownerId?: string,
    debuggerSessionId?: string,
  ): Promise<unknown> {
    const resolvedOwnerId = resolveOwnerId(ownerId);
    await leaveNativeStack();
    const tab = this.options.tabs.require(tabId, resolvedOwnerId);
    if (
      tab.preview &&
      method === "Page.navigate" &&
      !isRendererUrl(String(params?.url ?? ""))
    ) {
      throw new Error(
        "A Stella preview tab only shows Stella. Open web pages in a new tab.",
      );
    }
    this.attachDebugger(tab);
    await this.guardAgentPage(tab);
    if (isAgentTab(tab) && !debuggerSessionId) {
      // The file chooser guard needs the Page domain enabled on the tab.
      if (method === "Page.disable") return {};
      if (method === "Page.setInterceptFileChooserDialog") {
        params = { ...params, enabled: true };
      }
    }
    if (method !== "Target.attachToTarget") {
      return await this.sendAttachedCommand(
        tab,
        method,
        params,
        debuggerSessionId,
      );
    }
    const attachKey = `${tab.id}:${String(params?.targetId ?? "")}`;
    this.explicitAttaches.set(
      attachKey,
      (this.explicitAttaches.get(attachKey) ?? 0) + 1,
    );
    try {
      return await this.sendAttachedCommand(
        tab,
        method,
        params,
        debuggerSessionId,
      );
    } finally {
      const remaining = (this.explicitAttaches.get(attachKey) ?? 1) - 1;
      if (remaining > 0) this.explicitAttaches.set(attachKey, remaining);
      else this.explicitAttaches.delete(attachKey);
    }
  }

  private async sendAttachedCommand(
    tab: ManagedTab,
    method: string,
    params: Record<string, unknown> | undefined,
    debuggerSessionId: string | undefined,
  ): Promise<unknown> {
    const tabId = tab.id;
    const tabDebugger = tab.view.webContents.debugger;
    // An offscreen tab always has its viewport and its own frames.
    if (tab.offscreen) {
      return await tabDebugger.sendCommand(method, params, debuggerSessionId);
    }
    // Electron gives an unattached WebContentsView a 0x0 layout viewport. CDP
    // Runtime queries and Input commands need the same drawable mount as
    // screenshots; otherwise discovery succeeds but actionability/scrolling
    // fails against viewport=0x0. The hidden host never replaces the visible
    // manual view, and the scoped lease restores the prior mount after every
    // command (including failures).
    const lease = this.acquireDrawableHost(tabId, tab.ownerId);
    // A screenshot renders its own frame, and one overlapping a frame-pump
    // capture (full-page ones above all) can leave the page drawing only a
    // band of itself after it returns to the panel.
    const isScreenshot = method === "Page.captureScreenshot";
    if (isScreenshot) {
      this.screenshotsInFlight.set(
        tabId,
        (this.screenshotsInFlight.get(tabId) ?? 0) + 1,
      );
    }
    try {
      await this.settleDrawableHost(tabId);
      const pumpCapture = isScreenshot && this.pumpCaptures.get(tabId);
      if (pumpCapture) await Promise.race([pumpCapture, this.delay(250)]);
      const command = Promise.resolve(
        tabDebugger.sendCommand(method, params, debuggerSessionId),
      );
      if (
        !isScreenshot &&
        this.options.hideDrawableHost &&
        this.drawableLeases.get(tabId)?.mountedInHiddenHost
      ) {
        this.pumpFramesUntilSettled(tab, command);
      }
      return await command;
    } finally {
      if (isScreenshot) {
        const remaining = (this.screenshotsInFlight.get(tabId) ?? 1) - 1;
        if (remaining > 0) this.screenshotsInFlight.set(tabId, remaining);
        else this.screenshotsInFlight.delete(tabId);
      }
      lease.release();
    }
  }

  async recoverTarget(
    tabId: string,
    ownerId?: string,
    debuggerSessionId?: string,
  ): Promise<InAppBrowserDebuggerRecovery> {
    const resolvedOwnerId = resolveOwnerId(ownerId);
    await leaveNativeStack();
    const tab = this.options.tabs.require(tabId, resolvedOwnerId);
    const contents = tab.view.webContents;
    const tabDebugger = contents.debugger;
    const timeoutMs =
      this.options.debuggerRecoveryTimeoutMs ??
      DEFAULT_DEBUGGER_RECOVERY_TIMEOUT_MS;
    let timer: NodeJS.Timeout | undefined;
    let terminated = false;

    try {
      this.attachDebugger(tab);
      void this.guardAgentPage(tab);
      terminated = await Promise.race([
        Promise.resolve(
          tabDebugger.sendCommand(
            "Runtime.terminateExecution",
            {},
            debuggerSessionId,
          ),
        ).then(
          () => true,
          () => false,
        ),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), timeoutMs);
          timer.unref?.();
        }),
      ]);
    } catch {
      terminated = false;
    } finally {
      clearTimeout(timer);
    }

    if (terminated) return "terminated";
    if (contents.isDestroyed()) {
      throw new Error("Browser tab was destroyed during page recovery.");
    }
    contents.reload();
    return "reloaded";
  }

  acquireDrawableHost(
    tabId: string,
    ownerId?: string,
  ): InAppBrowserDrawableLease {
    const tab = this.options.tabs.require(tabId, resolveOwnerId(ownerId));
    if (tab.offscreen) return { release: () => {} };
    const attachedView = this.options.getAttachedView();
    let lease = this.drawableLeases.get(tabId);
    if (lease) {
      lease.count += 1;
      if (
        attachedView !== tab.view &&
        !lease.expired &&
        (!lease.mountedInHiddenHost || this.drawableHost?.isDestroyed())
      ) {
        lease.mountedInHiddenHost = false;
        this.mountLeaseInHiddenHost(tab, lease);
      }
    } else {
      lease = { count: 1, mountedInHiddenHost: false, expired: false };
      this.drawableLeases.set(tabId, lease);
      if (attachedView !== tab.view) this.mountLeaseInHiddenHost(tab, lease);
    }
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.releaseDrawableHost(tabId);
      },
    };
  }

  subscribe(listener: (event: InAppBrowserDebuggerEvent) => void): () => void {
    this.debuggerListeners.add(listener);
    return () => this.debuggerListeners.delete(listener);
  }

  subscribeTabLifecycle(
    listener: (event: InAppBrowserTabLifecycleEvent) => void,
  ): () => void {
    this.lifecycleListeners.add(listener);
    return () => this.lifecycleListeners.delete(listener);
  }

  forwardEvents(tab: ManagedTab) {
    const contents = tab.view.webContents;
    const emit = (kind: InAppBrowserTabLifecycleEvent["kind"]) => {
      for (const listener of this.lifecycleListeners) {
        listener({ tabId: tab.id, ownerId: tab.ownerId, kind });
      }
    };
    contents.debugger.on("detach", () => {
      this.forgetPageGuard(tab.id);
      emit("debugger-detached");
    });
    contents.on("did-start-navigation", (details) => {
      if (details.isMainFrame && !details.isSameDocument) emit("navigating");
    });
    contents.once("destroyed", () => emit("gone"));
    contents.debugger.on(
      "message",
      (_event, method, params, sessionId) => {
        if (
          this.consumeGuardEvent(tab, method, record(params), sessionId || undefined)
        ) {
          return;
        }
        const debuggerEvent: InAppBrowserDebuggerEvent = {
          tabId: tab.id,
          method,
          ...(sessionId ? { sessionId } : {}),
          ...(params && typeof params === "object"
            ? { params: params as Record<string, unknown> }
            : {}),
        };
        for (const listener of this.debuggerListeners) listener(debuggerEvent);
      },
    );
  }

  /**
   * Sends an agent tab's guard before its first navigation. Page commands to a
   * tab that has no renderer yet are answered only once it loads, so this
   * resolves when they are sent, not answered.
   */
  async prepareTab(tab: ManagedTab) {
    await leaveNativeStack();
    if (tab.view.webContents.isDestroyed()) return;
    this.attachDebugger(tab);
    void this.guardAgentPage(tab);
  }

  emitEvent(event: InAppBrowserDebuggerEvent) {
    for (const listener of this.debuggerListeners) listener(event);
  }

  private attachDebugger(tab: ManagedTab) {
    const tabDebugger = tab.view.webContents.debugger;
    if (tabDebugger.isAttached()) return;
    tabDebugger.attach();
    this.forgetPageGuard(tab.id);
  }

  private forgetPageGuard(tabId: string) {
    this.pageGuards.delete(tabId);
    this.guardSessions.delete(tabId);
  }

  /**
   * Native dialogs from an agent tab would be parented to a window that is
   * never shown (fatal on Wayland, invisible elsewhere). File choosers are
   * intercepted and cancelled, and every frame, including cross-origin
   * iframes, gets the page guard. Frames attached for this are internal and
   * never reach agent clients.
   */
  private async guardAgentPage(tab: ManagedTab) {
    if (!isAgentTab(tab)) return;
    let guard = this.pageGuards.get(tab.id);
    if (!guard) {
      const created: Promise<void> = this.guardSession(tab).catch(() => {
        if (this.pageGuards.get(tab.id) === created) {
          this.pageGuards.delete(tab.id);
        }
      });
      guard = created;
      this.pageGuards.set(tab.id, guard);
    }
    await guard;
  }

  private async guardSession(tab: ManagedTab, sessionId?: string) {
    const tabDebugger = tab.view.webContents.debugger;
    await Promise.all([
      tabDebugger.sendCommand("Page.enable", {}, sessionId),
      tabDebugger.sendCommand(
        "Page.setInterceptFileChooserDialog",
        { enabled: true, cancel: true },
        sessionId,
      ),
      tabDebugger.sendCommand(
        "Page.addScriptToEvaluateOnNewDocument",
        { source: agentPageGuard, runImmediately: true },
        sessionId,
      ),
      tabDebugger.sendCommand(
        "Target.setAutoAttach",
        {
          autoAttach: true,
          waitForDebuggerOnStart: true,
          flatten: true,
          filter: [{ type: "iframe" }],
        },
        sessionId,
      ),
    ]);
  }

  private async guardFrameSession(
    tab: ManagedTab,
    sessionId: string,
    waitingForDebugger: boolean,
  ) {
    await leaveNativeStack();
    const contents = tab.view.webContents;
    if (contents.isDestroyed() || !contents.debugger.isAttached()) return;
    try {
      await this.guardSession(tab, sessionId);
    } catch {
      // A frame that went away while being guarded has nothing left to open.
    } finally {
      if (waitingForDebugger && !contents.isDestroyed()) {
        try {
          await contents.debugger.sendCommand(
            "Runtime.runIfWaitingForDebugger",
            {},
            sessionId,
          );
        } catch {
          // Detached frames don't wait.
        }
      }
    }
  }

  private consumeGuardEvent(
    tab: ManagedTab,
    method: string,
    params: Record<string, unknown> | undefined,
    sessionId: string | undefined,
  ): boolean {
    if (!isAgentTab(tab)) return false;
    let sessions = this.guardSessions.get(tab.id);
    const onGuardedSession =
      sessionId === undefined || sessions?.has(sessionId) === true;
    if (method === "Target.attachedToTarget" && onGuardedSession) {
      const childSessionId = params?.sessionId;
      const targetInfo = record(params?.targetInfo);
      const explicit = this.explicitAttaches.has(
        `${tab.id}:${String(targetInfo?.targetId ?? "")}`,
      );
      if (
        !explicit &&
        typeof childSessionId === "string" &&
        targetInfo?.type === "iframe"
      ) {
        if (!sessions) {
          sessions = new Map();
          this.guardSessions.set(tab.id, sessions);
        }
        sessions.set(childSessionId, String(targetInfo.targetId ?? ""));
        void this.guardFrameSession(
          tab,
          childSessionId,
          params?.waitingForDebugger === true,
        );
        return true;
      }
    }
    if (method === "Target.detachedFromTarget") {
      const detached = params?.sessionId;
      if (typeof detached === "string" && sessions?.delete(detached)) {
        return true;
      }
    }
    if (method === "Target.targetInfoChanged" && sessions) {
      const targetId = record(params?.targetInfo)?.targetId;
      for (const guarded of sessions.values()) {
        if (guarded === targetId) return true;
      }
    }
    if (method === "Page.fileChooserOpened" && onGuardedSession && params) {
      this.options.onFileChooserOpened?.({
        tab,
        ...(sessionId ? { sessionId } : {}),
        params,
      });
    }
    return sessionId !== undefined && sessions?.has(sessionId) === true;
  }

  isMountedInHiddenHost(tabId: string) {
    return this.drawableLeases.get(tabId)?.mountedInHiddenHost === true;
  }

  remountLeased(tab: ManagedTab) {
    const lease = this.drawableLeases.get(tab.id);
    if (lease && lease.count > 0 && !lease.expired) {
      this.mountLeaseInHiddenHost(tab, lease);
    }
  }

  takeBackForPanel(tab: ManagedTab) {
    this.unmountDrawableLease(tab);
  }

  resizeHiddenMounts() {
    for (const [tabId, lease] of this.drawableLeases) {
      if (!lease.mountedInHiddenHost) continue;
      this.options.tabs.get(tabId)?.view.setBounds(this.drawableBounds());
    }
  }

  releaseTab(tab: ManagedTab) {
    this.unmountDrawableLease(tab);
    this.forgetTab(tab.id);
  }

  forgetTab(tabId: string) {
    this.forgetPageGuard(tabId);
    const lease = this.drawableLeases.get(tabId);
    if (lease) clearTimeout(lease.expiryTimer);
    this.drawableLeases.delete(tabId);
  }

  dispose() {
    for (const lease of this.drawableLeases.values()) {
      clearTimeout(lease.expiryTimer);
    }
    this.drawableLeases.clear();
    const drawableHost = this.drawableHost;
    this.drawableHost = null;
    if (drawableHost && !drawableHost.isDestroyed()) drawableHost.destroy();
    this.debuggerListeners.clear();
    this.lifecycleListeners.clear();
  }

  private ensureDrawableHost() {
    if (this.drawableHost && !this.drawableHost.isDestroyed()) {
      return this.drawableHost;
    }
    const host =
      this.options.createDrawableHost?.() ??
      new BrowserWindow({
        ...DRAWABLE_HOST_BOUNDS,
        show: false,
        frame: false,
        focusable: false,
        opacity: 0,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });
    host.setBounds(DRAWABLE_HOST_BOUNDS, false);
    host.setFocusable(false);
    host.setOpacity(0);
    host.setSkipTaskbar(true);
    host.once("closed", () => {
      if (this.drawableHost !== host) return;
      this.drawableHost = null;
      for (const lease of this.drawableLeases.values()) {
        lease.mountedInHiddenHost = false;
      }
    });
    // Linux never maps the host: Wayland compositors ignore client positions,
    // setOpacity is a no-op there and focusable:false isn't honored, so a shown
    // host is an empty floating window that takes focus (X11 WMs may clamp it
    // on screen too). Unmapped, the mounted tab still gets a real viewport and
    // script, DOM, clicks and keys work, but its compositor never ticks, so
    // whatever waits on the next frame (mouseMoved and mouseWheel acks, every
    // other Page.captureScreenshot, rAF) stalls. `pumpFramesUntilSettled`
    // forces frames while a command is pending. The cost is ~16-30 ms of
    // latency on those commands and a page that reads
    // `visibilityState: "hidden"` during agent commands instead of "visible".
    // Even pumped, surface screenshots (all of stella-browser's) still stall,
    // so agent tabs on Linux render offscreen instead and never come here
    // (offscreen-tabs.ts); this path is left for tabs that aren't offscreen.
    if (!this.options.hideDrawableHost) host.showInactive();
    this.drawableHost = host;
    return host;
  }

  private delay(delayMs: number) {
    return (
      this.options.wait?.(delayMs) ??
      new Promise<void>((resolve) => setTimeout(resolve, delayMs))
    );
  }

  /**
   * Forces frames for a tab mounted in the unmapped host until `command`
   * settles. Page.captureScreenshot renders a frame even for a hidden widget,
   * which delivers acks (and rAF callbacks) that were waiting on one.
   */
  private pumpFramesUntilSettled(tab: ManagedTab, command: Promise<unknown>) {
    let settled = false;
    command.then(
      () => (settled = true),
      () => (settled = true),
    );
    const tabDebugger = tab.view.webContents.debugger;
    void (async () => {
      await this.delay(DRAWABLE_HOST_FRAME_PUMP_MS);
      while (
        !settled &&
        !tab.view.webContents.isDestroyed() &&
        tabDebugger.isAttached() &&
        this.drawableLeases.get(tab.id)?.mountedInHiddenHost
      ) {
        if (!this.screenshotsInFlight.has(tab.id)) {
          const capture = Promise.resolve(
            tabDebugger.sendCommand("Page.captureScreenshot", {
              format: "jpeg",
              quality: 1,
              optimizeForSpeed: true,
            }),
          ).catch(() => {});
          this.pumpCaptures.set(tab.id, capture);
          void capture.finally(() => {
            if (this.pumpCaptures.get(tab.id) === capture) {
              this.pumpCaptures.delete(tab.id);
            }
          });
          await Promise.race([capture, this.delay(250)]);
        }
        if (!settled) await this.delay(DRAWABLE_HOST_FRAME_PUMP_MS);
      }
    })();
  }

  private drawableBounds(): Rectangle {
    const requested = this.options.getPageBounds();
    return {
      x: 0,
      y: 0,
      width: Math.max(1, requested?.width ?? DRAWABLE_HOST_BOUNDS.width),
      height: Math.max(1, requested?.height ?? DRAWABLE_HOST_BOUNDS.height),
    };
  }

  private mountLeaseInHiddenHost(tab: ManagedTab, lease: DrawableLease) {
    if (
      lease.mountedInHiddenHost ||
      lease.expired ||
      tab.view.webContents.isDestroyed()
    ) {
      return;
    }
    const host = this.ensureDrawableHost();
    host.contentView.addChildView(tab.view);
    tab.view.setBounds(this.drawableBounds());
    lease.mountedInHiddenHost = true;
    if (!lease.expiryTimer) {
      lease.expiryTimer = setTimeout(
        () => this.expireHiddenMount(tab.id, lease),
        HIDDEN_MOUNT_LIMIT_MS,
      );
      lease.expiryTimer.unref?.();
    }
  }

  private expireHiddenMount(tabId: string, lease: DrawableLease) {
    lease.expiryTimer = undefined;
    if (this.drawableLeases.get(tabId) !== lease) return;
    lease.expired = true;
    const tab = this.options.tabs.get(tabId);
    if (tab) this.unmountDrawableLease(tab);
    this.options.attachActiveView();
  }

  private unmountDrawableLease(tab: ManagedTab) {
    const lease = this.drawableLeases.get(tab.id);
    const host = this.drawableHost;
    if (!lease?.mountedInHiddenHost || !host || host.isDestroyed()) return;
    lease.mountedInHiddenHost = false;
    try {
      host.contentView.removeChildView(tab.view);
    } catch {
      // Host teardown can race tab cleanup.
    }
  }

  private releaseDrawableHost(tabId: string) {
    const lease = this.drawableLeases.get(tabId);
    if (!lease) return;
    lease.count -= 1;
    if (lease.count > 0) return;
    const tab = this.options.tabs.get(tabId);
    if (tab) this.unmountDrawableLease(tab);
    clearTimeout(lease.expiryTimer);
    this.drawableLeases.delete(tabId);
    this.options.attachActiveView();
  }

  private async settleDrawableHost(tabId: string) {
    const wait = (delayMs: number) => this.delay(delayMs);
    await wait(16);
    const tab = this.options.tabs.get(tabId);
    const lease = this.drawableLeases.get(tabId);
    if (!tab || !lease || this.options.getAttachedView() === tab.view) return;
    if (lease.expired) return;
    if (!lease.mountedInHiddenHost || this.drawableHost?.isDestroyed()) {
      lease.mountedInHiddenHost = false;
      this.mountLeaseInHiddenHost(tab, lease);
      await wait(16);
    }
  }
}
