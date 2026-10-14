import { authClient } from "./auth-client";

export type AccountDeletionOutcome =
  | { ok: true }
  | { ok: false; reauth: boolean; message: string };

type DeleteUserResult = {
  data?: { success?: unknown; message?: unknown } | null;
  error?: { code?: unknown; message?: unknown; status?: unknown } | null;
};

// Better Auth's client resolves with `{ data, error }` instead of throwing, so
// a refused deletion (stale session, server error) must be read from the result.
// Only `success: true` with "User deleted" means the account is gone.
export async function deleteAccountOnServer(): Promise<AccountDeletionOutcome> {
  const client = authClient as unknown as {
    deleteUser?: (args?: { callbackURL?: string }) => Promise<DeleteUserResult>;
  };
  if (typeof client.deleteUser !== "function") {
    return {
      ok: false,
      reauth: false,
      message: "Account deletion is not available in this build.",
    };
  }
  const result = await client.deleteUser({});
  if (result?.error) {
    const code = typeof result.error.code === "string" ? result.error.code : "";
    const message =
      typeof result.error.message === "string" && result.error.message
        ? result.error.message
        : `The server refused the request (${String(result.error.status ?? "unknown")}).`;
    return {
      ok: false,
      reauth: code === "SESSION_EXPIRED" || code === "SESSION_NOT_FRESH",
      message,
    };
  }
  if (result?.data?.success === true && result.data.message === "User deleted") {
    return { ok: true };
  }
  return {
    ok: false,
    reauth: false,
    message: "The server did not confirm the deletion.",
  };
}
