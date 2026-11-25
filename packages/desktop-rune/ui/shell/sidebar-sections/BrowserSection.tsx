import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BrowserViewBounds, BrowserViewLayout, BrowserViewState } from "@stella/contracts/desktop/browser-view";
import { useFileViewerStageOpen } from "@/features/workspace-display/file-viewer-store";
import { uiState } from "@/platform/ui-state";
import type { ElectronBrowserViewApi } from "@/shared/types/electron";
import { useChatRuntime } from "@/context/use-chat-runtime";
import { translateNow, useT } from "@/shared/i18n";
import { useActiveSidebarSection } from "@/features/workspace-display/sidebar-sections";
import { useDisplayPanelOpen } from "@/features/workspace-display/tab-store";
import { copyText } from "@/platform/context-menu";
import { normalizedHttpUrl } from "@/features/chat/lib/stella-web-links";
import agentCursor from "../../../../desktop-ui/public/stella-agent-cursor.png";
import { contextMenu } from "../../chat/context-menu";
import { Icon, Icons, type IconData } from "../../kit";
import { Button } from "../../kit/compat";
import { fontSize, look, mixOklch, radius, useTokens } from "../../theme";

const MANUAL_OWNER_ID = "stella:manual";
const SIGN_IN_HINT_DISMISSED_KEY = "stella-browser-sign-in-hint-dismissed";

const EMPTY_STATE: BrowserViewState = {
  connection: "checking",
  visibleOwnerId: MANUAL_OWNER_ID,
  owners: [{ id: MANUAL_OWNER_ID, kind: "manual", tabCount: 0, latest: false }],
  tabs: [],
};

type Rect = { x: number; y: number; w: number; h: number };

const browserViewApi = (): ElectronBrowserViewApi | null => window.electronAPI?.browserView ?? null;

const toBounds = (rect: Rect): BrowserViewBounds => ({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.max(0, Math.round(rect.w)), height: Math.max(0, Math.round(rect.h)) });

const boundsKey = (layout: BrowserViewLayout) =>
  `${layout.pageBounds.x},${layout.pageBounds.y},${layout.pageBounds.width},${layout.pageBounds.height}|` + `${layout.surfaceBounds.x},${layout.surfaceBounds.y},${layout.surfaceBounds.width},${layout.surfaceBounds.height}`;

const normalizeAddress = (raw: string): string | null => {
  const value = raw.trim();
  if (!value) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return value;
  if (/^(?:localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:\/|$)/i.test(value)) return `http://${value}`;
  if (/^[^\s/]+\.[^\s]+/.test(value)) return `https://${value}`;
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
};

const isBrowserViewState = (value: unknown): value is BrowserViewState => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BrowserViewState>;
  return (candidate.connection === "checking" || candidate.connection === "disconnected" || candidate.connection === "connected") && typeof candidate.visibleOwnerId === "string" && Array.isArray(candidate.owners) && Array.isArray(candidate.tabs);
};

const sanitizeOwnerSegment = (value: string) =>
  value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

const conversationOwnerId = (conversationId: string | null | undefined) => {
  const ownerSegment = sanitizeOwnerSegment(conversationId ? `conversation-${conversationId}` : "");
  return ownerSegment ? `orchestrator-${ownerSegment}`.slice(0, 120) : MANUAL_OWNER_ID;
};

type LoginAction = "install" | "reconnect" | null;

const loginActionFor = (state: BrowserViewState): LoginAction => {
  if (state.connection !== "disconnected") return null;
  const reason = state.unavailableReason;
  if (reason === "bridge_missing") return null;
  if (!reason || reason === "extension_not_installed") return "install";
  return "reconnect";
};

const SM = look(fontSize.sm, 400);

