import { app } from "electron";
import { hasMacPermission } from "../utils/macos-permissions.js";
import path from "path";
import { resolveStellaDataDir } from "@stella/runtime/kernel/home/stella-home";
import { OverlayWindowController } from "../windows/overlay-window.js";
import { CompanionWindowController } from "../windows/companion-window.js";
import { broadcastCompanionVisibility } from "../ipc/companion-handlers.js";
import { WindowManager } from "../windows/window-manager.js";
import { TrayController } from "../windows/tray-controller.js";
import { configureNotificationActivationHandling } from "../services/notification-service.js";
import { configureStellaSessionPermissions } from "./session-permissions.js";
import { resolveRendererBuildMode, serveRendererSource, } from "../source/renderer-protocol.js";
import { getAllWindows, } from "./context.js";
import { startDeferredStartup } from "./deferred-startup.js";
import { getMainLogger } from "../observability/main-logger.js";
import { noteStartupAppPainted, onceAppPainted } from "../observability/app-paint.js";
import { heldFirstPage, pendingHold } from "../services/app-source/update-transition.js";
const STARTUP_APP_PAINT_FALLBACK_MS = 4_000;
const initializeBootstrapLocalState = async (context) => {
    const { config, lifecycle, services, state } = context;
    const stellaDataDir = await resolveStellaDataDir(app, config.stellaAppDir, config.stellaDataDirPath);
    lifecycle.setStellaAppDir(stellaDataDir.stellaAppDir);
    lifecycle.setStellaDataDir(stellaDataDir.statePath);
    state.stellaAppDir = stellaDataDir.stellaAppDir;
    state.stellaDataDirPath = stellaDataDir.statePath;
    state.stellaWorkspacePath = stellaDataDir.workspacePath;
    services.securityPolicyService.setSecurityPolicyPath(path.join(stellaDataDir.statePath, "security_policy.json"));
};
const initializeWindowShell = (context) => {
    const { config, lifecycle, services, state } = context;
    const preloadPath = path.join(config.electronDir, "preload.js");
    configureStellaSessionPermissions({
        appPartition: config.sessionPartition,
    });
    const hold = pendingHold(app.getPath("userData"));
    state.pendingUpdateHold = hold;
    state.rendererSource = serveRendererSource({
        partition: config.sessionPartition,
        sourceRoot: config.stellaAppDir,
        mode: resolveRendererBuildMode({
            isInstalledProduct: config.isInstalledProduct,
        }),
        log: (message) => getMainLogger()?.process("renderer.source", { message }),
        firstPage: hold ? (html) => heldFirstPage(html, hold) : undefined,
    });
    configureNotificationActivationHandling(context);
    state.overlayController = new OverlayWindowController({
        preloadPath,
        sessionPartition: config.sessionPartition,
        electronDir: config.electronDir,
        isQuitting: () => state.isQuitting,
    });
    lifecycle.setWindowManager(new WindowManager({
        electronDir: config.electronDir,
        preloadPath,
        sessionPartition: config.sessionPartition,
        externalLinkService: services.externalLinkService,
        isQuitting: () => state.isQuitting,
        onMinimizeFullToTray: () => state.trayController?.notifyMinimizedToTray(),
    }));
    state.companionController = new CompanionWindowController({
        preloadPath,
        sessionPartition: config.sessionPartition,
        electronDir: config.electronDir,
        isQuitting: () => state.isQuitting,
        getStellaDataDir: () => state.stellaDataDirPath,
        onOpenMain: () => state.windowManager?.showWindow(),
        hasMainWindow: () => {
            const full = state.windowManager?.getFullWindow();
            return Boolean(full && !full.isDestroyed());
        },
        onQuit: () => {
            state.isQuitting = true;
            app.quit();
        },
        onVisibleChanged: (visible) => broadcastCompanionVisibility(visible),
    });
    if (process.platform === "win32") {
        const trayController = new TrayController({
            electronDir: config.electronDir,
            onShowWindow: () => state.windowManager?.showWindow(),
            onQuit: () => {
                state.isQuitting = true;
                app.quit();
            },
        });
        trayController.create();
        state.trayController = trayController;
    }
    services.uiStateService.bind({
        broadcastTarget: {
            getAllWindows: () => getAllWindows(context),
        },
    });
};
const finalizeWindowLaunch = (context) => {
    const { config, services, state } = context;
    state.windowManager.createInitialWindows();
    const fullWindow = state.windowManager.getFullWindow();
    let deferredStartupTriggered = false;
    const triggerDeferredStartup = (trigger) => {
        if (deferredStartupTriggered) {
            return;
        }
        deferredStartupTriggered = true;
        getMainLogger()?.process("startup.deferred-startup.trigger", {
            trigger,
            elapsedMs: Math.round(process.uptime() * 1000),
        });
        void startDeferredStartup(context);
    };
    if (fullWindow) {
        fullWindow.webContents.once("did-finish-load", () => {
            getMainLogger()?.process("startup.first-paint", {
                elapsedMs: Math.round(process.uptime() * 1000),
            });
            triggerDeferredStartup("first-paint");
        });
    }
    const transition = state.updateTransition;
    if (fullWindow && transition?.hasPendingHold()) {
        triggerDeferredStartup("update-relaunch");
        void transition.resumeAfterRelaunch(fullWindow);
    }
    else {
        state.windowManager.showWindow();
    }
    context.state.processRuntime.setManagedTimeout(() => {
        triggerDeferredStartup("fallback");
    }, config.startupFirstPaintFallbackMs);
    if (process.platform === "darwin") {
        app.on("browser-window-focus", () => {
            if (context.state.isQuitting || !hasMacPermission("accessibility", false)) {
                return;
            }
            services.globalInputHook.start();
        });
    }
};
export const createBootstrapInitialWindows = (context) => {
    const hold = context.state.pendingUpdateHold;
    context.state.windowManager.createInitialWindows(hold ? { backgroundColor: hold.backgroundColor } : undefined);
    const fullWindow = context.state.windowManager.getFullWindow();
    if (fullWindow) {
        onceAppPainted(fullWindow.webContents, () => {
            getMainLogger()?.process("startup.first-app-paint", {
                elapsedMs: Math.round(process.uptime() * 1000),
            });
            noteStartupAppPainted();
        });
    }
    setTimeout(noteStartupAppPainted, STARTUP_APP_PAINT_FALLBACK_MS).unref?.();
    if (hold && fullWindow) {
        let raised = false;
        const raise = (shownWith) => {
            if (raised || fullWindow.isDestroyed())
                return;
            raised = true;
            getMainLogger()?.process("startup.window-shown", {
                shownWith,
                elapsedMs: Math.round(process.uptime() * 1000),
            });
            context.state.windowManager.showWindow();
        };
        fullWindow.once("ready-to-show", () => raise("first-page"));
        setTimeout(() => raise("timeout"), 800);
    }
    getMainLogger()?.process("startup.window-created", {
        elapsedMs: Math.round(process.uptime() * 1000),
    });
};
export const prepareBootstrapAppShell = async (context) => {
    await initializeBootstrapLocalState(context);
    initializeWindowShell(context);
};
export const launchBootstrapAppShell = (context) => {
    finalizeWindowLaunch(context);
};
