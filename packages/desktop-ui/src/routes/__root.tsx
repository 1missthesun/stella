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
import { ChatMessageAlerts } from "@/features/chat-alerts/ChatMessageAlerts";
import { FirstReplyCounter } from "@/features/anonymous-counts/FirstReplyCounter";
import { ANONYMOUS_COUNTS_ENABLED } from "@stella/contracts/telemetry/anonymous-counts";
import { useChatRuntime } from "@/context/use-chat-runtime";
import { useUiState } from "@/context/ui-state";
import { ChatColumn } from "@/app/chat/ChatColumn";
import { OPEN_CONNECT_DIALOG_EVENT } from "@/global/integrations/connect-action";
import { conversationTabs } from "@/features/chat/services/conversation-tabs-store";
import { useCloudConversationSession } from "@/global/auth/hooks/use-cloud-conversation-session";
import { useShellConversationSource } from "@/global/auth/hooks/use-shell-conversation-source";
import {
  cloudConversationBelongsToOwnerSubject,
  resolveCloudConversationForShell,
  resolveCloudConversationRoute,
} from "@/features/cloud/cloud-conversation-selection";
import {
  readActiveCloudConversationIdCache,
  writeActiveCloudConversationIdCache,
} from "@/features/cloud/cloud-conversation-cache";
import { retireCloudConversationClientAuthority } from "@/features/cloud/conversation-store";
import { cloudAttachmentsStore } from "@/features/cloud/cloud-composer-store";
import { retireCloudExecutionClientAuthority } from "@/features/cloud/cloud-execution-store";
import type { WorkspaceStageHandle } from "@/shell/workspace-stage/WorkspaceStage";
const WorkspaceStage = lazy(() =>
  import("@/shell/workspace-stage/WorkspaceStage").then((m) => ({
    default: m.WorkspaceStage,
  })),
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
import { fileViewer } from "@/features/workspace-display/file-viewer-store";
import {
  CHAT_DISPLAY_TAB_ID,
  ensureChatDisplayTab,
  openChatDisplayTab,
} from "@/shell/display/default-tabs";
import { FullShellDialogs } from "@/shell/full-shell-dialogs";
import { SettingsDialogHost } from "@/shell/SettingsDialogHost";
import { FeedbackDialogHost } from "@/shell/FeedbackDialogHost";
import { PlanUsageDialogHost } from "@/shell/PlanUsageDialogHost";
import { SelfHostPairScreen } from "@/global/self-host/SelfHostPairScreen";
import { SignInScreen } from "@/global/auth/SignInScreen";
import { SignedOutLocalChoice } from "@/global/local-mode/SignedOutLocalChoice";
import { SignOutDialog } from "@/global/auth/SignOutDialog";
import { AccountSwitchGuard } from "@/global/local-mode/AccountSwitchGuard";
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
  const pausedConversationId =
    !isPrivate && cloudSession.isCloudConversationPaused
      ? readActiveCloudConversationIdCache(accountScope)
      : null;
  const conversationId = isPrivate
    ? privateSelection?.intent === routeIntent
      ? privateSelection.id
      : null
    : pausedConversationId
      ? pausedConversationId
      : !isAuthLoading &&
        isCloudConversationReady &&
        !shellConversationSelectionIsLoading
      ? resolveCloudConversationForShell({
          isOnChatRoute,
          conversations: ownedCloudConversationCandidates,
          routeConversationId: routerConversationId,
          mainConversationId: mainCloudConversationId,
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
      isPrivate
        ? "local"
        : isCloudConversationReady || cloudSession.isCloudConversationPaused
          ? accountScope
          : null,
    );
    setConversationId(null);
  }, [
    accountScope,
    settledAccountScope,
    isPrivate,
    isCloudConversationReady,
    cloudSession.isCloudConversationPaused,
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
    if (routeIsOwnedCloudConversation && routerConversationId) return;
    if (mainOwnershipIsLoading || !mainCloudConversationId) return;
    const fallbackConversationId = resolveCloudConversationRoute({
      conversations: ownedCloudConversationCandidates,
      routeConversationId: routerConversationId,
      mainConversationId: mainCloudConversationId,
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

  if (authBootstrapStatus === "signed_out" && !isPrivate) {
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
      <SignOutDialog />
      <AccountSwitchGuard />
      <SignedOutLocalChoice
        signedIn={authBootstrapStatus === "ready"}
        isPrivate={isPrivate}
        conversationId={conversationId}
      />
      <ChatRuntimeProvider
        activeConversationId={conversationId}
        isOnChatRoute={isOnChatRoute}
      >
        {platformCapabilities.nativeBridges ? (
          <ChatMessageAlerts conversationId={conversationId} isOnChatRoute={isOnChatRoute} />
        ) : null}
        {platformCapabilities.nativeBridges && ANONYMOUS_COUNTS_ENABLED ? (
          <FirstReplyCounter />
        ) : null}
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

  const rightSidebarRef = useRef<WorkspaceStageHandle>(null);

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isOnChatRoute = pathname === "/chat";



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

  // The Chat tab shows in the viewer only while you're away from the chat;
  // coming back to it puts that copy away.
  useEffect(() => {
    if (isOnChatRoute && fileViewer.getSnapshot().fileId === CHAT_DISPLAY_TAB_ID) {
      fileViewer.close();
    }
  }, [isOnChatRoute]);

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

      {/* Tabs on the stage and the floating file viewer, both over the chat.
          The Models and run-location controls live in the top bar. */}
      <Suspense fallback={null}>
        <WorkspaceStage ref={rightSidebarRef} />
      </Suspense>

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
