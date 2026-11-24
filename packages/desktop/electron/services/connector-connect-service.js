import { randomUUID } from "crypto";
import { BrowserWindow, shell } from "electron";
import { STELLA_BROWSER_EXTENSION_ID } from "@stella/node-shared/tools/stella-browser-bridge-config";
import { runIntegrationFlow } from "./integration-flows.js";
import { PendingRequestStore } from "./pending-request-store.js";
import {
  IPC_CONNECTOR_CONNECT_REQUEST,
  IPC_CONNECTOR_CONNECT_UPDATE,
} from "@stella/contracts/desktop/ipc-channels";
// Under Claude Code's 5-minute MCP tool idle timeout so the card always
// resolves (and disappears) before the agent-side wait gives up.
const CARD_TIMEOUT_MS = 4.5 * 60 * 1000;
const BROWSER_EXTENSION_WEB_STORE_URL = `https://chromewebstore.google.com/detail/${STELLA_BROWSER_EXTENSION_ID}`;
const EXTENSION_POLL_INTERVAL_MS = 2_000;
const EXTENSION_FLOW_TIMEOUT_MS = 4 * 60 * 1000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export class ConnectorConnectService {
    options;
    pending = new PendingRequestStore();
    meta = new Map();
    constructor(options) {
        this.options = options;
    }
    async requestConnection(payload) {
        const stellaAppDir = this.options.getStellaAppDir();
        if (!stellaAppDir) {
            return { ok: false, reason: "unsupported" };
        }
        const offer = await runIntegrationFlow("describeConnectorOffer", {
            getAuthToken: this.options.getAuthToken,
            getBackendUrl: this.options.getBackendUrl,
        }, { id: payload.id.trim().toLowerCase() });
        if (!offer?.ok) {
            return { ok: false, reason: "connector_unavailable" };
        }
        const { entry } = offer;
        const windowManager = this.options.windowManagerTarget.getWindowManager();
        const fullWindow = windowManager?.getFullWindow() ?? null;
        const targetWindows = fullWindow
            ? [fullWindow]
            : BrowserWindow.getAllWindows();
        if (targetWindows.length === 0) {
            return { ok: false, reason: "unsupported" };
        }
        const requestId = randomUUID();
        this.meta.set(requestId, {
            id: entry.id,
            name: entry.name,
            kind: "integration",
            state: "pending",
            ...(payload.offerId ? { offerId: payload.offerId } : {}),
            ...(payload.addAccount === true ? { addAccount: true } : {}),
            canonicalFingerprint: offer.fingerprint,
            oauthAbort: new AbortController(),
            windows: targetWindows,
        });
        const request = {
            requestId,
            id: entry.id,
            name: entry.name,
            description: entry.description,
            iconUrl: entry.iconUrl,
            category: entry.category,
            reason: payload.reason,
            kind: "integration",
            ...(payload.addAccount === true ? { addAccount: true } : {}),
            ...(payload.conversationId
                ? { conversationId: payload.conversationId }
                : {}),
        };
        const settled = new Promise((resolve) => {
            const timeout = setTimeout(() => {
                const meta = this.meta.get(requestId);
                if (!this.pending.has(requestId))
                    return;
                if (meta?.state === "connecting") {
                    meta.oauthAbort.abort(new Error("Connection timed out."));
                }
                this.settle(requestId, { ok: false, reason: "timeout" }, "timeout");
            }, CARD_TIMEOUT_MS);
            this.pending.set(requestId, {
                resolve,
                reject: () => undefined,
                timeout,
            });
        });
        for (const window of targetWindows) {
            if (window.isDestroyed())
                continue;
            window.webContents.send(IPC_CONNECTOR_CONNECT_REQUEST, request);
        }
        return settled;
    }
    async requestBrowserExtensionConnect(payload) {
        for (const meta of this.meta.values()) {
            if (meta.kind === "browser-extension") {
                return { ok: false, reason: "already_pending" };
            }
        }
        const windowManager = this.options.windowManagerTarget.getWindowManager();
        const fullWindow = windowManager?.getFullWindow() ?? null;
        const targetWindows = fullWindow
            ? [fullWindow]
            : BrowserWindow.getAllWindows();
        if (targetWindows.length === 0) {
            return { ok: false, reason: "unsupported" };
        }
        const requestId = randomUUID();
        this.meta.set(requestId, {
            id: "stella-browser-extension",
            name: "the Stella browser extension",
            kind: "browser-extension",
            state: "pending",
            ...(payload.offerId ? { offerId: payload.offerId } : {}),
            oauthAbort: new AbortController(),
            windows: targetWindows,
        });
        const request = {
            requestId,
            id: "stella-browser-extension",
            name: "Stella browser extension",
            description: "Lets Stella work in your own browser, in a tab group of its own, so sites open signed in as you.",
            reason: "Stella's browser works without it, but this task needs a site you're signed in to.",
            kind: "browser-extension",
            ...(payload.conversationId
                ? { conversationId: payload.conversationId }
                : {}),
        };
        const settled = new Promise((resolve) => {
            const timeout = setTimeout(() => {
                const meta = this.meta.get(requestId);
                if (!this.pending.has(requestId))
                    return;
                if (meta?.state === "connecting") {
                    meta.oauthAbort.abort(new Error("Connection timed out."));
                }
                this.settle(requestId, { ok: false, reason: "timeout" }, "timeout");
            }, CARD_TIMEOUT_MS);
            this.pending.set(requestId, {
                resolve,
                reject: () => undefined,
                timeout,
            });
        });
        for (const window of targetWindows) {
            if (window.isDestroyed())
                continue;
            window.webContents.send(IPC_CONNECTOR_CONNECT_REQUEST, request);
        }
        return settled;
    }
    respond(payload) {
        const meta = this.meta.get(payload.requestId);
        if (!meta || !this.pending.has(payload.requestId)) {
            return { ok: false, error: "Connect request not found." };
        }
        if (payload.action === "decline") {
            meta.oauthAbort.abort(new Error("Connection declined."));
            this.settle(payload.requestId, { ok: false, reason: "declined" }, "declined");
            return { ok: true };
        }
        if (payload.action === "cancel") {
            meta.oauthAbort.abort(new Error("Connection cancelled."));
            if (meta.state === "pending") {
                this.settle(payload.requestId, { ok: false, reason: "cancelled" }, "cancelled");
            }
            return { ok: true };
        }
        if (meta.state !== "pending") {
            return { ok: false, error: "Connect flow already started." };
        }
        meta.state = "connecting";
        this.broadcastUpdate(meta.windows, payload.requestId, "connecting");
        if (meta.kind === "browser-extension") {
            void this.runBrowserExtensionFlow(payload.requestId, meta);
        }
        else {
            void this.runConnectFlow(payload.requestId, meta);
        }
        return { ok: true };
    }
    cancelAll() {
        for (const [requestId, meta] of this.meta) {
            meta.oauthAbort.abort(new Error("Connection cancelled."));
            this.settle(requestId, { ok: false, reason: "cancelled" }, "cancelled");
        }
    }
    cancelByOfferId(offerId) {
        for (const [requestId, meta] of this.meta) {
            if (meta.offerId !== offerId)
                continue;
            meta.oauthAbort.abort(new Error("Connection cancelled."));
            if (meta.state === "pending") {
                this.settle(requestId, { ok: false, reason: "cancelled" }, "cancelled");
            }
            return { ok: true };
        }
        return { ok: false };
    }
    async runConnectFlow(requestId, meta) {
        const stellaAppDir = this.options.getStellaAppDir();
        if (!stellaAppDir) {
            this.settle(requestId, { ok: false, reason: "unsupported" }, "error", "Stella root is unavailable.");
            return;
        }
        const credentialService = this.options.connectorCredentialService;
        const flowOptions = {
            getAuthToken: this.options.getAuthToken,
            getBackendUrl: this.options.getBackendUrl,
            abortSignal: meta.oauthAbort.signal,
            requestPreregisteredOAuth: (payload) => credentialService.requestPreregisteredOAuth({
                ...payload,
                presentation: "headless",
                oauthAbort: meta.oauthAbort,
            }),
            requestExternalOAuthApproval: (payload) => credentialService.requestExternalOAuthApproval({
                ...payload,
                presentation: "headless",
            }),
            requestDeviceOAuth: (payload) => credentialService.requestDeviceOAuth(payload),
        };
        try {
            await runIntegrationFlow("connectConnectorOffer", flowOptions, {
                id: meta.id,
                name: meta.name,
                fingerprint: meta.canonicalFingerprint,
                addAccount: meta.addAccount === true,
            }, meta.oauthAbort.signal);
            this.settle(requestId, { ok: true, status: "connected" }, "connected");
        }
        catch (error) {
            if (!this.pending.has(requestId))
                return;
            const cancelled = meta.oauthAbort.signal.aborted;
            const message = error instanceof Error ? error.message : "Connection failed.";
            this.settle(requestId, { ok: false, reason: cancelled ? "cancelled" : message }, cancelled ? "cancelled" : "error", cancelled ? undefined : message);
        }
    }
    async runBrowserExtensionFlow(requestId, meta) {
        const signal = meta.oauthAbort.signal;
        const isConnected = async () => (await this.options.isBrowserExtensionConnected?.().catch(() => false)) === true;
        if (await isConnected()) {
            this.settle(requestId, { ok: true, status: "already_connected" }, "connected");
            return;
        }
        void shell
            .openExternal(BROWSER_EXTENSION_WEB_STORE_URL)
            .catch(() => undefined);
        const deadline = Date.now() + EXTENSION_FLOW_TIMEOUT_MS;
        while (Date.now() < deadline) {
            if (!this.pending.has(requestId))
                return;
            if (signal.aborted) {
                this.settle(requestId, { ok: false, reason: "cancelled" }, "cancelled");
                return;
            }
            if (await isConnected()) {
                if (this.pending.has(requestId)) {
                    this.settle(requestId, { ok: true, status: "connected" }, "connected");
                }
                return;
            }
            await sleep(EXTENSION_POLL_INTERVAL_MS);
        }
        if (this.pending.has(requestId)) {
            this.settle(requestId, { ok: false, reason: "timeout" }, "timeout");
        }
    }
    settle(requestId, outcome, phase, message) {
        const meta = this.meta.get(requestId);
        if (!this.pending.resolve(requestId, outcome))
            return;
        this.meta.delete(requestId);
        this.broadcastUpdate(meta?.windows ?? BrowserWindow.getAllWindows(), requestId, phase, message);
    }
    broadcastUpdate(windows, requestId, phase, message) {
        for (const window of windows) {
            if (window.isDestroyed())
                continue;
            window.webContents.send(IPC_CONNECTOR_CONNECT_UPDATE, {
                requestId,
                phase,
                ...(message ? { message } : {}),
            });
        }
    }
}
