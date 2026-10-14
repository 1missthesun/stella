import { isBillingPlan, type BillingPlan } from "@stella/contracts/billing-plans";
import { OWNER_ENFORCEMENT_STATUSES, type OwnerEnforcementStatus } from "@stella/contracts/gateway/usage";
import { rpcErrorStatus, type RpcResponse } from "@stella/contracts/backend/protocol";
import { bearerCredential } from "../../../shared/bearer.js";
import { fail, json } from "../http/response.js";
import { fixedWorkSha256SecretEqual } from "../service-bearer.js";
import { ownerGateStub } from "../rpc-release.js";
import { adminAccessDenied } from "./access.js";

type AdminEnv = Pick<Cloudflare.Env, "OWNER_GATES" | "DB" | "WORLDS" | "ORCHESTRATOR_SESSIONS">;

const OWNER_ID_MAX = 512;
const TOP_DEFAULT_LIMIT = 50;
const TOP_MAX_LIMIT = 200;

const failRpc = (response: Extract<RpcResponse, { ok: false }>): Response =>
  fail(rpcErrorStatus(response.error.code), response.error.message, {
    code: response.error.code,
    ...(response.error.reason ? { reason: response.error.reason } : {}),
  });

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readBody = async (request: Request): Promise<Record<string, unknown> | null> => {
  const body = (await request.json().catch(() => null)) as unknown;
  return isRecord(body) ? body : null;
};

const ownerIdOf = (value: unknown): string | null => {
  const ownerId = typeof value === "string" ? value.trim() : "";
  return ownerId && ownerId.length <= OWNER_ID_MAX ? ownerId : null;
};

const authorized = async (request: Request, env: AdminEnv): Promise<Response | null> => {
  const raw = (env as unknown as Record<string, unknown>).STELLA_ADMIN_API_SECRET;
  const expected = typeof raw === "string" ? raw.trim() : "";
  if (!expected) return fail(503, "Admin API disabled.", { env: "STELLA_ADMIN_API_SECRET" });
  const provided = bearerCredential(request.headers.get("authorization")) ?? "";
  return (await fixedWorkSha256SecretEqual(provided, expected)) ? null : fail(401, "Invalid admin credentials.");
};

const ownerGate = async (env: AdminEnv, ownerId: string) => {
  const gate = ownerGateStub(env.OWNER_GATES, ownerId);
  try {
    return { gate, snapshot: await gate.snapshot() };
  } catch (error) {
    return { response: fail(404, "Owner not found or unavailable.", { ownerId, detail: message(error) }) };
  }
};

const ownerInternal = async (
  env: AdminEnv,
  ownerId: string,
  name: string,
  args: unknown,
): Promise<Response | RpcResponse> => {
  const owner = await ownerGate(env, ownerId);
  if (owner.response) return owner.response;
  return await owner.gate.ownerInternal({ name, args, ownerGeneration: owner.snapshot.ownerGeneration });
};

const db = (env: AdminEnv): D1Database => {
  if (!env.DB) throw new Error("D1 is not bound.");
  return env.DB;
};

const lookup = async (url: URL, env: AdminEnv): Promise<Response> => {
  const ownerId = ownerIdOf(url.searchParams.get("ownerId"));
  if (!ownerId) return fail(400, "Missing ownerId.");
  const owner = await ownerGate(env, ownerId);
  if (owner.response) return owner.response;
  const { snapshot } = owner;
  const [billing, risk] = await Promise.all([
    owner.gate.billingAccess(),
    db(env)
      .prepare("SELECT score, status, updated_at AS updatedAt FROM owner_risk WHERE owner_id = ?")
      .bind(ownerId)
      .first(),
  ]);
  return json({
    ownerId,
    isAnonymous: snapshot.isAnonymous,
    identityLevel: snapshot.identityLevel,
    plan: billing.plan,
    enforcement: snapshot.enforcement ?? { status: "ok" },
    billing,
    risk: risk ?? null,
  });
};

