/**
 * Stella for Slack's settings API for stella.sh
 * (`@stella/contracts/slack-workspace`). Bearer-authenticated; a workspace is
 * listed and changed only by the Stella account that owns it.
 *
 *   GET  /api/slack/workspaces            the caller's workspaces, settings and choices
 *   POST /api/slack/workspaces/:teamId    change settings, rules or notes
 *   POST /api/slack/install/start         the "Add to Slack" URL for this account
 */

import { rpcErrorStatus } from "@stella/contracts/backend/protocol";
import type { ManagedModelAudience } from "@stella/contracts/gateway/capability";
import {
  SLACK_INSTALL_START_PATH,
  SLACK_MEMORY_MAX_CHARS,
  SLACK_RULES_MAX_CHARS,
  SLACK_WORKSPACES_PATH,
  type SlackWorkspace,
  type SlackWorkspaceUpdate,
  type SlackWorkspacesResponse,
} from "@stella/contracts/slack-workspace";
import { websiteUrl } from "../auth/auth.js";
import { requireCaller } from "../http/caller.js";
import type { OwnerCaller } from "../owner-store/registry.js";
import { unwrapRpc } from "../owner-store/errors.js";
import { ownerGateStub } from "../rpc-release.js";
import { SLACK_BOT_SCOPES, SLACK_PATHS, slackConfigured, slackPublicOrigin, slackSecret } from "./config.js";
import { signInstallState } from "./link-state.js";
import {
  isEffort,
  loadWorkspaceSettings,
  parseBranch,
  parseRepoName,
  resolveModelChoice,
  saveWorkspaceSettings,
  workspaceOptions,
  type SettingsPatch,
} from "./settings.js";
import { loadInstallation, type SlackInstallation } from "./store.js";
import { rulesPath, workspaceNotesPath } from "./workspace.js";

const d1 = (env: Cloudflare.Env): D1Database => {
  if (!env.DB) throw new Error("The DB binding is missing.");
  return env.DB;
};

const fail = (status: number, message: string): Response =>
  Response.json({ error: message }, { status, headers: { "cache-control": "no-store" } });

const ok = (body: unknown): Response =>
  Response.json(body, { headers: { "cache-control": "no-store" } });

const ownerInternal = async (env: Cloudflare.Env, ownerId: string, name: string, args: unknown): Promise<unknown> => {
  const gate = ownerGateStub(env.OWNER_GATES, ownerId);
  const { ownerGeneration } = await gate.snapshot();
  return unwrapRpc(await gate.ownerInternal({ name, args, ownerGeneration }));
};

const audienceOf = async (env: Cloudflare.Env, caller: OwnerCaller): Promise<ManagedModelAudience> =>
  (await ownerGateStub(env.OWNER_GATES, caller.ownerId).billingAccess({ isAnonymous: false })).audience;

const readText = async (env: Cloudflare.Env, ownerId: string, path: string): Promise<string> => {
  try {
    const file = (await ownerInternal(env, ownerId, "drive.turnRead", { path, length: 64_000 })) as {
      bytes: Uint8Array;
    };
    return new TextDecoder().decode(file.bytes).trim();
  } catch {
    return "";
  }
};

const encodeBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
};

const writeText = async (env: Cloudflare.Env, ownerId: string, path: string, text: string): Promise<void> => {
  const content = text.trim();
  const bytes = new TextEncoder().encode(content ? `${content}\n` : "");
  const result = (await ownerInternal(env, ownerId, "drive.turnFiles", {
    turnId: `slack-settings:${crypto.randomUUID()}`,
    hydratesDrive: false,
    source: "slack",
    batchKey: crypto.randomUUID(),
    files: [
      {
        path,
        name: path.slice(path.lastIndexOf("/") + 1),
        sizeBytes: bytes.byteLength,
        contentType: "text/markdown; charset=utf-8",
        contentBase64: encodeBase64(bytes),
      },
    ],
  })) as { files: Array<{ stored: boolean }>; skipped?: Array<{ reason?: string }> };
  if (!result.files.some((file) => file.stored)) {
    throw new Error(result.skipped?.[0]?.reason ?? "The drive did not store the file.");
  }
};

