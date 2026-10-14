import { authClient } from "./auth-client";

export type AccountDeletionOutcome = { ok: true } | { ok: false; message: string };

type DeleteUserResult = {
  data?: { success?: unknown } | null;
  error?: { message?: unknown; status?: unknown } | null;
};

// Better Auth's client resolves with `{ data, error }` instead of throwing, so
// only an explicit `success: true` means the server recorded the request.
export async function requestAccountDeletion(): Promise<AccountDeletionOutcome> {
  const client = authClient as unknown as {
    deleteUser?: (args?: { callbackURL?: string }) => Promise<DeleteUserResult>;
  };
  if (typeof client.deleteUser !== "function") {
    return { ok: false, message: "Account deletion is not available in this build." };
  }
  const result = await client.deleteUser({});
  if (result?.data?.success === true && !result.error) return { ok: true };
  const message = result?.error?.message;
  return {
    ok: false,
    message:
      typeof message === "string" && message
        ? message
        : `The server did not confirm the request (${String(result?.error?.status ?? "no response")}).`,
  };
}