const storage = async (url: URL, env: AdminEnv): Promise<Response> => {
  const ownerId = ownerIdOf(url.searchParams.get("ownerId"));
  if (!ownerId) return fail(400, "Missing ownerId.");
  const drive = await ownerInternal(env, ownerId, "drive.usage", {});
  if (drive instanceof Response) return drive;
  if (!drive.ok) return failRpc(drive);
  const { worldName } = await import("../workspace.js");
  const world = await env.WORLDS.getByName(await worldName(ownerId)).usage();
  const ownerDb = await ownerGateStub(env.OWNER_GATES, ownerId).storageReport();
  return json({ ownerId, drive: drive.value, world, ownerDb });
};

const top = async (url: URL, env: AdminEnv): Promise<Response> => {
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? TOP_DEFAULT_LIMIT : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > TOP_MAX_LIMIT) {
    return fail(400, `limit must be 1 to ${TOP_MAX_LIMIT}.`);
  }
  const status = url.searchParams.get("status")?.trim().toLowerCase() || null;
  if (status && !OWNER_ENFORCEMENT_STATUSES.includes(status as OwnerEnforcementStatus)) {
    return fail(400, "Invalid enforcement status.");
  }
  const query = status
    ? db(env)
        .prepare(
          `SELECT owner_id AS ownerId, score, status, updated_at AS updatedAt FROM owner_risk
           WHERE status = ? ORDER BY score DESC LIMIT ?`,
        )
        .bind(status, limit)
    : db(env)
        .prepare(
          `SELECT owner_id AS ownerId, score, status, updated_at AS updatedAt FROM owner_risk
           ORDER BY score DESC LIMIT ?`,
        )
        .bind(limit);
  const { results } = await query.all();
  return json({ owners: results });
};

const enforcement = async (request: Request, env: AdminEnv): Promise<Response> => {
  const body = await readBody(request);
  const ownerId = ownerIdOf(body?.ownerId);
  if (!ownerId) return fail(400, "Missing ownerId.");
  const status = typeof body?.status === "string" ? body.status.trim().toLowerCase() : "";
  if (!OWNER_ENFORCEMENT_STATUSES.includes(status as OwnerEnforcementStatus)) {
    return fail(400, "Invalid enforcement status.");
  }
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!reason || reason.length > 1_000) return fail(400, "reason must be 1 to 1,000 characters.");
  const until = body?.until;
  if (until !== undefined && (typeof until !== "number" || !Number.isFinite(until))) {
    return fail(400, "until must be a timestamp.");
  }
  const state = await ownerGateStub(env.OWNER_GATES, ownerId).setOwnerEnforcement({
    status: status as OwnerEnforcementStatus,
    reason,
    actor: "admin",
    ...(typeof until === "number" ? { until } : {}),
  });
  console.log(JSON.stringify({ event: "admin_owner_enforcement", ownerId, status }));
  return json({ ownerId, enforcement: state });
};

const billingPlan = async (request: Request, env: AdminEnv): Promise<Response> => {
  const body = await readBody(request);
  const ownerId = ownerIdOf(body?.ownerId);
  if (!ownerId) return fail(400, "Missing ownerId.");
  const plan = typeof body?.plan === "string" ? body.plan.trim().toLowerCase() : "";
  if (plan && !isBillingPlan(plan)) return fail(400, `Unsupported plan: ${plan}`);
  if (body?.complimentary !== undefined && typeof body.complimentary !== "boolean") {
    return fail(400, "complimentary must be a boolean.");
  }
  const rawUsageMode = typeof body?.usageMode === "string" ? body.usageMode.trim().toLowerCase() : "";
  const usageMode =
    typeof body?.unlimited === "boolean" ? (body.unlimited ? "unlimited" : "default") : rawUsageMode;
  if (usageMode && usageMode !== "default" && usageMode !== "unlimited") {
    return fail(400, `Unsupported usageMode: ${usageMode}`);
  }
  if (body?.resetUsage !== undefined && typeof body.resetUsage !== "boolean") {
    return fail(400, "resetUsage must be a boolean.");
  }
  const owner = await ownerGate(env, ownerId);
  if (owner.response) return owner.response;
  await owner.gate.setBillingPlan({
    ...(plan ? { plan: plan as BillingPlan } : {}),
    ...(usageMode ? { usageMode: usageMode as "default" | "unlimited" } : {}),
    ...(typeof body?.resetUsage === "boolean" ? { resetUsage: body.resetUsage } : {}),
    ...(body?.complimentary === true ? { complimentary: true } : {}),
  });
  console.log(JSON.stringify({ event: "admin_billing_plan", ownerId, plan: plan || null, usageMode: usageMode || null }));
  return json(await owner.gate.billingAccess());
};

