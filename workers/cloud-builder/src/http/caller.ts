import { bearerCredential } from "../../../shared/bearer.js";
import { verifyUserToken } from "../auth-jwt.js";
import { RpcError } from "../owner-store/errors.js";
import type { OwnerCaller } from "../owner-store/registry.js";

type CallerEnv = Pick<Cloudflare.Env, "OWNER_GATES" | "CLOUD_BUILDER_PUBLIC_URL">;

export type VerifiedCaller = { ok: true; caller: OwnerCaller } | { ok: false; error: RpcError };

export const verifyCaller = async (env: CallerEnv, token: string): Promise<VerifiedCaller> => {
  if (!token) {
    return { ok: false, error: new RpcError("UNAUTHENTICATED", "Sign in to continue.") };
  }
  const verified = await verifyUserToken(token, env as unknown as Cloudflare.Env);
  if (verified.ok) return { ok: true, caller: verified.token };
  return {
    ok: false,
    error: verified.retryable
      ? new RpcError("UNAVAILABLE", "Stella couldn't check your sign-in. Try again shortly.")
      : new RpcError("UNAUTHENTICATED", "Your sign-in expired. Sign in again to continue."),
  };
};

export const requireCaller = (request: Request, env: CallerEnv): Promise<VerifiedCaller> =>
  verifyCaller(env, bearerCredential(request.headers.get("authorization")) ?? "");