/** `.browser-section__chrome-button`. */
function ChromeButton({ id, label, title, icon, iconSize = 14, disabled = false, spin, onPress }: { id: string; label: string; title?: string; icon: IconData; iconSize?: number; disabled?: boolean; spin?: number; onPress: () => void }) {
  const t = useTokens();
  return (
    <box
      id={id}
      role="button"
      label={label}
      title={title ?? label}
      focusable={!disabled}
      disabled={disabled}
      w={27}
      h={27}
      shrink={false}
      center
      radius={radius.sm}
      opacity={disabled ? 0.35 : 1}
      hover={disabled ? undefined : mixOklch(t.c.foreground, 7, "transparent")}
      hoverColor={disabled ? undefined : t.c.textStrong}
      focusRing={{ width: 2, offset: 0, color: t.c.ring, radius: radius.sm }}
      onPress={disabled ? undefined : onPress}
    >
      <Icon icon={icon} size={iconSize} strokeWidth={1.8} color={t.c.textWeak} spin={spin} />
    </box>
  );
}

/** `.browser-section__login-banner-link` / `__status-link`: an underlined text button. */
function TextLink({ id, label, title, disabled, weak = false, onPress }: { id: string; label: string; title?: string; disabled: boolean; weak?: boolean; onPress: () => void }) {
  const t = useTokens();
  return (
    <box id={id} role="button" label={label} title={title} focusable={!disabled} disabled={disabled} shrink={false} py={2} px={4} radius={6} focusRing={{ width: 2, offset: 0, color: t.c.ring, radius: 6 }} onPress={disabled ? undefined : onPress}>
      <text {...SM} underline color={disabled || weak ? t.c.textWeak : t.c.textBase} nowrap>
        {label}
      </text>
    </box>
  );
}

function BrowserLoginBanner({ state, busy, onConnect, onReconnect, onDismiss }: { state: BrowserViewState; busy: boolean; onConnect: () => void; onReconnect: () => void; onDismiss: () => void }) {
  const t = useT();
  const tk = useTokens();
  if (state.connection !== "disconnected") return null;
  const bridgeMissing = state.unavailableReason === "bridge_missing";
  const action = loginActionFor(state);
  return (
    <row id="browser-section-login-banner" role="status" title={state.connectionError} shrink={false} align="center" gap={8} minW={0} pt={5} pb={5} pl={12} pr={6} border={tk.c.borderWeak} borderSides={[0, 0, 1, 0]} fill={mixOklch(tk.c.background, 96, tk.c.foreground)}>
      <Icon icon={bridgeMissing ? Icons.stella.AlertCircle : Icons.stella.KeyRound} size={13} strokeWidth={1.75} color={tk.c.textWeak} />
      <text {...look(fontSize.sm, 400, { lh: 1.35 })} grow={1} minW={0} color={tk.c.textWeak} nowrap truncate>
        {bridgeMissing ? t("shell.browser.serviceMissing") : t("shell.browser.signInHint")}
      </text>
      {action ? <TextLink id="browser-section-login-link" label={busy ? t("shell.browser.connecting") : action === "install" ? t("shell.browser.useMyLogins") : t("shell.browser.reconnectExtension")} disabled={busy} onPress={action === "install" ? onConnect : onReconnect} /> : null}
      <ChromeButton id="browser-section-login-dismiss" label={t("shell.browser.dismiss")} icon={Icons.stella.X} iconSize={12} onPress={onDismiss} />
    </row>
  );
}

function StatusBlock({ role, icon, boxedIcon = false, title, body, children }: { role: "alert" | "status"; icon: IconData; boxedIcon?: boolean; title: string; body: string; children?: React.ReactNode }) {
  const tk = useTokens();
  return (
    <col role={role} grow={1} minH={0} align="center" justify="center" gap={10} py={28} px={22}>
      {boxedIcon ? (
        <box w={38} h={38} center radius={12} border={tk.c.borderWeak} fill={mixOklch(tk.c.foreground, 3, "transparent")}>
          <Icon icon={icon} size={21} strokeWidth={1.75} color={tk.c.textBase} />
        </box>
      ) : (
        <Icon icon={icon} size={22} strokeWidth={1.75} color={tk.c.textWeak} />
      )}
      <text {...look(fontSize.base, 600, { em: -0.01 })} color={tk.c.textStrong} textAlign="center">
        {title}
      </text>
      <text {...look(fontSize.sm, 400, { lh: 1.5 })} maxW={32 * 6.9} color={tk.c.textWeak} textAlign="center">
        {body}
      </text>
      {children}
    </col>
  );
}

