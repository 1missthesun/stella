import { EMAIL_FEATURE_ENABLED } from "@stella/contracts/email-feature";
import { authClient } from "./auth-client";
import { useBackendView } from "./backend";

/**
 * Whether email shows anywhere in the app: always in builds with the feature
 * on, otherwise only when the backend says it runs email (dev). `known` is
 * false until the backend has answered.
 */
export function useEmailFeatureState(): { on: boolean; known: boolean } {
  const signedIn = Boolean(authClient.useSession().data?.user);
  const view = useBackendView("email.available", !EMAIL_FEATURE_ENABLED && signedIn ? {} : "skip");
  if (EMAIL_FEATURE_ENABLED) return { on: true, known: true };
  return { on: view.value?.available === true, known: view.value !== undefined || !signedIn };
}

export const useEmailFeature = (): boolean => useEmailFeatureState().on;