const ownerCosts = async (url: URL, env: AdminEnv): Promise<Response> => {
  const ownerId = ownerIdOf(url.searchParams.get("ownerId"));
  if (!ownerId) return fail(400, "Missing ownerId.");
  const { dayRange } = await import("./costs.js");
  const range = dayRange(url);
  if (range instanceof Response) return range;
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? undefined : Number(rawLimit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 500)) {
    return fail(400, "limit must be 1 to 500.");
  }
  const owner = await ownerGate(env, ownerId);
  if (owner.response) return owner.response;
  const cursor = url.searchParams.get("cursor")?.trim() || undefined;
  const report = await owner.gate.billingCosts({
    from: range.from,
    to: range.to,
    ...(limit !== undefined ? { limit } : {}),
    ...(cursor ? { cursor } : {}),
  });
  return json({ ownerId, ...report });
};

const ownerCostsExport = async (request: Request, env: AdminEnv): Promise<Response> => {
  const body = await readBody(request);
  const ownerId = ownerIdOf(body?.ownerId);
  if (!ownerId) return fail(400, "Missing ownerId.");
  const owner = await ownerGate(env, ownerId);
  if (owner.response) return owner.response;
  return json({ ownerId, ...(await owner.gate.exportBillingCosts()) });
};

const remove = async (request: Request, env: AdminEnv): Promise<Response> => {
  const body = await readBody(request);
  const kind = typeof body?.kind === "string" ? body.kind.trim() : "";
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!kind || !id) return fail(400, "Missing kind or id.");
  switch (kind) {
    case "feedback": {
      const result = await db(env).prepare("DELETE FROM feedback WHERE id = ?").bind(id).run();
      return json({ deleted: (result.meta.changes ?? 0) > 0, kind, id });
    }
    case "media_job": {
      const ownerId = ownerIdOf(body?.ownerId);
      if (!ownerId) return fail(400, "media_job deletes need the job's ownerId.");
      const response = await ownerInternal(env, ownerId, "media.deleteJob", { jobId: id });
      if (response instanceof Response) return response;
      return response.ok ? json(response.value) : failRpc(response);
    }
    default:
      return fail(400, `Unsupported delete kind: ${kind}`);
  }
};

const TEST_ACCOUNT_SUFFIX = "@test.stella.local";

