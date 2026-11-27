import { useChatStorageMode, selectPrivateConversation } from "@/features/chat/services/chat-storage-preference";
import { Outlet, useMatchRoute, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ChatRuntimeProvider } from "@/context/chat-runtime";
import { ChatMessageAlerts } from "@/features/chat-alerts/ChatMessageAlerts";
import { FirstReplyCounter } from "@/features/anonymous-counts/FirstReplyCounter";
import { UsageNudges } from "@/features/nudges/UsageNudges";
import { ANONYMOUS_COUNTS_ENABLED } from "@stella/contracts/telemetry/anonymous-counts";
import { useChatRuntime } from "@/context/use-chat-runtime";
import { useUiState } from "@/context/ui-state";
import { OPEN_CONNECT_DIALOG_EVENT } from "@/global/integrations/connect-action";
import { conversationTabs } from "@/features/chat/services/conversation-tabs-store";
import { setNotificationAccountScope } from "@/features/notifications/notification-store";
import { useCloudConversationSession } from "@/global/auth/hooks/use-cloud-conversation-session";
import { useShellConversationSource } from "@/global/auth/hooks/use-shell-conversation-source";
import { cloudConversationBelongsToOwnerSubject, resolveCloudConversationForShell, resolveCloudConversationRoute } from "@/features/cloud/cloud-conversation-selection";
import { readActiveCloudConversationIdCache, writeActiveCloudConversationIdCache } from "@/features/cloud/cloud-conversation-cache";
import { retireCloudConversationClientAuthority } from "@/features/cloud/conversation-store";
import { cloudAttachmentsStore } from "@/features/cloud/cloud-composer-store";
import { retireCloudExecutionClientAuthority } from "@/features/cloud/cloud-execution-store";
import type { WorkspaceStageHandle } from "@/shell/workspace-stage/WorkspaceStage";
import { fileViewer } from "@/features/workspace-display/file-viewer-store";
import { CHAT_DISPLAY_TAB_ID, ensureChatDisplayTab, openChatDisplayTab } from "@/shell/display/default-tabs";
import { STELLA_COMPOSE_TEXT_EVENT, type StellaComposeTextDetail } from "@/shared/lib/stella-orb-chat";
import { useRestrictedStellaModelReset } from "@/global/settings/hooks/use-restricted-stella-model-reset";
import { MobileActivityNotificationsBridge } from "@/global/mobile/MobileActivityNotificationsBridge";
import { ScheduleZoneReporter } from "@/features/schedule/use-schedule-zone";
import { useDictationToggleBridge } from "@/shell/root-chrome/use-dictation-toggle-bridge";
import { CompanionBridge } from "@/shell/companion/use-companion-bridge";
import { AppSourceNotifications } from "@/features/app-source/AppSourceNotifications";
import { EmailNotifications } from "@/features/email/EmailNotifications";
import { MemorySyncNotifications } from "@/features/cloud/MemorySyncNotifications";
import { SavedValuesNotifications } from "@/features/saved-values/SavedValuesNotifications";
import { useDisplayPayloadRouting } from "@/shell/root-chrome/use-display-payload-routing";
import { useLastLocationRestore } from "@/shell/root-chrome/use-last-location-restore";
import { usePersistLastLocation } from "@/shell/root-chrome/use-persist-last-location";
import { shellBreakpointStore } from "@/shell/shell-breakpoints";
import { platformCapabilities } from "@/platform/capabilities";
import type { ChatColumnProps } from "@/features/chat/chat-column-types";
import { dismissLaunchSplash } from "../../shell/launch-splash";
import { ShellTopBarFull } from "../../shell/ShellTopBarFull";
import { WorkspaceStage } from "../../shell/workspace-stage/WorkspaceStage";
import { CloudStartupFailure } from "../../shell/CloudStartupFailure";
import { SHELL_TOPBAR_HEIGHT } from "../../shell/metrics";
import { TopInsetContext } from "../../shell/top-inset";
import { mounted, Nothing } from "../mount";
import { lazyScreen, useLazyReady } from "../../kit/lazy";

