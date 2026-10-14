import { useEffect, useSyncExternalStore } from "react";
import {
  getAuthSessionIdentityIntent,
  getAuthSnapshotSession,
  isRecognizedAuthRejection,
  resolveAuthSessionObservation,
  type AuthSessionSnapshot,
} from "@stella/contracts/auth-session";
import { configurePiRuntime } from "@/platform/electron/device";
import { getStellaInteriorBridge } from "@/platform/interior/interior-bridge";
import { authClient } from "@/global/auth/lib/auth-client";
import {
  clearBrowserSessionToken,
  readBrowserCachedSession,
  readBrowserIdentityIntent,
  readBrowserSessionToken,
  writeBrowserCachedSession,
  writeBrowserIdentityIntent,
} from "./auth-storage";
import {
  consumeBrowserAuthHandoffToken,
  type BrowserAuthHandoffResult,
} from "../browser-auth-handoff";
import {
  advanceAuthIdentityRevision,
  resolveAuthSessionCacheScope,
  type AuthSessionScopeData,
} from "../lib/auth-session-scope";

type AuthSessionResult = {
  snapshot: AuthSessionSnapshot;
  status: AuthSessionSnapshot["status"];
  data: unknown | null;
  isPending: boolean;
  error: Error | null;
  identityRevision: number;
};

let identityRevision = 0;
const initialCachedSession =
  typeof window !== "undefined" &&
  !window.electronAPI &&
  !getStellaInteriorBridge()
    ? readBrowserCachedSession()
    : null;
const initialIdentityIntent =
  typeof window !== "undefined" &&
  !window.electronAPI &&
  !getStellaInteriorBridge()
    ? (readBrowserIdentityIntent() ??
      getAuthSessionIdentityIntent(initialCachedSession))
    : null;
let currentIdentityScope = resolveAuthSessionCacheScope(
  initialCachedSession as AuthSessionScopeData,
);
if (initialCachedSession) identityRevision = 1;
const initialSnapshot: AuthSessionSnapshot = {
  status: "unknown",
  identityIntent: initialIdentityIntent,
  staleSession: initialCachedSession,
  error: { kind: "ipc", message: "Auth session initialization is pending." },
};
let currentSession: AuthSessionResult = {
  snapshot: initialSnapshot,
  status: initialSnapshot.status,
  data: initialCachedSession,
  isPending: !initialCachedSession,
  error: null,
  identityRevision,
};
const listeners = new Set<() => void>();
let inFlightRefresh: Promise<void> | null = null;
let initialRefreshRequested = false;
let refreshVersion = 0;
let browserRetryTimer: ReturnType<typeof setTimeout> | null = null;
let browserRetryAttempt = 0;
let ipcRetryTimer: ReturnType<typeof setTimeout> | null = null;
let ipcRetryAttempt = 0;

const browserErrorObservation = (error: unknown) => {
  const value = error as {
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
    message?: unknown;
  } | null;
  const statusValue = value?.status ?? value?.statusCode;
  const status =
    typeof statusValue === "number"
      ? statusValue
      : typeof statusValue === "string"
        ? Number.parseInt(statusValue, 10)
        : undefined;
  const code =
    typeof value?.code === "string" ? value.code.slice(0, 80) : undefined;
  if (isRecognizedAuthRejection({ status, code })) {
    return { kind: "rejected" as const };
  }
  return {
    kind: "unknown" as const,
    error: {
      kind: status ? ("http" as const) : ("network" as const),
      message:
        typeof value?.message === "string"
          ? value.message.slice(0, 160)
          : "Could not read the browser session.",
      ...(status ? { status } : {}),
      ...(code ? { code } : {}),
    },
  };
};

const setCurrentSession = (args: {
  snapshot: AuthSessionSnapshot;
  isPending?: boolean;
}): void => {
  const data = getAuthSnapshotSession(args.snapshot);
  const nextIdentity = advanceAuthIdentityRevision({
    currentScope: currentIdentityScope,
    currentRevision: identityRevision,
    nextSessionData: data as AuthSessionScopeData,
  });
  currentIdentityScope = nextIdentity.scope;
  identityRevision = nextIdentity.revision;
  currentSession = {
    snapshot: args.snapshot,
    status: args.snapshot.status,
    data,
    isPending: args.isPending ?? (args.snapshot.status === "unknown" && !data),
    error:
      args.snapshot.status === "unknown"
        ? new Error(args.snapshot.error.message)
        : null,
    identityRevision,
  };
};

