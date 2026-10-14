import { useMemo } from "react";
import { useAuthSessionState } from "./use-auth-session-state";

type CurrentUser = {
  email?: string;
  name?: string;
  isAnonymous?: boolean;
} | null | undefined;

export function useCurrentUser(): { user: CurrentUser; hasConnectedAccount: boolean } {
  const { user, hasConnectedAccount } = useAuthSessionState();
  return useMemo(() => {
    if (!hasConnectedAccount || !user) return { user: null, hasConnectedAccount };
    return {
      user: {
        ...(user.email ? { email: user.email } : {}),
        ...(user.name ? { name: user.name } : {}),
        isAnonymous: user.isAnonymous === true,
      },
      hasConnectedAccount,
    };
  }, [hasConnectedAccount, user]);
}