const testAccountSession = async (request: Request, env: AdminEnv): Promise<Response> => {
  const { backendUrl, createAuth, testAccountsEnabled } = await import("../auth/auth.js");
  if (!testAccountsEnabled(env)) return fail(404, "Test accounts disabled.", { env: "STELLA_TEST_ACCOUNTS" });
  const body = await readBody(request);
  if (!body) return fail(400, "Body must be a JSON object.");
  if (body.email !== undefined && typeof body.email !== "string") return fail(400, "email must be a string.");
  const email =
    typeof body.email === "string"
      ? body.email.trim().toLowerCase()
      : `agent-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}${TEST_ACCOUNT_SUFFIX}`;
  if (!email.endsWith(TEST_ACCOUNT_SUFFIX)) return fail(400, `email must end with ${TEST_ACCOUNT_SUFFIX}.`);
  const plan = typeof body.plan === "string" ? body.plan.trim().toLowerCase() : "";
  if (body.plan !== undefined && !isBillingPlan(plan)) {
    return fail(400, "plan must be free, plus, pro, or max.");
  }
  const usageMode = typeof body.usageMode === "string" ? body.usageMode.trim().toLowerCase() : "";
  if (body.usageMode !== undefined && usageMode !== "default" && usageMode !== "unlimited") {
    return fail(400, "usageMode must be default or unlimited.");
  }

  const fullEnv = env as unknown as Cloudflare.Env;
  const auth = createAuth(fullEnv);
  const context = await auth.$context;
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ".charAt(byte % 52),
  ).join("");
  // Better Auth 1.7's magic-link record: a `magic-link:`-prefixed identifier
  // holding the token's SHA-256 (base64url, no padding), because auth.ts sets
  // magicLink({ storeToken: "hashed" }), and a typed value.
  const tokenDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  const storedToken = btoa(String.fromCharCode(...tokenDigest))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  await context.internalAdapter.createVerificationValue({
    identifier: `magic-link:${storedToken}`,
    value: JSON.stringify({ type: "magic-link", email, name: "" }),
    expiresAt: new Date(Date.now() + 5 * 60_000),
  });
  const verified = await auth.api.magicLinkVerify({ query: { token }, headers: new Headers(), returnHeaders: true });
  const sessionToken = verified.headers.get("set-auth-token")?.trim() ?? "";
  const userId = (verified.response as { user?: { id?: unknown } } | null)?.user?.id;
  if (!sessionToken || typeof userId !== "string" || !userId) {
    return fail(500, "Better Auth did not return a test account session.");
  }
  const sessionHeaders = new Headers({ authorization: `Bearer ${sessionToken}` });
  const minted = await auth.api.getToken({ headers: sessionHeaders });
  const oneTimeToken = await auth.api.generateOneTimeToken({ headers: sessionHeaders });

  const ownerId = userId;
  const spendAllowance = body.allowance === "spent";
  if (plan || spendAllowance) {
    await ownerGateStub(env.OWNER_GATES, ownerId).setBillingPlan({
      ...(plan ? { plan: plan as BillingPlan } : {}),
      ...(usageMode ? { usageMode: usageMode as "default" | "unlimited" } : {}),
      ...(spendAllowance ? { spendAllowance: true } : {}),
    });
  }
  console.log(JSON.stringify({ event: "admin_test_account_session", ownerId, plan: plan || "free" }));
  return json({
    ownerId,
    userId,
    email,
    sessionToken,
    token: minted.token,
    oneTimeToken: oneTimeToken.token,
    plan: plan || "free",
    siteUrl: backendUrl(fullEnv),
  });
};

const claudeLoginProbeRoute = async (request: Request, env: AdminEnv): Promise<Response> => {
  const { testAccountsEnabled } = await import("../auth/auth.js");
  if (!testAccountsEnabled(env)) return fail(404, "Test accounts disabled.", { env: "STELLA_TEST_ACCOUNTS" });
  const body = await readBody(request);
  const ownerId = ownerIdOf(body?.ownerId);
  const action = body?.action;
  if (
    !ownerId ||
    (action !== "plant" && action !== "inspect" && action !== "backup" && action !== "restore" && action !== "replace")
  ) {
    return fail(400, "Need ownerId and action plant|inspect|backup|restore|replace.");
  }
  const { claudeLoginProbe } = await import("../claude-cloud-login.js");
  return json(await claudeLoginProbe(env as unknown as Cloudflare.Env, ownerId, action));
};

const conversationRestart = async (request: Request, env: AdminEnv): Promise<Response> => {
  const { testAccountsEnabled } = await import("../auth/auth.js");
  if (!testAccountsEnabled(env)) return fail(404, "Test accounts disabled.", { env: "STELLA_TEST_ACCOUNTS" });
  const body = await readBody(request);
  const conversationId = typeof body?.conversationId === "string" ? body.conversationId.trim() : "";
  if (!/^[A-Za-z0-9._-]{8,128}$/.test(conversationId)) return fail(400, "conversationId is required.");
  return json(await env.ORCHESTRATOR_SESSIONS.getByName(conversationId).restartForVerification());
};

const FAKE_LIMIT_CLI = "/tmp/stella-digest-fake-claude-limit";

