import { rpcErrorStatus, type RpcResponse } from "@stella/contracts/backend/protocol";
import { emailFeatureOnFor } from "@stella/contracts/email-feature";
import {
  FINISH_CONNECT_PATH,
  GOOGLE_OAUTH_CALLBACK_PATH,
  connectClaimLink,
  X_FINISH_CONNECT_PATH,
  X_OAUTH_CALLBACK_PATH,
} from "@stella/contracts/backend/integrations";
import { PROVIDER_OAUTH_CALLBACK_PATH } from "@stella/contracts/backend/providers";
import { verifyOAuthState } from "../oauth-state.js";
import { RpcError } from "../owner-store/errors.js";
import { readJsonObject, type BodyResult } from "../http/body.js";
import { requireCaller } from "../http/caller.js";
import { fail, failRpcError, json } from "../http/response.js";
import type { OwnerCaller } from "../owner-store/registry.js";
import { verifyServiceBearerRequest } from "../service-bearer.js";
import { listIntegrationActions, listIntegrationCatalog, publishIntegration } from "./catalog.js";
import { exchangeNativeOAuthToken, listNativeOAuthProviders } from "./native-oauth.js";
import { X_STATE_KIND, xConnectCodePage, xResultPage } from "./x.js";
import { GOOGLE_STATE_KIND, googleConnectCodePage, googleResultPage } from "./google.js";
import { formatConnectCode } from "../owner-store/oauth-claims.js";
import { ownerGateStub } from "../rpc-release.js";
import { adminAccessDenied } from "../admin/access.js";

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_ADMIN_BODY_BYTES = 8 * 1024 * 1024;

type RouteEnv = Cloudflare.Env;

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const providerCallbackPage = (request: Request): Response => {
  const code = new URL(request.url).searchParams.get("code")?.trim() ?? "";
  const valid = /^[A-Za-z0-9._~-]{1,512}$/.test(code);
  const body = valid
    ? `<h1>Almost done</h1><p>Copy this code and paste it into Stella.</p>
<pre id="code">${escapeHtml(code)}</pre>
<button onclick="navigator.clipboard.writeText(document.getElementById('code').textContent).then(()=>{this.textContent='Copied'})">Copy code</button>`
    : `<h1>Sign-in didn't finish</h1><p>No code came back. Start signing in again from Stella.</p>`;
  return new Response(
    `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Stella sign-in</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #0a0a0a; color: #e5e5e5; }
  main { text-align: center; padding: 2rem; max-width: 460px; }
  pre { background: #171717; padding: 1rem; border-radius: 10px; white-space: pre-wrap; word-break: break-all; user-select: all; font-size: 1rem; }
  button { background: #e5e5e5; color: #0a0a0a; border: 0; border-radius: 999px; padding: .7rem 1.4rem; font-size: 1rem; }
  p { color: #a3a3a3; line-height: 1.6; }
</style></head><body><main>${body}</main></body></html>`,
    {
      status: valid ? 200 : 400,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    },
  );
};

const failError = (error: unknown): Response => {
  if (error instanceof RpcError) return failRpcError(error);
  console.error(JSON.stringify({
    event: "integration_route_failed",
    message: error instanceof Error ? error.message : String(error),
  }));
  return fail(500, "Stella hit an error. Try again.");
};

const respond = (response: RpcResponse): Response =>
  response.ok ? json(response.value) : failRpcError(response.error);

const authenticate = async (
  request: Request,
  env: RouteEnv,
): Promise<{ ok: true; caller: OwnerCaller } | { ok: false; response: Response }> => {
  const verified = await requireCaller(request, env);
  return verified.ok ? verified : { ok: false, response: failRpcError(verified.error) };
};

const failBody = (body: Extract<BodyResult<unknown>, { ok: false }>, invalid: string): Response =>
  fail(body.status, body.status === 413 ? body.error : invalid);

const rpc = async (env: RouteEnv, caller: OwnerCaller, name: string, args: unknown): Promise<RpcResponse> =>
  await ownerGateStub(env.OWNER_GATES, caller.ownerId).ownerRpc({ name, args, caller });

const internal = async (env: RouteEnv, ownerId: string, name: string, args: unknown): Promise<RpcResponse> => {
  const gate = ownerGateStub(env.OWNER_GATES, ownerId);
  const { ownerGeneration } = await gate.snapshot();
  return await gate.ownerInternal({ name, args, ownerGeneration });
};

