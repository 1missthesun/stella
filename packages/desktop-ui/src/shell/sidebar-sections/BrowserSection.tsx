import { useFileViewerStageOpen } from "@/features/workspace-display/file-viewer-store";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type {
  BrowserViewBounds,
  BrowserViewLayout,
  BrowserViewState,
} from "@stella/contracts/desktop/browser-view";
import { uiState } from "@/platform/ui-state";
import type { ElectronBrowserViewApi } from "@/shared/types/electron";
import { useChatRuntime } from "@/context/use-chat-runtime";
import { translateNow, useT } from "@/shared/i18n";
import { useActiveSidebarSection } from "@/features/workspace-display/sidebar-sections";
import { useDisplayPanelOpen } from "@/features/workspace-display/tab-store";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Globe,
  KeyRound,
  Plus,
  RefreshCw,
  X,
} from "@/ui/icons";
import { useTabStripCloseFreeze } from "@/shared/hooks/use-tab-strip-close-freeze";
import "./browser-section.css";
import { contextMenu, copyText } from "@/platform/context-menu";
import { normalizedHttpUrl } from "@/features/chat/lib/stella-web-links";

const MANUAL_OWNER_ID = "stella:manual";
const SIGN_IN_HINT_DISMISSED_KEY = "stella-browser-sign-in-hint-dismissed";

const EMPTY_STATE: BrowserViewState = {
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

const browserViewApi = (): ElectronBrowserViewApi | null =>
  window.electronAPI?.browserView ?? null;

const toBounds = (rect: DOMRect): BrowserViewBounds => ({
  x: Math.round(rect.x),
  y: Math.round(rect.y),
  width: Math.max(0, Math.round(rect.width)),
  height: Math.max(0, Math.round(rect.height)),
});

const boundsKey = (layout: BrowserViewLayout) =>
  `${layout.pageBounds.x},${layout.pageBounds.y},${layout.pageBounds.width},${layout.pageBounds.height}|` +
  `${layout.surfaceBounds.x},${layout.surfaceBounds.y},${layout.surfaceBounds.width},${layout.surfaceBounds.height}`;

/* The browser fills a stage tab; nothing HTML sits over its page. */
const browserPageBounds = (rect: DOMRect): BrowserViewBounds => toBounds(rect);

const normalizeAddress = (raw: string): string | null => {
  const value = raw.trim();
  if (!value) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return value;
  if (/^(?:localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:\/|$)/i.test(value)) {
    return `http://${value}`;
  }
  if (/^[^\s/]+\.[^\s]+/.test(value)) return `https://${value}`;
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
};

const isBrowserViewState = (value: unknown): value is BrowserViewState => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BrowserViewState>;
  return (
    (candidate.connection === "checking" ||
      candidate.connection === "disconnected" ||
      candidate.connection === "connected") &&
    typeof candidate.visibleOwnerId === "string" &&
    Array.isArray(candidate.owners) &&
    Array.isArray(candidate.tabs)
  );
};

const sanitizeOwnerSegment = (value: string) =>
  value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

const conversationOwnerId = (conversationId: string | null | undefined) => {
  const ownerSegment = sanitizeOwnerSegment(
    conversationId ? `conversation-${conversationId}` : "",
  );
  return ownerSegment
    ? `orchestrator-${ownerSegment}`.slice(0, 120)
    : MANUAL_OWNER_ID;
};

type LoginAction = "install" | "reconnect" | null;

const loginActionFor = (state: BrowserViewState): LoginAction => {
  if (state.connection !== "disconnected") return null;
  const reason = state.unavailableReason;
  if (reason === "bridge_missing") return null;
  if (!reason || reason === "extension_not_installed") return "install";
  return "reconnect";
};