const emailDigestProbeRoute = async (request: Request, env: AdminEnv): Promise<Response> => {
  const { testAccountsEnabled } = await import("../auth/auth.js");
  if (!testAccountsEnabled(env)) return fail(404, "Test accounts disabled.", { env: "STELLA_TEST_ACCOUNTS" });
  const body = await readBody(request);
  const ownerId = ownerIdOf(body?.ownerId);
  if (!ownerId || !Array.isArray(body?.messages)) return fail(400, "Need ownerId and messages.");
  const fullEnv = env as unknown as Cloudflare.Env;
  const { isTestAccountOwner } = await import("../test-claude.js");
  if (!(await isTestAccountOwner(fullEnv, ownerId))) return fail(403, "Test accounts only.");
  const simulateLimit = body?.simulate === "usage_limit";
  if (simulateLimit) {
    const { claudeLoginContainer } = await import("../claude-cloud-login.js");
    const container = await claudeLoginContainer(fullEnv, ownerId);
    const reset = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 16);
    const fake = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: true,
      api_error_status: 429,
      result: `You've hit your session limit · resets at ${reset}Z`,
    });
    await container.exec(`printf '%s' "$FAKE" > ${FAKE_LIMIT_CLI} && chmod 700 ${FAKE_LIMIT_CLI}`, {
      cwd: "/",
      timeout: 30_000,
      env: { FAKE: `#!/bin/sh\ncat >/dev/null\ncat <<'JSON'\n${fake}\nJSON\nexit 1\n` },
    });
  }
  const stub = ownerGateStub(env.OWNER_GATES, ownerId);
  const snapshot = await stub.snapshot();
  const response = (await stub.ownerInternal({
    name: "emailDigest.probe",
    args: { messages: body.messages, ...(simulateLimit ? { cli: FAKE_LIMIT_CLI } : {}) },
    ownerGeneration: snapshot.ownerGeneration,
  })) as unknown as RpcResponse;
  return response.ok ? json(response.value) : fail(rpcErrorStatus(response.error.code), response.error.message);
};

/**
 * Moves every Stella Crew workspace's folder out of its owner's personal Drive
 * into the workspace's own drive space (the gate adopts it on the first Crew
 * call), and reports what each space and personal Drive now hold there.
 */
const crewDriveSpaces = async (env: AdminEnv): Promise<Response> => {
  const { results } = await db(env)
    .prepare(
      `SELECT team_id, owner_id, home_folder FROM slack_installations
        WHERE revoked_at IS NULL AND owner_id IS NOT NULL AND home_folder IS NOT NULL`,
    )
    .all<{ team_id: string; owner_id: string; home_folder: string }>();
  const { crewScopeForInstall } = await import("../slack/scope.js");
  const report: Array<Record<string, unknown>> = [];
  for (const row of results) {
    const owner = await ownerGate(env, row.owner_id);
    if (owner.response) {
      report.push({ teamId: row.team_id, error: "owner unavailable" });
      continue;
    }
    const crew = crewScopeForInstall({ teamId: row.team_id, homeFolder: row.home_folder });
    const ownerGeneration = owner.snapshot.ownerGeneration;
    const inSpace = (await owner.gate.ownerInternal({
      name: "drive.turnList",
      args: { prefix: row.home_folder, limit: 200 },
      ownerGeneration,
      crew,
    })) as RpcResponse<{ files: unknown[]; more: boolean }>;
    const personal = (await owner.gate.ownerInternal({
      name: "drive.turnList",
      args: { prefix: row.home_folder, limit: 200 },
      ownerGeneration,
    })) as RpcResponse<{ files: unknown[] }>;
    report.push({
      teamId: row.team_id,
      space: crew.space,
      home: row.home_folder,
      ...(inSpace.ok
        ? { spaceFiles: inSpace.value.files.length, spaceMore: inSpace.value.more }
        : { spaceError: inSpace.error.message }),
      ...(personal.ok ? { personalFilesLeft: personal.value.files.length } : { personalError: personal.error.message }),
    });
  }
  return json({ installations: report });
};