const ownedTeamIds = async (env: Cloudflare.Env, ownerId: string): Promise<Array<{ teamId: string; installedAt: number }>> => {
  const rows = await d1(env)
    .prepare(
      `SELECT team_id, installed_at FROM slack_installations
       WHERE owner_id = ? AND revoked_at IS NULL ORDER BY installed_at DESC`,
    )
    .bind(ownerId)
    .all<{ team_id: string; installed_at: number }>();
  return (rows.results ?? []).map((row) => ({ teamId: row.team_id, installedAt: row.installed_at }));
};

const describe = async (
  env: Cloudflare.Env,
  install: SlackInstallation,
  installedAt: number,
): Promise<SlackWorkspace> => {
  const ownerId = install.ownerId!;
  const [settings, rules, memory] = await Promise.all([
    loadWorkspaceSettings(env, install.teamId),
    readText(env, ownerId, rulesPath(install.homeFolder)),
    readText(env, ownerId, workspaceNotesPath(install.homeFolder)),
  ]);
  return {
    teamId: install.teamId,
    teamName: install.teamName,
    homeFolder: install.homeFolder,
    installedAt,
    engine: settings.engine,
    model: settings.model,
    effort: settings.effort,
    slackCommands: settings.slackCommands,
    repo: settings.repo,
    rules,
    memory,
    slackUrl: `https://app.slack.com/client/${encodeURIComponent(install.teamId)}`,
  };
};

const ownedInstallation = async (
  env: Cloudflare.Env,
  ownerId: string,
  teamId: string,
): Promise<{ install: SlackInstallation; installedAt: number } | null> => {
  const owned = (await ownedTeamIds(env, ownerId)).find((entry) => entry.teamId === teamId);
  if (!owned) return null;
  const install = await loadInstallation(env, teamId);
  return install && install.ownerId === ownerId ? { install, installedAt: owned.installedAt } : null;
};

const list = async (env: Cloudflare.Env, caller: OwnerCaller): Promise<Response> => {
  const audience = await audienceOf(env, caller);
  const workspaces: SlackWorkspace[] = [];
  for (const { teamId, installedAt } of await ownedTeamIds(env, caller.ownerId)) {
    const install = await loadInstallation(env, teamId);
    if (install?.ownerId === caller.ownerId) workspaces.push(await describe(env, install, installedAt));
  }
  const body: SlackWorkspacesResponse = {
    available: slackConfigured(env),
    workspaces,
    options: workspaceOptions(audience),
  };
  return ok(body);
};

