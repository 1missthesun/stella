import { stopAllDesktopAutomationDaemons } from "../services/desktop-automation-cleanup.js";
import { stopOrphanedStellaBrowserDaemons } from "../services/stella-browser-bridge-service.js";
import { stopNativeHelperDaemons } from "../native-helper-daemon.js";
import { stopOfficePreviewSessions } from "./office-preview-bridge.js";
import { joinWithTimeout } from "@stella/runtime/kernel/shared/join-timeout";
import { isRelaunching } from "../launcher-client.js";
const RUNTIME_SHELLS_SHUTDOWN_TIMEOUT_MS = 4_000;
const RUNTIME_EXIT_TIMEOUT_MS = 2_500;
const RUNTIME_TEARDOWN_TIMEOUT_MS = RUNTIME_SHELLS_SHUTDOWN_TIMEOUT_MS + RUNTIME_EXIT_TIMEOUT_MS + 500;
export const registerBootstrapProcessCleanups = (context) => {
    const { processRuntime } = context.state;
    let runtimeTeardown = null;
    const startRuntimeTeardown = () => {
        const runner = context.state.stellaHostRunner;
        if (!runner) {
            return Promise.resolve();
        }
        if (runtimeTeardown?.runner !== runner) {
            const keep = isRelaunching() && context.state.keepRuntimeAcrossRelaunch;
            const teardown = keep ? runner.stop({}).catch((error) => {
                console.warn("[cleanup] Runtime detach failed:", error);
            }) : (async () => {
                await joinWithTimeout(Promise.resolve()
                    .then(() => runner.killAllShells())
                    .catch((error) => {
                    console.warn("[cleanup] Runtime shell teardown failed:", error);
                }), RUNTIME_SHELLS_SHUTDOWN_TIMEOUT_MS, () => {
                    console.warn("[cleanup] Runtime shell teardown exceeded the quit bound; stopping the runtime anyway.");
                });
                await runner.stop({ shutdownRuntime: true, quit: true, exitTimeoutMs: RUNTIME_EXIT_TIMEOUT_MS });
            })().catch((error) => {
                console.warn("[cleanup] Runtime shutdown failed:", error);
            });
            runtimeTeardown = {
                runner,
                promise: joinWithTimeout(teardown, RUNTIME_TEARDOWN_TIMEOUT_MS, () => {
                    console.warn("[cleanup] Runtime shutdown exceeded the quit bound; quitting anyway.");
                }),
            };
        }
        return runtimeTeardown.promise;
    };
    processRuntime.registerCleanup("before-quit", "auth-refresh-loop", () => {
        context.services.authService.stopAuthRefreshLoop();
    });
    processRuntime.registerCleanup("before-quit", "engine-account-access", () => {
        context.services.claudeLocalAccounts.dispose();
        context.services.engineAccountAccess.dispose();
    });
    processRuntime.registerCleanup("before-quit", "memory-sync", async () => {
        if (!isRelaunching()) {
            await context.services.memorySync.flush(3000);
        }
        context.services.memorySync.dispose();
    });
    processRuntime.registerCleanup("before-quit", "remote-telemetry", async () => {
        await context.services.telemetry.record({
            type: "app.lifecycle",
            component: "desktop-main",
            phase: "stopping",
        });
        await context.services.telemetry.close({
            timeoutMs: 3000,
            send: !isRelaunching(),
        });
    });
    processRuntime.registerCleanup("before-quit", "runtime-worker", async () => {
        const runner = context.state.stellaHostRunner;
        if (!runner) {
            return;
        }
        await startRuntimeTeardown();
        if (context.state.stellaHostRunner === runner) {
            context.state.stellaHostRunner = null;
        }
    });
    processRuntime.registerCleanup("before-quit", "browser-bridge", async () => {
        await context.state.stellaBrowserBridgeService?.stop();
        await stopOrphanedStellaBrowserDaemons();
    });
    processRuntime.registerCleanup("before-quit", "in-app-browser", async () => {
        context.state.inAppBrowserHandlersDispose?.();
        context.state.inAppBrowserHandlersDispose = null;
        await context.state.inAppBrowserBootstrapServer?.stop();
        context.state.inAppBrowserBootstrapServer = null;
        await context.state.inAppBrowserCdpAdapter?.stop();
        context.state.inAppBrowserCdpAdapter = null;
        context.state.inAppBrowserService?.dispose();
        context.state.inAppBrowserService = null;
    });
    processRuntime.registerCleanup("before-quit", "overlay-window", () => {
        context.state.overlayController?.destroy();
    });
    processRuntime.registerCleanup("before-quit", "companion-window", () => {
        context.state.companionController?.destroy();
    });
    processRuntime.registerCleanup("before-quit", "tray", () => {
        context.state.trayController?.destroy();
        context.state.trayController = null;
    });
    processRuntime.registerCleanup("before-quit", "office-preview-bridge", async () => {
        context.state.officePreviewBridgeStop?.();
        context.state.officePreviewBridgeStop = null;
        const stellaDataDir = context.state.stellaDataDirPath ?? context.config.stellaDataDirPath;
        await stopOfficePreviewSessions(stellaDataDir);
    });
    processRuntime.registerCleanup("before-quit", "meeting-capture-daemon", async () => {
        await context.state.meetingCaptureController?.shutdown();
        context.state.meetingCaptureController = null;
    });
    processRuntime.registerCleanup("before-quit", "desktop-automation-daemon", async () => {
        await stopAllDesktopAutomationDaemons();
    });
    processRuntime.registerCleanup("before-quit", "native-helper-daemons", () => {
        stopNativeHelperDaemons();
    });
    processRuntime.registerCleanup("before-quit", "global-input-hooks", () => {
        context.services.globalInputHook.dispose();
        context.state.globalInputHooksStarted = false;
        context.state.globalInputHooksStartScheduled = false;
    });
    processRuntime.registerCleanup("before-quit", "runtime-shells", () => {
        void startRuntimeTeardown();
    });
};
