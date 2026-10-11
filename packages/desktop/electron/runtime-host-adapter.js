import { AGENT_STREAM_EVENT_TYPES, isTaskLifecycleEventType, isTaskLifecycleTerminalType, } from "@stella/contracts/agent-runtime";
import { RemoteRuntimeHost } from "@stella/runtime/host/remote";
import { createRuntimeUnavailableError } from "@stella/contracts/protocol/rpc-peer";
import { readConfiguredBackendUrl } from "@stella/contracts/stella-api";

const isRunTerminalEvent = (type) => type === AGENT_STREAM_EVENT_TYPES.RUN_FINISHED;
export class RuntimeHostAdapter {
    host;
    lastHealth = null;
    lastRuntimeHealth = null;
    connected = false;
    started = false;
    lastConfigureError = null;
    lastAvailabilitySnapshot = null;
    pendingConfig = { cloudSyncEnabled: true };
    queuedConfigPatch = {};
    configFlushQueued = false;
    availabilityListeners = new Set();
    constructor(options) {
        // Main-side followers of the Stella session (engine account access).
        this.onAuthTokenChanged = options.onAuthTokenChanged;
        // The host runs in the runtime process; this is the app's handle on it.
        this.host = new RemoteRuntimeHost(options);
        this.host.on("runtime-connected", () => {
            this.connected = true;
            if (this.lastHealth && !this.lastHealth.ready) {
                this.lastHealth = { ready: false };
            }
            this.emitAvailabilityChange();
            // Flush any config patches that failed before the worker was ready
            if (this.started && Object.keys(this.pendingConfig).length > 0) {
                void this.host.configure(this.pendingConfig).catch(() => { });
            }
        });
        this.host.on("runtime-disconnected", ({ reason }) => {
            this.connected = false;
            this.lastRuntimeHealth = null;
            this.lastHealth = { ready: false, reason };
            this.emitAvailabilityChange();
        });
        this.host.on("runtime-ready", (snapshot) => {
            this.lastRuntimeHealth = snapshot;
            this.emitAvailabilityChange();
        });
    }
    emitAvailabilityChange() {
        const snapshot = this.getAvailabilitySnapshot();
        if (this.lastAvailabilitySnapshot &&
            this.lastAvailabilitySnapshot.connected === snapshot.connected &&
            this.lastAvailabilitySnapshot.ready === snapshot.ready &&
            this.lastAvailabilitySnapshot.reason === snapshot.reason) {
            return;
        }
        this.lastAvailabilitySnapshot = snapshot;
        for (const listener of this.availabilityListeners) {
            listener(snapshot);
        }
    }
    waitForAvailability(predicate, timeoutMs, fallbackMessage) {
        const initial = this.getAvailabilitySnapshot();
        if (predicate(initial)) {
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                unsubscribe();
                reject(createRuntimeUnavailableError(this.getAvailabilitySnapshot().reason ?? fallbackMessage));
            }, timeoutMs);
            const unsubscribe = this.onAvailabilityChange((snapshot) => {
                if (!predicate(snapshot)) {
                    return;
                }
                clearTimeout(timer);
                unsubscribe();
                resolve();
            });
        });
    }
    getAvailabilitySnapshot() {
        const ready = Boolean(this.connected && this.lastRuntimeHealth?.ready);
        const reason = this.lastRuntimeHealth && !this.lastRuntimeHealth.ready
            ? "Stella runtime host is not ready."
            : (this.lastHealth?.reason ??
                (!this.connected
                    ? "Stella runtime client is not connected."
                    : undefined));
        return {
            connected: this.connected,
            ready,
            ...(reason ? { reason } : {}),
            ...(this.lastRuntimeHealth?.pendingWorkerRestart
                ? { pendingRuntimeRestart: true }
                : {}),
        };
    }
    onAvailabilityChange(listener) {
        this.availabilityListeners.add(listener);
        return () => {
            this.availabilityListeners.delete(listener);
        };
    }
    async start() {
        await this.host.start();
        this.started = true;
        if (Object.keys(this.pendingConfig).length > 0) {
            try {
                await this.host.configure(this.pendingConfig);
                this.lastConfigureError = null;
            }
            catch (error) {
                this.lastConfigureError =
                    error instanceof Error
                        ? error.message
                        : String(error ?? "Runtime configure failed.");
                throw error;
            }
        }
        this.lastRuntimeHealth = await this.host.health();
        this.lastHealth = await this.host.healthCheck();
        this.emitAvailabilityChange();
    }
    /**
     * `shutdownRuntime` stops the runtime too, for quit and for resets that
     * delete its files; `exitTimeoutMs` bounds how long this waits for it.
     */
    async stop(options = {}) {
        this.started = false;
        await this.host.stop({
            shutdownRuntime: options.shutdownRuntime === true,
            quit: options.quit === true,
            ...(options.exitTimeoutMs !== undefined ? { exitTimeoutMs: options.exitTimeoutMs } : {}),
        });
    }
    async ensureWorkerStarted() {
        if (!this.started) {
            return;
        }
        await this.host.ensureWorkerStarted();
        this.lastRuntimeHealth = await this.host.health();
        this.lastHealth = await this.host.healthCheck();
        this.emitAvailabilityChange();
    }
    /** An update changed runtime code: the runtime restarts once it is idle (between turns). */
    requestRuntimeRestart() {
        return this.host.requestRuntimeRestart();
    }
    queueRuntimeConfigPatch(patch) {
        this.pendingConfig = {
            ...this.pendingConfig,
            ...patch,
        };
        this.queuedConfigPatch = {
            ...this.queuedConfigPatch,
            ...patch,
        };
        if (!this.started) {
            return;
        }
        if (this.configFlushQueued) {
            return;
        }
        this.configFlushQueued = true;
        queueMicrotask(() => {
            this.configFlushQueued = false;
            if (!this.started) {
                return;
            }
            const nextPatch = this.queuedConfigPatch;
            this.queuedConfigPatch = {};
            if (Object.keys(nextPatch).length === 0) {
                return;
            }
            void this.host.configure(nextPatch).then(() => {
                this.lastConfigureError = null;
            }, (error) => {
                this.lastConfigureError =
                    error instanceof Error
                        ? error.message
                        : String(error ?? "Runtime configure failed.");
                console.warn("[stella-runtime-adapter] Failed to apply runtime config patch:", {
                    patch: nextPatch,
                    error: this.lastConfigureError,
                });
            });
        });
    }
    async waitUntilReady(timeoutMs = 10_000) {
        const deadline = Date.now() + timeoutMs;
        while (true) {
            // Host readiness only proves that the socket and host-owned services are
            // online. The worker builds its runner lazily after that handshake, and
            // a failed lazy import leaves the socket healthy while chats cannot run.
            // Require both layers to report ready before accepting a send.
            this.lastRuntimeHealth = await this.host.health();
            const workerHealth = await this.agentHealthCheck();
            this.emitAvailabilityChange();
            const snapshot = this.getAvailabilitySnapshot();
            // A pending restart is intentionally informational: the current worker
            // remains authoritative and usable until its active work drains. During
            // the actual stop/start window workerHealth is not ready, so sends still
            // wait without locking the user out for the entire deferral period.
            if (workerHealth?.ready === true && snapshot.ready) {
                return;
            }
            if (Date.now() >= deadline) {
                throw createRuntimeUnavailableError(workerHealth?.reason ??
                    snapshot.reason ??
                    "Stella is reconnecting to its runtime. Please try again.");
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
    async waitUntilConnected(timeoutMs = 10_000) {
        if (this.getAvailabilitySnapshot().connected) {
            return;
        }
        await this.waitForAvailability((snapshot) => snapshot.connected, timeoutMs, "Stella runtime client is not connected.");
    }
    setBackendUrl(value) {
        this.queueRuntimeConfigPatch({ backendUrl: value ?? null });
    }
    setAuthToken(value) {
        this.queueRuntimeConfigPatch({ authToken: value });
        this.onAuthTokenChanged?.(value ?? null);
    }
    setHasConnectedAccount(value) {
        this.queueRuntimeConfigPatch({ hasConnectedAccount: value });
    }
    setCloudSyncEnabled(enabled) {
        // This affects future local work; in-flight turns retain their storage mode.
        this.queueRuntimeConfigPatch({ cloudSyncEnabled: Boolean(enabled) });
    }
    refreshLocalLlmCredentials() {
        this.queueRuntimeConfigPatch({
            localLlmCredentialsUpdatedAt: Date.now(),
        });
    }
    getStellaSiteAuth() {
        const baseUrl = readConfiguredBackendUrl(this.pendingConfig.backendUrl ?? null);
        const authToken = this.pendingConfig.authToken?.trim() || null;
        if (!baseUrl || !authToken) {
            return null;
        }
        return { baseUrl, authToken };
    }
    async agentHealthCheck() {
        try {
            const value = await this.host.healthCheck();
            this.lastHealth = value ?? { ready: false };
        }
        catch (error) {
            this.lastHealth = {
                ready: false,
                reason: error instanceof Error
                    ? error.message
                    : String(error ?? "Stella runtime client is not connected."),
            };
        }
        this.emitAvailabilityChange();
        return this.lastHealth;
    }
    async listModels(request = {}) {
        return await this.host.listModels(request);
    }
    async sendAgentInput(payload) {
        return await this.host.sendAgentInput(payload);
    }
    runAutomationTurn(payload) {
        return this.host.runAutomationTurn(payload);
    }
    runBlockingLocalAgent(payload) {
        return this.host.runBlockingLocalAgent(payload);
    }
    createBackgroundAgent(payload) {
        return this.host.createBackgroundAgent(payload);
    }
    persistVoiceTranscript(args) {
        return this.host.persistVoiceTranscript(args);
    }
    async handleVoiceChat(payload, callbacks) {
        // The caller may name the request so it can correlate the run's own
        // activity (the voice runtime does, to narrate backend progress). The
        // id used here and the id sent to the worker must be the same one, or
        // the subscription below filters out every event of its own run.
        const requestId = (typeof payload?.requestId === "string" && payload.requestId.trim()) ||
            globalThis.crypto?.randomUUID?.() ||
            `voice-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        let lastRunEventSeq = 0;
        let lastTaskEventSeq = 0;
        const activeTaskIds = new Set();
        const knownRunIds = new Set();
        let runTerminated = false;
        let unsubscribe = () => { };
        const maybeUnsubscribe = () => {
            if (!runTerminated || activeTaskIds.size > 0) {
                return;
            }
            unsubscribe();
        };
        const dispatch = (event) => {
            if (event.runId) {
                knownRunIds.add(event.runId);
            }
            const taskLifecycleEvent = isTaskLifecycleEventType(event.type);
            if (taskLifecycleEvent) {
                if (event.seq <= lastTaskEventSeq) {
                    return;
                }
                lastTaskEventSeq = event.seq;
            }
            else {
                if (event.seq <= lastRunEventSeq) {
                    return;
                }
                lastRunEventSeq = event.seq;
            }
            if (event.type === AGENT_STREAM_EVENT_TYPES.AGENT_STARTED &&
                event.agentId) {
                activeTaskIds.add(event.agentId);
            }
            else if (isTaskLifecycleTerminalType(event.type) && event.agentId) {
                activeTaskIds.delete(event.agentId);
            }
            switch (event.type) {
                case AGENT_STREAM_EVENT_TYPES.STATUS:
                    callbacks.onStatus?.(event);
                    break;
                case AGENT_STREAM_EVENT_TYPES.TOOL_START:
                    callbacks.onToolStart(event);
                    break;
                case AGENT_STREAM_EVENT_TYPES.TOOL_END:
                    callbacks.onToolEnd(event);
                    break;
                case AGENT_STREAM_EVENT_TYPES.RUN_FINISHED:
                    callbacks.onRunFinished(event);
                    break;
                default:
                    if (taskLifecycleEvent) {
                        callbacks.onAgentEvent?.({
                            type: event.type,
                            conversationId: payload.conversationId,
                            rootRunId: event.runId,
                            agentId: event.agentId ?? "",
                            agentType: event.agentType ?? "",
                            ...(event.description ? { description: event.description } : {}),
                            ...(event.parentAgentId
                                ? { parentAgentId: event.parentAgentId }
                                : {}),
                            ...(event.result ? { result: event.result } : {}),
                            ...(event.error ? { error: event.error } : {}),
                            ...(event.statusText ? { statusText: event.statusText } : {}),
                            ...(event.groupKey ? { groupKey: event.groupKey } : {}),
                            ...(event.groupLabel ? { groupLabel: event.groupLabel } : {}),
                        });
                    }
                    break;
            }
            if (isRunTerminalEvent(event.type)) {
                runTerminated = true;
            }
            maybeUnsubscribe();
        };
        const offEvent = this.host.on("voice-agent-event", (eventPayload) => {
            if (eventPayload.requestId !== requestId) {
                return;
            }
            dispatch(eventPayload.event);
        });
        unsubscribe = () => {
            offEvent();
        };
        try {
            return await this.host.voiceOrchestratorChat({
                ...payload,
                requestId,
            });
        }
        catch (error) {
            unsubscribe();
            throw error;
        }
    }
    getVoiceOrchestratorConfig(payload) {
        return this.host.voiceOrchestratorConfig(payload);
    }
    executeVoiceTool(payload) {
        return this.host.voiceExecuteTool(payload);
    }
    webSearch(query, options) {
        return this.host.webSearch(query, options);
    }
    voiceWebSearch(payload) {
        return this.host.voiceWebSearch(payload);
    }
    runOneShotCompletion(payload) {
        return this.host.runOneShotCompletion(payload);
    }
    listCronJobs() {
        return this.host.listCronJobs();
    }
    listHeartbeats() {
        return this.host.listHeartbeats();
    }
    runCronJob(jobId) {
        return this.host.runCronJob(jobId);
    }
    removeCronJob(jobId) {
        return this.host.removeCronJob(jobId);
    }
    updateCronJob(jobId, patch) {
        return this.host.updateCronJob(jobId, patch);
    }
    upsertHeartbeat(input) {
        return this.host.upsertHeartbeat(input);
    }
    runHeartbeat(conversationId) {
        return this.host.runHeartbeat(conversationId);
    }
    listConversationEvents(args) {
        return this.host.listConversationEvents(args);
    }
    getConversationEventCount(args) {
        return this.host.getConversationEventCount(args);
    }
    onScheduleUpdated(listener) {
        return this.host.on("schedule-updated", listener);
    }
    onModelCatalogUpdated(listener) {
        return this.host.on("model-catalog-updated", listener);
    }
    onLocalChatUpdated(listener) {
        return this.host.on("local-chat-updated", listener);
    }
    /** The pi-durable chat (`@stella/contracts/pi-chat`). */
    piChat(request) {
        return this.host.piChat(request);
    }
    onPiChatEvents(listener) {
        return this.host.on("pi-chat-events", listener);
    }
    async killAllShells() {
        await this.host.killAllShells();
    }
    killShellsByPort(port) {
        return this.host.killShellsByPort(port);
    }
    collectBrowserData(options) {
        return this.host.collectBrowserData(options);
    }
    collectAllSignals(options) {
        return this.host.collectAllSignals(options);
    }
    coreMemoryExists() {
        return this.host.coreMemoryExists();
    }
    discoveryKnowledgeExists() {
        return this.host.discoveryKnowledgeExists();
    }
    writeCoreMemory(content, options) {
        return this.host.writeCoreMemory(content, options);
    }
    writeDiscoveryKnowledge(payload) {
        return this.host.writeDiscoveryKnowledge(payload);
    }
    detectPreferredBrowserProfile() {
        return this.host.detectPreferredBrowserProfile();
    }
    listBrowserProfiles(browserType) {
        return this.host.listBrowserProfiles(browserType);
    }
    googleWorkspaceGetAuthStatus() {
        return this.host.googleWorkspaceGetAuthStatus();
    }
    googleWorkspaceConnect() {
        return this.host.googleWorkspaceConnect();
    }
    googleWorkspaceDisconnect() {
        return this.host.googleWorkspaceDisconnect();
    }
    answerRemoteExecutionRequest(params) {
        return this.host.answerRemoteExecutionRequest(params);
    }
}
