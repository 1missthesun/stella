import { useCallback } from "react";
import { useAuthBootstrapState } from "@/global/auth/BackendAuthProvider";
import { signInThen } from "@/global/auth/sign-in-then";
import { useSelfHostedServer } from "@/platform/backend/server-discovery";

export function useStellaModelsSignIn(): (pick: () => void) => boolean {
  const { status } = useAuthBootstrapState();
  const selfHosted = useSelfHostedServer();
  const needsSignIn = !selfHosted && (status === "signed_out" || status === "reauth_required");
  return useCallback(
    (pick) => {
      if (needsSignIn) signInThen(pick);
      return needsSignIn;
    },
    [needsSignIn],
  );
}
