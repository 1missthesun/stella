import { waitForConnectedRunner } from "./runtime-availability.js";
import { IPC_DISCOVERY_COLLECT_ALL_SIGNALS, IPC_DISCOVERY_DETECT_PREFERRED_BROWSER, IPC_DISCOVERY_LIST_BROWSER_PROFILES, IPC_DISCOVERY_WRITE_CORE_MEMORY, IPC_DISCOVERY_WRITE_KNOWLEDGE, } from "@stella/contracts/desktop/ipc-channels";
import {
  handleIpc,
} from "./typed-ipc.js";
const DISCOVERY_RUNNER_TIMEOUT_MS = 30_000;
const waitForDiscoveryRunner = async (options) => await waitForConnectedRunner(options.getStellaHostRunner, {
    timeoutMs: DISCOVERY_RUNNER_TIMEOUT_MS,
    unavailableMessage: "Runtime not available.",
    onRunnerChanged: options.onStellaHostRunnerChanged,
});
const collectWithRunnerEnvelope = async (options, event, channel, action) => {
    if (!options.assertPrivilegedSender(event, channel)) {
        throw new Error("Blocked untrusted request.");
    }
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
    handleIpc(IPC_DISCOVERY_WRITE_CORE_MEMORY, async (event, payload) => {
        if (!options.assertPrivilegedSender(event, IPC_DISCOVERY_WRITE_CORE_MEMORY)) {
            throw new Error("Blocked untrusted request.");
        }
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
    handleIpc(IPC_DISCOVERY_WRITE_KNOWLEDGE, async (event, payload) => {
        if (!options.assertPrivilegedSender(event, IPC_DISCOVERY_WRITE_KNOWLEDGE)) {
            throw new Error("Blocked untrusted request.");
        }
        try {
            const runner = await waitForDiscoveryRunner(options);
            await runner.writeDiscoveryKnowledge(payload);
            return { ok: true };
        }
        catch (error) {
            return { ok: false, error: error.message };
        }
    });
    handleIpc(IPC_DISCOVERY_DETECT_PREFERRED_BROWSER, async () => {
        try {
            const runner = await waitForDiscoveryRunner(options);
            return await runner.detectPreferredBrowserProfile();
        }
        catch {
            return null;
        }
    });
    handleIpc(IPC_DISCOVERY_LIST_BROWSER_PROFILES, async (_event, browserType) => {
        try {
            const runner = await waitForDiscoveryRunner(options);
            return await runner.listBrowserProfiles(browserType);
        }
        catch {
            return [];
        }
    });
    handleIpc(IPC_DISCOVERY_COLLECT_ALL_SIGNALS, async (event, ipcOptions) => await collectWithRunnerEnvelope(options, event, IPC_DISCOVERY_COLLECT_ALL_SIGNALS, async (runner) => await runner.collectAllSignals(ipcOptions)));
};
