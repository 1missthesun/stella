import path from "node:path";
import { getMainLogger } from "../observability/main-logger.js";
import { startupAppPainted } from "../observability/app-paint.js";
import { sweepOrphanedHelpers } from "../services/orphaned-helpers.js";
import { resolveStellaBrowserBinaryPath } from "../utils/stella-browser-paths.js";
import { getTotalSystemMemoryMb, isLowMemoryWindowsDevice, } from "../resource-profile.js";
import { getCompanionEnabled } from "@stella/runtime/kernel/preferences/local-preferences";
const OVERLAY_STARTUP_WARM_DELAY_MS = 5_000;
const runDeferredStartupTask = async (context, task) => {
    if (task.delayMs) {
        const completed = await context.state.processRuntime.wait(task.delayMs);
        if (!completed) {
            return false;
        }
    }
    if (context.state.isQuitting ||
        context.state.processRuntime.isShuttingDown()) {
        return false;
    }
    await task.run();
    return true;
};
const scheduleOverlayWarmup = (context) => {
    const { state } = context;
    if (isLowMemoryWindowsDevice()) {
        getMainLogger()?.process("startup.overlay-warmup.skipped-low-memory-windows", {
            totalMemoryMb: getTotalSystemMemoryMb(),
        });
        return;
    }
    state.processRuntime.setManagedTimeout(() => {
        void (async () => {
            if (state.isQuitting || state.processRuntime.isShuttingDown()) {
                return;
            }
            const warmed = await state.overlayController?.warmForStartup();
            getMainLogger()?.process("startup.overlay-warmup", {
                warmed: warmed === true,
                elapsedMs: Math.round(process.uptime() * 1000),
            });
        })().catch((error) => {
            console.debug("[startup] Overlay warmup failed:", error instanceof Error ? error.message : String(error));
        });
    }, OVERLAY_STARTUP_WARM_DELAY_MS);
};
const createDeferredStartupTasks = (context) => {
    const { config, state } = context;
    return [
        {
            label: "host-runner",
            run: () => {
                getMainLogger()?.process("startup.host-runner.kickoff", {
                    elapsedMs: Math.round(process.uptime() * 1000),
                });
                state.startHostRunner?.();
            },
        },
        {
            label: "orphaned-helpers",
            afterAppPaint: true,
            run: () => {
                const browserBinaryDirectories = [resolveStellaBrowserBinaryPath()]
                    .filter((binaryPath) => Boolean(binaryPath))
                    .map((binaryPath) => path.dirname(binaryPath));
                void sweepOrphanedHelpers({ browserBinaryDirectories }).catch((error) => {
                    console.debug("[startup] Orphaned helper sweep failed:", error instanceof Error ? error.message : String(error));
                });
            },
        },
        {
            label: "app-source",
            afterAppPaint: true,
            run: () => {
                state.appSourceService?.start();
            },
        },
        {
            label: "overlay-warmup-schedule",
            afterAppPaint: true,
            run: () => {
                scheduleOverlayWarmup(context);
            },
        },
        {
            label: "companion-restore",
            afterAppPaint: true,
            run: () => {
                const stellaDataDir = state.stellaDataDirPath ?? config.stellaDataDirPath;
                if (!stellaDataDir || !getCompanionEnabled(stellaDataDir)) {
                    return;
                }
                void state.companionController
                    ?.show({ focus: false, persist: false })
                    .catch((error) => {
                    console.debug("[startup] Companion restore failed:", error instanceof Error ? error.message : String(error));
                });
            },
        },
    ];
};
export const startDeferredStartup = (context) => {
    const { state } = context;
    if (state.deferredStartupSequence) {
        return state.deferredStartupSequence;
    }
    state.deferredStartupSequence = (async () => {
        for (const task of createDeferredStartupTasks(context)) {
            if (task.afterAppPaint) {
                await startupAppPainted;
            }
            const completed = await runDeferredStartupTask(context, task);
            if (!completed) {
                return;
            }
        }
    })().catch((error) => {
        console.error("[startup] Deferred startup failed:", error.message);
    });
    return state.deferredStartupSequence;
};