const commitBrowserSnapshot = (snapshot: AuthSessionSnapshot): void => {
  if (getStellaInteriorBridge()) {
    setCurrentSession({ snapshot });
    return;
  }
  if (snapshot.status === "authenticated") {
    writeBrowserIdentityIntent(snapshot.identityIntent);
    writeBrowserCachedSession(snapshot.session);
    browserRetryAttempt = 0;
    if (browserRetryTimer) clearTimeout(browserRetryTimer);
    browserRetryTimer = null;
  } else if (snapshot.status === "reauth_required") {
    clearBrowserSessionToken();
    writeBrowserIdentityIntent("connected");
  } else if (snapshot.status === "signed_out") {
    clearBrowserSessionToken();
    writeBrowserIdentityIntent("anonymous");
    writeBrowserCachedSession(null);
  }
  setCurrentSession({ snapshot });
};

const scheduleBrowserRetry = (version: number): void => {
  if (
    window.electronAPI ||
    getStellaInteriorBridge() ||
    browserRetryTimer ||
    !readBrowserSessionToken()
  ) {
    return;
  }
  const ceiling = Math.min(
    60_000,
    2_000 * 2 ** Math.min(browserRetryAttempt, 5),
  );
  browserRetryAttempt += 1;
  const jitter = 0.8 + Math.random() * 0.4;
  browserRetryTimer = setTimeout(
    () => {
      browserRetryTimer = null;
      if (version === refreshVersion) void refreshAuthSession({ silent: true });
    },
    Math.round(ceiling * jitter),
  );
};

const scheduleIpcRetry = (version: number): void => {
  if (ipcRetryTimer) return;
  const ceiling = Math.min(60_000, 2_000 * 2 ** Math.min(ipcRetryAttempt, 5));
  ipcRetryAttempt += 1;
  const jitter = 0.8 + Math.random() * 0.4;
  ipcRetryTimer = setTimeout(
    () => {
      ipcRetryTimer = null;
      if (version === refreshVersion) void refreshAuthSession({ silent: true });
    },
    Math.round(ceiling * jitter),
  );
};

const emit = () => {
  for (const listener of listeners) {
    listener();
  }
};

type RefreshOptions = {
  allowCached?: boolean;
  silent?: boolean;
};

