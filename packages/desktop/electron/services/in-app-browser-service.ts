import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  session,
  View,
  WebContentsView,
  type Rectangle,
  type Session,
} from "electron";
import {
  buildInAppBrowserUserAgent,
  isAuthOrigin,
  isAuthPermission,
  isAuthPopupUrl,
  shouldAllowAuthDevice,
} from "./in-app-browser-auth-policy.js";
import type {
  InAppBrowserDebuggerEvent,
  InAppBrowserTabLifecycleEvent,
  InAppBrowserDebuggerRecovery,
  InAppBrowserDebuggerTarget,
} from "./in-app-browser-cdp-adapter.js";
import type { StellaBrowserBridgeStatus } from "../process-resources/browser-bridge-resource.js";
import type {
  BrowserViewConnection,
  BrowserViewLayout,
  BrowserViewState,
  BrowserViewUnavailableReason,
} from "@stella/contracts/desktop/browser-view";
import { BROWSER_BRIDGE_MISSING_ERROR } from "../utils/register-stella-native-messaging-host.js";
import { STELLA_BROWSER_EXTENSION_STORE_URL } from "@stella/runtime/kernel/tools/stella-browser-bridge-config";
import { trimInAppBrowserStorage } from "./in-app-browser/storage-hygiene.js";
import { keepSessionCookies } from "./in-app-browser/session-cookie-keeper.js";
import {
  DebuggerTargetProxy,
  isRendererUrl,
  type FileChooserOpened,
} from "./in-app-browser/debugger-target-proxy.js";
import { InAppBrowserDownloads } from "./in-app-browser/downloads.js";
import {
  BrowserTabRegistry,
  DEFAULT_URL,
  MANUAL_OWNER_ID,
  resolveOwnerId,
  type ManagedTab,
} from "./in-app-browser/tab-registry.js";
import { OffscreenTabs } from "./in-app-browser/offscreen-tabs.js";

export type InAppBrowserPreview = {
  view: WebContentsView;
  url: string;
  dispose: () => void;
};

export type InAppBrowserDrawableLease = {
  release: () => void;
};

type InAppBrowserServiceOptions = {
  stellaDataDir: string;
  getWindow: () => BrowserWindow | null;
  ensureBrowserBridgeStarted: () => void | Promise<void>;
  openExtensionStore?: () => void | Promise<void>;
  getBrowserSetupStatus?: () => {
    bridgeBinaryInstalled: boolean;
    extensionInstalled: boolean;
  };
  getBrowserBridgeStatus?: () => StellaBrowserBridgeStatus | undefined;
  getBrowserBridgeNamespace?: () =>
    | { mode: "shared" | "isolated"; ownsExtensionChannel: boolean }
    | undefined;
  getExtensionStatus: () => Promise<boolean>;
  reconnectExtension?: () => Promise<void>;
  onStateChanged?: (state: BrowserViewState) => void;
  connectionTimeoutMs?: number;
  connectionPollMs?: number;
  automaticConnectionTimeoutMs?: number;
  demandConnectionTimeoutMs?: number;
  profilePath?: string;
  sessionFromPath?: typeof session.fromPath;
  createView?: (browserSession: Session) => WebContentsView;
  createDrawableHost?: () => BrowserWindow;
  hideDrawableHost?: boolean;
  createId?: () => string;
  wait?: (delayMs: number) => Promise<void>;
  debuggerRecoveryTimeoutMs?: number;
  runtimeUserAgent?: string;
  openPreview?: (
    name: string,
    options: { offscreen?: { deviceScaleFactor: number } },
  ) => Promise<InAppBrowserPreview>;
  /**
   * Preload of the panel mirror for offscreen agent tabs. Agent tabs render
   * offscreen on Linux when it is set (see in-app-browser/offscreen-tabs.ts).
   */
  offscreenMirrorPreloadPath?: string;
  offscreenAgentTabs?: boolean;
};

const PREVIEW_URL_PREFIX = "stella-preview://";
const AGENT_ACTIVITY_IDLE_MS = 2_500;
const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;
const DEFAULT_CONNECTION_POLL_MS = 250;
// Extension wake (MV3 service worker) plus native-host/daemon spawn can take
// several seconds on a cold start, so the first automatic connect gets a
// forgiving window.
const DEFAULT_AUTOMATIC_CONNECTION_TIMEOUT_MS = 5_000;
const DEFAULT_DEMAND_CONNECTION_TIMEOUT_MS = 30_000;
const DEMAND_ATTEMPT_WINDOWS_MS = [2_000, 5_000, 10_000] as const;
const DEMAND_RETRY_BACKOFF_MS = [250, 1_000, 2_000] as const;
const MAX_FAVICON_BYTES = 256 * 1024;

const cloneState = (state: BrowserViewState): BrowserViewState => ({
  ...state,
  owners: state.owners.map((owner) => ({ ...owner })),
  tabs: state.tabs.map((tab) => ({ ...tab })),
});

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const normalizeWebUrl = (input: string | undefined) => {
  const raw = input?.trim() || DEFAULT_URL;
  if (raw === DEFAULT_URL) return raw;
  const withProtocol = /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new Error("Enter a valid web address.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http, https, and about:blank URLs are allowed.");
  }
  return parsed.toString();
};

