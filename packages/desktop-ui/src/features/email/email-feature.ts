import { EMAIL_FEATURE_ENABLED } from "@stella/contracts/email-feature";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { useBackendView } from "@/platform/backend/use-backend-view";

/**
 * Whether email shows anywhere in this app: always in builds with the feature
 * on, otherwise only when the backend says it runs email (dev). `known` is
 * false until the backend has answered (and while signed out).
 */
export function useEmailFeatureState(): { on: boolean; known: boolean } {
  const { hasConnectedAccount } = useAuthSessionState();
  const view = useBackendView("email.available", !EMAIL_FEATURE_ENABLED && hasConnectedAccount ? {} : "skip");
  if (EMAIL_FEATURE_ENABLED) return { on: true, known: true };
  // Known only once the backend answers: while sign-in is still loading, nothing is decided.
  return { on: view.value?.available === true, known: view.value !== undefined };
}

export const useEmailFeature = (): boolean => useEmailFeatureState().on;
