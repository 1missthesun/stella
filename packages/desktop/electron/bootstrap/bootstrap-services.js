import path from "path";
import { app } from "electron";
import { AuthService } from "../services/auth-service.js";
import { SelfHostService } from "../services/self-host-service.js";
import { isLauncherPresent, relaunchApp } from "../launcher-client.js";
import { CaptureService } from "../services/capture-service.js";
import { MouseHookManager } from "../input/mouse-hook.js";
import { UserAskService } from "../services/user-ask-service.js";
import { ConnectorCredentialService } from "../services/connector-credential-service.js";
import { ConnectorOAuthService } from "../services/connector-oauth-service.js";
import { ConnectorConnectService } from "../services/connector-connect-service.js";
import { EngineAccountAccess } from "../services/engine-account-access.js";
import { MemorySyncService } from "../services/memory-sync/memory-sync-service.js";
import { ClaudeLocalAccounts } from "../services/claude-local-accounts.js";
import { ExternalLinkService } from "../services/external-link-service.js";
import { readConfiguredCanvasShareBaseUrl } from "../services/canvas-share-service.js";
import { isCanvasShareUrl } from "@stella/contracts/canvas-share";
import {
  IPC_AUTH_SESSION_INVALIDATED,
  IPC_MEMORY_SYNC_STATUS,
  IPC_LOCAL_CHAT_UPDATED,
  IPC_DISPLAY_OPEN_SHARE_LINK,
  IPC_CLAUDE_ACCOUNTS_CHANGED,
  IPC_SELF_HOST_PAIR_LINK,
} from "@stella/contracts/desktop/ipc-channels";
import { LocalChatHistoryService } from "../services/local-chat-history-service.js";
import { SecurityPolicyService } from "../services/security-policy-service.js";
import { UiStateService } from "../services/ui-state-service.js";
import { RENDERER_ORIGIN } from "../source/origin.js";
import { startupAppPainted } from "../observability/app-paint.js";
import { initMainProcessTelemetry } from "../observability/main-telemetry.js";
import { getMainLogger } from "../observability/main-logger.js";
export const createBootstrapServices = (options) => {
    const { config, lifecycle, state } = options;
    const uiStateService = new UiStateService();
    const externalLinkService = new ExternalLinkService();
    const localChatHistoryService = new LocalChatHistoryService({
        stellaAppDir: config.stellaDataDirPath,
        onUpdated: (payload) => {
            for (const window of options.getAllWindows()) {
                if (!window.isDestroyed()) {
                    window.webContents.send(IPC_LOCAL_CHAT_UPDATED, payload ?? null);
                }
            }
        },
    });
    externalLinkService.trustRendererOrigin(RENDERER_ORIGIN);
    externalLinkService.setCanvasShareHandler((url) => {
        const baseUrl = readConfiguredCanvasShareBaseUrl();
        if (!baseUrl || !isCanvasShareUrl(url, baseUrl))
            return false;
        const windows = options.getAllWindows().filter((window) => !window.isDestroyed());
        if (windows.length === 0)
            return false;
        for (const window of windows) {
            window.webContents.send(IPC_DISPLAY_OPEN_SHARE_LINK, { url });
        }
        return true;
    });
    const securityPolicyService = new SecurityPolicyService({
        windowManagerTarget: lifecycle,
    });
    let connectorCredentialService = null;
    let selfHostService = null;
    const authService = new AuthService({
        authProtocol: config.authProtocol,
        projectDir: path.resolve(config.electronDir, "..", ".."),
        sessionPartition: config.sessionPartition,
        runnerTarget: lifecycle,
        onAuthCallback: (url) => {
            if (connectorCredentialService?.handleExternalOAuthCallback(url)) {
                return;
            }
            console.warn("[security] Rejected unhandled protocol callback URL.");
        },
        onPairingLink: (url) => {
            selfHostService?.receiveLink(url);
        },
        onSecondInstanceFocus: () => {
            state.windowManager?.getFullWindow()?.focus();
        },
        onSessionInvalidated: () => {
            for (const window of options.getAllWindows()) {
                if (!window.isDestroyed()) {
                    window.webContents.send(IPC_AUTH_SESSION_INVALIDATED, null);
                }
            }
        },
    });
    selfHostService = new SelfHostService({
        getBackendUrl: () => authService.getBackendUrl(),
        getAuthToken: () => authService.getAuthToken(),
        applySessionToken: (token) => authService.applySessionToken(token),
        relaunch: () => relaunchApp(),
        canRelaunchThroughLauncher: () => isLauncherPresent(),
        onPairingLink: (link) => {
            const full = state.windowManager?.getFullWindow();
            if (full && !full.isDestroyed()) {
                if (full.isMinimized()) full.restore();
                full.show();
                full.focus();
            }
            for (const window of options.getAllWindows()) {
                if (!window.isDestroyed()) {
                    window.webContents.send(IPC_SELF_HOST_PAIR_LINK, { link });
                }
            }
        },
    });
    const telemetry = initMainProcessTelemetry({
        stellaDataDirPath: config.stellaDataDirPath,
        environment: config.telemetryEnvironment,
        getAuthToken: () => authService.getAuthToken(),
    });
    const userAskService = new UserAskService({
        getAllWindows: () => options.getAllWindows(),
        getStellaAppDir: () => lifecycle.getStellaDataDir(),
        getDeviceId: () => state.deviceId,
        getRunner: () => lifecycle.getRunner(),
        getInAppBrowserService: () => state.inAppBrowserService,
        getBackendUrl: () => authService.getBackendUrl(),
        getAuthToken: () => authService.getAuthToken(),
        notificationContext: { state },
    });
    void startupAppPainted.then(() => userAskService.startMirror());
    const engineAccountAccess = new EngineAccountAccess({
        getBackendUrl: () => authService.getBackendUrl(),
        getAuthToken: () => authService.getAuthToken(),
    });
    const claudeLocalAccounts = new ClaudeLocalAccounts({
        stellaDataDir: config.stellaDataDirPath,
        engineAccounts: engineAccountAccess,
        loadDeviceId: async () => (await options.loadDeviceId?.()) ?? null,
        onChanged: () => {
            for (const window of options.getAllWindows()) {
                if (!window.isDestroyed()) {
                    window.webContents.send(IPC_CLAUDE_ACCOUNTS_CHANGED, {});
                }
            }
        },
    });
    const memorySync = new MemorySyncService({
        stellaDataDir: config.stellaDataDirPath,
        getBackendUrl: () => authService.getBackendUrl(),
        getAuthToken: () => authService.getAuthToken(),
        hasConnectedAccount: () => authService.getHostHasConnectedAccount(),
        dispatchAgentBrief: async (brief) => {
            const runner = lifecycle.getRunner();
            const conversationId = uiStateService.state.conversationId;
            if (!runner || !conversationId) {
                throw new Error("Stella isn't ready to start an agent yet.");
            }
            await runner.createBackgroundAgent({
                conversationId,
                description: brief.description,
                prompt: brief.prompt,
                agentType: "general",
            });
        },
        broadcast: (status) => {
            for (const window of options.getAllWindows()) {
                if (!window.isDestroyed()) {
                    window.webContents.send(IPC_MEMORY_SYNC_STATUS, status);
                }
            }
        },
        log: (event, data) => getMainLogger()?.process(event, data),
    });
    app.on("browser-window-focus", () => {
        void startupAppPainted.then(() => {
            claudeLocalAccounts.noteWindowFocus();
            memorySync.noteWindowFocus();
        });
    });
    const connectorOAuthService = new ConnectorOAuthService();
    connectorCredentialService = new ConnectorCredentialService({
        getUserAskService: () => userAskService,
        getActiveConversationId: () => uiStateService.state.conversationId?.trim() || null,
        getStellaAppDir: () => lifecycle.getStellaDataDir(),
        getAuthToken: () => authService.getAuthToken(),
        getBackendUrl: () => authService.getBackendUrl(),
    });
    const connectorConnectService = new ConnectorConnectService({
        windowManagerTarget: lifecycle,
        getStellaAppDir: () => lifecycle.getStellaDataDir(),
        connectorCredentialService,
        getAuthToken: () => authService.getAuthToken(),
        getBackendUrl: () => authService.getBackendUrl(),
    });
    const captureService = new CaptureService({
        window: {
            getAllWindows: () => options.getAllWindows(),
        },
        overlay: {
            startRegionCapture: () => state.overlayController?.startRegionCapture(),
            endRegionCapture: () => state.overlayController?.endRegionCapture(),
            suspendRegionCaptureForScreenshot: () => state.overlayController?.suspendRegionCaptureForScreenshot(),
            restoreRegionCaptureAfterScreenshot: () => state.overlayController?.restoreRegionCaptureAfterScreenshot(),
            getOverlayBounds: () => state.overlayController?.getWindow()?.getBounds() ?? null,
        },
        updateUiState: (partial) => uiStateService.update(partial),
    });
    const globalInputHook = new MouseHookManager();
    return {
        authService,
        selfHostService,
        captureService,
        globalInputHook,
        userAskService,
        connectorCredentialService,
        connectorOAuthService,
        connectorConnectService,
        engineAccountAccess,
        claudeLocalAccounts,
        memorySync,
        externalLinkService,
        localChatHistoryService,
        securityPolicyService,
        telemetry,
        uiStateService,
    };
};
