import { registerBootstrapIpcHandlers } from "./ipc.js";
import { createBootstrapResetFlows } from "./resets.js";
import { initializeStellaHostRunner } from "./host-runner.js";
import {} from "./context.js";
import { createBootstrapInitialWindows, launchBootstrapAppShell, prepareBootstrapAppShell, } from "./app-shell.js";
import { createManagedResource } from "../managed-resource.js";
import { getMainLogger } from "../observability/main-logger.js";
const BACKGROUND_RUNTIME_RETRY_DELAY_MS = 2_000;
export const initializeBootstrapApplication = async (context) => {
    const { services } = context;
    services.authService.registerAuthProtocol();
    services.authService.captureInitialAuthUrl(process.argv);
    await prepareBootstrapAppShell(context);
    createBootstrapInitialWindows(context);
    const ipcStartedAt = performance.now();
    registerBootstrapIpcHandlers(context, createBootstrapResetFlows(context, {
        initializeStellaHostRunner: () => initializeStellaHostRunner(context),
    }));
    getMainLogger()?.process("startup.ipc-registered", {
        elapsedMs: Math.round(process.uptime() * 1000),
        durationMs: Math.round(performance.now() - ipcStartedAt),
    });
    const hostRunnerResource = createManagedResource({
        processRuntime: context.state.processRuntime,
        canStart: () => !context.state.isQuitting,
        create: () => null,
        start: () => initializeStellaHostRunner(context),
        stop: async () => { },
        oneShot: true,
        retry: { fixedDelayMs: BACKGROUND_RUNTIME_RETRY_DELAY_MS },
        onError: (error) => {
            console.error("[startup] Failed to initialize Stella host runner:", error);
        },
    });
    context.state.startHostRunner = () => hostRunnerResource.start();
    launchBootstrapAppShell(context);
};