const update = async (
  request: Request,
  env: Cloudflare.Env,
  caller: OwnerCaller,
  teamId: string,
): Promise<Response> => {
  const owned = await ownedInstallation(env, caller.ownerId, teamId);
  if (!owned) return fail(404, "That workspace isn't connected to your Stella account.");
  let input: SlackWorkspaceUpdate;
  try {
    input = (await request.json()) as SlackWorkspaceUpdate;
  } catch {
    return fail(400, "The request wasn't valid JSON.");
  }
  if (!input || typeof input !== "object") return fail(400, "Nothing to change.");
  const audience = await audienceOf(env, caller);
  const current = await loadWorkspaceSettings(env, teamId);
  const patch: SettingsPatch = {};
  if (input.engine !== undefined) {
    if (input.engine !== "stella" && input.engine !== "claude-code") return fail(400, "Unknown engine.");
    patch.engine = input.engine;
  }
  if (input.model !== undefined) {
    const engine = patch.engine ?? current.engine;
    const model = resolveModelChoice(engine, String(input.model), audience);
    if (!model) return fail(400, "That model isn't available for this engine.");
    patch.model = model;
  }
  if (input.effort !== undefined) {
    if (!isEffort(input.effort)) return fail(400, "Unknown reasoning effort.");
    patch.effort = input.effort;
  }
  if (input.slackCommands !== undefined) patch.slackCommands = input.slackCommands === true;
  if (input.repo === null) patch.repo = null;
  else if (input.repo !== undefined) {
    const fullName = parseRepoName(String(input.repo.fullName ?? ""));
    if (!fullName) return fail(400, "Enter the repository as owner/name.");
    const branch = parseBranch(input.repo.branch);
    if (branch === null) return fail(400, "That branch name isn't valid.");
    const token = input.repo.token === undefined ? undefined : String(input.repo.token).trim();
    if (token && (token.length > 400 || /\s/u.test(token))) return fail(400, "That access token isn't valid.");
    patch.repo = { fullName, branch, ...(token !== undefined ? { token } : {}) };
  }
  if (input.rules !== undefined && String(input.rules).length > SLACK_RULES_MAX_CHARS) {
    return fail(400, `Rules are limited to ${SLACK_RULES_MAX_CHARS} characters.`);
  }
  if (input.memory !== undefined && String(input.memory).length > SLACK_MEMORY_MAX_CHARS) {
    return fail(400, `Workspace memory is limited to ${SLACK_MEMORY_MAX_CHARS} characters.`);
  }
  if (Object.keys(patch).length) await saveWorkspaceSettings(env, teamId, patch);
  const { install } = owned;
  if (input.rules !== undefined) await writeText(env, caller.ownerId, rulesPath(install.homeFolder), String(input.rules));
  if (input.memory !== undefined) {
    await writeText(env, caller.ownerId, workspaceNotesPath(install.homeFolder), String(input.memory));
  }
  return ok({ workspace: await describe(env, install, owned.installedAt) });
};

const allowedReturnOrigins = (env: Cloudflare.Env): Set<string> =>
  new Set([new URL(websiteUrl(env)).origin, "https://stella.sh", "http://localhost:3000"]);

const installStart = async (request: Request, env: Cloudflare.Env, caller: OwnerCaller): Promise<Response> => {
  const clientId = slackSecret(env, "SLACK_CLIENT_ID");
  if (!clientId || !slackConfigured(env)) return fail(503, "Slack isn't set up on this deployment.");
  let returnTo: URL;
  try {
    const body = (await request.json()) as { returnTo?: unknown };
    returnTo = new URL(String(body.returnTo ?? ""));
  } catch {
    return fail(400, "returnTo must be a URL on the Stella website.");
  }
  if (!allowedReturnOrigins(env).has(returnTo.origin)) {
    return fail(400, "returnTo must be a URL on the Stella website.");
  }
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", SLACK_BOT_SCOPES.join(","));
  url.searchParams.set("redirect_uri", `${slackPublicOrigin(env, request)}${SLACK_PATHS.oauthCallback}`);
  url.searchParams.set(
    "state",
    await signInstallState(env, { ownerId: caller.ownerId, returnTo: returnTo.toString() }),
  );
  return ok({ url: url.toString() });
};

export const handleSlackWorkspaceApi = async (request: Request, env: Cloudflare.Env): Promise<Response | null> => {
  const { pathname } = new URL(request.url);
  const isList = pathname === SLACK_WORKSPACES_PATH;
  const isOne = pathname.startsWith(`${SLACK_WORKSPACES_PATH}/`);
  const isInstall = pathname === SLACK_INSTALL_START_PATH;
  if (!isList && !isOne && !isInstall) return null;
  const verified = await requireCaller(request, env, {
    allowAnonymous: false,
    anonymousMessage: "Sign in to your Stella account to set up Stella for Slack.",
  });
  if (!verified.ok) return fail(rpcErrorStatus(verified.error.code), verified.error.message);
  const { caller } = verified;
  if (isList && request.method === "GET") return await list(env, caller);
  if (isInstall && request.method === "POST") return await installStart(request, env, caller);
  if (isOne && request.method === "POST") {
    const teamId = decodeURIComponent(pathname.slice(SLACK_WORKSPACES_PATH.length + 1));
    if (!/^[A-Z0-9]{2,32}$/u.test(teamId)) return fail(404, "Unknown workspace.");
    return await update(request, env, caller, teamId);
  }
  return fail(405, "Method not allowed.");
};
