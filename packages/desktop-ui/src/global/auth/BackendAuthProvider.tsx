import { useChatStorageMode } from "@/features/chat/services/chat-storage-preference";
import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { MagicLinkAuthProvider } from "@/global/auth/useMagicLinkAuth";
import { clearCachedToken } from "@/global/auth/services/auth-token";
import {
  getAuthSessionSnapshot,
  refreshAuthSession,
  useDesktopAuthSession,
  waitForBrowserAuthHandoff,
} from "@/global/auth/services/auth-session";
import { SIGN_IN_TOAST_ACTION } from "@/shared/lib/auth-cta";
import { isSelfHostedServer } from "@/platform/backend/server-discovery";
import { showToast } from "@/ui/toast";

export type AuthBootstrapStatus =
  | "loading_session"
  | "ready"
  | "signed_out"
  | "reauth_required"
  | "needs_pairing"
  | "failed";

type AuthBootstrapState = {
  status: AuthBootstrapStatus;
  error: string | null;
};

type AuthBootstrapContextValue = AuthBootstrapState & {
  runtimeAuthReady: boolean;
  retryAuthBootstrap: () => void;
};

const AuthBootstrapContext = createContext<AuthBootstrapContextValue>({
  status: "loading_session",
  error: null,
  runtimeAuthReady: false,
  retryAuthBootstrap: () => {},
});

export function useAuthBootstrapState() {
  return useContext(AuthBootstrapContext);
}

export function useAuthState() {
  const session = useDesktopAuthSession();
  const sessionUserId =
    (session.data as { user?: { id?: string } } | null | undefined)?.user?.id ??
    null;
  const isAuthenticated = Boolean(session.data && sessionUserId?.trim());
  const isLoading = Boolean(session.isPending);
  return useMemo(
    () => ({ isLoading, isAuthenticated }),
    [isAuthenticated, isLoading],
  );
}

function DesktopAuthRuntimeEffects({
  retryAttempt,
  setAuthBootstrapState,
}: {
  retryAttempt: number;
  setAuthBootstrapState: (state: AuthBootstrapState) => void;
}) {
  const session = useDesktopAuthSession();

  useEffect(() => {
    let cancelled = false;
    void waitForBrowserAuthHandoff().then(async (handoff) => {
      if (cancelled) return;
      if (handoff === "failed") {
        showToast({
          title: "Couldn’t finish sign in",
          description:
            "Your existing Stella session is still active. You can try signing in again.",
          variant: "error",
          action: SIGN_IN_TOAST_ACTION,
        });
      }

      const snapshot = getAuthSessionSnapshot();
      if (snapshot.isPending && !snapshot.data) {
        setAuthBootstrapState({ status: "loading_session", error: null });
        return;
      }
      if (snapshot.status === "reauth_required") {
        setAuthBootstrapState({ status: "reauth_required", error: null });
        return;
      }
      if (snapshot.data) {
        const snapshotUserId = (
          snapshot.data as { user?: { id?: string | null } }
        ).user?.id?.trim();
        if (!snapshotUserId) {
          setAuthBootstrapState({
            status: "failed",
            error: "Stella could not verify the signed-in identity.",
          });
          return;
        }
        setAuthBootstrapState({ status: "ready", error: null });
        return;
      }

      if (snapshot.status !== "signed_out") {
        setAuthBootstrapState({ status: "loading_session", error: null });
        return;
      }

      setAuthBootstrapState({
        status: isSelfHostedServer() ? "needs_pairing" : "signed_out",
        error: null,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [
    retryAttempt,
    session.data,
    session.isPending,
    session.status,
    setAuthBootstrapState,
  ]);

  const chatStorageMode = useChatStorageMode();
  useEffect(() => {
    const systemApi = window.electronAPI?.system;
    if (!systemApi?.setCloudSyncEnabled) {
      return;
    }

    void systemApi.setCloudSyncEnabled({ enabled: chatStorageMode === "cloud" });
  }, [chatStorageMode]);

  useEffect(() => {
    const systemApi = window.electronAPI?.system;
    if (!systemApi?.onAuthSessionInvalidated) {
      return;
    }

    return systemApi.onAuthSessionInvalidated(() => {
      clearCachedToken();
      void refreshAuthSession({ silent: true });
    });
  }, []);

  return null;
}

export function BackendAuthProvider({
  children,
  enableRuntimeEffects = true,
}: {
  children: ReactNode;
  enableRuntimeEffects?: boolean;
}) {
  const [authBootstrapState, setAuthBootstrapState] =
    useState<AuthBootstrapState>(() =>
      enableRuntimeEffects
        ? {
            status: "loading_session",
            error: null,
          }
        : {
            status: "ready",
            error: null,
          },
    );
  const [retryAttempt, setRetryAttempt] = useState(0);
  const retryAuthBootstrap = useCallback(() => {
    clearCachedToken();
    setAuthBootstrapState({ status: "loading_session", error: null });
    setRetryAttempt((attempt) => attempt + 1);
  }, []);
  const authBootstrapValue = useMemo(
    () => ({
      ...authBootstrapState,
      runtimeAuthReady: authBootstrapState.status === "ready",
      retryAuthBootstrap,
    }),
    [authBootstrapState, retryAuthBootstrap],
  );

  return (
    <AuthBootstrapContext.Provider value={authBootstrapValue}>
      <MagicLinkAuthProvider>
        {enableRuntimeEffects ? (
          <DesktopAuthRuntimeEffects
            retryAttempt={retryAttempt}
            setAuthBootstrapState={setAuthBootstrapState}
          />
        ) : null}
        {children}
      </MagicLinkAuthProvider>
    </AuthBootstrapContext.Provider>
  );
}
