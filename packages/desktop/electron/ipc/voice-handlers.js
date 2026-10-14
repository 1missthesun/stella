import { applyShortcutRegistration } from "./shortcut-registration.js";
import { getRealtimeVoicePreferences, loadLocalPreferences, resolveRealtimeVoiceId, saveLocalPreferences, } from "@stella/runtime/kernel/preferences/local-preferences";
import { DEFAULT_OPENAI_REALTIME_VOICE, DEFAULT_XAI_REALTIME_VOICE, buildXaiRealtimeClientSecretRequest, } from "@stella/contracts/realtime-voice-catalog";
import { getLocalLlmCredential } from "@stella/runtime/kernel/storage/llm-credentials";
import { getLocalLlmOAuthApiKey } from "@stella/runtime/kernel/storage/llm-oauth-credentials";
import {
  IPC_VOICE_CREATE_OPENAI_SESSION,
  IPC_VOICE_ORCHESTRATOR_CONFIG,
  IPC_VOICE_CREATE_XAI_SESSION,
  IPC_VOICE_REPORT_SESSION_ERROR,
  IPC_VOICE_RTC_TOGGLE,
  IPC_VOICE_SESSION_ERROR,
  IPC_VOICE_ORCHESTRATOR_ACTIVITY,
  IPC_DISPLAY_UPDATE,
  IPC_VOICE_RUNTIME_STATE,
  IPC_VOICE_REPORT_SESSION_ERROR_STATE,
  IPC_VOICE_SESSION_ERROR_STATE,
  IPC_VOICE_GET_SESSION_ERROR_STATE,
  IPC_VOICE_RTC_SET_SHORTCUT,
  IPC_VOICE_RTC_GET_SHORTCUT,
  IPC_VOICE_PERSIST_TRANSCRIPT,
  IPC_VOICE_ORCHESTRATOR_CHAT,
  IPC_VOICE_GET_RUNTIME_STATE,
} from "@stella/contracts/desktop/ipc-channels";
import { requireMatchingCloudConversationId, requireRequestedCloudConversationId, } from "../cloud-conversation-mode.js";
import { randomUUID } from "node:crypto";
import {
  handleIpc,
  onIpc,
} from "./typed-ipc.js";
const DEFAULT_OPENAI_REALTIME_MODEL = "gpt-realtime-2.1";
const DEFAULT_XAI_REALTIME_MODEL = "grok-voice-think-fast-1.0";
const DEFAULT_RUNTIME_STATE = {
    sessionState: "idle",
    isConnected: false,
    isSpeaking: false,
    isUserSpeaking: false,
    micLevel: 0,
    outputLevel: 0,
};
export const registerVoiceHandlers = (options) => {
    let currentVoiceRtcShortcut = "";
    let runtimeState = DEFAULT_RUNTIME_STATE;
    const ts = () => {
        const d = new Date();
        return `${d.toLocaleTimeString("en-US", { hour12: false })}.${String(d.getMilliseconds()).padStart(3, "0")}`;
    };
    const emitVoiceOrchestratorActivity = (activity) => {
        for (const window of options.windowManager.getAllWindows()) {
            if (window.isDestroyed())
                continue;
            window.webContents.send(IPC_VOICE_ORCHESTRATOR_ACTIVITY, activity);
        }
    };
    const emitVoiceDisplayPayload = (payload) => {
        for (const window of options.windowManager.getAllWindows()) {
            if (window.isDestroyed())
                continue;
            window.webContents.send(IPC_DISPLAY_UPDATE, payload);
        }
    };
    const asRecord = (value) => value && typeof value === "object" && !Array.isArray(value)
        ? value
        : null;
    const errorMessage = (value) => value instanceof Error ? value.message : String(value ?? "Unknown error");
    const requireCurrentVoiceConversation = (value) => requireMatchingCloudConversationId(value, options.uiState.conversationId);
    const resolveVoiceConversation = (remote, value) => remote
        ? requireRequestedCloudConversationId(value, options.getActiveCloudConversationCacheAuthority?.() ?? null)
        : requireCurrentVoiceConversation(value);
    const CLOUD_VOICE_APPEND_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
    const withTranscriptIdentity = (payload) => {
        const eventId = typeof payload?.eventId === "string" &&
            CLOUD_VOICE_APPEND_ID_PATTERN.test(payload.eventId.trim())
            ? payload.eventId.trim()
            : `voice:${randomUUID()}`;
        const timestamp = typeof payload?.timestamp === "number" &&
            Number.isFinite(payload.timestamp) &&
            payload.timestamp >= 0
            ? payload.timestamp
            : Date.now();
        return { ...payload, eventId, timestamp };
    };
    const htmlDisplayPayloadFromVoiceTool = (payload, result) => {
        if (payload.name !== "html" || result.error)
            return null;
        const details = asRecord(result.details);
        const filePath = typeof details?.filePath === "string" && details.filePath.trim()
            ? details.filePath.trim()
            : "";
        if (!filePath)
            return null;
        return {
            kind: "canvas-html",
            filePath,
            ...(typeof details?.title === "string" && details.title.trim()
                ? { title: details.title.trim() }
                : {}),
            ...(typeof details?.slug === "string" && details.slug.trim()
                ? { slug: details.slug.trim() }
                : {}),
            ...(typeof details?.createdAt === "number" &&
                Number.isFinite(details.createdAt)
                ? { createdAt: details.createdAt }
                : {}),
        };
    };
    const broadcastRuntimeState = () => {
        const windows = options.windowManager.getAllWindows();
        for (const window of windows) {
            if (window.isDestroyed())
                continue;
            window.webContents.send(IPC_VOICE_RUNTIME_STATE, runtimeState);
        }
    };
    const emitVoiceSessionErrorToast = (message) => {
        const trimmed = typeof message === "string" ? message.trim() : "";
        if (!trimmed)
            return;
        const target = options.windowManager.getFullWindow();
        if (target && !target.isDestroyed()) {
            target.webContents.send(IPC_VOICE_SESSION_ERROR, trimmed);
        }
    };
    onIpc(IPC_VOICE_REPORT_SESSION_ERROR, (_event, message) => {
        emitVoiceSessionErrorToast(message);
    });
    let lastVoiceSessionError = "";
    onIpc(IPC_VOICE_REPORT_SESSION_ERROR_STATE, (_event, message) => {
        lastVoiceSessionError = typeof message === "string" ? message.trim() : "";
        for (const window of options.windowManager.getAllWindows()) {
            if (window.isDestroyed())
                continue;
            window.webContents.send(IPC_VOICE_SESSION_ERROR_STATE, lastVoiceSessionError);
        }
    });
    handleIpc(IPC_VOICE_GET_SESSION_ERROR_STATE, () => lastVoiceSessionError);
    const toggleVoiceRtc = () => {
        if (!options.getAppReady())
            return;
        options.toggleRealtimeVoice();
    };
    onIpc(IPC_VOICE_RTC_TOGGLE, (event) => {
        if (!options.assertPrivilegedSender(event, IPC_VOICE_RTC_TOGGLE))
            return;
        toggleVoiceRtc();
    });
    const loadConfiguredShortcut = () => {
        return loadLocalPreferences(options.stellaAppDir).voiceRtcShortcut;
    };
    const saveConfiguredShortcut = (shortcut) => {
        const prefs = loadLocalPreferences(options.stellaAppDir);
        prefs.voiceRtcShortcut = shortcut;
        saveLocalPreferences(options.stellaAppDir, prefs);
    };
    const initialVoiceRtcShortcut = applyShortcutRegistration({
        label: "Voice realtime",
        requestedShortcut: loadConfiguredShortcut(),
        currentShortcut: currentVoiceRtcShortcut,
        callback: toggleVoiceRtc,
    });
    currentVoiceRtcShortcut = initialVoiceRtcShortcut.activeShortcut;
    if (!initialVoiceRtcShortcut.ok) {
        console.warn("[voice]", initialVoiceRtcShortcut.error);
    }
    handleIpc(IPC_VOICE_RTC_SET_SHORTCUT, (_event, shortcut) => {
        const result = applyShortcutRegistration({
            label: "Voice realtime",
            requestedShortcut: shortcut,
            currentShortcut: currentVoiceRtcShortcut,
            callback: toggleVoiceRtc,
        });
        currentVoiceRtcShortcut = result.activeShortcut;
        if (!result.ok) {
            console.warn("[voice]", result.error);
        }
        else {
            saveConfiguredShortcut(result.activeShortcut);
        }
        return result;
    });
    handleIpc(IPC_VOICE_RTC_GET_SHORTCUT, () => currentVoiceRtcShortcut);
    handleIpc(IPC_VOICE_CREATE_OPENAI_SESSION, async (_event, payload) => {
        const preferences = getRealtimeVoicePreferences(options.stellaAppDir);
        if (preferences.provider !== "openai") {
            throw new Error("OpenAI is not selected for voice.");
        }
        const apiKey = getLocalLlmCredential(options.stellaAppDir, "openai")?.trim() ||
            (await getLocalLlmOAuthApiKey(options.stellaAppDir, "openai"))?.trim();
        if (!apiKey) {
            throw new Error("Connect OpenAI in Settings to use it for voice.");
        }
        const model = preferences.model?.startsWith("openai/")
            ? preferences.model.slice("openai/".length)
            : preferences.model || DEFAULT_OPENAI_REALTIME_MODEL;
        const voice = resolveRealtimeVoiceId(preferences, "openai", DEFAULT_OPENAI_REALTIME_VOICE);
        const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                session: {
                    type: "realtime",
                    model,
                    instructions: typeof payload?.instructions === "string"
                        ? payload.instructions
                        : undefined,
                    audio: {
                        output: {
                            voice,
                        },
                    },
                },
            }),
        });
        if (!response.ok) {
            throw new Error(`Failed to create OpenAI voice session: ${response.status} ${await response.text()}`);
        }
        const data = (await response.json());
        const clientSecret = typeof data.value === "string"
            ? data.value
            : typeof data.client_secret?.value === "string"
                ? data.client_secret.value
                : null;
        if (!clientSecret) {
            throw new Error("OpenAI voice session response did not include a client secret.");
        }
        return {
            provider: "openai",
            clientSecret,
            model: typeof data.session?.model === "string" ? data.session.model : model,
            voice,
            expiresAt: typeof data.expires_at === "number"
                ? data.expires_at
                : typeof data.client_secret?.expires_at === "number"
                    ? data.client_secret.expires_at
                    : undefined,
            sessionId: typeof data.session?.id === "string" ? data.session.id : undefined,
        };
    });
    handleIpc(IPC_VOICE_CREATE_XAI_SESSION, async (_event, _payload) => {
        const preferences = getRealtimeVoicePreferences(options.stellaAppDir);
        if (preferences.provider !== "xai") {
            throw new Error("xAI is not selected for voice.");
        }
        const apiKey = getLocalLlmCredential(options.stellaAppDir, "xai")?.trim() ||
            (await getLocalLlmOAuthApiKey(options.stellaAppDir, "xai"))?.trim();
        if (!apiKey) {
            throw new Error("Connect xAI in Settings to use it for voice.");
        }
        const model = preferences.model?.startsWith("xai/")
            ? preferences.model.slice("xai/".length)
            : preferences.model || DEFAULT_XAI_REALTIME_MODEL;
        const voice = resolveRealtimeVoiceId(preferences, "xai", DEFAULT_XAI_REALTIME_VOICE);
        // The browser WebSocket cannot attach an Authorization header, so it
        // must use an ephemeral token. Voice/instructions/tools are configured
        // after connection via session.update; xAI rejects them on this
        // client-secret endpoint.
        let clientSecret = null;
        let expiresAt;
        const response = await fetch("https://api.x.ai/v1/realtime/client_secrets", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(buildXaiRealtimeClientSecretRequest()),
        });
        if (!response.ok) {
            throw new Error(`Failed to create xAI voice session: ${response.status} ${await response.text()}`);
        }
        const data = (await response.json());
        if (typeof data.value === "string") {
            clientSecret = data.value;
        }
        else if (typeof data.client_secret?.value === "string") {
            clientSecret = data.client_secret.value;
        }
        if (typeof data.expires_at === "number") {
            expiresAt = data.expires_at;
        }
        else if (typeof data.client_secret?.expires_at === "number") {
            expiresAt = data.client_secret.expires_at;
        }
        if (!clientSecret) {
            throw new Error("xAI voice session response did not include a client secret.");
        }
        return {
            provider: "xai",
            clientSecret,
            model,
            voice,
            expiresAt,
        };
    });
    onIpc(IPC_VOICE_PERSIST_TRANSCRIPT, (_event, payload) => {
        let conversationId;
        try {
            conversationId = resolveVoiceConversation(false, payload?.conversationId);
        }
        catch (error) {
            console.warn("[voice] Rejected stale transcript:", errorMessage(error));
            return;
        }
        const currentPayload = withTranscriptIdentity({ ...payload, conversationId });
        console.log(`[${ts()}] [Voice RTC] ${currentPayload.role.toUpperCase()}: ${currentPayload.text}`);
        const stellaHostRunner = options.getStellaHostRunner();
        if (!stellaHostRunner) {
            return;
        }
        stellaHostRunner.persistVoiceTranscript(currentPayload).catch((err) => {
            console.debug("[voice] transcript persistence failed (best-effort):", err.message);
        });
    });
    handleIpc(IPC_VOICE_ORCHESTRATOR_CHAT, async (_event, payload) => {
        if (!options.uiState.isVoiceRtcActive) {
            throw new Error("Voice mode is no longer active.");
        }
        const conversationId = requireCurrentVoiceConversation(payload?.conversationId);
        const requestId = typeof payload?.requestId === "string" && payload.requestId.trim()
            ? payload.requestId.trim()
            : `voice:${randomUUID()}`;
        console.log(`[${ts()}] [Voice] orchestratorChat request:`, payload.message);
        const stellaHostRunner = options.getStellaHostRunner();
        if (!stellaHostRunner) {
            throw new Error("Stella runtime not initialized");
        }
        return await stellaHostRunner.handleVoiceChat({ ...payload, requestId, conversationId }, {
            onStatus: (event) => {
                emitVoiceOrchestratorActivity({
                    requestId,
                    kind: "status",
                    statusText: event?.statusText ?? event?.text,
                });
            },
            onToolStart: (event) => {
                emitVoiceOrchestratorActivity({
                    requestId,
                    kind: "tool-start",
                    toolName: event?.toolName,
                    toolCallId: event?.toolCallId,
                });
            },
            onToolEnd: (event) => {
                emitVoiceOrchestratorActivity({
                    requestId,
                    kind: "tool-end",
                    toolName: event?.toolName,
                    toolCallId: event?.toolCallId,
                    isError: Boolean(event?.error),
                });
            },
            onRunFinished: (event) => {
                if (event.outcome === "error") {
                    console.error(`[${ts()}] [Voice] orchestratorChat error:`, event.error ?? event.reason);
                }
            },
        });
    });
    const voiceConfig = async (remote, payload) => {
        const conversationId = resolveVoiceConversation(remote, payload?.conversationId);
        const stellaHostRunner = options.getStellaHostRunner();
        if (!stellaHostRunner) {
            throw new Error("Stella runtime not initialized");
        }
        return await stellaHostRunner.getVoiceOrchestratorConfig({
            ...payload,
            conversationId,
        });
    };
    handleIpc(IPC_VOICE_ORCHESTRATOR_CONFIG, async (_event, payload) => await voiceConfig(false, payload));
    const executeVoiceTool = async (remote, payload) => {
        const conversationId = resolveVoiceConversation(remote, payload?.conversationId);
        const currentPayload = { ...payload, conversationId };
        const stellaHostRunner = options.getStellaHostRunner();
        if (!stellaHostRunner) {
            throw new Error("Stella runtime not initialized");
        }
        const result = await stellaHostRunner.executeVoiceTool(currentPayload);
        const displayPayload = htmlDisplayPayloadFromVoiceTool(currentPayload, result);
        if (displayPayload) {
            emitVoiceDisplayPayload(displayPayload);
        }
        return result;
    };
    handleIpc(IPC_VOICE_GET_RUNTIME_STATE, () => runtimeState);
    onIpc(IPC_VOICE_RUNTIME_STATE, (_event, nextState) => {
        runtimeState = {
            sessionState: nextState?.sessionState ?? "idle",
            isConnected: Boolean(nextState?.isConnected),
            isSpeaking: Boolean(nextState?.isSpeaking),
            isUserSpeaking: Boolean(nextState?.isUserSpeaking),
            micLevel: Number.isFinite(nextState?.micLevel)
                ? Math.max(0, Number(nextState.micLevel))
                : 0,
            outputLevel: Number.isFinite(nextState?.outputLevel)
                ? Math.max(0, Number(nextState.outputLevel))
                : 0,
        };
        broadcastRuntimeState();
    });
    return {
        configForRequest: (payload) => voiceConfig(true, payload),
        executeToolForRequest: (payload) => executeVoiceTool(true, payload),
    };
};