const ownerCall = async (
  request: Request,
  env: RouteEnv,
  name: string,
  args: (body: Record<string, unknown> | null, url: URL) => unknown,
): Promise<Response> => {
  const auth = await authenticate(request, env);
  if (!auth.ok) return auth.response;
  let body: Record<string, unknown> | null = null;
  if (request.method === "POST") {
    const read = await readJsonObject(request, MAX_BODY_BYTES);
    if (!read.ok) return failBody(read, "Invalid JSON body.");
    body = read.value;
  }
  return respond(await rpc(env, auth.caller, name, args(body, new URL(request.url))));
};

const actions = async (request: Request, env: RouteEnv): Promise<Response> => {
  const auth = await authenticate(request, env);
  if (!auth.ok) return auth.response;
  const params = new URL(request.url).searchParams;
  const id = params.get("id")?.trim().toLowerCase();
  if (!id) return fail(400, "Missing integration id.");
  const limit = params.get("limit");
  if (limit !== null && !/^\d{1,3}$/u.test(limit)) return fail(400, "Action page limit must be an integer from 1 to 100.");
  const query = params.get("query")?.trim();
  if (query && query.length > 200) return fail(400, "Action query is too long.");
  try {
    const page = await listIntegrationActions(env, {
      id,
      ...(params.get("action") ? { action: params.get("action")!.trim() } : {}),
      ...(query ? { query } : {}),
      ...(params.get("cursor") ? { cursor: params.get("cursor")! } : {}),
      ...(limit !== null ? { limit: Number(limit) } : {}),
    });
    return page ? json(page) : fail(404, "Executable integration actions are unavailable.");
  } catch (error) {
    return failError(error);
  }
};

const run = async (request: Request, env: RouteEnv): Promise<Response> =>
  await ownerCall(request, env, "integrations.run", (body) => ({
    id: body?.id,
    action: body?.action,
    input: body?.input,
    ...(typeof body?.account === "string" && body.account.trim() ? { account: body.account } : {}),
    requestId: (request.headers.get("x-stella-request-id") ?? request.headers.get("idempotency-key") ?? "").trim(),
  }));

const adminUpsert = async (request: Request, env: RouteEnv): Promise<Response> => {
  const accessDenied = await adminAccessDenied(request, env);
  if (accessDenied) return accessDenied;
  const secret = (env as unknown as Record<string, unknown>).STELLA_ADMIN_API_SECRET;
  if (!(await verifyServiceBearerRequest(request, typeof secret === "string" ? secret : null))) {
    return fail(401, "Unauthorized");
  }
  const body = await readJsonObject(request, MAX_ADMIN_BODY_BYTES);
  if (!body.ok) return failBody(body, "Invalid integration payload.");
  try {
    return json({ ok: true, ...(await publishIntegration(env, body.value)) });
  } catch (error) {
    return failError(error);
  }
};

const nativeOAuthToken = async (request: Request, env: RouteEnv): Promise<Response> => {
  const auth = await authenticate(request, env);
  if (!auth.ok) return auth.response;
  const body = await readJsonObject(request, MAX_BODY_BYTES);
  if (!body.ok) return failBody(body, "Invalid JSON body.");
  try {
    const result = await exchangeNativeOAuthToken(env, body.value);
    return json(result.body, result.status);
  } catch (error) {
    return failError(error);
  }
};

const xRequest = async (request: Request, env: RouteEnv): Promise<Response> => {
  const auth = await authenticate(request, env);
  if (!auth.ok) return auth.response;
  const read = await readJsonObject(request, MAX_BODY_BYTES);
  if (!read.ok) return failBody(read, "Provide method and an X API v2 path such as /2/users/me.");
  const body = read.value;
  const response = await rpc(env, auth.caller, "x.request", {
    ...(body.method !== undefined ? { method: body.method } : {}),
    path: body.path,
    ...(body.query !== undefined ? { query: body.query } : {}),
    ...(body.body !== undefined ? { body: body.body } : {}),
  });
  if (!response.ok) return respond(response);
  const { status, payload } = response.value as { status: number; payload: unknown };
  return json(payload, status);
};