function BrowserEmptyState({ state, error, busy, onCreateTab, onConnect, onReconnect }: { state: BrowserViewState; error?: string; busy: boolean; onCreateTab: () => void; onConnect: () => void; onReconnect: () => void }) {
  const t = useT();
  const action = loginActionFor(state);
  const body = error ? error : state.connection === "connected" ? t("shell.browser.emptyBodyConnected") : t("shell.browser.emptyBody");
  return (
    <StatusBlock role={error ? "alert" : "status"} icon={error ? Icons.stella.AlertCircle : Icons.stella.Globe} boxedIcon title={error ? t("shell.browser.openErrorTitle") : t("shell.browser.emptyTitle")} body={body}>
      <box mt={2}>
        <Button className="pill-btn pill-btn--primary" minW={118} onClick={onCreateTab}>
          {t("shell.browser.newTab")}
        </Button>
      </box>
      {action && !error ? (
        <box mt={-2}>
          <TextLink id="browser-section-status-link" weak title={state.connectionError} label={busy ? t("shell.browser.connecting") : action === "install" ? t("shell.browser.useMyLogins") : t("shell.browser.reconnectExtension")} disabled={busy} onPress={action === "install" ? onConnect : onReconnect} />
        </box>
      ) : null}
    </StatusBlock>
  );
}

function BrowserPageError({ error, onRetry }: { error: string; onRetry: () => void }) {
  const t = useT();
  return (
    <StatusBlock role="alert" icon={Icons.stella.AlertCircle} title={t("shell.browser.pageErrorTitle")} body={error}>
      <box mt={2}>
        <Button className="pill-btn pill-btn--primary" minW={118} onClick={onRetry}>
          {t("common.tryAgain")}
        </Button>
      </box>
    </StatusBlock>
  );
}

type BrowserTab = BrowserViewState["tabs"][number];

