import { waitForConnectedRunner } from "./runtime-availability.js";
import { IPC_DISCOVERY_COLLECT_ALL_SIGNALS, IPC_DISCOVERY_DETECT_PREFERRED_BROWSER, IPC_DISCOVERY_LIST_BROWSER_PROFILES, IPC_DISCOVERY_WRITE_CORE_MEMORY, } from "@stella/contracts/desktop/ipc-channels";
import {
  registerPrivilegedHandle,
} from "./privileged-ipc.js";
const DISCOVERY_RUNNER_TIMEOUT_MS = 30_000;
const waitForDiscoveryRunner = async (options) => await waitForConnectedRunner(options.getStellaHostRunner, {
    timeoutMs: DISCOVERY_RUNNER_TIMEOUT_MS,
    unavailableMessage: "Runtime not available.",
    onRunnerChanged: options.onStellaHostRunnerChanged,
});
const collectWithRunnerEnvelope = async (options, action) => {
    try {
        const runner = await waitForDiscoveryRunner(options);
        return await action(runner);
    }
    catch (error) {
        return {
            data: null,
            formatted: null,
            error: error.message,
        };
    }
};
export const registerDiscoveryHandlers = (options) => {
    registerPrivilegedHandle(options, IPC_DISCOVERY_WRITE_CORE_MEMORY, async (event, payload) => {
        const content = typeof payload === "string" ? payload : payload.content;
        const includeLocation = typeof payload === "string" ? false : payload.includeLocation === true;
        try {
            const runner = await waitForDiscoveryRunner(options);
            await runner.writeCoreMemory(content, { includeLocation });
            return { ok: true };
        }
        catch (error) {
            return { ok: false, error: error.message };
        }
    });
    registerPrivilegedHandle(options, IPC_DISCOVERY_DETECT_PREFERRED_BROWSER, async () => {
        try {
            const runner = await waitForDiscoveryRunner(options);
            return await runner.detectPreferredBrowserProfile();
        }
        catch {
            return null;
        }
    });
    registerPrivilegedHandle(options, IPC_DISCOVERY_LIST_BROWSER_PROFILES, async (_event, browserType) => {
        try {
            const runner = await waitForDiscoveryRunner(options);
            return await runner.listBrowserProfiles(browserType);
        }
        catch {
            return [];
        }
    });
    registerPrivilegedHandle(options, IPC_DISCOVERY_COLLECT_ALL_SIGNALS, async (event, ipcOptions) => await collectWithRunnerEnvelope(options, async (runner) => await runner.collectAllSignals(ipcOptions)));
};