export const refreshAuthSession = async (options: RefreshOptions = {}) => {
  const allowCached = options.allowCached ?? false;
  if (inFlightRefresh && allowCached) {
    await inFlightRefresh;
    return;
  }
  if (inFlightRefresh) {
    await inFlightRefresh.catch(() => {});
  }
  const systemApi = window.electronAPI?.system;
  const version = ++refreshVersion;
  if (!options.silent) {
    setCurrentSession({ snapshot: currentSession.snapshot, isPending: true });
    emit();
  }
  const interiorBridge = getStellaInteriorBridge();
  if (interiorBridge) {
    inFlightRefresh = Promise.resolve()
      .then(async () => {
        let session = await interiorBridge.getSession();
        if (session.expiresAt <= Date.now() + 5_000) {
          await interiorBridge.getToken({ forceRefresh: true });
          session = await interiorBridge.getSession();
        }
        if (session.expiresAt <= Date.now()) {
          throw new Error("The Stella interior session is expired.");
        }
        if (version !== refreshVersion) return;
        const snapshot = resolveAuthSessionObservation({
          observation: { kind: "authenticated", session },
          identityIntent: getAuthSessionIdentityIntent(session),
          staleSession: getAuthSnapshotSession(currentSession.snapshot),
        });
        setCurrentSession({ snapshot, isPending: false });
      })
      .catch((error) => {
        if (version !== refreshVersion) return;
        setCurrentSession({
          snapshot: {
            status: "unknown",
            identityIntent: currentSession.snapshot.identityIntent,
            staleSession: getAuthSnapshotSession(currentSession.snapshot),
            error: {
              kind: "network",
              message: error instanceof Error ? error.message : String(error),
            },
          },
          isPending: !currentSession.data,
        });
      })
      .finally(() => {
        inFlightRefresh = null;
        if (version === refreshVersion) emit();
      });
    await inFlightRefresh;
    return;
  }
  if (!systemApi?.getAuthSession) {
    inFlightRefresh = Promise.resolve()
      .then(async () => {
        const result = await authClient.getSession();
        if (version !== refreshVersion) return;
        const identityIntent =
          readBrowserIdentityIntent() ??
          getAuthSessionIdentityIntent(readBrowserCachedSession());
        const snapshot = resolveAuthSessionObservation({
          observation: result.error
            ? browserErrorObservation(result.error)
            : result.data === null || result.data === undefined
              ? { kind: "no_session" }
              : { kind: "authenticated", session: result.data },
          identityIntent,
          staleSession: readBrowserCachedSession(),
        });
        commitBrowserSnapshot(snapshot);
        if (snapshot.status === "unknown") scheduleBrowserRetry(version);
      })
      .catch((error) => {
        if (version !== refreshVersion) return;
        const snapshot = resolveAuthSessionObservation({
          observation: {
            kind: "unknown",
            error: {
              kind: "network",
              message: error instanceof Error ? error.message : String(error),
            },
          },
          identityIntent:
            readBrowserIdentityIntent() ??
            currentSession.snapshot.identityIntent,
          staleSession:
            readBrowserCachedSession() ??
            getAuthSnapshotSession(currentSession.snapshot),
        });
        commitBrowserSnapshot(snapshot);
        scheduleBrowserRetry(version);
      })
      .finally(() => {
        inFlightRefresh = null;
        if (version === refreshVersion) {
          emit();
        }
      });
    await inFlightRefresh;
    return;
  }
  inFlightRefresh = configurePiRuntime()
    .then(async () => {
      const first = await systemApi.getAuthSession({ allowCached });
      if (version !== refreshVersion) {
        return;
      }
      if (allowCached && getAuthSnapshotSession(first)) {
        setCurrentSession({ snapshot: first, isPending: false });
        emit();
      }
      const revalidated = await systemApi.getAuthSession();
      if (version !== refreshVersion) {
        return;
      }
      setCurrentSession({ snapshot: revalidated, isPending: false });
      ipcRetryAttempt = 0;
      if (ipcRetryTimer) clearTimeout(ipcRetryTimer);
      ipcRetryTimer = null;
    })
    .catch((error) => {
      if (version !== refreshVersion) {
        return;
      }
      setCurrentSession({
        snapshot: {
          status: "unknown",
          identityIntent: currentSession.snapshot.identityIntent,
          staleSession: getAuthSnapshotSession(currentSession.snapshot),
          error: {
            kind: "ipc",
            message: error instanceof Error ? error.message : String(error),
          },
        },
        isPending: !currentSession.data,
      });
      scheduleIpcRetry(version);
    })
    .finally(() => {
      inFlightRefresh = null;
      if (version === refreshVersion) {
        emit();
      }
    });
  await inFlightRefresh;
};

type PendingBrowserAuthHandoff =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "token"; token: string };

