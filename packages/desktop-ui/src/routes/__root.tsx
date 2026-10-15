import {
  useChatStorageMode,
  selectPrivateConversation,
} from "@/features/chat/services/chat-storage-preference";
import {
  createRootRoute,
  Outlet,
  useMatchRoute,
  useNavigate,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { z } from "zod";
import { ChatRuntimeProvider } from "@/context/chat-runtime";
import { useChatRuntime } from "@/context/use-chat-runtime";
import { useUiState } from "@/context/ui-state";
import { ChatColumn } from "@/app/chat/ChatColumn";
import { OPEN_CONNECT_DIALOG_EVENT } from "@/global/integrations/connect-action";
import { conversationTabs } from "@/features/chat/services/conversation-tabs-store";
import { useCloudConversationSession } from "@/global/auth/hooks/use-cloud-conversation-session";
import { useShellConversationSource } from "@/global/auth/hooks/use-shell-conversation-source";
import { SIGN_IN_TOAST_ACTION } from "@/shared/lib/auth-cta";
import {
  acknowledgeCloudConversation,
  cloudConversationBelongsToOwnerSubject,
  resolveCloudConversationForShell,
  resolveCloudConversationRoute,
} from "@/features/cloud/cloud-conversation-selection";
import { writeActiveCloudConversationIdCache } from "@/features/cloud/cloud-conversation-cache";
import { retireCloudConversationClientAuthority } from "@/features/cloud/conversation-store";
import { cloudAttachmentsStore } from "@/features/cloud/cloud-composer-store";
import { retireCloudExecutionClientAuthority } from "@/features/cloud/cloud-execution-store";
import type { RightSidebarHandle } from "@/shell/RightSidebar";
const RightSidebar = lazy(() =>
  import("@/shell/RightSidebar").then((m) => ({ default: m.RightSidebar })),
);
const ProviderConnectedDialog = lazy(() =>
  import("@/global/settings/ProviderConnectedDialog").then((m) => ({
    default: m.ProviderConnectedDialog,
  })),
);
const DictationKeyDialog = lazy(() =>
  import("@/features/dictation/components/DictationKeyDialog").then((m) => ({
    default: m.DictationKeyDialog,
  })),
);
const SubscriptionUpgradeDialog = lazy(() =>
  import("@/global/billing/SubscriptionUpgradeDialog").then((m) => ({
    default: m.SubscriptionUpgradeDialog,
  })),
);
import { ShellTopBarFull } from "@/shell/ShellTopBarFull";
import { GlobalModelsControl } from "@/shell/GlobalModelsControl";
import { DisplayPanelTopBar } from "@/shell/DisplayPanelTopBar";
import {
  displayTabs,
  useDisplayPanelExpanded,
  useDisplayPanelOpen,
} from "@/features/workspace-display/tab-store";
import {
  CHAT_DISPLAY_TAB_ID,
  HOME_DISPLAY_TAB_ID,
  ensureChatDisplayTab,
  openChatDisplayTab,
  openHomeDisplayTab,
} from "@/shell/display/default-tabs";
import { FullShellDialogs } from "@/shell/full-shell-dialogs";
import { SettingsDialogHost } from "@/shell/SettingsDialogHost";
import { FeedbackDialogHost } from "@/shell/FeedbackDialogHost";
import { PlanUsageDialogHost } from "@/shell/PlanUsageDialogHost";
import { SelfHostPairScreen } from "@/global/self-host/SelfHostPairScreen";
import { SignInScreen } from "@/global/auth/SignInScreen";
import {
  STELLA_COMPOSE_TEXT_EVENT,
  type StellaComposeTextDetail,
} from "@/shared/lib/stella-orb-chat";
import { useRestrictedStellaModelReset } from "@/global/settings/hooks/use-restricted-stella-model-reset";
import { MobileActivityNotificationsBridge } from "@/global/mobile/MobileActivityNotificationsBridge";
import { ScheduleZoneReporter } from "@/features/schedule/use-schedule-zone";
import { useDictationToggleBridge } from "@/shell/root-chrome/use-dictation-toggle-bridge";
import { CompanionBridge } from "@/shell/companion/use-companion-bridge";
import { useDisplayPayloadRouting } from "@/shell/root-chrome/use-display-payload-routing";
import { useLastLocationRestore } from "@/shell/root-chrome/use-last-location-restore";
import { usePersistLastLocation } from "@/shell/root-chrome/use-persist-last-location";
import {
  shellBreakpointStore,
  useShellBreakpointState,
} from "@/shell/shell-breakpoints";
import "@/shell/error-boundary.css";
import { platformCapabilities } from "@/platform/capabilities";
import { dismissLaunchSplash } from "@/shell/launch-splash";
import { usePendingDiscoveryWelcome } from "@/global/onboarding/chat/pending-handoff";

function CloudStartupFailure({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="error-boundary" role="alert">
      <div className="error-boundary-gradient" />
      <div className="error-boundary-content">
        <h2>Stella couldn&apos;t start chat</h2>
        <p>{message}</p>
        <div className="error-boundary-actions">
          <button
            className="error-boundary-btn error-boundary-btn--fix"
            onClick={onRetry}
            type="button"
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}

function RootLayout() {
  const { state, setConversationId } = useUiState();
  const storageMode = useChatStorageMode();
  const isPrivate = storageMode === "local";
  const [privateSelectionError, setPrivateSelectionError] = useState<
    string | null
  >(null);
  const [privateSelectionAttempt, setPrivateSelectionAttempt] = useState(0);
  const [privateSelection, setPrivateSelection] = useState<{
    intent: string;
    id: string;
  } | null>(null);
  const cloudSession = useCloudConversationSession();
  const {
    error: authBootstrapError,
    authBootstrapStatus,
    accountScope,
    ownerSubject,
    retryAuthBootstrap,
    refreshMainConversation,
  } = cloudSession;
  const matchRoute = useMatchRoute();
  const isOnChatRoute = Boolean(matchRoute({ to: "/chat" }));
  const routerConversationId = useRouterState({
    select: (s) =>
      s.location.pathname === "/chat"
        ? ((s.location.search as { c?: string }).c ?? null)
        : null,
  });
  const router = useRouter();
  const routeIntent = `${isOnChatRoute ? "chat" : "other"}:${routerConversationId ?? ""}`;
  useEffect(() => {
    if (!isPrivate) {
      setPrivateSelection(null);
      return;
    }
    let canceled = false;
    setPrivateSelectionError(null);
    void selectPrivateConversation(routerConversationId)
      .then((id) => {
        if (canceled) return;
        setPrivateSelection({ intent: routeIntent, id });
        if (isOnChatRoute && routerConversationId !== id) {
          void router.navigate({
            to: "/chat",
            search: { c: id },
            replace: true,
          });
        }
      })
      .catch((error) => {
        if (!canceled)
          setPrivateSelectionError(
            error instanceof Error
              ? error.message
              : "Couldn’t open chat history on this computer.",
          );
      });
    return () => {
      canceled = true;
    };
  }, [
    isPrivate,
    routeIntent,
    routerConversationId,
    isOnChatRoute,
    router,
    privateSelectionAttempt,
  ]);
  const {
    isCloudConversationReady,
    isLoading: isAuthLoading,
    cloudConversations,
    scopedCloudConversations,
    mainCloudConversationId,
    routeIsListedOrPendingCloudConversation,
    exactCloudConversation,
    mainConversationIsListed,
    exactMainCloudConversation,
  } = useShellConversationSource({
    session: cloudSession,
    isPrivate,
    routeConversationId: routerConversationId,
  });
  const refreshedMainConversationRef = useRef<string | null>(null);
  const [mainConversationFailure, setMainConversationFailure] = useState<{
    accountScope: string;
    conversationId: string;
  } | null>(null);

  const routeOwnershipIsLoading = Boolean(
    isCloudConversationReady &&
      routerConversationId &&
      !routeIsListedOrPendingCloudConversation &&
      exactCloudConversation === undefined,
  );
  const mainOwnershipIsLoading = Boolean(
    isCloudConversationReady &&
      mainCloudConversationId &&
      mainCloudConversationId !== routerConversationId &&
      !mainConversationIsListed &&
      exactMainCloudConversation === undefined,
  );
  const routeIsOwnedCloudConversation =
    routeIsListedOrPendingCloudConversation ||
    (exactCloudConversation?.conversationId === routerConversationId &&
      cloudConversationBelongsToOwnerSubject(
        exactCloudConversation,
        ownerSubject,
      ));
  const scopedExactCloudConversation =
    exactCloudConversation &&
    cloudConversationBelongsToOwnerSubject(exactCloudConversation, ownerSubject)
      ? exactCloudConversation
      : null;
  const scopedExactMainCloudConversation =
    exactMainCloudConversation &&
    cloudConversationBelongsToOwnerSubject(
      exactMainCloudConversation,
      ownerSubject,
    )
      ? exactMainCloudConversation
      : null;
  const ownedCloudConversationCandidates = useMemo(
    () => [
      ...(scopedExactCloudConversation ? [scopedExactCloudConversation] : []),
      ...(scopedExactMainCloudConversation
        ? [scopedExactMainCloudConversation]
        : []),
      ...scopedCloudConversations,
    ],
    [
      scopedCloudConversations,
      scopedExactCloudConversation,
      scopedExactMainCloudConversation,
    ],
  );
  const shellConversationSelectionIsLoading =
    cloudConversations === undefined ||
    (isOnChatRoute ? routeOwnershipIsLoading : mainOwnershipIsLoading);
  const conversationId = isPrivate
    ? privateSelection?.intent === routeIntent
      ? privateSelection.id
      : null
    : !isAuthLoading &&
        isCloudConversationReady &&
        !shellConversationSelectionIsLoading
      ? resolveCloudConversationForShell({
          isOnChatRoute,
          conversations: ownedCloudConversationCandidates,
          routeConversationId: routerConversationId,
          mainConversationId: mainCloudConversationId,
          accountScope,
          ownerSubject,
        })
      : null;
  usePendingDiscoveryWelcome(conversationId);

  const settledAccountScope = cloudSession.sessionGate.sessionIsLoading
    ? null
    : accountScope;
  useLayoutEffect(() => {
    refreshedMainConversationRef.current = null;
    setMainConversationFailure(null);
    if (settledAccountScope !== null) {
      retireCloudConversationClientAuthority(settledAccountScope);
      retireCloudExecutionClientAuthority(settledAccountScope);
    }
    cloudAttachmentsStore.clear();
    conversationTabs.setAccountScope(
      isPrivate ? "local" : isCloudConversationReady ? accountScope : null,
    );
    setConversationId(null);
  }, [
    accountScope,
    settledAccountScope,
    isPrivate,
    isCloudConversationReady,
    setConversationId,
  ]);

  useLayoutEffect(() => {
    if (state.conversationId !== conversationId) {
      setConversationId(conversationId);
    }
  }, [conversationId, setConversationId, state.conversationId]);

  const retryMainConversation = useCallback(() => {
    refreshedMainConversationRef.current = null;
    setMainConversationFailure(null);
    refreshMainConversation();
  }, [refreshMainConversation]);

  useEffect(() => {
    if (isAuthLoading || !isOnChatRoute || !isCloudConversationReady) return;
    if (cloudConversations === undefined || routeOwnershipIsLoading) return;
    for (const item of scopedCloudConversations) {
      acknowledgeCloudConversation(item.conversationId);
    }
    if (routeIsOwnedCloudConversation && routerConversationId) return;
    if (mainOwnershipIsLoading || !mainCloudConversationId) return;
    const fallbackConversationId = resolveCloudConversationRoute({
      conversations: ownedCloudConversationCandidates,
      routeConversationId: routerConversationId,
      mainConversationId: mainCloudConversationId,
      accountScope,
      ownerSubject,
    });
    if (fallbackConversationId) {
      refreshedMainConversationRef.current = null;
      setMainConversationFailure(null);
      void router.navigate({
        to: "/chat",
        search: { c: fallbackConversationId },
        replace: true,
      });
      return;
    }
    if (refreshedMainConversationRef.current === mainCloudConversationId) {
      setMainConversationFailure({
        accountScope,
        conversationId: mainCloudConversationId,
      });
      return;
    }
    refreshedMainConversationRef.current = mainCloudConversationId;
    refreshMainConversation();
  }, [
    accountScope,
    cloudConversations,
    isAuthLoading,
    isCloudConversationReady,
    isOnChatRoute,
    mainCloudConversationId,
    mainOwnershipIsLoading,
    ownedCloudConversationCandidates,
    ownerSubject,
    refreshMainConversation,
    routeIsOwnedCloudConversation,
    routeOwnershipIsLoading,
    router,
    routerConversationId,
    scopedCloudConversations,
  ]);

  useEffect(() => {
    if (!conversationId || isAuthLoading || !isCloudConversationReady) return;
    writeActiveCloudConversationIdCache(accountScope, conversationId);
  }, [accountScope, isCloudConversationReady, conversationId, isAuthLoading]);

  useLastLocationRestore(router);
  usePersistLastLocation(router);

  const showsMainConversationFailure = Boolean(
    isOnChatRoute &&
      !conversationId &&
      mainConversationFailure?.accountScope === accountScope &&
      mainConversationFailure.conversationId === mainCloudConversationId,
  );
  const shellIsLive =
    conversationId !== null || (!isOnChatRoute && isCloudConversationReady);
  const shouldDismissLaunchSplash =
    shellIsLive ||
    Boolean(authBootstrapError) ||
    showsMainConversationFailure ||
    authBootstrapStatus === "reauth_required" ||
    authBootstrapStatus === "signed_out" ||
    authBootstrapStatus === "needs_pairing";
  useEffect(() => {
    if (shouldDismissLaunchSplash) dismissLaunchSplash();
  }, [shouldDismissLaunchSplash]);

  if (isPrivate && privateSelectionError) {
    return (
      <CloudStartupFailure
        message={privateSelectionError}
        onRetry={() => setPrivateSelectionAttempt((attempt) => attempt + 1)}
      />
    );
  }

  if (authBootstrapStatus === "needs_pairing") {
    return <SelfHostPairScreen />;
  }

  if (authBootstrapStatus === "signed_out") {
    return <SignInScreen />;
  }

  if (!isPrivate && authBootstrapError) {
    return (
      <CloudStartupFailure
        message={authBootstrapError}
        onRetry={retryAuthBootstrap}
      />
    );
  }

  if (showsMainConversationFailure) {
    return (
      <CloudStartupFailure
        message="Stella couldn't open your conversation."
        onRetry={retryMainConversation}
      />
    );
  }

  return (
    <>
      {authBootstrapStatus === "reauth_required" ? (
        <div
          role="status"
          style={{
            position: "fixed",
            zIndex: 10000,
            left: "50%",
            top: 12,
            transform: "translateX(-50%)",
            padding: "8px 14px",
            borderRadius: 999,
            background: "rgba(32, 28, 39, 0.94)",
            color: "white",
            fontSize: 13,
            boxShadow: "0 8px 30px rgba(0, 0, 0, 0.3)",
          }}
        >
          Your session expired.{" "}
          <button
            type="button"
            onClick={SIGN_IN_TOAST_ACTION.onClick}
            style={{
              margin: 0,
              padding: 0,
              border: 0,
              background: "transparent",
              color: "inherit",
              font: "inherit",
              textDecoration: "underline",
              cursor: "pointer",
            }}
          >
            Sign in again
          </button>{" "}
          to reconnect your account.
        </div>
      ) : null}
      <ChatRuntimeProvider
        activeConversationId={conversationId}
        isOnChatRoute={isOnChatRoute}
      >
        <RootChrome conversationId={conversationId} />
      </ChatRuntimeProvider>
    </>
  );
}

function RootChrome({ conversationId }: { conversationId: string | null }) {
  useRestrictedStellaModelReset();

  const navigate = useNavigate();
  const { dialog: activeDialog } = Route.useSearch();
  const chat = useChatRuntime();
  const panelOpen = useDisplayPanelOpen();
  const panelExpanded = useDisplayPanelExpanded();
  const shellBreakpoints = useShellBreakpointState();
  const modelControlVisible = panelOpen;
  const panelExpandedBeforeTakeoverRef = useRef<boolean | null>(null);
  const displayBreakpointTransitionTimeoutRef = useRef<number | null>(null);

  const rightSidebarRef = useRef<RightSidebarHandle>(null);

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isOnChatRoute = pathname === "/chat";

  const triggerDisplayBreakpointTransition = useCallback(() => {
    document.body.dataset.displayBreakpointTransition = "true";
    if (displayBreakpointTransitionTimeoutRef.current !== null) {
      window.clearTimeout(displayBreakpointTransitionTimeoutRef.current);
    }
    displayBreakpointTransitionTimeoutRef.current = window.setTimeout(() => {
      displayBreakpointTransitionTimeoutRef.current = null;
      delete document.body.dataset.displayBreakpointTransition;
    }, 520);
  }, []);

  useEffect(
    () => () => {
      if (displayBreakpointTransitionTimeoutRef.current !== null) {
        window.clearTimeout(displayBreakpointTransitionTimeoutRef.current);
        displayBreakpointTransitionTimeoutRef.current = null;
      }
      delete document.body.dataset.displayBreakpointTransition;
    },
    [],
  );

  useEffect(() => {
    window.electronAPI?.window.setNativeButtonsVisible?.(true);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.shellPanelChrome = "true";
    return () => {
      delete root.dataset.shellPanelChrome;
    };
  }, []);

  const setDialogSearch = useCallback(
    (next: "auth" | "connect" | undefined) => {
      void navigate({
        to: ".",
        search: (prev: Record<string, unknown> | undefined) => ({
          ...(prev ?? {}),
          dialog: next,
        }),
      });
    },
    [navigate],
  );

  const showAuthDialog = useCallback(
    () => setDialogSearch("auth"),
    [setDialogSearch],
  );
  const showConnectDialog = useCallback(
    () => setDialogSearch("connect"),
    [setDialogSearch],
  );
  const closeDialog = useCallback(
    () => setDialogSearch(undefined),
    [setDialogSearch],
  );

  useEffect(() => {
    const handler = () => showConnectDialog();
    window.addEventListener(OPEN_CONNECT_DIALOG_EVENT, handler);
    return () => window.removeEventListener(OPEN_CONNECT_DIALOG_EVENT, handler);
  }, [showConnectDialog]);

  const handleDialogOpenChange = useCallback(
    (open: boolean) => {
      if (!open) closeDialog();
    },
    [closeDialog],
  );

  useEffect(() => {
    const handleComposeText = (event: Event) => {
      const detail = (event as CustomEvent<StellaComposeTextDetail>).detail;
      const text = typeof detail?.text === "string" ? detail.text : "";
      const hasPrefillText = Boolean(text.trim());
      const hasChatContext = Object.prototype.hasOwnProperty.call(
        detail,
        "chatContext",
      );
      const hasSelectedText = Object.prototype.hasOwnProperty.call(
        detail,
        "selectedText",
      );
      if (!hasPrefillText && !hasChatContext && !hasSelectedText) return;

      const selectedTextContext =
        hasSelectedText && detail.selectedText
          ? {
              window: null,
              browserUrl: null,
              selectedText: detail.selectedText,
              regionScreenshots: [],
            }
          : null;
      const nextChatContext = hasChatContext
        ? (detail.chatContext ?? null)
        : selectedTextContext;

      if (isOnChatRoute) {
        if (hasPrefillText) {
          chat.composer.setMessage(text);
        }
        if (hasChatContext || selectedTextContext) {
          chat.composer.setChatContext(nextChatContext);
        }
        if (hasSelectedText) {
          chat.composer.setSelectedText(detail.selectedText ?? null);
        }
        chat.composer.requestFocus?.();
        return;
      }

      openChatDisplayTab({
        id: Date.now(),
        chatContext: nextChatContext,
        ...(hasPrefillText ? { prefillText: text } : {}),
      });
    };

    window.addEventListener(STELLA_COMPOSE_TEXT_EVENT, handleComposeText);
    return () => {
      window.removeEventListener(STELLA_COMPOSE_TEXT_EVENT, handleComposeText);
    };
  }, [chat.composer, isOnChatRoute]);

  useEffect(() => {
    ensureChatDisplayTab();
  }, []);

  useDisplayPayloadRouting({
    rightSidebarRef,
  });

  useDictationToggleBridge();

  useEffect(() => {
    const { panelOpen, activeTabId } = displayTabs.getSnapshot();
    if (!panelOpen) return;
    const isDefaultSurface =
      activeTabId === CHAT_DISPLAY_TAB_ID ||
      activeTabId === HOME_DISPLAY_TAB_ID;
    if (!isDefaultSurface) return;
    if (isOnChatRoute) {
      if (activeTabId !== HOME_DISPLAY_TAB_ID) openHomeDisplayTab();
    } else if (activeTabId !== CHAT_DISPLAY_TAB_ID) {
      displayTabs.activateTab(CHAT_DISPLAY_TAB_ID);
    }
  }, [isOnChatRoute]);

  useEffect(() => {
    const root = document.documentElement;
    if (panelOpen) root.dataset.displayPanelOpen = "true";
    else delete root.dataset.displayPanelOpen;

    if (panelOpen && panelExpanded) root.dataset.displayPanelExpanded = "true";
    else delete root.dataset.displayPanelExpanded;

    return () => {
      delete root.dataset.displayPanelOpen;
      delete root.dataset.displayPanelExpanded;
    };
  }, [panelExpanded, panelOpen]);

  useEffect(() => {
    const root = document.documentElement;
    let active = false;
    let timeout = 0;

    const clearActive = () => {
      active = false;
      timeout = 0;
      delete root.dataset.shellWindowResizing;
    };

    const onResize = () => {
      if (!active) {
        active = true;
        root.dataset.shellWindowResizing = "true";
      }
      window.clearTimeout(timeout);
      timeout = window.setTimeout(clearActive, 140);
    };

    window.addEventListener("resize", onResize, { passive: true });
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("resize", onResize);
      delete root.dataset.shellWindowResizing;
    };
  }, []);

  const applyShellBreakpoints = useCallback((width: number) => {
    shellBreakpointStore.setWidth(width);
  }, []);

  const shellWidthRef = useRef(0);

  useEffect(() => {
    const shell = document.querySelector<HTMLElement>(".full-body");
    if (!shell) return;

    let frame = 0;
    const syncWidth = (width: number) => {
      shellWidthRef.current = width;
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        applyShellBreakpoints(shellWidthRef.current);
      });
    };

    syncWidth(shell.getBoundingClientRect().width);

    if (typeof ResizeObserver === "undefined") {
      const onResize = () => syncWidth(shell.getBoundingClientRect().width);
      window.addEventListener("resize", onResize);
      return () => {
        cancelAnimationFrame(frame);
        window.removeEventListener("resize", onResize);
      };
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      syncWidth(entry.contentRect.width);
    });
    observer.observe(shell);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [applyShellBreakpoints]);

  useEffect(() => {
    const root = document.documentElement;
    if (shellBreakpoints.displayPanelTakeover) {
      root.dataset.displayPanelTakeover = "true";
    } else {
      delete root.dataset.displayPanelTakeover;
    }
    return () => {
      delete root.dataset.displayPanelTakeover;
    };
  }, [shellBreakpoints.displayPanelTakeover]);

  useEffect(() => {
    const { panelExpanded } = displayTabs.getSnapshot();
    if (shellBreakpoints.displayPanelTakeover) {
      if (panelExpandedBeforeTakeoverRef.current === null) {
        panelExpandedBeforeTakeoverRef.current = panelExpanded;
      }
      if (panelExpanded) {
        triggerDisplayBreakpointTransition();
        displayTabs.setPanelExpanded(false);
      }
      return;
    }

    const restoreExpanded = panelExpandedBeforeTakeoverRef.current;
    panelExpandedBeforeTakeoverRef.current = null;
    if (restoreExpanded && !panelExpanded) {
      triggerDisplayBreakpointTransition();
      displayTabs.setPanelExpanded(true);
    }
  }, [
    panelExpanded,
    shellBreakpoints.displayPanelTakeover,
    triggerDisplayBreakpointTransition,
  ]);

  return (
    <>
      {/* A leaf, so its timeline subscription never re-renders this chrome. */}
      <CompanionBridge conversationId={conversationId} />
      <ScheduleZoneReporter />
      {platformCapabilities.phoneAccess ? (
        <MobileActivityNotificationsBridge />
      ) : null}

      <div className="content-area">
        <div
          className={`persistent-chat-surface${isOnChatRoute ? " persistent-chat-surface--active" : ""}`}
          aria-hidden={!isOnChatRoute}
        >
          <ChatColumn
            conversation={chat.conversation}
            composer={chat.composer}
            scroll={chat.scroll}
            conversationId={conversationId}
            showHomeContent={chat.showHomeContent}
          />
        </div>
        <div
          className={`route-outlet-surface${isOnChatRoute ? "" : " route-outlet-surface--active"}`}
          aria-hidden={isOnChatRoute}
        >
          <Outlet />
        </div>
      </div>

      <ShellTopBarFull onSignIn={showAuthDialog} />

      <DisplayPanelTopBar />

      <Suspense fallback={null}>
        <RightSidebar ref={rightSidebarRef} />
      </Suspense>

      {/* Global bottom-right Models control — top-level, not owned by the
          right sidebar (state/overlay/lifecycle stay global), but its on-screen
          visibility follows the display panel so it never creates an empty
          right gutter when there is nothing on the right. */}
      <GlobalModelsControl visible={modelControlVisible} />

      <FullShellDialogs
        activeDialog={activeDialog ?? null}
        onDialogOpenChange={handleDialogOpenChange}
      />

      <SettingsDialogHost />

      <FeedbackDialogHost />

      <PlanUsageDialogHost />

      <Suspense fallback={null}>
        <ProviderConnectedDialog />
      </Suspense>

      <Suspense fallback={null}>
        <DictationKeyDialog />
      </Suspense>

      <Suspense fallback={null}>
        <SubscriptionUpgradeDialog />
      </Suspense>
    </>
  );
}

const RootSearch = z.object({
  dialog: z.enum(["auth", "connect"]).optional(),
});

export const Route = createRootRoute({
  validateSearch: RootSearch,
  component: RootLayout,
});