const ROUTES: Record<string, { method: "GET" | "POST"; run: (request: Request, url: URL, env: AdminEnv) => Promise<Response> }> = {
  "/api/admin/slack/crew-drive-spaces": { method: "POST", run: (_request, _url, env) => crewDriveSpaces(env) },
  "/api/admin/owners/lookup": { method: "GET", run: (_request, url, env) => lookup(url, env) },
  "/api/admin/owners/top": { method: "GET", run: (_request, url, env) => top(url, env) },
  "/api/admin/owners/storage": { method: "GET", run: (_request, url, env) => storage(url, env) },
  "/api/admin/owners/costs": { method: "GET", run: (_request, url, env) => ownerCosts(url, env) },
  "/api/admin/owners/costs/export": { method: "POST", run: (request, _url, env) => ownerCostsExport(request, env) },
  "/api/admin/costs": {
    method: "GET",
    run: async (_request, url, env) => (await import("./costs.js")).costsReport(url, db(env)),
  },
  "/api/admin/owners/enforcement": { method: "POST", run: (request, _url, env) => enforcement(request, env) },
  "/api/admin/billing/plan": { method: "POST", run: (request, _url, env) => billingPlan(request, env) },
  "/api/admin/delete": { method: "POST", run: (request, _url, env) => remove(request, env) },
  "/api/admin/test-accounts/session": { method: "POST", run: (request, _url, env) => testAccountSession(request, env) },
  "/api/admin/selfhost/owner": {
    method: "POST",
    run: async (request, _url, env) =>
      (await import("../selfhost/owner.js")).bootstrapOwnerRoute(request, env as unknown as Cloudflare.Env),
  },
  "/api/admin/test-accounts/run-account-deletions": {
    method: "POST",
    run: async (_request, _url, env) => {
      const { testAccountsEnabled } = await import("../auth/auth.js");
      if (!testAccountsEnabled(env)) return fail(404, "Test accounts disabled.", { env: "STELLA_TEST_ACCOUNTS" });
      await (await import("../auth/account-deletion.js")).runAccountDeletions(env as unknown as Cloudflare.Env);
      const rows = await (env as unknown as Cloudflare.Env).DB?.prepare(
        "SELECT user_id, email, status, requested_at, due_at, confirmation_sent_at, started_at, owner_closed_at, completed_at, attempts, last_error FROM account_deletions WHERE email IS NULL OR email LIKE '%@test.stella.local' ORDER BY requested_at DESC LIMIT 20",
      ).all();
      return json({ rows: rows?.results ?? [] });
    },
  },
  "/api/admin/test-accounts/conversation-restart": {
    method: "POST",
    run: (request, _url, env) => conversationRestart(request, env),
  },
  "/api/admin/test-accounts/email-digest-probe": {
    method: "POST",
    run: (request, _url, env) => emailDigestProbeRoute(request, env),
  },
  "/api/admin/secret-rotation/status": {
    method: "GET",
    run: async (_request, _url, env) =>
      (await import("./secret-rotation.js")).secretRotationStatus(env as unknown as Cloudflare.Env),
  },
  "/api/admin/secret-rotation/reencrypt": {
    method: "POST",
    run: async (_request, _url, env) =>
      (await import("./secret-rotation.js")).secretRotationReencrypt(env as unknown as Cloudflare.Env),
  },
  "/api/admin/test-accounts/claude-login-probe": {
    method: "POST",
    run: (request, _url, env) => claudeLoginProbeRoute(request, env),
  },
};

export const handleAdminRoute = async (request: Request, env: AdminEnv): Promise<Response | null> => {
  const url = new URL(request.url);
  const route = ROUTES[url.pathname];
  if (!route) return null;
  if (request.method !== route.method) return fail(405, "Method not allowed.");
  const accessDenied = await adminAccessDenied(request, env);
  if (accessDenied) return accessDenied;
  const denied = await authorized(request, env);
  if (denied) return denied;
  try {
    const response = await route.run(request, url, env);
    console.log(
      JSON.stringify({
        event: "admin_route",
        path: url.pathname,
        status: response.status,
      }),
    );
    return response;
  } catch (error) {
    console.error(JSON.stringify({ event: "admin_route_failed", path: url.pathname, message: message(error) }));
    return fail(500, "Admin request failed.", { detail: message(error) });
  }
};