function BrowserTabShell({ tab, active, frozenWidth, others, onLayout, onClose }: { tab: BrowserTab; active: boolean; frozenWidth: number | null; others: BrowserTab[]; onLayout: (id: string, w: number) => void; onClose: (tab: BrowserTab) => void }) {
  const t = useT();
  const tk = useTokens();
  const close = (entry: BrowserTab) => void browserViewApi()?.closeTab({ tabId: entry.id, ownerId: entry.ownerId });
  const title = tab.title || "New tab";
  return (
    <row
      id={`browser-tab-${tab.id}`}
      shrink={frozenWidth === null}
      w={frozenWidth ?? 154}
      minW={frozenWidth ?? 76}
      maxW={frozenWidth ?? 180}
      h={27}
      clip={0}
      corners={[7, 7, 0, 0]}
      fill={active ? tk.c.background : undefined}
      border={active ? tk.c.borderWeak : undefined}
      hover={active ? undefined : mixOklch(tk.c.foreground, 5, "transparent")}
      hoverGroup
      enter={{ opacity: 0, y: 3, scale: 0.98, dur: 0.16 }}
      onLayout={(r) => onLayout(tab.id, r.w)}
      onContextMenu={contextMenu(() => {
        const url = normalizedHttpUrl(tab.url ?? "");
        return [
          [{ label: translateNow("contextMenu.reload"), run: () => browserViewApi()?.reload({ tabId: tab.id, ownerId: tab.ownerId }) }],
          ...(url
            ? [
                [
                  { label: translateNow("contextMenu.openInYourBrowser"), run: () => window.electronAPI?.system?.openExternal?.(url) },
                  { label: translateNow("contextMenu.copyLink"), run: () => copyText(url) },
                ],
              ]
            : []),
          [
            { label: translateNow("contextMenu.closeTab"), run: () => close(tab) },
            { label: translateNow("contextMenu.closeOtherTabs"), enabled: others.length > 0, run: () => others.forEach(close) },
          ],
        ];
      })}
    >
      <row role="tab" label={title} selected={active} title={tab.title || tab.url || "New tab"} focusable grow={1} minW={0} align="center" gap={6} pl={8} pr={25} focusRing={{ width: 2, offset: 0, color: tk.c.ring, radius: 7 }} onPress={() => void browserViewApi()?.selectTab({ tabId: tab.id, ownerId: tab.ownerId, activate: true })}>
        {tab.faviconUrl ? <image src={tab.faviconUrl} label="" w={13} h={13} fit="contain" shrink={false} /> : <Icon icon={Icons.stella.Globe} size={13} strokeWidth={1.75} color={active ? tk.c.textStrong : tk.c.textWeak} />}
        <text {...SM} minW={0} shrink color={active ? tk.c.textStrong : tk.c.textWeak} hoverColor={tk.c.textStrong} nowrap truncate>
          {title}
        </text>
        {tab.agentActive ? (
          <row grow={1} justify="end">
            <image src={agentCursor} label={t("shell.browser.taskUsingTab")} title={t("shell.browser.taskUsingTab")} w={12} h={12.5} fit="contain" inert />
          </row>
        ) : null}
      </row>
      <box
        role="button"
        label={`Close ${tab.title || "tab"}`}
        focusable
        absolute={{ top: 5, right: 5 }}
        w={17}
        h={17}
        center
        radius={4}
        opacity={active ? 1 : undefined}
        hoverOpacity={active ? undefined : [0, 1]}
        hover={mixOklch(tk.c.foreground, 8, "transparent")}
        focusRing={{ width: 2, offset: 0, color: tk.c.ring, radius: 4 }}
        onPress={() => onClose(tab)}
      >
        <Icon icon={Icons.stella.X} size={12} strokeWidth={1.8} color={active ? tk.c.textStrong : tk.c.textWeak} />
      </box>
    </row>
  );
}

const LOADING_BAR = 0.38;