function BrowserLoginBanner({
  state,
  busy,
  onConnect,
  onReconnect,
  onDismiss,
}: {
  state: BrowserViewState;
  busy: boolean;
  onConnect: () => void;
  onReconnect: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  if (state.connection !== "disconnected") return null;
  const bridgeMissing = state.unavailableReason === "bridge_missing";
  const action = loginActionFor(state);
  return (
    <div
      className="browser-section__login-banner"
      role="status"
      data-reason={state.unavailableReason ?? "extension_not_installed"}
      title={state.connectionError}
    >
      {bridgeMissing ? (
        <AlertCircle size={13} strokeWidth={1.75} aria-hidden="true" />
      ) : (
        <KeyRound size={13} strokeWidth={1.75} aria-hidden="true" />
      )}
      <p className="browser-section__login-banner-text">
        {bridgeMissing
          ? t("shell.browser.serviceMissing")
          : t("shell.browser.signInHint")}
      </p>
      {action ? (
        <button
          type="button"
          className="browser-section__login-banner-link"
          disabled={busy}
          onClick={action === "install" ? onConnect : onReconnect}
        >
          {busy
            ? t("shell.browser.connecting")
            : action === "install"
              ? t("shell.browser.useMyLogins")
              : t("shell.browser.reconnectExtension")}
        </button>
      ) : null}
      <button
        type="button"
        className="browser-section__chrome-button"
        aria-label={t("shell.browser.dismiss")}
        title={t("shell.browser.dismiss")}
        onClick={onDismiss}
      >
        <X size={12} strokeWidth={1.8} />
      </button>
    </div>
  );
}

function BrowserEmptyState({
  state,
  error,
  busy,
  onCreateTab,
  onConnect,
  onReconnect,
}: {
  state: BrowserViewState;
  error?: string;
  busy: boolean;
  onCreateTab: () => void;
  onConnect: () => void;
  onReconnect: () => void;
}) {
  const t = useT();
  const action = loginActionFor(state);
  const body = error
    ? error
    : state.connection === "connected"
      ? t("shell.browser.emptyBodyConnected")
      : t("shell.browser.emptyBody");
  return (
    <div className="browser-section__status" role={error ? "alert" : "status"}>
      <span className="browser-section__status-icon" aria-hidden="true">
        {error ? (
          <AlertCircle size={21} strokeWidth={1.75} />
        ) : (
          <Globe size={21} strokeWidth={1.75} />
        )}
      </span>
      <p className="browser-section__status-title">
        {error
          ? t("shell.browser.openErrorTitle")
          : t("shell.browser.emptyTitle")}
      </p>
      <p className="browser-section__status-body">{body}</p>
      <button
        type="button"
        className="pill-btn pill-btn--primary"
        onClick={onCreateTab}
      >
        {t("shell.browser.newTab")}
      </button>
      {action && !error ? (
        <button
          type="button"
          className="browser-section__status-link"
          disabled={busy}
          title={state.connectionError}
          onClick={action === "install" ? onConnect : onReconnect}
        >
          {busy
            ? t("shell.browser.connecting")
            : action === "install"
              ? t("shell.browser.useMyLogins")
              : t("shell.browser.reconnectExtension")}
        </button>
      ) : null}
    </div>
  );
}

function BrowserPageError({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}) {
  const t = useT();
  return (
    <div className="browser-section__status" role="alert">
      <AlertCircle size={22} strokeWidth={1.75} aria-hidden="true" />
      <p className="browser-section__status-title">
        {t("shell.browser.pageErrorTitle")}
      </p>
      <p className="browser-section__status-body">{error}</p>
      <button
        type="button"
        className="pill-btn pill-btn--primary"
        onClick={onRetry}
      >
        {t("common.tryAgain")}
      </button>
    </div>
  );
}

/**
 * Whether an open popover, menu or dialog overlaps the page. The page is a
 * native view drawn above the whole window, so it must step aside while one
 * is open or it would cover it.
 */
const OVERLAY_SELECTOR = [
  '[data-radix-popper-content-wrapper] > [data-state="open"]',
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
].join(", ");

function useOverlayOverPage(
  pageRef: { current: HTMLElement | null },
  enabled: boolean,
): boolean {
  const [covered, setCovered] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setCovered(false);
      return;
    }
    let frame = 0;
    const check = () => {
      frame = 0;
      const page = pageRef.current?.getBoundingClientRect();
      let next = false;
      if (page) {
        for (const overlay of document.querySelectorAll(OVERLAY_SELECTOR)) {
          const rect = overlay.getBoundingClientRect();
          if (
            rect.width > 0 &&
            rect.left < page.right &&
            rect.right > page.left &&
            rect.top < page.bottom &&
            rect.bottom > page.top
          ) {
            next = true;
            break;
          }
        }
      }
      setCovered(next);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state"],
    });
    check();
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [enabled, pageRef]);
  return covered;
}