const isAllowedNavigationUrl = (value: string) => {
  if (value === DEFAULT_URL) return true;
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

const normalizeBounds = (bounds: Rectangle): Rectangle => ({
  x: Math.round(Number.isFinite(bounds.x) ? bounds.x : 0),
  y: Math.round(Number.isFinite(bounds.y) ? bounds.y : 0),
  width: Math.max(
    0,
    Math.round(Number.isFinite(bounds.width) ? bounds.width : 0),
  ),
  height: Math.max(
    0,
    Math.round(Number.isFinite(bounds.height) ? bounds.height : 0),
  ),
});

const clampBoundsToWindow = (
  bounds: Rectangle,
  window: BrowserWindow,
): Rectangle => {
  const normalized = normalizeBounds(bounds);
  const [windowWidth, windowHeight] = window.getContentSize();
  const x = Math.min(Math.max(normalized.x, 0), windowWidth);
  const y = Math.min(Math.max(normalized.y, 0), windowHeight);
  return {
    x,
    y,
    width: Math.max(0, Math.min(normalized.width, windowWidth - x)),
    height: Math.max(0, Math.min(normalized.height, windowHeight - y)),
  };
};

type ConnectionAttemptOptions = {
  timeoutMs?: number;
  recover?: boolean;
};

export class InAppBrowserService {
  private readonly options: InAppBrowserServiceOptions;
  private readonly tabs = new BrowserTabRegistry();
  private readonly debuggerProxy: DebuggerTargetProxy;
  private readonly offscreenTabs: OffscreenTabs | null;
  private readonly downloads: InAppBrowserDownloads;
  private readonly errorsByOwner = new Map<string, string>();
  private readonly profilePath: string;

  private state: BrowserViewState = {
    connection: "checking",
    visibleOwnerId: MANUAL_OWNER_ID,
    owners: [
      {
        id: MANUAL_OWNER_ID,
        kind: "manual",
        tabCount: 0,
        latest: false,
      },
    ],
    tabs: [],
  };
  private browserSession: Session | null = null;
  private releaseSessionCookies: (() => void) | null = null;
  private initializePromise: Promise<void> | null = null;
  private connectPromise: Promise<BrowserViewState> | null = null;
  private visible = false;
  private layout: BrowserViewLayout | null = null;
  private attachedView: WebContentsView | null = null;
  private attachedWindow: BrowserWindow | null = null;
  private visibilityNudge: View | null = null;
  private disposed = false;
  private connectionError: string | undefined;
  private connectionUnavailableReason: BrowserViewUnavailableReason | undefined;
  private browserUserAgent = buildInAppBrowserUserAgent(undefined);

  constructor(options: InAppBrowserServiceOptions) {
    this.options = options;
    this.profilePath =
      options.profilePath ??
      path.join(options.stellaDataDir, "browser", "profile-v1");
    this.debuggerProxy = new DebuggerTargetProxy({
      tabs: this.tabs,
      getAttachedView: () => this.attachedView,
      getPageBounds: () => this.layout?.pageBounds,
      attachActiveView: () => this.attachActiveView(),
      createDrawableHost: options.createDrawableHost,
      hideDrawableHost:
        options.hideDrawableHost ?? process.platform === "linux",
      wait: options.wait,
      debuggerRecoveryTimeoutMs: options.debuggerRecoveryTimeoutMs,
      onFileChooserOpened: (request) => this.openFileChooserForUser(request),
    });
    this.downloads = new InAppBrowserDownloads({
      stellaDataDir: options.stellaDataDir,
      getUserDownloadsDir: () => {
        try {
          return app.getPath("downloads");
        } catch {
          return path.join(os.homedir(), "Downloads");
        }
      },
      findTab: (contents) =>
        this.tabs.all().find((tab) => tab.view.webContents === contents),
      emit: (event) => this.debuggerProxy.emitEvent(event),
    });
    const mirrorPreloadPath = options.offscreenMirrorPreloadPath;
    this.offscreenTabs =
      mirrorPreloadPath &&
      (options.offscreenAgentTabs ?? process.platform === "linux")
        ? new OffscreenTabs({
            mirrorPreloadPath,
            getPageBounds: () => this.layout?.pageBounds,
          })
        : null;
  }

  /** Agent tabs render offscreen where a hidden tab can't get frames. */
  private rendersOffscreen(ownerId: string) {
    return this.offscreenTabs !== null && ownerId !== MANUAL_OWNER_ID;
  }

  async getState(ownerId?: string): Promise<BrowserViewState> {
    const resolvedOwnerId =
      ownerId === undefined ? undefined : resolveOwnerId(ownerId);
    if (this.disposed) return this.snapshot(resolvedOwnerId);
    const setupRequirement = this.readSetupRequirement();
    if (setupRequirement) {
      this.updateUnavailableConnection(setupRequirement);
      return this.snapshot(resolvedOwnerId);
    }
    try {
      if (await this.options.getExtensionStatus()) {
        this.updateConnection("connected");
      } else {
        this.updateUnavailableConnection(
          this.readConnectionFailure("extension_disconnected"),
        );
      }
    } catch {
      this.updateUnavailableConnection(
        this.readConnectionFailure("transient_failure"),
      );
    }
    return this.snapshot(resolvedOwnerId);
  }

  async requestExtensionConnect(): Promise<BrowserViewState> {
    if (this.disposed) throw new Error("The in-app browser has been closed.");
    const setupRequirement = this.readSetupRequirement({ extension: false });
    if (setupRequirement) {
      this.updateUnavailableConnection(setupRequirement);
      return this.snapshot();
    }
    this.updateConnection("checking");
    try {
      await this.options.ensureBrowserBridgeStarted();
      let connected = false;
      try {
        connected = await this.options.getExtensionStatus();
      } catch {
        // Daemon startup races the first status probe; poll below.
      }
      if (connected) {
        this.updateConnection("connected");
        return this.snapshot();
      }
      await this.options.openExtensionStore?.();
      const timeoutMs =
        this.options.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS;
      const pollMs =
        this.options.connectionPollMs ?? DEFAULT_CONNECTION_POLL_MS;
      if (await this.pollExtensionStatus(timeoutMs, pollMs)) {
        this.updateConnection("connected");
        return this.snapshot();
      }
      this.updateUnavailableConnection(
        this.readConnectionFailure("extension_not_installed"),
      );
    } catch (error) {
      this.updateUnavailableConnection(
        this.readConnectionFailure("transient_failure", errorMessage(error)),
      );
    }
    return this.snapshot();
  }

  async reconnectExtension(): Promise<BrowserViewState> {
    if (this.disposed) throw new Error("The in-app browser has been closed.");
    const setupRequirement = this.readSetupRequirement();
    if (setupRequirement) {
      this.updateUnavailableConnection(setupRequirement);
      return this.snapshot();
    }
    this.updateConnection("checking");
    await this.connectPromise?.catch(() => undefined);
    try {
      await this.options.reconnectExtension?.();
    } catch {
      // The attempts below report whatever state the bridge is left in.
    }
    await this.ensureConnectionOnDemand();
    return this.snapshot();
  }

  connect(attempt: ConnectionAttemptOptions = {}): Promise<BrowserViewState> {
    if (this.connectPromise) return this.connectPromise;
    const promise = this.connectInternal(attempt).finally(() => {
      if (this.connectPromise === promise) this.connectPromise = null;
    });
    this.connectPromise = promise;
    return promise;
  }

  private async connectInternal(
    attempt: ConnectionAttemptOptions = {},
  ): Promise<BrowserViewState> {
    if (this.state.connection === "connected" && !attempt.recover) {
      return await this.getState();
    }
    await this.runConnectionAttempt({
      timeoutMs:
        attempt.timeoutMs ??
        this.options.automaticConnectionTimeoutMs ??
        DEFAULT_AUTOMATIC_CONNECTION_TIMEOUT_MS,
    });
    return this.snapshot();
  }

  private async runConnectionAttempt(attempt: {
    timeoutMs: number;
  }): Promise<boolean> {
    const setupRequirement = this.readSetupRequirement();
    if (setupRequirement) {
      this.updateUnavailableConnection(setupRequirement);
      return false;
    }
    try {
      await this.options.ensureBrowserBridgeStarted();
      const connected = await this.pollExtensionStatus(
        attempt.timeoutMs,
        this.options.connectionPollMs ?? DEFAULT_CONNECTION_POLL_MS,
      );
      if (!connected) {
        this.updateUnavailableConnection(
          this.readConnectionFailure("extension_disconnected"),
        );
        return false;
      }
      this.updateConnection("connected");
      return true;
    } catch (error) {
      this.updateUnavailableConnection(
        this.readConnectionFailure("transient_failure", errorMessage(error)),
      );
      return false;
    }
  }

  /**
   * Bring the bridge up for a caller that needs it right now, repairing a cold
   * or dead transport rather than reporting it.
   *
   * One poll window is not a terminal answer (an asleep MV3 service worker or
   * a daemon mid-respawn can miss it), and `connect()`'s dedupe would hand the
   * caller whatever attempt happened to be in flight. So the caller waits out
   * any in-flight attempt, then drives its own attempts with backoff until the
   * budget runs out.
   */
  private async ensureConnectionOnDemand(): Promise<boolean> {
    if (this.disposed) return false;
    const pending = this.connectPromise;
    if (pending) {
      await pending.catch(() => undefined);
      if (this.state.connection === "connected") return true;
    }
    const budgetMs =
      this.options.demandConnectionTimeoutMs ??
      DEFAULT_DEMAND_CONNECTION_TIMEOUT_MS;
    const deadline = Date.now() + Math.max(0, budgetMs);
    const wait =
      this.options.wait ??
      ((delayMs: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
    for (let index = 0; !this.disposed; index += 1) {
      const remainingMs = deadline - Date.now();
      if (index > 0 && remainingMs <= 0) break;
      const windowMs =
        DEMAND_ATTEMPT_WINDOWS_MS[
          Math.min(index, DEMAND_ATTEMPT_WINDOWS_MS.length - 1)
        ]!;
      const state = await this.connect({
        timeoutMs: Math.min(windowMs, Math.max(remainingMs, 0)),
        recover: true,
      });
      if (state.connection === "connected") return true;
      if (!this.isRecoverableFailure()) return false;
      const backoffMs =
        DEMAND_RETRY_BACKOFF_MS[
          Math.min(index, DEMAND_RETRY_BACKOFF_MS.length - 1)
        ]!;
      if (deadline - Date.now() <= backoffMs) break;
      await wait(backoffMs);
    }
    return this.state.connection === "connected";
  }

  private isRecoverableFailure(): boolean {
    const reason = this.connectionUnavailableReason;
    if (!reason) return true;
    return reason !== "bridge_missing" && reason !== "extension_not_installed";
  }

  async show(
    layout: BrowserViewLayout,
    ownerId?: string,
  ): Promise<BrowserViewState> {
    this.tabs.visibleOwnerId = this.tabs.resolveShowOwnerId(ownerId);
    this.visible = true;
    this.setLayoutInternal(layout);
    this.syncState();
    this.attachActiveView();
    return this.snapshot();
  }


  setOwnerScope(ownerId?: string): BrowserViewState {
    const normalizedOwnerId = ownerId?.trim();
    this.tabs.scopedOwnerId = normalizedOwnerId || null;
    if (normalizedOwnerId) {
      this.tabs.visibleOwnerId = normalizedOwnerId;
    }
    this.syncState();
    this.attachActiveView();
    return this.snapshot();
  }

  async setLayout(layout: BrowserViewLayout): Promise<BrowserViewState> {
    this.setLayoutInternal(layout);
    if (this.visible) this.attachActiveView();
    return this.snapshot();
  }

  async hide(): Promise<BrowserViewState> {
    this.visible = false;
    this.detachAttachedView();
    return this.snapshot();
  }

  async createTab(
    options: { url?: string; ownerId?: string; activate?: boolean } = {},
  ): Promise<BrowserViewState> {
    await this.ensureSessionInitialized();
    const browserSession = this.browserSession;
    if (!browserSession) throw new Error("Browser session is unavailable.");
    const ownerId = resolveOwnerId(options.ownerId);
    const agentOwned = ownerId !== MANUAL_OWNER_ID;
    const id = (this.options.createId ?? randomUUID)();
    const offscreen =
      this.rendersOffscreen(ownerId) && !this.options.createView
        ? this.offscreenTabs?.webPreferences()
        : undefined;
    const view =
      this.options.createView?.(browserSession) ??
      new WebContentsView({
        webPreferences: {
          ...offscreen,
          session: browserSession,
          nodeIntegration: false,
          nodeIntegrationInSubFrames: false,
          nodeIntegrationInWorker: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          allowRunningInsecureContent: false,
          webviewTag: false,
          // alert/confirm would open a message box parented to the tab's
          // never-shown host; agents get them dismissed, as over CDP.
          ...(agentOwned ? { disableDialogs: true } : {}),
        },
      });
    try {
      view.webContents.setUserAgent(this.browserUserAgent);
    } catch {
      // Injected/mock views in tests may not implement setUserAgent.
    }
    const tab = this.addTab({
      id,
      view,
      ownerId,
      activate: options.activate,
      offscreen: offscreen !== undefined,
    });
    if (agentOwned) await this.debuggerProxy.prepareTab(tab).catch(() => {});
    try {
      const url = normalizeWebUrl(options.url);
      await view.webContents.loadURL(url);
    } catch (error) {
      if (!view.webContents.isDestroyed()) {
        this.setError(errorMessage(error), ownerId);
      }
    }
    this.syncState();
    return this.snapshot(ownerId);
  }

  private addTab(options: {
    id: string;
    view: WebContentsView;
    ownerId: string;
    activate?: boolean;
    preview?: ManagedTab["preview"];
    offscreen?: boolean;
  }): ManagedTab {
    const { id, view, ownerId } = options;
    const tab: ManagedTab = {
      id,
      ownerId,
      view,
      title: options.preview ? `Preview: ${options.preview.name}` : "New Tab",
      faviconLoadId: 0,
      loading: false,
      ...(options.preview ? { preview: options.preview } : {}),
      ...(options.offscreen ? { offscreen: true } : {}),
    };
    if (tab.offscreen) this.offscreenTabs?.adopt(tab);
    this.tabs.add(tab, options.activate);
    this.bindTab(tab);
    this.syncState();
    this.attachActiveView();
    return tab;
  }

  private async createPreviewTab(name: string, ownerId: string) {
    const openPreview = this.options.openPreview;
    if (!openPreview) {
      throw new Error(
        "Stella previews are available only when Stella runs from source.",
      );
    }
    for (const existing of this.tabs.all()) {
      if (existing.preview?.name !== name) continue;
      existing.preview.dispose();
      this.closeTabInternal(existing.id, existing.ownerId);
    }
    const offscreen = this.rendersOffscreen(ownerId)
      ? this.offscreenTabs?.webPreferences().offscreen
      : undefined;
    const preview = await openPreview(name, { offscreen });
    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      preview.dispose();
    };
    const contents = preview.view.webContents;
    contents.once("destroyed", dispose);
    this.downloads.watch(contents.session);
    const tab = this.addTab({
      id: (this.options.createId ?? randomUUID)(),
      view: preview.view,
      ownerId,
      preview: { name, dispose },
      offscreen: offscreen !== undefined,
    });
    await this.debuggerProxy.prepareTab(tab).catch(() => {});
    try {
      await contents.loadURL(preview.url);
    } catch (error) {
      if (!contents.isDestroyed()) this.setError(errorMessage(error), ownerId);
    }
    this.syncState();
    return tab.id;
  }

  private describeConnectionFailure(
    reason: BrowserViewUnavailableReason | undefined,
    error: string | undefined,
  ): string {
    const detail = error?.trim();
    const withDetail = (message: string) =>
      detail && detail !== message ? `${message} (${detail})` : message;
    const namespace = this.options.getBrowserBridgeNamespace?.();
    if (
      namespace &&
      namespace.mode === "isolated" &&
      !namespace.ownsExtensionChannel &&
      (reason === "extension_disconnected" ||
        reason === "extension_not_installed" ||
        reason === undefined)
    ) {
      return withDetail(
        "Stella Browser works, but without your browser's logins: this Stella " +
          "instance runs an isolated browser bridge, which the browser " +
          "extension cannot reach (no native-messaging host, private loopback " +
          "port). Run the installed Stella app, or start this instance with " +
          "STELLA_BROWSER_BRIDGE=shared, to use your logins.",
      );
    }
    switch (reason) {
      case "bridge_missing":
        return withDetail(
          "The stella-browser bridge binary is not installed for this " +
            "platform, so agents cannot drive Stella Browser and your logins " +
            "cannot be imported. Reinstall or rehydrate stella-browser.",
        );
      case "extension_not_installed":
        return withDetail(
          "Stella Browser works without the extension, but pages open signed " +
            "out. To use your browser's logins, install the Stella browser " +
            `extension from ${STELLA_BROWSER_EXTENSION_STORE_URL}, then press ` +
            "Connect in Stella's Browser panel.",
        );
      case "extension_disconnected":
        return withDetail(
          "Stella Browser works, but it is not using your browser's logins " +
            "right now: the Stella browser extension is installed but did not " +
            "attach to the bridge. Open or focus a tab in the browser where it " +
            "is installed, then press Connect in Stella's Browser panel.",
        );
      case "authorization_failed":
        return withDetail(
          "Stella Browser works, but could not authorize against the browser " +
            "bridge daemon to import your logins. Restarting Stella reissues " +
            "its token.",
        );
      case "connection_lost":
        return withDetail(
          "Stella Browser works, but lost its link to the browser bridge, so " +
            "your logins are not being kept in sync. Stella keeps retrying.",
        );
      default:
        return withDetail(
          "Stella Browser works, but could not reach the browser bridge to " +
            "import your logins. Stella restarted the bridge and retried; it " +
            "did not come up.",
        );
    }
  }

  async selectTab(options: {
    tabId: string;
    ownerId?: string;
    activate?: boolean;
  }): Promise<BrowserViewState> {
    const ownerId = resolveOwnerId(options.ownerId);
    this.tabs.require(options.tabId, ownerId);
    this.tabs.select(options.tabId, ownerId, options.activate);
    this.syncState();
    this.attachActiveView();
    return this.snapshot(ownerId);
  }

  async closeTab(options: {
    tabId: string;
    ownerId?: string;
  }): Promise<BrowserViewState> {
    const ownerId = resolveOwnerId(options.ownerId);
    this.closeTabInternal(options.tabId, ownerId);
    return this.snapshot(ownerId);
  }

  async navigate(options: {
    tabId: string;
    url: string;
    ownerId?: string;
  }): Promise<BrowserViewState> {
    const ownerId = resolveOwnerId(options.ownerId);
    const tab = this.tabs.require(options.tabId, ownerId);
    if (tab.preview) throw new Error("A Stella preview tab only shows Stella.");
    this.clearOwnerError(ownerId);
    const url = normalizeWebUrl(options.url);
    await tab.view.webContents.loadURL(url);
    this.syncState();
    return this.snapshot(ownerId);
  }

  async goBack(options: {
    tabId: string;
    ownerId?: string;
  }): Promise<BrowserViewState> {
    const ownerId = resolveOwnerId(options.ownerId);
    const history = this.tabs.require(options.tabId, ownerId).view.webContents
      .navigationHistory;
    if (history.canGoBack()) history.goBack();
    this.syncState();
    return this.snapshot(ownerId);
  }

  async goForward(options: {
    tabId: string;
    ownerId?: string;
  }): Promise<BrowserViewState> {
    const ownerId = resolveOwnerId(options.ownerId);
    const history = this.tabs.require(options.tabId, ownerId).view.webContents
      .navigationHistory;
    if (history.canGoForward()) history.goForward();
    this.syncState();
    return this.snapshot(ownerId);
  }

  async reload(options: {
    tabId: string;
    ownerId?: string;
  }): Promise<BrowserViewState> {
    const ownerId = resolveOwnerId(options.ownerId);
    this.clearOwnerError(ownerId);
    this.tabs.require(options.tabId, ownerId).view.webContents.reload();
    this.syncState();
    return this.snapshot(ownerId);
  }

  listDebuggerTargets(ownerId?: string): InAppBrowserDebuggerTarget[] {
    return this.debuggerProxy.listTargets(ownerId);
  }

  async createDebuggerTarget(
    url = DEFAULT_URL,
    ownerId?: string,
  ): Promise<InAppBrowserDebuggerTarget> {
    const resolvedOwnerId = resolveOwnerId(ownerId);
    let tabId: string | undefined;
    if (url.startsWith(PREVIEW_URL_PREFIX)) {
      tabId = await this.createPreviewTab(
        url.slice(PREVIEW_URL_PREFIX.length).replace(/\/$/, ""),
        resolvedOwnerId,
      );
    } else {
      tabId = (await this.createTab({ url, ownerId: resolvedOwnerId }))
        .activeTabId;
    }
    const target = tabId
      ? this.listDebuggerTargets(resolvedOwnerId).find(
          (candidate) => candidate.id === tabId,
        )
      : undefined;
    if (!target) throw new Error("Failed to create browser target.");
    return target;
  }

  async closeDebuggerTarget(tabId: string, ownerId?: string): Promise<boolean> {
    const resolvedOwnerId = resolveOwnerId(ownerId);
    if (!this.tabs.isOwnedBy(tabId, resolvedOwnerId)) return false;
    this.closeTabInternal(tabId, resolvedOwnerId);
    return true;
  }

  async activateDebuggerTarget(tabId: string, ownerId?: string): Promise<void> {
    await this.selectTab({
      tabId,
      ownerId: resolveOwnerId(ownerId),
      activate: true,
    });
  }

  sendDebuggerCommand(
    tabId: string,
    method: string,
    params?: Record<string, unknown>,
    ownerId?: string,
    debuggerSessionId?: string,
  ): Promise<unknown> {
    this.markAgentActivity(tabId);
    const tab = this.tabs.get(tabId);
    const resumePainting =
      tab?.offscreen && method === "Page.captureScreenshot"
        ? this.offscreenTabs?.pausePainting(tab)
        : undefined;
    const command = this.debuggerProxy.sendCommand(
      tabId,
      method,
      params,
      ownerId,
      debuggerSessionId,
    );
    if (!resumePainting) return command;
    return command.finally(resumePainting);
  }

  /**
   * File choosers in agent tabs are intercepted (see debugger-target-proxy).
   * When the user, not the agent, opens one in the tab the panel shows, a
   * picker parented to the visible Stella window fills it in.
   */
  private openFileChooserForUser({ tab, sessionId, params }: FileChooserOpened) {
    const window = this.attachedWindow;
    const backendNodeId = params.backendNodeId;
    const shownInPanel =
      this.attachedView === tab.view ||
      this.offscreenTabs?.isMirroring(tab) === true;
    if (
      !shownInPanel ||
      tab.agentActive ||
      typeof backendNodeId !== "number" ||
      !window ||
      window.isDestroyed() ||
      !window.isVisible() ||
      !window.isFocused()
    ) {
      return;
    }
    void dialog
      .showOpenDialog(window, {
        properties:
          params.mode === "selectMultiple"
            ? ["openFile", "multiSelections"]
            : ["openFile"],
      })
      .then(async ({ canceled, filePaths }) => {
        if (canceled || filePaths.length === 0 || !this.tabs.has(tab.id)) {
          return;
        }
        await this.debuggerProxy.sendCommand(
          tab.id,
          "DOM.setFileInputFiles",
          { files: filePaths, backendNodeId },
          tab.ownerId,
          sessionId,
        );
      })
      .catch(() => {});
  }

  private markAgentActivity(tabId: string) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    clearTimeout(tab.agentIdleTimer);
    tab.agentIdleTimer = setTimeout(() => {
      tab.agentIdleTimer = undefined;
      if (!tab.agentActive || !this.tabs.has(tab.id)) return;
      tab.agentActive = false;
      this.syncState();
    }, AGENT_ACTIVITY_IDLE_MS);
    tab.agentIdleTimer.unref?.();
    if (tab.agentActive) return;
    tab.agentActive = true;
    this.syncState();
  }

  recoverDebuggerTarget(
    tabId: string,
    ownerId?: string,
    debuggerSessionId?: string,
  ): Promise<InAppBrowserDebuggerRecovery> {
    return this.debuggerProxy.recoverTarget(tabId, ownerId, debuggerSessionId);
  }

  acquireDrawableHost(
    tabId: string,
    ownerId?: string,
  ): InAppBrowserDrawableLease {
    return this.debuggerProxy.acquireDrawableHost(tabId, ownerId);
  }

  closeOwnerTabs(ownerId: string): void {
    const resolvedOwnerId = resolveOwnerId(ownerId);
    const tabIds = this.tabs.ownerTabIds(resolvedOwnerId);
    if (!tabIds) return;
    const wasVisibleOwner = this.tabs.visibleOwnerId === resolvedOwnerId;
    if (wasVisibleOwner) this.tabs.visibleOwnerId = MANUAL_OWNER_ID;
    for (const tabId of tabIds) {
      if (this.tabs.has(tabId)) this.closeTabInternal(tabId, resolvedOwnerId);
    }
    this.tabs.deleteOwner(resolvedOwnerId);
    this.errorsByOwner.delete(resolvedOwnerId);
    if (wasVisibleOwner) {
      this.syncState();
      this.attachActiveView();
    }
  }

  subscribeDebuggerEvents(
    listener: (event: InAppBrowserDebuggerEvent) => void,
  ): () => void {
    return this.debuggerProxy.subscribe(listener);
  }

  subscribeTabLifecycle(
    listener: (event: InAppBrowserTabLifecycleEvent) => void,
  ): () => void {
    return this.debuggerProxy.subscribeTabLifecycle(listener);
  }

  getDebuggerUserAgent(): string {
    return this.browserUserAgent;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.visible = false;
    this.releaseSessionCookies?.();
    this.releaseSessionCookies = null;
    this.detachAttachedView();
    for (const tab of this.tabs.all()) {
      this.closeTabInternal(tab.id, tab.ownerId);
    }
    this.debuggerProxy.dispose();
    this.offscreenTabs?.dispose();
    this.tabs.clearOwners();
  }

  private async ensureSessionInitialized() {
    if (this.browserSession) return;
    if (this.initializePromise) return await this.initializePromise;
    const initializePromise = (async () => {
      this.browserSession = (this.options.sessionFromPath ?? session.fromPath)(
        this.profilePath,
        { cache: true },
      );
      const runtimeUserAgent =
        this.options.runtimeUserAgent ?? this.browserSession.getUserAgent?.();
      this.browserUserAgent = buildInAppBrowserUserAgent(runtimeUserAgent);
      this.browserSession.setUserAgent(this.browserUserAgent);
      // Permission policy: deny by default, but allow the WebAuthn / security-key
      // access that reauth needs and ONLY on trusted auth origins. Sensitive,
      // auth-irrelevant permissions (camera, microphone, geolocation,
      // notifications) stay denied everywhere. The request handler's permission
      // union excludes hid/usb/serial, so it stays effectively deny-all; the
      // check + device handlers are where security-key access is granted.
      this.browserSession.setPermissionRequestHandler(
        (webContents, permission, callback) => {
          const origin = webContents?.getURL?.() ?? "";
          callback(isAuthPermission(permission) && isAuthOrigin(origin));
        },
      );
      this.browserSession.setPermissionCheckHandler(
        (_webContents, permission, requestingOrigin) =>
          isAuthPermission(permission) && isAuthOrigin(requestingOrigin),
      );
      this.browserSession.setDevicePermissionHandler((details) =>
        shouldAllowAuthDevice(details),
      );
      this.downloads.watch(this.browserSession);
      this.releaseSessionCookies = keepSessionCookies(this.browserSession);
      void trimInAppBrowserStorage(this.profilePath, this.browserSession);
    })().finally(() => {
      if (this.initializePromise === initializePromise) {
        this.initializePromise = null;
      }
    });
    this.initializePromise = initializePromise;
    await initializePromise;
  }

  private async pollExtensionStatus(timeoutMs: number, pollMs: number) {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    do {
      try {
        if (await this.options.getExtensionStatus()) return true;
      } catch {
        // Native-host registration and daemon startup can race any individual
        // probe. A failed attempt is not a terminal connection result.
      }
      const bridgeFailure = this.options.getBrowserBridgeStatus?.()?.reason;
      if (
        bridgeFailure === "bridge_missing" ||
        bridgeFailure === "authorization_failed"
      ) {
        break;
      }
      if (Date.now() >= deadline || this.disposed) break;
      await (
        this.options.wait ??
        ((delayMs: number) =>
          new Promise<void>((resolve) => setTimeout(resolve, delayMs)))
      )(pollMs);
    } while (!this.disposed);
    return false;
  }

  private async loadFaviconDataUrl(url: string): Promise<string | undefined> {
    const browserSession = this.browserSession;
    if (!browserSession?.fetch) return undefined;
    try {
      const response = await browserSession.fetch(url, {
        cache: "force-cache",
      });
      if (!response.ok) return undefined;
      const mimeType = response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      if (!mimeType?.startsWith("image/")) return undefined;
      const declaredSize = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredSize) && declaredSize > MAX_FAVICON_BYTES) {
        return undefined;
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength > MAX_FAVICON_BYTES) return undefined;
      return `data:${mimeType};base64,${bytes.toString("base64")}`;
    } catch {
      return undefined;
    }
  }

  private bindTab(tab: ManagedTab) {
    const contents = tab.view.webContents;
    const refresh = () => this.syncState();
    contents.on("did-start-loading", () => {
      tab.loading = true;
      this.clearOwnerError(tab.ownerId, false);
      refresh();
    });
    contents.on("did-stop-loading", () => {
      tab.loading = false;
      refresh();
    });
    contents.on("did-navigate", refresh);
    contents.on("did-navigate-in-page", refresh);
    contents.on("page-title-updated", (_event, title) => {
      tab.title = title || "New Tab";
      refresh();
    });
    contents.on("page-favicon-updated", (_event, favicons) => {
      const faviconUrl = favicons.find(isAllowedNavigationUrl);
      const loadId = ++tab.faviconLoadId;
      tab.faviconUrl = undefined;
      refresh();
      if (!faviconUrl) return;
      void this.loadFaviconDataUrl(faviconUrl).then((dataUrl) => {
        if (
          !dataUrl ||
          this.tabs.get(tab.id) !== tab ||
          tab.faviconLoadId !== loadId
        ) {
          return;
        }
        tab.faviconUrl = dataUrl;
        refresh();
      });
    });
    contents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
        if (!isMainFrame || errorCode === -3) return;
        tab.loading = false;
        this.setError(
          errorDescription || `Page failed to load (${errorCode}).`,
          tab.ownerId,
        );
      },
    );
    contents.on("render-process-gone", (_event, details) => {
      tab.loading = false;
      this.setError(`Browser page stopped: ${details.reason}.`, tab.ownerId);
    });
    contents.on("destroyed", () => {
      if (this.tabs.get(tab.id) !== tab) return;
      this.debuggerProxy.forgetTab(tab.id);
      this.offscreenTabs?.release(tab);
      if (this.tabs.remove(tab, "last")) {
        this.errorsByOwner.delete(tab.ownerId);
      }
      this.syncState();
      this.attachActiveView();
    });
    contents.on("will-prevent-unload", (event) => {
      if (tab.ownerId !== MANUAL_OWNER_ID) event.preventDefault();
    });
    contents.on("will-navigate", (event) => {
      const allowed = tab.preview
        ? isRendererUrl(event.url)
        : isAllowedNavigationUrl(event.url);
      if (!allowed) event.preventDefault();
    });
    contents.setWindowOpenHandler(({ url }) => {
      // Real auth / reauth popups (Google "confirm it's you", passkey, OAuth
      // consent) run as window.open and MUST open as a genuine child window that
      // keeps its opener, so the challenge can postMessage / redirect back to the
      // page that spawned it. Scope this to the auth-origin allowlist only.
      if (isAuthPopupUrl(url)) {
        return {
          action: "allow",
          outlivesOpener: false,
          overrideBrowserWindowOptions: {
            autoHideMenuBar: true,
            webPreferences: {
              session: this.browserSession ?? undefined,
              nodeIntegration: false,
              nodeIntegrationInSubFrames: false,
              nodeIntegrationInWorker: false,
              contextIsolation: true,
              sandbox: true,
              webSecurity: true,
              allowRunningInsecureContent: false,
              webviewTag: false,
            },
          },
        };
      }
      if (isAllowedNavigationUrl(url)) {
        void this.createTab({ url, ownerId: tab.ownerId }).catch((error) => {
          this.setError(errorMessage(error), tab.ownerId);
        });
      }
      return { action: "deny" };
    });
    this.debuggerProxy.forwardEvents(tab);
  }

  private closeTabInternal(tabId: string, ownerId: string) {
    const tab = this.tabs.require(tabId, ownerId);
    clearTimeout(tab.agentIdleTimer);
    if (
      this.attachedView === tab.view ||
      this.offscreenTabs?.isMirroring(tab)
    ) {
      this.detachAttachedView();
    }
    this.debuggerProxy.releaseTab(tab);
    this.offscreenTabs?.release(tab);
    if (this.tabs.remove(tab, "neighbor")) this.errorsByOwner.delete(ownerId);
    const tabDebugger = tab.view.webContents.debugger;
    if (tabDebugger.isAttached()) tabDebugger.detach();
    tab.view.webContents.close();
    this.syncState();
    this.attachActiveView();
  }

  private syncState() {
    const scopedOwnerId = this.tabs.settleScopedOwner();
    this.state.visibleOwnerId = scopedOwnerId;
    this.state.owners = this.tabs.ownerStates();
    this.state.tabs = this.tabs.tabsForCurrentScope();
    this.state.activeTabId = this.tabs.activeTabId(scopedOwnerId);
    this.syncErrorState();
    this.emitState();
  }

  private updateConnection(connection: BrowserViewConnection, error?: string) {
    this.state.connection = connection;
    this.connectionError = error;
    this.connectionUnavailableReason = undefined;
    delete this.state.unavailableReason;
    this.syncErrorState();
    this.emitState();
  }

  private readSetupRequirement(
    options: { extension?: boolean } = {},
  ): { reason: BrowserViewUnavailableReason; error?: string } | undefined {
    const setup = this.options.getBrowserSetupStatus?.();
    if (!setup) return undefined;
    if (!setup.bridgeBinaryInstalled) {
      return { reason: "bridge_missing", error: BROWSER_BRIDGE_MISSING_ERROR };
    }
    if (options.extension !== false && !setup.extensionInstalled) {
      return { reason: "extension_not_installed" };
    }
    return undefined;
  }

  private readConnectionFailure(
    fallback: BrowserViewUnavailableReason,
    error?: string,
  ): { reason: BrowserViewUnavailableReason; error?: string } {
    const bridgeStatus = this.options.getBrowserBridgeStatus?.();
    if (bridgeStatus?.reason && bridgeStatus.state !== "connected") {
      return {
        reason: bridgeStatus.reason,
        error: bridgeStatus.error ?? error,
      };
    }
    if (fallback === "extension_not_installed") {
      const setup = this.options.getBrowserSetupStatus?.();
      if (setup?.extensionInstalled) {
        return { reason: "extension_disconnected", error };
      }
    }
    return { reason: fallback, error };
  }

  private updateUnavailableConnection(failure: {
    reason: BrowserViewUnavailableReason;
    error?: string;
  }) {
    this.state.connection = "disconnected";
    this.connectionError = this.describeConnectionFailure(
      failure.reason,
      failure.error,
    );
    this.connectionUnavailableReason = failure.reason;
    this.state.unavailableReason = failure.reason;
    this.syncErrorState();
    this.emitState();
  }

  private setError(error: string, ownerId = this.tabs.visibleOwnerId) {
    this.errorsByOwner.set(ownerId, error);
    if (ownerId !== this.tabs.visibleOwnerId) return;
    this.syncErrorState();
    this.emitState();
  }

  private clearOwnerError(ownerId: string, emit = true) {
    if (
      !this.errorsByOwner.delete(ownerId) ||
      ownerId !== this.tabs.visibleOwnerId
    ) {
      return;
    }
    this.syncErrorState();
    if (emit) this.emitState();
  }

  private errorForOwner(ownerId: string) {
    return this.errorsByOwner.get(ownerId);
  }

  private currentConnectionError() {
    return this.state.connection === "connected"
      ? undefined
      : this.connectionError;
  }

  private syncErrorState() {
    const error = this.errorForOwner(this.tabs.visibleOwnerId);
    if (error) this.state.error = error;
    else delete this.state.error;
    const connectionError = this.currentConnectionError();
    if (connectionError) this.state.connectionError = connectionError;
    else delete this.state.connectionError;
  }

  private snapshot(ownerId?: string) {
    if (ownerId === undefined) return cloneState(this.state);
    const activeTabId = this.tabs.activeTabId(ownerId);
    const error = this.errorForOwner(ownerId);
    const connectionError = this.currentConnectionError();
    return cloneState({
      connection: this.state.connection,
      visibleOwnerId: this.tabs.visibleOwnerId,
      owners: this.tabs.ownerStates(),
      tabs: this.tabs.ownerTabStates(ownerId),
      ...(activeTabId ? { activeTabId } : {}),
      ...(error ? { error } : {}),
      ...(connectionError ? { connectionError } : {}),
      ...(this.connectionUnavailableReason
        ? { unavailableReason: this.connectionUnavailableReason }
        : {}),
    });
  }

  private emitState() {
    this.options.onStateChanged?.(this.snapshot());
  }

  private setLayoutInternal(layout: BrowserViewLayout) {
    this.layout = {
      pageBounds: normalizeBounds(layout.pageBounds),
      surfaceBounds: normalizeBounds(layout.surfaceBounds),
    };
    if (this.attachedView && this.attachedWindow && this.layout) {
      this.attachedView.setBounds(
        clampBoundsToWindow(this.layout.pageBounds, this.attachedWindow),
      );
    }
    this.debuggerProxy.resizeHiddenMounts();
    this.offscreenTabs?.resize();
  }

  private attachActiveView() {
    const activeTabId = this.state.activeTabId;
    if (!this.visible || !this.layout || !activeTabId) {
      this.detachAttachedView();
      return;
    }
    const tab = this.tabs.get(activeTabId);
    const window = this.options.getWindow();
    if (
      !tab ||
      tab.view.webContents.isDestroyed() ||
      !window ||
      window.isDestroyed()
    ) {
      this.detachAttachedView();
      return;
    }
    if (this.debuggerProxy.isMountedInHiddenHost(tab.id)) {
      // The panel is showing this tab, so it comes back now rather than when
      // an agent's lease ends. A lease that never ended used to leave the tab
      // blank in the panel for good.
      this.debuggerProxy.takeBackForPanel(tab);
    }
    if (!tab.offscreen) this.offscreenTabs?.unbindMirror();
    const view =
      tab.offscreen && this.offscreenTabs
        ? this.offscreenTabs.mirrorFor(tab)
        : tab.view;
    let attached = false;
    if (this.attachedView !== view || this.attachedWindow !== window) {
      this.detachAttachedView({ keepMirror: view !== tab.view });
      window.contentView.addChildView(view);
      this.attachedView = view;
      this.attachedWindow = window;
      attached = true;
    }
    view.setBounds(clampBoundsToWindow(this.layout.pageBounds, window));
    if (attached) this.refreshAttachedVisibility(window);
  }

  /**
   * Chromium keeps a view that went hidden (inside the unmapped agent host, or
   * detached while covered) marked hidden after it is re-added to the window,
   * so the page paints nothing until the window's focus changes. Adding and
   * removing any child view makes it recompute which views are visible.
   */
  private refreshAttachedVisibility(window: BrowserWindow) {
    this.visibilityNudge ??= new View();
    try {
      window.contentView.addChildView(this.visibilityNudge);
      this.visibilityNudge.setBounds({ x: 0, y: 0, width: 1, height: 1 });
      window.contentView.removeChildView(this.visibilityNudge);
    } catch {
      // A window torn down mid-attach has nothing to recompute.
    }
  }

  private detachAttachedView(options: { keepMirror?: boolean } = {}) {
    if (!options.keepMirror) this.offscreenTabs?.unbindMirror();
    const view = this.attachedView;
    const window = this.attachedWindow;
    this.attachedView = null;
    this.attachedWindow = null;
    if (!view || !window || window.isDestroyed()) return;
    try {
      window.contentView.removeChildView(view);
    } catch {
      // Window teardown may have already detached its child views.
    }
    const tab = this.tabs.findByView(view);
    if (tab) this.debuggerProxy.remountLeased(tab);
  }
}