const xCallback = async (request: Request, env: RouteEnv): Promise<Response> => {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  if (!state) return xResultPage(false, "Missing OAuth state.", 400);
  const verified = await verifyOAuthState(env, state);
  if (!verified || verified.kind !== X_STATE_KIND) {
    return xResultPage(false, "Invalid or expired OAuth state. Please start the X connection again.", 400);
  }
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  let response: RpcResponse;
  try {
    response = await internal(env, verified.ownerId, "x.completeOAuth", {
      nonce: verified.nonce,
      ...(code ? { code } : {}),
      ...(error ? { error: error.slice(0, 512) } : {}),
    });
  } catch (cause) {
    console.error(JSON.stringify({
      event: "x_oauth_callback_failed",
      message: cause instanceof Error ? cause.message : String(cause),
    }));
    return xResultPage(false, "X connection failed. Please retry the connection.", 500);
  }
  if (!response.ok) {
    return xResultPage(false, response.error.message, rpcErrorStatus(response.error.code));
  }
  const { username, connectCode } = response.value as { username: string; connectCode: string };
  return xConnectCodePage(username, formatConnectCode(connectCode));
};

const googleCallback = async (request: Request, env: RouteEnv): Promise<Response> => {
  const url = new URL(request.url);
  const failed = (message: string, status: number) =>
    googleResultPage(false, "Google didn't connect", message, status);
  const state = url.searchParams.get("state");
  if (!state) return failed("This link is missing its sign-in details. Start again from Stella.", 400);
  const verified = await verifyOAuthState(env, state);
  if (!verified || verified.kind !== GOOGLE_STATE_KIND) {
    return failed("This link expired. Start connecting Google again from Stella.", 400);
  }
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  let response: RpcResponse;
  try {
    response = await internal(env, verified.ownerId, "google.completeOAuth", {
      nonce: verified.nonce,
      ...(code ? { code } : {}),
      ...(error ? { error: error.slice(0, 512) } : {}),
    });
  } catch (cause) {
    console.error(JSON.stringify({
      event: "google_oauth_callback_failed",
      message: cause instanceof Error ? cause.message : String(cause),
    }));
    return failed("Something went wrong. Try connecting again.", 500);
  }
  if (!response.ok) return failed(response.error.message, rpcErrorStatus(response.error.code));
  const { email, connectCode } = response.value as { email: string; connectCode: string };
  const claimCode = formatConnectCode(connectCode);
  return googleConnectCodePage(email, claimCode, connectClaimLink(claimCode));
};

const methodNotAllowed = () => fail(405, "Method not allowed.");

const GMAIL_PUSH_PATH = "/api/gmail/push";

const sameSecret = (left: string, right: string): boolean => {
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
};

/**
 * Gmail's Pub/Sub push: "this address changed". It carries no mail, only the
 * address, so a forged one can at most make that inbox sync early; each owner
 * store debounces syncs. Always 204 for a known token so Pub/Sub doesn't retry.
 */
const gmailPush = async (request: Request, env: RouteEnv): Promise<Response> => {
  // Email is off on this backend: nothing to wake, and 204 keeps Pub/Sub from retrying.
  if (!emailFeatureOnFor(env)) return new Response(null, { status: 204 });
  const expected = String((env as unknown as Record<string, unknown>).GMAIL_PUSH_TOKEN ?? "").trim();
  const token = new URL(request.url).searchParams.get("token")?.trim() ?? "";
  if (!sameSecret(token, expected)) return new Response(null, { status: 401 });
  const body = (await request.json().catch(() => null)) as { message?: { data?: unknown } } | null;
  let address = "";
  try {
    const data = typeof body?.message?.data === "string" ? body.message.data : "";
    const decoded = JSON.parse(atob(data.replace(/-/gu, "+").replace(/_/gu, "/"))) as { emailAddress?: unknown };
    address = typeof decoded.emailAddress === "string" ? decoded.emailAddress.trim().toLowerCase() : "";
  } catch {
    address = "";
  }
  const db = (env as unknown as Cloudflare.Env).DB;
  if (!address || !db) return new Response(null, { status: 204 });
  const owners = await db
    .prepare("SELECT owner_id FROM gmail_watch WHERE address = ? LIMIT 20")
    .bind(address)
    .all<{ owner_id: string }>()
    .catch(() => ({ results: [] as { owner_id: string }[] }));
  await Promise.all(
    (owners.results ?? []).map((row) =>
      internal(env, row.owner_id, "email.changed", { account: address }).catch((error: unknown) => {
        console.error(JSON.stringify({ event: "gmail_push_forward_failed", message: error instanceof Error ? error.message : String(error) }));
      }),
    ),
  );
  return new Response(null, { status: 204 });
};