export function BrowserSection() {
  const t = useT();
  const chat = useChatRuntime();
  const activeSection = useActiveSidebarSection();
  const panelOpen = useDisplayPanelOpen();
  // An expanded file sits over the stage; the native view would draw on top.
  const fileStageOpen = useFileViewerStageOpen();
  const visible = panelOpen && activeSection === "browser" && !fileStageOpen;
  const [state, setState] = useState<BrowserViewState>(EMPTY_STATE);
  const [connectingExtension, setConnectingExtension] = useState(false);
  const [reconnectingLogins, setReconnectingLogins] = useState(false);
  const [loginBannerDismissed, setLoginBannerDismissed] = useState(
    () => uiState.getItem(SIGN_IN_HINT_DISMISSED_KEY) === "1",
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const surfaceRef = useRef<HTMLElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const overlayOverPage = useOverlayOverPage(pageRef, visible);
  const shownRef = useRef(false);
  const mountedRef = useRef(true);
  const tabStripRef = useRef<HTMLDivElement | null>(null);
  const { onTabCloseClick } = useTabStripCloseFreeze({
    stripRef: tabStripRef,
    tabSelector: ".browser-section__tab-shell",
    tabIds: state.tabs.map((tab) => tab.id),
  });
  const scopedOwnerId = useMemo(
    () => conversationOwnerId(chat.conversation.conversationId),
    [chat.conversation.conversationId],
  );

  const activeTab = useMemo(
    () =>
      state.tabs.find((tab) => tab.id === state.activeTabId) ??
      state.tabs[0] ??
      null,
    [state.activeTabId, state.tabs],
  );
  const activeTabId = activeTab?.id ?? null;

  useEffect(() => {
    setAddress(activeTab?.url ?? "");
  }, [activeTab?.id, activeTab?.url]);

  useEffect(() => {
    mountedRef.current = true;
    const api = browserViewApi();
    if (!api) {
      setState({ ...EMPTY_STATE, connection: "disconnected" });
      return () => {
        mountedRef.current = false;
      };
    }

    const unsubscribe = api.onState((next) => {
      if (!mountedRef.current) return;
      setState(next);
      setLocalError(null);
    });
    void api
      .getState()
      .then((next) => {
        if (mountedRef.current) setState(next);
      })
      .catch((error: unknown) => {
        if (!mountedRef.current) return;
        setLocalError(
          error instanceof Error
            ? error.message
            : "Couldn’t check the browser.",
        );
      });

    return () => {
      mountedRef.current = false;
      unsubscribe();
      if (shownRef.current) void api.hide();
      shownRef.current = false;
    };
  }, []);

  useEffect(() => {
    const api = browserViewApi();
    if (!api) return;
    void api
      .setOwnerScope({})
      .then((next) => {
        if (mountedRef.current && isBrowserViewState(next)) setState(next);
      })
      .catch((error: unknown) => {
        if (!mountedRef.current) return;
        setLocalError(
          error instanceof Error
            ? error.message
            : "Couldn’t select this chat’s browser tabs.",
        );
      });
  }, []);

  const connect = useCallback(async (reconnect = false) => {
    const api = browserViewApi();
    if (!api) return;
    setLocalError(null);
    try {
      const next = await api.connect(reconnect ? { reconnect: true } : {});
      if (mountedRef.current && isBrowserViewState(next)) setState(next);
    } catch (error) {
      if (mountedRef.current) {
        setLocalError(
          error instanceof Error
            ? error.message
            : "Stella couldn’t prepare the browser.",
        );
      }
    }
  }, []);

  useEffect(() => {
    if (visible) void connect();
  }, [connect, visible]);

  useEffect(() => {
    const api = browserViewApi();
    const surface = surfaceRef.current;
    const page = pageRef.current;
    const shouldShow =
      visible &&
      !overlayOverPage &&
      Boolean(activeTabId) &&
      !state.error &&
      !localError;
    if (!api || !surface || !page || !shouldShow) {
      if (api && shownRef.current) void api.hide();
      shownRef.current = false;
      return;
    }

    const panel = surface.closest<HTMLElement>(".right-sidebar");
    let frame = 0;
    let lastKey = "";

    const syncLayout = () => {
      const layout = {
        pageBounds: browserPageBounds(page.getBoundingClientRect()),
        surfaceBounds: toBounds(surface.getBoundingClientRect()),
      };
      if (
        layout.pageBounds.width <= 0 ||
        layout.pageBounds.height <= 0 ||
        layout.surfaceBounds.width <= 0 ||
        layout.surfaceBounds.height <= 0
      ) {
        return;
      }
      const key = boundsKey(layout);
      if (key === lastKey) return;
      lastKey = key;
      if (shownRef.current) void api.setLayout(layout);
      else {
        shownRef.current = true;
        void api.show(layout);
      }
    };

    const panelIsMoving = () =>
      panel
        ?.getAnimations({ subtree: true })
        .some(
          (animation) =>
            animation instanceof CSSTransition &&
            animation.playState === "running",
        ) ?? false;

    const followMotion = () => {
      frame = 0;
      syncLayout();
      if (panelIsMoving()) frame = requestAnimationFrame(followMotion);
    };
    const startFollowingMotion = () => {
      if (!frame) frame = requestAnimationFrame(followMotion);
    };

    const observer = new ResizeObserver(syncLayout);
    observer.observe(surface);
    observer.observe(page);
    window.addEventListener("resize", syncLayout);
    panel?.addEventListener("transitionrun", startFollowingMotion);
    panel?.addEventListener("transitionend", syncLayout);
    panel?.addEventListener("transitioncancel", syncLayout);
    syncLayout();
    startFollowingMotion();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", syncLayout);
      panel?.removeEventListener("transitionrun", startFollowingMotion);
      panel?.removeEventListener("transitionend", syncLayout);
      panel?.removeEventListener("transitioncancel", syncLayout);
      if (shownRef.current) void api.hide();
      shownRef.current = false;
    };
  }, [activeTabId, localError, overlayOverPage, state.error, visible]);

  const requestExtension = useCallback(async () => {
    const api = browserViewApi();
    if (!api || connectingExtension) return;
    setConnectingExtension(true);
    setLocalError(null);
    try {
      await api.requestExtensionConnect();
      await connect();
    } catch (error) {
      if (mountedRef.current) {
        setLocalError(
          error instanceof Error
            ? error.message
            : "Couldn’t connect the extension.",
        );
      }
    } finally {
      if (mountedRef.current) setConnectingExtension(false);
    }
  }, [connect, connectingExtension]);

  const runTabAction = useCallback(
    (
      action: (
        api: ElectronBrowserViewApi,
        tabId: string,
        ownerId: string,
      ) => Promise<unknown>,
    ) => {
      if (!activeTab) return;
      const api = browserViewApi();
      if (!api) return;
      setLocalError(null);
      void action(api, activeTab.id, activeTab.ownerId).catch(
        (error: unknown) => {
          if (mountedRef.current) {
            setLocalError(
              error instanceof Error ? error.message : "Browser action failed.",
            );
          }
        },
      );
    },
    [activeTab],
  );

  const createConversationTab = useCallback(() => {
    const api = browserViewApi();
    if (!api) return;
    setLocalError(null);
    void api
      .createTab({ ownerId: scopedOwnerId, activate: true })
      .then((next) => {
        if (mountedRef.current && isBrowserViewState(next)) setState(next);
      })
      .catch((error: unknown) => {
        if (!mountedRef.current) return;
        setLocalError(
          error instanceof Error ? error.message : "Couldn’t create a tab.",
        );
      });
  }, [scopedOwnerId]);

  const navigate = (event: FormEvent) => {
    event.preventDefault();
    const url = normalizeAddress(address);
    if (!url) return;
    runTabAction((api, tabId, ownerId) =>
      api.navigate({ tabId, url, ownerId }),
    );
  };

  const error = localError ?? state.error;
  const retryPage = () => {
    setLocalError(null);
    runTabAction((api, tabId, ownerId) => api.reload({ tabId, ownerId }));
  };
  const loginBusy = connectingExtension || reconnectingLogins;
  const reconnectLogins = () => {
    setReconnectingLogins(true);
    void connect(true).finally(() => {
      if (mountedRef.current) setReconnectingLogins(false);
    });
  };
  const dismissLoginBanner = () => {
    uiState.setItem(SIGN_IN_HINT_DISMISSED_KEY, "1");
    setLoginBannerDismissed(true);
  };
  const loginBanner = loginBannerDismissed ? null : (
    <BrowserLoginBanner
      state={state}
      busy={loginBusy}
      onConnect={() => void requestExtension()}
      onReconnect={reconnectLogins}
      onDismiss={dismissLoginBanner}
    />
  );

  return (
    <section
      ref={surfaceRef}
      className="browser-section"
      data-connection={state.connection}
      aria-label="Browser"
    >
      {activeTab ? (
        <>
          <div className="browser-section__chrome">
            <div
              ref={tabStripRef}
              className="browser-section__tabs"
              role="tablist"
              aria-label="Browser tabs"
            >
              {state.tabs.map((tab) => {
                const active = tab.id === activeTab.id;
                return (
                  <div
                    key={tab.id}
                    className="browser-section__tab-shell"
                    data-tab-id={tab.id}
                    data-active={active || undefined}
                    data-agent-active={tab.agentActive || undefined}
                    onContextMenu={contextMenu(() => {
                      const url = normalizedHttpUrl(tab.url ?? "");
                      const others = state.tabs.filter(
                        (entry) => entry.id !== tab.id,
                      );
                      const close = (entry: typeof tab) =>
                        void browserViewApi()?.closeTab({
                          tabId: entry.id,
                          ownerId: entry.ownerId,
                        });
                      return [
                        [
                          {
                            label: translateNow("contextMenu.reload"),
                            run: () =>
                              browserViewApi()?.reload({
                                tabId: tab.id,
                                ownerId: tab.ownerId,
                              }),
                          },
                        ],
                        ...(url
                          ? [
                              [
                                {
                                  label: translateNow("contextMenu.openInYourBrowser"),
                                  run: () =>
                                    window.electronAPI?.system?.openExternal?.(url),
                                },
                                {
                                  label: translateNow("contextMenu.copyLink"),
                                  run: () => copyText(url),
                                },
                              ],
                            ]
                          : []),
                        [
                          {
                            label: translateNow("contextMenu.closeTab"),
                            run: () => close(tab),
                          },
                          {
                            label: translateNow("contextMenu.closeOtherTabs"),
                            enabled: others.length > 0,
                            run: () => others.forEach(close),
                          },
                        ],
                      ];
                    })}
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={active}
                      className="browser-section__tab"
                      title={tab.title || tab.url || "New tab"}
                      onClick={() =>
                        void browserViewApi()?.selectTab({
                          tabId: tab.id,
                          ownerId: tab.ownerId,
                          activate: true,
                        })
                      }
                    >
                      {tab.faviconUrl ? (
                        <img
                          className="browser-section__favicon"
                          src={tab.faviconUrl}
                          alt=""
                        />
                      ) : (
                        <Globe
                          size={13}
                          strokeWidth={1.75}
                          aria-hidden="true"
                        />
                      )}
                      <span>{tab.title || "New tab"}</span>
                      {tab.agentActive ? (
                        <img
                          className="browser-section__agent-mark"
                          src="stella-agent-cursor.png"
                          alt={t("shell.browser.taskUsingTab")}
                          title={t("shell.browser.taskUsingTab")}
                          draggable={false}
                        />
                      ) : null}
                    </button>
                    <button
                      type="button"
                      className="browser-section__tab-close"
                      aria-label={`Close ${tab.title || "tab"}`}
                      onClick={(event) => {
                        onTabCloseClick(event, tab.id);
                        void browserViewApi()?.closeTab({
                          tabId: tab.id,
                          ownerId: tab.ownerId,
                        });
                      }}
                    >
                      <X size={12} strokeWidth={1.8} />
                    </button>
                  </div>
                );
              })}
              <button
                type="button"
                className="browser-section__chrome-button browser-section__new-tab"
                aria-label="New tab"
                title="New tab"
                onClick={createConversationTab}
              >
                <Plus size={14} strokeWidth={1.8} />
              </button>
            </div>

            <form className="browser-section__navigation" onSubmit={navigate}>
              <button
                type="button"
                className="browser-section__chrome-button"
                aria-label="Go back"
                title="Back"
                disabled={!activeTab.canGoBack}
                onClick={() =>
                  runTabAction((api, tabId, ownerId) =>
                    api.goBack({ tabId, ownerId }),
                  )
                }
              >
                <ArrowLeft size={14} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                className="browser-section__chrome-button"
                aria-label="Go forward"
                title="Forward"
                disabled={!activeTab.canGoForward}
                onClick={() =>
                  runTabAction((api, tabId, ownerId) =>
                    api.goForward({ tabId, ownerId }),
                  )
                }
              >
                <ArrowRight size={14} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                className="browser-section__chrome-button"
                aria-label="Reload page"
                title="Reload"
                onClick={() =>
                  runTabAction((api, tabId, ownerId) =>
                    api.reload({ tabId, ownerId }),
                  )
                }
              >
                <RefreshCw
                  className={
                    activeTab.loading ? "stella-loader-circle" : undefined
                  }
                  size={14}
                  strokeWidth={1.8}
                />
              </button>
              <div className="browser-section__address-wrap">
                <Globe size={13} strokeWidth={1.7} aria-hidden="true" />
                <input
                  value={address}
                  onChange={(event) => setAddress(event.currentTarget.value)}
                  onFocus={(event) => event.currentTarget.select()}
                  aria-label="Address and search"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>
            </form>
            {activeTab.loading ? (
              <div
                className="browser-section__loading-track"
                aria-hidden="true"
              >
                <span />
              </div>
            ) : null}
          </div>
          {loginBanner}
          <div
            ref={pageRef}
            className="browser-section__page"
            aria-busy={activeTab.loading || undefined}
          >
            {error ? (
              <BrowserPageError error={error} onRetry={retryPage} />
            ) : null}
          </div>
        </>
      ) : (
        <BrowserEmptyState
          state={state}
          error={error ?? undefined}
          busy={loginBusy}
          onCreateTab={createConversationTab}
          onConnect={() => void requestExtension()}
          onReconnect={reconnectLogins}
        />
      )}
    </section>
  );
}