const glob = <T,>(modules: Record<string, Record<string, unknown>>, name: string) => mounted<T>(modules, name, Nothing as never);
const ChatColumn = mounted<ChatColumnProps>(import.meta.glob("../../chat/ChatColumn.tsx", { eager: true }), "ChatColumn", Nothing);
const SelfHostPairScreen = glob<object>(import.meta.glob("../../replace/global/self-host/SelfHostPairScreen.tsx", { eager: true }), "SelfHostPairScreen");
// Only signed-out launches show it.
const SignInScreen = lazyScreen(() => import("../../replace/global/auth/SignInScreen"), (module) => module.SignInScreen);
const SignedOutLocalSync = glob<{ signedIn: boolean; isPrivate: boolean; conversationId: string | null }>(import.meta.glob("../../replace/global/local-mode/SignedOutLocalSync.tsx", { eager: true }), "SignedOutLocalSync");
const SignOutDialog = glob<object>(import.meta.glob("../../replace/global/auth/SignOutDialog.tsx", { eager: true }), "SignOutDialog");
const AccountSwitchGuard = glob<object>(import.meta.glob("../../replace/global/local-mode/AccountSwitchGuard.tsx", { eager: true }), "AccountSwitchGuard");
const FullShellDialogs = glob<{ activeDialog: "auth" | "connect" | null; onDialogOpenChange: (open: boolean) => void }>(import.meta.glob("../../replace/shell/full-shell-dialogs.tsx", { eager: true }), "FullShellDialogs");
const SettingsDialogHost = glob<object>(import.meta.glob("../../replace/shell/SettingsDialogHost.tsx", { eager: true }), "SettingsDialogHost");
const WhatsNewDialogHost = glob<object>(import.meta.glob("../../replace/features/whats-new/WhatsNewDialog.tsx", { eager: true }), "WhatsNewDialogHost");
const FeedbackDialogHost = glob<object>(import.meta.glob("../../replace/shell/FeedbackDialogHost.tsx", { eager: true }), "FeedbackDialogHost");
const PlanUsageDialogHost = glob<object>(import.meta.glob("../../replace/shell/PlanUsageDialogHost.tsx", { eager: true }), "PlanUsageDialogHost");
const ContextMenuHost = glob<object>(import.meta.glob("../../replace/platform/context-menu/ContextMenuHost.tsx", { eager: true }), "ContextMenuHost");
const ProviderConnectedDialog = glob<object>(import.meta.glob("../../replace/global/settings/ProviderConnectedDialog.tsx", { eager: true }), "ProviderConnectedDialog");
const DictationKeyDialog = glob<object>(import.meta.glob("../../replace/features/dictation/components/DictationKeyDialog.tsx", { eager: true }), "DictationKeyDialog");
const SubscriptionUpgradeDialog = glob<object>(import.meta.glob("../../replace/global/billing/SubscriptionUpgradeDialog.tsx", { eager: true }), "SubscriptionUpgradeDialog");

/** desktop-ui's `RootLayout` (routes/__root.tsx): which conversation the shell shows, and its startup failures. */
export function RootLayout() {
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
            search: (prev) => ({ ...prev, c: id }),
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

  const settledAccountScope = cloudSession.sessionGate.sessionIsLoading
    ? null
    : accountScope;
  useLayoutEffect(() => {
    setNotificationAccountScope(settledAccountScope);
  }, [settledAccountScope]);
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
  const wantsSignIn = authBootstrapStatus === "signed_out" && !isPrivate;
  const signInReady = useLazyReady(wantsSignIn, SignInScreen);
  const shouldDismissLaunchSplash =
    shellIsLive ||
    Boolean(authBootstrapError) ||
    showsMainConversationFailure ||
    authBootstrapStatus === "reauth_required" ||
    (authBootstrapStatus === "signed_out" && (signInReady || isPrivate)) ||
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

  if (wantsSignIn) {
    return signInReady ? <SignInScreen /> : null;
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
      <SignedOutLocalSync
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
        {platformCapabilities.nativeBridges && platformCapabilities.onboarding ? (
          <UsageNudges />
        ) : null}
        <RootChrome conversationId={conversationId} />
      </ChatRuntimeProvider>
    </>
  );
}

/** desktop-ui's `RootChrome`: the chat surface and route outlet under the top bar, the stage, and the shell's dialogs. */
function RootChrome({ conversationId }: { conversationId: string | null }) {
  useRestrictedStellaModelReset();

  const navigate = useNavigate();
  const activeDialog = useRouterState({ select: (s) => (s.location.search as { dialog?: "auth" | "connect" }).dialog });
  const chat = useChatRuntime();

  const rightSidebarRef = useRef<WorkspaceStageHandle>(null) as RefObject<WorkspaceStageHandle | null>;

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

  useEffect(() => {
    if (isOnChatRoute && fileViewer.getSnapshot().fileId === CHAT_DISPLAY_TAB_ID) {
      fileViewer.close();
    }
  }, [isOnChatRoute]);

  const onShellLayout = useCallback((r: { w: number }) => shellBreakpointStore.setWidth(r.w), []);

  return (
    <>
      <CompanionBridge conversationId={conversationId} />
      <AppSourceNotifications conversationId={conversationId} />
      <EmailNotifications />
      <MemorySyncNotifications />
      <SavedValuesNotifications />
      <ScheduleZoneReporter />
      {platformCapabilities.phoneAccess ? <MobileActivityNotificationsBridge /> : null}

      <col id="content-area" grow={1} minW={0} h="full" onLayout={onShellLayout}>
        <box absolute={{ left: 0, top: 0, right: 0 }} h={SHELL_TOPBAR_HEIGHT} windowDrag />
        <col id="persistent-chat-surface" absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} hidden={!isOnChatRoute}>
          <ChatColumn
            conversation={chat.conversation}
            composer={chat.composer}
            scroll={chat.scroll}
            conversationId={conversationId}
          />
        </col>
        <col id="route-outlet-surface" absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} hidden={isOnChatRoute}>
          <TopInsetContext.Provider value={SHELL_TOPBAR_HEIGHT}>{isOnChatRoute ? null : <Outlet />}</TopInsetContext.Provider>
        </col>
      </col>

      <ShellTopBarFull onSignIn={showAuthDialog} />

      <WorkspaceStage ref={rightSidebarRef} />

      <FullShellDialogs activeDialog={activeDialog ?? null} onDialogOpenChange={handleDialogOpenChange} />
      <SettingsDialogHost />
      <WhatsNewDialogHost />
      <FeedbackDialogHost />
      <ContextMenuHost />
      <PlanUsageDialogHost />
      <ProviderConnectedDialog />
      <DictationKeyDialog />
      <SubscriptionUpgradeDialog />
    </>
  );
}
