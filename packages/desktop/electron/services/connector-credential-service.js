import { randomUUID } from "crypto";
import { shell } from "electron";
import { beginConnectorDeviceOAuth, completeConnectorDeviceOAuth, connectConnectorOAuth, connectPreregisteredConnectorOAuth, saveConnectorAccessToken, } from "@stella/runtime/kernel/connectors/oauth";
import { PendingRequestStore } from "./pending-request-store.js";
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const callerOf = (payload) => ({
    ...(payload.conversationId ? { conversationId: payload.conversationId } : {}),
    ...(payload.agentId ? { agentId: payload.agentId } : {}),
    ...(payload.toolCallId ? { toolCallId: payload.toolCallId } : {}),
});
export class ConnectorCredentialService {
    options;
    pending = new PendingRequestStore();
    meta = new Map();
    pendingExternalOAuthCallbacks = new Map();
    constructor(options) {
        this.options = options;
    }
    async requestCredential(payload) {
        return await this.enqueueRequest({
            ...payload,
            kind: "credential",
        });
    }
    async requestExternalOAuthApproval(payload) {
        return await this.enqueueRequest({
            tokenKey: payload.tokenKey,
            displayName: payload.displayName,
            authType: "oauth",
            resourceUrl: payload.resourceUrl,
            description: payload.description,
            presentation: payload.presentation,
            kind: "external_approval",
        });
    }
    async requestPreregisteredOAuth(payload) {
        return await this.enqueueRequest({
            tokenKey: payload.tokenKey,
            displayName: payload.displayName,
            authType: "oauth",
            resourceUrl: payload.resourceUrl ?? payload.authorizationEndpoint,
            oauthClientId: payload.clientId,
            scopes: payload.scopes,
            scopeSeparator: payload.scopeSeparator,
            description: payload.description,
            presentation: payload.presentation,
            oauthAbort: payload.oauthAbort,
            ...callerOf(payload),
            kind: "credential",
            preregisteredOAuth: {
                clientId: payload.clientId,
                authorizationEndpoint: payload.authorizationEndpoint,
                tokenEndpoint: payload.tokenEndpoint,
                responseType: payload.responseType,
                resourceUrl: payload.resourceUrl,
                oauthResource: payload.oauthResource,
                callbackUrl: payload.callbackUrl,
                callbackId: payload.callbackId,
                callbackMode: payload.callbackMode,
                usesPkce: payload.usesPkce,
                authorizationRedirectParam: payload.authorizationRedirectParam,
                authorizationParams: payload.authorizationParams,
                tokenRedirectParam: payload.tokenRedirectParam,
                tokenAuth: payload.tokenAuth,
                tokenExchange: payload.tokenExchange,
            },
        });
    }
    async requestDeviceOAuth(payload) {
        const stellaAppDir = this.options.getStellaAppDir();
        if (!stellaAppDir) {
            return { ok: false, reason: "unsupported" };
        }
        const oauthAbort = new AbortController();
        const authorization = await beginConnectorDeviceOAuth({
            clientId: payload.clientId,
            deviceAuthorizationEndpoint: payload.deviceAuthorizationEndpoint,
            scopes: payload.scopes,
            signal: oauthAbort.signal,
        });
        const verificationUri = authorization.verification_uri_complete ||
            authorization.verification_uri ||
            payload.verificationUri;
        return await this.enqueueRequest({
            tokenKey: payload.tokenKey,
            displayName: payload.displayName,
            authType: "oauth",
            resourceUrl: verificationUri,
            scopes: payload.scopes,
            description: payload.description ??
                `Stella needs to open ${payload.displayName} in your browser. Enter the code shown here to approve the connection.`,
            ...callerOf(payload),
            kind: "credential",
            oauthUserCode: authorization.user_code,
            oauthVerificationUri: verificationUri,
            oauthAbort,
            deviceOAuth: {
                clientId: payload.clientId,
                deviceAuthorizationEndpoint: payload.deviceAuthorizationEndpoint,
                tokenEndpoint: payload.tokenEndpoint,
                resourceUrl: payload.resourceUrl,
                verificationUri,
                authorization,
            },
        });
    }
    async enqueueRequest(payload) {
        const stellaAppDir = this.options.getStellaAppDir();
        if (!stellaAppDir) {
            return { ok: false, reason: "unsupported" };
        }
        const mode = payload.authType === "oauth" ? "oauth" : "api_key";
        if (mode === "oauth" && !payload.resourceUrl) {
            return { ok: false, reason: "oauth_requires_resource_url" };
        }
        const requestId = randomUUID();
        const request = {
            requestId,
            tokenKey: payload.tokenKey,
            displayName: payload.displayName,
            mode,
            completionMode: payload.kind === "external_approval" ? "approve" : "wait",
            description: payload.description,
            placeholder: payload.placeholder,
            oauthUserCode: payload.oauthUserCode,
            oauthVerificationUri: payload.oauthVerificationUri,
        };
        const oauthAbort = payload.oauthAbort ??
            (mode === "oauth" ? new AbortController() : undefined);
        this.meta.set(requestId, {
            tokenKey: payload.tokenKey,
            mode,
            kind: payload.kind,
            resourceUrl: payload.resourceUrl,
            oauthAbort,
            oauthStarted: false,
            oauthFlow: mode === "oauth" &&
                payload.kind === "credential" &&
                payload.preregisteredOAuth
                ? {
                    type: "preregistered",
                    stellaAppDir,
                    tokenKey: payload.tokenKey,
                    clientId: payload.preregisteredOAuth.clientId,
                    authorizationEndpoint: payload.preregisteredOAuth.authorizationEndpoint,
                    tokenEndpoint: payload.preregisteredOAuth.tokenEndpoint,
                    responseType: payload.preregisteredOAuth.responseType,
                    resourceUrl: payload.preregisteredOAuth.resourceUrl,
                    oauthResource: payload.preregisteredOAuth.oauthResource,
                    callbackUrl: payload.preregisteredOAuth.callbackUrl,
                    callbackId: payload.preregisteredOAuth.callbackId,
                    callbackMode: payload.preregisteredOAuth.callbackMode,
                    tokenExchange: payload.preregisteredOAuth.tokenExchange,
                    usesPkce: payload.preregisteredOAuth.usesPkce,
                    authorizationRedirectParam: payload.preregisteredOAuth.authorizationRedirectParam,
                    authorizationParams: payload.preregisteredOAuth.authorizationParams,
                    tokenRedirectParam: payload.preregisteredOAuth.tokenRedirectParam,
                    tokenAuth: payload.preregisteredOAuth.tokenAuth,
                    scopes: payload.scopes,
                    scopeSeparator: payload.scopeSeparator,
                    signal: oauthAbort.signal,
                }
                : mode === "oauth" &&
                    payload.kind === "credential" &&
                    payload.deviceOAuth
                    ? {
                        type: "device",
                        stellaAppDir,
                        tokenKey: payload.tokenKey,
                        clientId: payload.deviceOAuth.clientId,
                        deviceAuthorizationEndpoint: payload.deviceOAuth.deviceAuthorizationEndpoint,
                        tokenEndpoint: payload.deviceOAuth.tokenEndpoint,
                        resourceUrl: payload.deviceOAuth.resourceUrl,
                        verificationUri: payload.deviceOAuth.verificationUri,
                        scopes: payload.scopes,
                        authorization: payload.deviceOAuth.authorization,
                        signal: oauthAbort.signal,
                    }
                    : mode === "oauth" &&
                        payload.kind === "credential" &&
                        payload.resourceUrl
                        ? {
                            type: "mcp",
                            stellaAppDir,
                            tokenKey: payload.tokenKey,
                            resourceUrl: payload.resourceUrl,
                            oauthClientId: payload.oauthClientId,
                            oauthResource: payload.oauthResource,
                            scopes: payload.scopes,
                            signal: oauthAbort.signal,
                        }
                        : undefined,
        });
        const headless = payload.presentation === "headless";
        const settled = new Promise((resolve) => {
            const timeout = headless
                ? setTimeout(() => {
                    if (this.pending.has(requestId)) {
                        oauthAbort?.abort(new Error("Connector authorization timed out."));
                        this.pending.resolve(requestId, { ok: false, reason: "timeout" });
                        this.meta.delete(requestId);
                    }
                }, REQUEST_TIMEOUT_MS)
                : undefined;
            this.pending.set(requestId, {
                resolve,
                reject: () => undefined,
                timeout,
            });
        });
        if (headless) {
            if (payload.kind === "external_approval") {
                if (payload.resourceUrl) {
                    void shell
                        .openExternal(payload.resourceUrl)
                        .then(() => {
                        this.pending.resolve(requestId, { ok: true });
                        this.meta.delete(requestId);
                    })
                        .catch((error) => {
                        this.pending.resolve(requestId, {
                            ok: false,
                            reason: error.message || "Could not open the browser.",
                        });
                        this.meta.delete(requestId);
                    });
                }
                else {
                    this.pending.resolve(requestId, {
                        ok: false,
                        reason: "unsupported",
                    });
                    this.meta.delete(requestId);
                }
                return settled;
            }
            const headlessMeta = this.meta.get(requestId);
            if (headlessMeta?.oauthFlow && !headlessMeta.oauthStarted) {
                headlessMeta.oauthStarted = true;
                void this.runOauthFlow({
                    requestId,
                    ...headlessMeta.oauthFlow,
                });
            }
            else {
                this.pending.resolve(requestId, { ok: false, reason: "unsupported" });
                this.meta.delete(requestId);
            }
            return settled;
        }
        void this.askInChat(requestId, request, payload).catch((error) => {
            this.finish(requestId, {
                ok: false,
                reason: error instanceof Error ? error.message : "Connector credential request failed.",
            });
        });
        return settled;
    }
    finish(requestId, outcome) {
        if (!this.pending.has(requestId))
            return;
        this.pending.resolve(requestId, outcome);
        this.meta.delete(requestId);
    }
    async askInChat(requestId, request, payload) {
        const userAsks = this.options.getUserAskService?.();
        const conversationId = payload.conversationId || this.options.getActiveConversationId?.() || "";
        if (!userAsks || !conversationId) {
            this.finish(requestId, { ok: false, reason: "unsupported" });
            return;
        }
        const name = request.displayName;
        const context = { ...callerOf(payload), conversationId };
        const ask = request.mode === "api_key"
            ? {
                ...context,
                purpose: `Connect ${name}`,
                detail: request.description ??
                    `Stella needs your ${name} key to use it. It is saved on this computer for ${name} only and never shown to the agent.`,
                fields: [
                    {
                        id: "credential",
                        label: `${name} key`,
                        type: "secret",
                        sensitive: true,
                        ...(request.placeholder ? { placeholder: request.placeholder } : {}),
                    },
                ],
            }
            : {
                ...context,
                purpose: `Connect ${name}`,
                detail: request.oauthUserCode
                    ? `${request.description ?? `Stella needs to open ${name} in your browser.`} Enter this code there: ${request.oauthUserCode}`
                    : request.description ?? `Stella needs you to sign in to ${name} in your browser.`,
                fields: [
                    {
                        id: "connect",
                        label: `Sign in to ${name}`,
                        type: "choice",
                        sensitive: false,
                        choices: [
                            { id: "open", label: "Open the sign-in page" },
                            { id: "decline", label: "Not now" },
                        ],
                    },
                ],
            };
        const resolution = await userAsks.requestSecureInput(ask);
        const current = this.meta.get(requestId);
        if (!current || !this.pending.has(requestId)) {
            if (resolution?.handles?.credential)
                await userAsks.takeSecureValue(resolution.handles.credential);
            return;
        }
        if (resolution?.outcome !== "answered") {
            current.oauthAbort?.abort(new Error("Connector authorization cancelled."));
            this.finish(requestId, { ok: false, reason: resolution?.outcome === "expired" ? "timeout" : "cancelled" });
            return;
        }
        if (current.mode === "api_key") {
            const handle = resolution.handles?.credential;
            const value = handle ? (await userAsks.takeSecureValue(handle))?.trim() : "";
            const stellaAppDir = this.options.getStellaAppDir();
            if (!value || !stellaAppDir) {
                this.finish(requestId, { ok: false, reason: value ? "unsupported" : "cancelled" });
                return;
            }
            await saveConnectorAccessToken(stellaAppDir, current.tokenKey, value);
            this.finish(requestId, { ok: true });
            return;
        }
        if (resolution.values?.connect !== "open") {
            current.oauthAbort?.abort(new Error("Connector authorization cancelled."));
            this.finish(requestId, { ok: false, reason: "cancelled" });
            return;
        }
        if (current.kind === "external_approval") {
            if (current.resourceUrl)
                await shell.openExternal(current.resourceUrl);
            this.finish(requestId, { ok: true });
            return;
        }
        if (!current.oauthFlow) {
            this.finish(requestId, { ok: false, reason: "OAuth flow is missing connection details." });
            return;
        }
        if (!current.oauthStarted) {
            current.oauthStarted = true;
            await this.runOauthFlow({ requestId, ...current.oauthFlow });
        }
    }
    backendTokenExchangeEndpoint() {
        const backendUrl = this.options
            .getBackendUrl?.()
            ?.trim()
            .replace(/\/+$/u, "");
        return backendUrl ? `${backendUrl}/api/native-oauth/token` : null;
    }
    waitForExternalOAuthCallback = async (args) => {
        if (!args.redirectUri) {
            throw new Error("Missing OAuth redirect URI.");
        }
        if (this.pendingExternalOAuthCallbacks.has(args.state)) {
            throw new Error("OAuth callback state collision.");
        }
        let settled = false;
        let abortHandler = null;
        const waitForCallback = new Promise((resolve, reject) => {
            const cleanup = () => {
                this.pendingExternalOAuthCallbacks.delete(args.state);
                if (abortHandler && args.signal) {
                    args.signal.removeEventListener("abort", abortHandler);
                }
            };
            abortHandler = () => {
                if (settled)
                    return;
                settled = true;
                cleanup();
                reject(args.signal?.reason instanceof Error
                    ? args.signal.reason
                    : new Error("Connector authorization cancelled."));
            };
            this.pendingExternalOAuthCallbacks.set(args.state, {
                callbackId: args.callbackId,
                resolve: (callback) => {
                    if (settled)
                        return;
                    settled = true;
                    cleanup();
                    resolve(callback);
                },
                reject: (error) => {
                    if (settled)
                        return;
                    settled = true;
                    cleanup();
                    reject(error);
                },
                cleanup,
            });
            if (args.signal) {
                if (args.signal.aborted) {
                    abortHandler();
                }
                else {
                    args.signal.addEventListener("abort", abortHandler, { once: true });
                }
            }
        });
        const waitForCode = waitForCallback.then((callback) => {
            if (!callback.code) {
                throw new Error("OAuth callback did not include a code.");
            }
            return callback.code;
        });
        return { waitForCallback, waitForCode };
    };
    handleExternalOAuthCallback(url) {
        let parsed;
        try {
            parsed = new URL(url);
        }
        catch {
            return false;
        }
        if (parsed.protocol.toLowerCase() !== "stella:")
            return false;
        if (parsed.hostname.trim().toLowerCase() !== "oauth")
            return false;
        const pathParts = parsed.pathname
            .split("/")
            .map((part) => part.trim())
            .filter(Boolean);
        if (pathParts[0] !== "callback")
            return true;
        const callbackId = pathParts[1]?.toLowerCase();
        const state = parsed.searchParams.get("state")?.trim();
        if (!state)
            return true;
        const pending = this.pendingExternalOAuthCallbacks.get(state);
        if (!pending)
            return true;
        if (pending.callbackId &&
            callbackId &&
            pending.callbackId.toLowerCase() !== callbackId) {
            pending.reject(new Error("OAuth callback provider did not match."));
            return true;
        }
        const error = parsed.searchParams.get("error");
        if (error) {
            const description = parsed.searchParams.get("error_description");
            pending.reject(new Error(description
                ? `OAuth provider returned ${error}: ${description}`
                : `OAuth provider returned ${error}`));
            return true;
        }
        const code = parsed.searchParams.get("code");
        const accessToken = parsed.searchParams.get("access_token");
        if (!code && !accessToken) {
            pending.reject(new Error("OAuth callback did not include a code or access token."));
            return true;
        }
        const expiresIn = Number(parsed.searchParams.get("expires_in"));
        pending.resolve({
            state,
            ...(code ? { code } : {}),
            ...(accessToken ? { accessToken } : {}),
            ...(Number.isFinite(expiresIn) && expiresIn > 0 ? { expiresIn } : {}),
            ...(parsed.searchParams.get("scope")
                ? { scope: parsed.searchParams.get("scope") }
                : {}),
        });
        return true;
    }
    async runOauthFlow(args) {
        try {
            if (args.type === "device") {
                const verificationUri = args.verificationUri || args.authorization?.verification_uri;
                if (verificationUri)
                    await shell.openExternal(verificationUri);
                await completeConnectorDeviceOAuth(args.stellaAppDir, {
                    tokenKey: args.tokenKey,
                    clientId: args.clientId,
                    tokenEndpoint: args.tokenEndpoint,
                    authorization: args.authorization,
                    resourceUrl: args.resourceUrl,
                    scopes: args.scopes,
                    signal: args.signal,
                });
            }
            else if (args.type === "preregistered") {
                const backendTokenExchangeEndpoint = args.tokenExchange?.type === "backend"
                    ? this.backendTokenExchangeEndpoint()
                    : null;
                const backendAuthToken = args.tokenExchange?.type === "backend"
                    ? await this.options.getAuthToken?.()
                    : null;
                if (args.tokenExchange?.type === "backend" &&
                    !backendTokenExchangeEndpoint) {
                    throw new Error("Stella backend OAuth exchange is unavailable.");
                }
                await connectPreregisteredConnectorOAuth(args.stellaAppDir, {
                    tokenKey: args.tokenKey,
                    clientId: args.clientId,
                    authorizationEndpoint: args.authorizationEndpoint,
                    tokenEndpoint: args.tokenEndpoint,
                    responseType: args.responseType,
                    resourceUrl: args.resourceUrl,
                    oauthResource: args.oauthResource,
                    callbackUrl: args.callbackUrl,
                    callbackId: args.callbackId,
                    callbackWaiter: args.callbackMode === "external"
                        ? this.waitForExternalOAuthCallback
                        : undefined,
                    scopes: args.scopes,
                    scopeSeparator: args.scopeSeparator,
                    usesPkce: args.usesPkce,
                    authorizationRedirectParam: args.authorizationRedirectParam,
                    authorizationParams: args.authorizationParams,
                    tokenRedirectParam: args.tokenRedirectParam,
                    tokenAuth: args.tokenAuth,
                    tokenExchange: args.tokenExchange?.type === "backend" &&
                        backendTokenExchangeEndpoint
                        ? {
                            type: "backend",
                            endpoint: backendTokenExchangeEndpoint,
                            provider: args.tokenExchange.provider,
                            authToken: backendAuthToken,
                        }
                        : undefined,
                    openUrl: (url) => shell.openExternal(url),
                    signal: args.signal,
                });
            }
            else {
                await connectConnectorOAuth(args.stellaAppDir, {
                    tokenKey: args.tokenKey,
                    resourceUrl: args.resourceUrl,
                    oauthClientId: args.oauthClientId,
                    oauthResource: args.oauthResource ?? undefined,
                    callbackId: args.callbackId,
                    scopes: args.scopes,
                    openUrl: (url) => shell.openExternal(url),
                    signal: args.signal,
                });
            }
            this.finish(args.requestId, { ok: true });
        }
        catch (error) {
            if (!this.pending.has(args.requestId))
                return;
            const message = error instanceof Error ? error.message : "OAuth connection failed.";
            const reason = args.signal.aborted ? "cancelled" : message;
            this.finish(args.requestId, { ok: false, reason });
        }
    }
    cancelAll() {
        for (const [requestId, meta] of this.meta) {
            meta.oauthAbort?.abort(new Error("Connector authorization cancelled."));
            this.pending.resolve(requestId, { ok: false, reason: "cancelled" });
        }
        this.meta.clear();
    }
}