const consumePendingBrowserAuthHandoff = (): PendingBrowserAuthHandoff => {
  if (
    typeof window === "undefined" ||
    window.electronAPI ||
    getStellaInteriorBridge()
  ) {
    return { kind: "none" };
  }
  const query = new URLSearchParams(window.location.search);
  if (
    window.location.pathname === "/auth/callback" &&
    query.get("client") === "desktop"
  ) {
    return { kind: "none" };
  }

  const rawFragment = window.location.hash.replace(/^#\??/, "");
  const hasHandoffCredential =
    rawFragment.length > 0 && new URLSearchParams(rawFragment).has("ott");
  const token = consumeBrowserAuthHandoffToken(window.location, window.history);
  if (token) {
    return { kind: "token", token };
  }
  return hasHandoffCredential ? { kind: "invalid" } : { kind: "none" };
};

const redeemPendingBrowserAuthHandoff =
  async (): Promise<BrowserAuthHandoffResult> => {
    const handoff = consumePendingBrowserAuthHandoff();
    if (handoff.kind === "none") {
      return "none";
    }
    if (handoff.kind === "invalid") {
      console.error("Failed to finish browser sign-in.");
      return "failed";
    }

    try {
      const result = await authClient.oneTimeToken.verify({
        token: handoff.token,
      });
      if (result.error) {
        throw new Error("Browser auth handoff verification failed.");
      }
      if (!readBrowserSessionToken()) {
        throw new Error("Browser auth handoff did not establish a session.");
      }
      authClient.updateSession();
      await refreshAuthSession();
      if (!currentSession.data) {
        throw new Error("Browser auth handoff session could not be verified.");
      }
      return "redeemed";
    } catch {
      // The credential has already been removed from the URL. Do not log it,
      // or retry it implicitly: an ambiguous POST failure may still have
      // redeemed it server-side.
      console.error("Failed to finish browser sign-in.");
      return "failed";
    }
  };

const browserAuthHandoffPromise = redeemPendingBrowserAuthHandoff();

export const waitForBrowserAuthHandoff =
  (): Promise<BrowserAuthHandoffResult> => browserAuthHandoffPromise;

export const signOutAuthSession = async () => {
  if (getStellaInteriorBridge()) {
    throw new Error(
      "Sign out must be completed by the trusted Stella browser shell.",
    );
  }
  if (!window.electronAPI) {
    await authClient.signOut();
    clearBrowserSessionToken();
    writeBrowserIdentityIntent("anonymous");
    writeBrowserCachedSession(null);
  } else {
    if (!window.electronAPI.system.signOutAuth) {
      throw new Error("Desktop sign-out is unavailable.");
    }
    await window.electronAPI.system.signOutAuth();
  }
  refreshVersion += 1;
  setCurrentSession({
    snapshot: {
      status: "signed_out",
      identityIntent: "anonymous",
      reason: "explicit_sign_out",
    },
    isPending: false,
  });
  emit();
};

export const deleteAuthUser = async () => {
  if (getStellaInteriorBridge()) {
    throw new Error(
      "Account deletion must be completed by the trusted Stella browser shell.",
    );
  }
  if (!window.electronAPI) {
    const result = await authClient.deleteUser();
    if (result.error || result.data?.success !== true) {
      throw new Error(
        result.error?.message ||
          `Account deletion was not recorded (HTTP ${result.error?.status ?? "unknown"}).`,
      );
    }
    clearBrowserSessionToken();
    writeBrowserIdentityIntent("anonymous");
    writeBrowserCachedSession(null);
  } else {
    if (!window.electronAPI.system.deleteAuthUser) {
      throw new Error("Desktop account deletion is unavailable.");
    }
    await window.electronAPI.system.deleteAuthUser();
  }
  refreshVersion += 1;
  setCurrentSession({
    snapshot: {
      status: "signed_out",
      identityIntent: "anonymous",
      reason: "explicit_sign_out",
    },
    isPending: false,
  });
  emit();
};

export function getAuthSessionSnapshot(): AuthSessionResult {
  return currentSession;
}

export function subscribeAuthSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const EVENT_REVALIDATE_THROTTLE_MS = 60_000;
let lastEventRevalidateAt = 0;
let revalidationListenersBound = false;

const revalidateAuthSessionFromEvent = () => {
  if (inFlightRefresh) {
    return;
  }
  const now = Date.now();
  if (now - lastEventRevalidateAt < EVENT_REVALIDATE_THROTTLE_MS) {
    return;
  }
  lastEventRevalidateAt = now;
  void refreshAuthSession({ silent: true });
};

const handleVisibilityChange = () => {
  if (document.visibilityState === "visible") {
    revalidateAuthSessionFromEvent();
  }
};

function ensureAuthSessionRevalidationListeners() {
  if (revalidationListenersBound || typeof window === "undefined") {
    return;
  }
  revalidationListenersBound = true;
  window.addEventListener("focus", revalidateAuthSessionFromEvent);
  window.addEventListener("online", revalidateAuthSessionFromEvent);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }
}

function startAuthSessionBootstrap(): void {
  if (initialRefreshRequested) return;
  initialRefreshRequested = true;
  void waitForBrowserAuthHandoff().then(() => {
    if (!inFlightRefresh) {
      void refreshAuthSession({ allowCached: true });
    }
  });
}

export function prefetchAuthSessionBeforeRender(): void {
  if (!currentSession.isPending) return;
  startAuthSessionBootstrap();
}

export function useDesktopAuthSession() {
  const snapshot = useSyncExternalStore(
    subscribeAuthSession,
    getAuthSessionSnapshot,
  );

  useEffect(() => {
    startAuthSessionBootstrap();
    ensureAuthSessionRevalidationListeners();
  }, []);

  return snapshot;
}