/** desktop-ui's `BrowserSection`: Stella's browser tabs for this chat, with the page drawn by the host's browser view. */
export function BrowserSection() {
  const t = useT();
  const tk = useTokens();
  const chat = useChatRuntime();
  const activeSection = useActiveSidebarSection();
  const panelOpen = useDisplayPanelOpen();
  const fileStageOpen = useFileViewerStageOpen();
  const visible = panelOpen && activeSection === "browser" && !fileStageOpen;
  const [state, setState] = useState<BrowserViewState>(EMPTY_STATE);
  const [connectingExtension, setConnectingExtension] = useState(false);
  const [reconnectingLogins, setReconnectingLogins] = useState(false);
  const [loginBannerDismissed, setLoginBannerDismissed] = useState(() => uiState.getItem(SIGN_IN_HINT_DISMISSED_KEY) === "1");
  const [localError, setLocalError] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [addressFocused, setAddressFocused] = useState(false);
  const [surfaceRect, setSurfaceRect] = useState<Rect | null>(null);
  const [pageRect, setPageRect] = useState<Rect | null>(null);
  const [chromeWidth, setChromeWidth] = useState(0);
  const tabWidths = useRef(new Map<string, number>());
  const [frozenWidths, setFrozenWidths] = useState<Map<string, number> | null>(null);
  const shownRef = useRef(false);
  const lastKeyRef = useRef("");
  const mountedRef = useRef(true);
  const scopedOwnerId = useMemo(() => conversationOwnerId(chat.conversation.conversationId), [chat.conversation.conversationId]);

  const activeTab = useMemo(() => state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0] ?? null, [state.activeTabId, state.tabs]);
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
        if (mountedRef.current) setLocalError(error instanceof Error ? error.message : "Couldn’t check the browser.");
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
        if (mountedRef.current) setLocalError(error instanceof Error ? error.message : "Couldn’t select this chat’s browser tabs.");
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
      if (mountedRef.current) setLocalError(error instanceof Error ? error.message : "Stella couldn’t prepare the browser.");
    }
  }, []);

  useEffect(() => {
    if (visible) void connect();
  }, [connect, visible]);

  const shouldShow = visible && Boolean(activeTabId) && !state.error && !localError;

  useEffect(() => {
    const api = browserViewApi();
    if (!api) return;
    if (!shouldShow || !pageRect || !surfaceRect) {
      if (shownRef.current) void api.hide();
      shownRef.current = false;
      lastKeyRef.current = "";
      return;
    }
    const layout = { pageBounds: toBounds(pageRect), surfaceBounds: toBounds(surfaceRect) };
    if (layout.pageBounds.width <= 0 || layout.pageBounds.height <= 0 || layout.surfaceBounds.width <= 0 || layout.surfaceBounds.height <= 0) return;
    const key = boundsKey(layout);
    if (key === lastKeyRef.current && shownRef.current) return;
    lastKeyRef.current = key;
    if (shownRef.current) void api.setLayout(layout);
    else {
      shownRef.current = true;
      void api.show(layout);
    }
  }, [pageRect, shouldShow, surfaceRect]);

  const requestExtension = useCallback(async () => {
    const api = browserViewApi();
    if (!api || connectingExtension) return;
    setConnectingExtension(true);
    setLocalError(null);
    try {
      await api.requestExtensionConnect();
      await connect();
    } catch (error) {
      if (mountedRef.current) setLocalError(error instanceof Error ? error.message : "Couldn’t connect the extension.");
    } finally {
      if (mountedRef.current) setConnectingExtension(false);
    }
  }, [connect, connectingExtension]);

  const runTabAction = useCallback(
    (action: (api: ElectronBrowserViewApi, tabId: string, ownerId: string) => Promise<unknown>) => {
      if (!activeTab) return;
      const api = browserViewApi();
      if (!api) return;
      setLocalError(null);
      void action(api, activeTab.id, activeTab.ownerId).catch((error: unknown) => {
        if (mountedRef.current) setLocalError(error instanceof Error ? error.message : "Browser action failed.");
      });
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
        if (mountedRef.current) setLocalError(error instanceof Error ? error.message : "Couldn’t create a tab.");
      });
  }, [scopedOwnerId]);

  const navigate = () => {
    const url = normalizeAddress(address);
    if (!url) return;
    runTabAction((api, tabId, ownerId) => api.navigate({ tabId, url, ownerId }));
  };

  const closeTab = (tab: BrowserTab) => {
    if (state.tabs.length > 1) setFrozenWidths((current) => current ?? new Map(tabWidths.current));
    void browserViewApi()?.closeTab({ tabId: tab.id, ownerId: tab.ownerId });
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

  const chromeFill = mixOklch(tk.c.background, 96, tk.c.foreground);
  const barWidth = chromeWidth * LOADING_BAR;

  return (
    <col id="browser-section" role="region" label="Browser" grow={1} minW={0} minH={0} clip={0} onLayout={setSurfaceRect}>
      {activeTab ? (
        <>
          <col id="browser-section-chrome" shrink={false} raise={2} fill={chromeFill} border={tk.c.borderWeak} borderSides={[0, 0, 1, 0]} onLayout={(r) => setChromeWidth(r.w)}>
            <row id="browser-section-tabs" role="tablist" label="Browser tabs" align="end" gap={2} minW={0} h={32} pt={4} px={6} scrollX onHover={(inside) => (!inside ? setFrozenWidths(null) : undefined)}>
              {state.tabs.map((tab) => (
                <BrowserTabShell key={tab.id} tab={tab} active={tab.id === activeTab.id} frozenWidth={frozenWidths?.get(tab.id) ?? null} others={state.tabs.filter((entry) => entry.id !== tab.id)} onLayout={(id, w) => tabWidths.current.set(id, w)} onClose={closeTab} />
              ))}
              <box selfAlign="center" mx={2} mb={1}>
                <ChromeButton id="browser-section-new-tab" label="New tab" icon={Icons.stella.Plus} onPress={createConversationTab} />
              </box>
            </row>
            <row id="browser-section-navigation" align="center" gap={2} h={36} pt={4} px={6} pb={5}>
              <ChromeButton id="browser-section-back" label="Go back" title="Back" icon={Icons.stella.ArrowLeft} disabled={!activeTab.canGoBack} onPress={() => runTabAction((api, tabId, ownerId) => api.goBack({ tabId, ownerId }))} />
              <ChromeButton id="browser-section-forward" label="Go forward" title="Forward" icon={Icons.stella.ArrowRight} disabled={!activeTab.canGoForward} onPress={() => runTabAction((api, tabId, ownerId) => api.goForward({ tabId, ownerId }))} />
              <ChromeButton id="browser-section-reload" label="Reload page" title="Reload" icon={Icons.stella.RefreshCw} spin={activeTab.loading ? 1.1 : undefined} onPress={() => runTabAction((api, tabId, ownerId) => api.reload({ tabId, ownerId }))} />
              <row
                id="browser-section-address"
                grow={1}
                align="center"
                gap={6}
                minW={76}
                h={27}
                ml={3}
                px={9}
                radius={8}
                border={addressFocused ? mixOklch(tk.c.primary, 38, tk.c.borderWeak) : tk.c.borderWeak}
                fill={addressFocused ? tk.c.background : mixOklch(tk.c.foreground, 3.5, "transparent")}
                shadows={addressFocused ? [{ x: 0, y: 0, blur: 0, spread: 2, color: tk.c.ring }] : undefined}
                motion={{ dur: 0.12 }}
              >
                <Icon icon={Icons.stella.Globe} size={13} strokeWidth={1.7} color={addressFocused ? tk.c.textBase : tk.c.textWeak} />
                <input id="browser-section-address-input" grow={1} minW={0} value={address} label="Address and search" spellcheck={false} selectOnFocus {...SM} color={tk.c.textBase} onInput={setAddress} onSubmit={navigate} onFocus={(focused) => setAddressFocused(focused)} />
              </row>
            </row>
            {activeTab.loading && barWidth > 0 ? (
              <box absolute={{ left: 0, right: 0, bottom: -1 }} h={2} clip={0} inert>
                <box w={barWidth} h="full" radius={999} fill={tk.c.primary} loop={{ kind: "slide", period: 1.15, from: [-1.1 * barWidth, 0], to: [3.65 * barWidth, 0] }} />
              </box>
            ) : null}
          </col>
          {loginBannerDismissed ? null : <BrowserLoginBanner state={state} busy={loginBusy} onConnect={() => void requestExtension()} onReconnect={reconnectLogins} onDismiss={dismissLoginBanner} />}
          <col id="browser-section-page" role="document" grow={1} minW={0} minH={0} clip={0} fill={tk.c.background} onLayout={setPageRect}>
            {error ? <BrowserPageError error={error} onRetry={retryPage} /> : null}
          </col>
        </>
      ) : (
        <BrowserEmptyState state={state} error={error ?? undefined} busy={loginBusy} onCreateTab={createConversationTab} onConnect={() => void requestExtension()} onReconnect={reconnectLogins} />
      )}
    </col>
  );
}