export const handleIntegrationsRoute = async (request: Request, env: RouteEnv): Promise<Response | null> => {
  const path = new URL(request.url).pathname;
  const method = request.method;
  switch (path) {
    case "/api/native-integrations/catalog":
      if (method !== "GET") return methodNotAllowed();
      try {
        return json({ integrations: await listIntegrationCatalog(env) });
      } catch (error) {
        return failError(error);
      }
    case "/api/native-integrations/actions":
      return method === "GET" ? await actions(request, env) : methodNotAllowed();
    case "/api/native-integrations/status":
      return method === "GET"
        ? await ownerCall(request, env, "integrations.status", (_body, url) => ({
            id: url.searchParams.get("id") ?? "",
          }))
        : methodNotAllowed();
    case "/api/native-integrations/connect-link":
      return method === "POST"
        ? await ownerCall(request, env, "integrations.connectLink", (body) => ({
            id: body?.id,
            ...(body?.addAccount === true ? { addAccount: true } : {}),
          }))
        : methodNotAllowed();
    case FINISH_CONNECT_PATH:
      return method === "POST"
        ? await ownerCall(request, env, "integrations.finishConnect", (body) => ({ connectCode: body?.connectCode }))
        : methodNotAllowed();
    case "/api/native-integrations/connections":
      return method === "GET"
        ? await ownerCall(request, env, "integrations.connections", () => ({}))
        : methodNotAllowed();
    case "/api/native-integrations/google-provider":
      if (method === "GET") return await ownerCall(request, env, "integrations.googleProvider", () => ({}));
      return method === "POST"
        ? await ownerCall(request, env, "integrations.setGoogleProvider", (body) => ({ provider: body?.provider }))
        : methodNotAllowed();
    case "/api/native-integrations/accounts/primary":
      return method === "POST"
        ? await ownerCall(request, env, "integrations.setPrimaryAccount", (body) => ({
            id: body?.id,
            account: body?.account,
          }))
        : methodNotAllowed();
    case "/api/native-integrations/accounts/remove":
      return method === "POST"
        ? await ownerCall(request, env, "integrations.removeAccount", (body) => ({
            id: body?.id,
            account: body?.account,
          }))
        : methodNotAllowed();
    case GMAIL_PUSH_PATH:
      return method === "POST" ? await gmailPush(request, env) : methodNotAllowed();
    case "/api/native-integrations/run":
      return method === "POST" ? await run(request, env) : methodNotAllowed();
    case "/api/admin/native-integrations/upsert":
      return method === "POST" ? await adminUpsert(request, env) : methodNotAllowed();
    case "/api/native-oauth/providers": {
      if (method !== "GET") return methodNotAllowed();
      const auth = await authenticate(request, env);
      return auth.ok ? json(listNativeOAuthProviders(env)) : auth.response;
    }
    case "/api/native-oauth/token":
      return method === "POST" ? await nativeOAuthToken(request, env) : methodNotAllowed();
    case "/api/x/connect-url":
      return method === "GET" ? await ownerCall(request, env, "x.connectUrl", () => ({})) : methodNotAllowed();
    case X_FINISH_CONNECT_PATH:
      return method === "POST"
        ? await ownerCall(request, env, "x.finishConnect", (body) => ({ connectCode: body?.connectCode }))
        : methodNotAllowed();
    case "/api/x/connections":
      return method === "GET" ? await ownerCall(request, env, "x.connections", () => ({})) : methodNotAllowed();
    case "/api/x/request":
      return method === "POST" ? await xRequest(request, env) : methodNotAllowed();
    case X_OAUTH_CALLBACK_PATH:
      return method === "GET" ? await xCallback(request, env) : methodNotAllowed();
    case GOOGLE_OAUTH_CALLBACK_PATH:
      return method === "GET" ? await googleCallback(request, env) : methodNotAllowed();
    case PROVIDER_OAUTH_CALLBACK_PATH:
      return method === "GET" ? providerCallbackPage(request) : methodNotAllowed();
    default:
      return null;
  }
};
