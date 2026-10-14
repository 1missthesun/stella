/**
 * Stella for Slack's settings API for stella.sh
 * (`@stella/contracts/slack-workspace`). Bearer-authenticated; a workspace is
 * listed and changed only by the Stella account that owns it.
 *
 *   GET    /api/slack/workspaces                    the caller's workspaces, settings and choices
 *   POST   /api/slack/workspaces/:teamId            change settings, rules or notes
 *   POST   /api/slack/workspaces/:teamId/repos      add a repository
 *   POST   /api/slack/workspaces/:teamId/repos/:id  change a repository's branch, rules, environment, previews
 *   POST   /api/slack/workspaces/:teamId/repos/:id/remove  remove a repository
 *   POST /api/slack/install/start         the "Add to Slack" URL for this account
 *   POST /api/slack/workspaces/:teamId/github/connect|finish|disconnect
 *   GET  /api/slack/workspaces/:teamId/github/repos|branches
 *                                         the workspace's GitHub connection (`github.ts`)
 */

import { rpcErrorStatus } from "@stella/contracts/backend/protocol";
import type { ManagedModelAudience } from "@stella/contracts/gateway/capability";
import {
  type SlackGithubAction,
  type SlackGithubBranchesResponse,
  type SlackGithubDisconnectRequest,
  type SlackGithubFinishRequest,
  type SlackGithubFinishResponse,
  type SlackRepoAdd,
  type SlackRepoUpdate,
  type SlackWorkspaceRepo,
  SLACK_INSTALL_START_PATH,
  SLACK_MEMORY_MAX_CHARS,
  SLACK_REPO_RULES_MAX_CHARS,
  SLACK_REPOS_MAX,
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
import { GithubError } from "../projects/github.js";
import {
  checkInstallation,
  describeGithub,
  finishGithubConnect,
  listInstallationRepos,
  listRepoBranches,
  RepoNotFoundError,
  slackGithubConfigured,
  startGithubConnect,
} from "./github.js";
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
import {
  addRepo,
  connectionFor,
  deleteGithubConnection,
  findRepoByName,
  listChannelDefaults,
  listGithubConnections,
  listRepos,
  loadRepo,
  removeChannelDefaults,
  removeRepo,
  saveGithubConnection,
  updateRepo,
  type RepoPatch,
  type SlackGithubConnection,
  type SlackRepoRecord,
} from "./repos.js";
import { describePreviews, isPreviewTtl, savePreviewSettings } from "./previews.js";
import {
  loadEnvironment,
  saveEnvironment,
  slackEnvironmentsEnabled,
  validateEnvironmentUpdate,
  type EnvironmentPatch,
} from "./environment.js";
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

const repoAccess = (
  repo: SlackRepoRecord,
  connections: SlackGithubConnection[],
): SlackWorkspaceRepo["access"] => {
  const github = connectionFor(connections, repo.fullName);
  return github && github.status !== "revoked" ? "github" : repo.hasToken ? "token" : "public";
};

const describe = async (
  env: Cloudflare.Env,
  install: SlackInstallation,
  installedAt: number,
): Promise<SlackWorkspace> => {
  const ownerId = install.ownerId!;
  const environments = slackEnvironmentsEnabled(env);
  const [settings, rules, memory, repos, channels, stored] = await Promise.all([
    loadWorkspaceSettings(env, install.teamId),
    readText(env, ownerId, rulesPath(install.homeFolder)),
    readText(env, ownerId, workspaceNotesPath(install.homeFolder)),
    listRepos(env, install.teamId),
    listChannelDefaults(env, install.teamId),
    listGithubConnections(env, install.teamId),
  ]);
  const connections = slackGithubConfigured(env)
    ? await Promise.all(
        stored.map(async (connection) => {
          const status = await checkInstallation(env, connection);
          return status && status !== connection.status ? { ...connection, status } : connection;
        }),
      )
    : stored;
  const repoViews: SlackWorkspaceRepo[] = await Promise.all(
    repos.map(async (repo) => ({
      id: repo.id,
      fullName: repo.fullName,
      branch: repo.branch,
      access: repoAccess(repo, connections),
      rules: repo.rules,
      channels: channels
        .filter((channel) => channel.repoId === repo.id)
        .map((channel) => ({ id: channel.channelId, name: channel.channelName || channel.channelId })),
      environment: environments ? await loadEnvironment(env, install.teamId, repo.id) : null,
      previews: await describePreviews(env, install.teamId, install.ownerId, repo.fullName),
    })),
  );
  return {
    teamId: install.teamId,
    teamName: install.teamName,
    homeFolder: install.homeFolder,
    installedAt,
    engine: settings.engine,
    model: settings.model,
    effort: settings.effort,
    slackCommands: settings.slackCommands,
    githubAccounts: connections.map(describeGithub),
    repos: repoViews,
    previews: await describePreviews(env, install.teamId, install.ownerId),
    environment: environments ? await loadEnvironment(env, install.teamId, "") : null,
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
    githubAvailable: slackGithubConfigured(env),
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
  const previews = input.previews;
  const previewProblem = checkPreviews(previews);
  if (previewProblem) return fail(400, previewProblem);
  let environmentPatch: EnvironmentPatch | null = null;
  if (input.environment !== undefined) {
    const checked = await checkEnvironment(env, teamId, "", input.environment);
    if (!checked.ok) return fail(400, checked.message);
    environmentPatch = checked.patch;
  }
  if (input.rules !== undefined && String(input.rules).length > SLACK_RULES_MAX_CHARS) {
    return fail(400, `Rules are limited to ${SLACK_RULES_MAX_CHARS} characters.`);
  }
  if (input.memory !== undefined && String(input.memory).length > SLACK_MEMORY_MAX_CHARS) {
    return fail(400, `Workspace memory is limited to ${SLACK_MEMORY_MAX_CHARS} characters.`);
  }
  if (Object.keys(patch).length) await saveWorkspaceSettings(env, teamId, patch);
  if (previews && (previews.access !== undefined || previews.ttlDays !== undefined)) {
    await savePreviewSettings(env, teamId, {
      ...(previews.access !== undefined ? { access: previews.access } : {}),
      ...(previews.ttlDays !== undefined ? { ttlDays: previews.ttlDays } : {}),
    });
  }
  if (environmentPatch) await applyEnvironment(env, teamId, "", environmentPatch);
  const { install } = owned;
  if (input.rules !== undefined) await writeText(env, caller.ownerId, rulesPath(install.homeFolder), String(input.rules));
  if (input.memory !== undefined) {
    await writeText(env, caller.ownerId, workspaceNotesPath(install.homeFolder), String(input.memory));
  }
  return ok({ workspace: await describe(env, install, owned.installedAt) });
};

const checkPreviews = (previews: SlackWorkspaceUpdate["previews"]): string | null => {
  if (previews === undefined) return null;
  if (!previews || typeof previews !== "object") return "Unknown preview settings.";
  if (previews.access !== undefined && previews.access !== "public" && previews.access !== "members") {
    return "Previews are either public or for workspace members.";
  }
  if (previews.ttlDays !== undefined && !isPreviewTtl(previews.ttlDays)) return "That expiry isn't one of the choices.";
  return null;
};

const checkEnvironment = async (
  env: Cloudflare.Env,
  teamId: string,
  repoId: string,
  input: NonNullable<SlackWorkspaceUpdate["environment"]>,
): Promise<{ ok: true; patch: EnvironmentPatch } | { ok: false; message: string }> => {
  if (!slackEnvironmentsEnabled(env)) return { ok: false, message: "Environments aren't available yet." };
  return validateEnvironmentUpdate(input, await loadEnvironment(env, teamId, repoId));
};

const applyEnvironment = async (
  env: Cloudflare.Env,
  teamId: string,
  repoId: string,
  patch: EnvironmentPatch,
): Promise<void> => {
  if (!Object.keys(patch).length) return;
  await saveEnvironment(env, teamId, repoId, patch);
  console.log(JSON.stringify({ event: "slack_environment_changed", teamId, repoId, fields: Object.keys(patch) }));
};

const readJson = async <T>(request: Request): Promise<T | null> => {
  try {
    const body = (await request.json()) as T;
    return body && typeof body === "object" ? body : null;
  } catch {
    return null;
  }
};

/** Checks `fullName` and `branch` on GitHub; a message when they're wrong, else whether a connection reaches it. */
const checkRepo = async (
  env: Cloudflare.Env,
  connections: SlackGithubConnection[],
  fullName: string,
  branch: string,
): Promise<{ ok: true; viaGithub: boolean } | { ok: false; message: string }> => {
  try {
    const found = await listRepoBranches(env, connectionFor(connections, fullName), fullName);
    if (branch && !found.truncated && !found.branches.includes(branch)) {
      return { ok: false, message: `GitHub can't find the branch ${branch} in ${fullName}.` };
    }
    return { ok: true, viaGithub: found.viaGithub };
  } catch (error) {
    if (error instanceof RepoNotFoundError) return { ok: false, message: error.message };
    // GitHub didn't answer: keep what the owner typed.
    return { ok: true, viaGithub: false };
  }
};

const addRepoRoute = async (
  request: Request,
  env: Cloudflare.Env,
  caller: OwnerCaller,
  teamId: string,
): Promise<Response> => {
  const owned = await ownedInstallation(env, caller.ownerId, teamId);
  if (!owned) return fail(404, "That workspace isn't connected to your Stella account.");
  const input = await readJson<SlackRepoAdd>(request);
  if (!input) return fail(400, "The request wasn't valid JSON.");
  const fullName = parseRepoName(String(input.fullName ?? ""));
  if (!fullName) return fail(400, "Enter the repository as owner/name.");
  const branch = parseBranch(input.branch);
  if (branch === null) return fail(400, "That branch name isn't valid.");
  const repos = await listRepos(env, teamId);
  if (repos.length >= SLACK_REPOS_MAX) return fail(400, `A workspace can have up to ${SLACK_REPOS_MAX} repositories.`);
  if (await findRepoByName(env, teamId, fullName)) return fail(409, `${fullName} is already in this workspace.`);
  const checked = await checkRepo(env, await listGithubConnections(env, teamId), fullName, branch);
  if (!checked.ok) return fail(400, checked.message);
  const repo = await addRepo(env, teamId, { fullName, branch });
  console.log(JSON.stringify({ event: "slack_repo_added", teamId, repoId: repo.id, viaGithub: checked.viaGithub }));
  return ok({ workspace: await describe(env, owned.install, owned.installedAt), repoId: repo.id });
};

const updateRepoRoute = async (
  request: Request,
  env: Cloudflare.Env,
  caller: OwnerCaller,
  teamId: string,
  repoId: string,
  remove: boolean,
): Promise<Response> => {
  const owned = await ownedInstallation(env, caller.ownerId, teamId);
  if (!owned) return fail(404, "That workspace isn't connected to your Stella account.");
  const repo = await loadRepo(env, teamId, repoId);
  if (!repo) return fail(404, "That repository isn't in this workspace any more.");
  if (remove) {
    await removeRepo(env, teamId, repoId);
    console.log(JSON.stringify({ event: "slack_repo_removed", teamId, repoId }));
    return ok({ workspace: await describe(env, owned.install, owned.installedAt) });
  }
  const input = await readJson<SlackRepoUpdate>(request);
  if (!input) return fail(400, "The request wasn't valid JSON.");
  const patch: RepoPatch = {};
  if (input.branch !== undefined) {
    const branch = parseBranch(input.branch);
    if (branch === null) return fail(400, "That branch name isn't valid.");
    if (branch !== repo.branch) {
      const checked = await checkRepo(env, await listGithubConnections(env, teamId), repo.fullName, branch);
      if (!checked.ok) return fail(400, checked.message);
      patch.branch = branch;
      if (checked.viaGithub) patch.dropToken = true;
    }
  }
  if (input.rules !== undefined) {
    const rules = String(input.rules);
    if (rules.length > SLACK_REPO_RULES_MAX_CHARS) {
      return fail(400, `Repository rules are limited to ${SLACK_REPO_RULES_MAX_CHARS} characters.`);
    }
    patch.rules = rules.trim();
  }
  const previewProblem = checkPreviews(input.previews);
  if (previewProblem) return fail(400, previewProblem);
  if (input.previews?.access !== undefined) patch.previewAccess = input.previews.access;
  if (input.previews?.ttlDays !== undefined) patch.previewTtlDays = input.previews.ttlDays;
  let environmentPatch: EnvironmentPatch | null = null;
  if (input.environment !== undefined) {
    const checked = await checkEnvironment(env, teamId, repoId, input.environment);
    if (!checked.ok) return fail(400, checked.message);
    environmentPatch = checked.patch;
  }
  if (input.removeChannels !== undefined && !Array.isArray(input.removeChannels)) {
    return fail(400, "removeChannels must be a list of channel ids.");
  }
  await updateRepo(env, teamId, repoId, patch);
  if (environmentPatch) await applyEnvironment(env, teamId, repoId, environmentPatch);
  if (input.removeChannels?.length) {
    await removeChannelDefaults(env, teamId, repoId, input.removeChannels.map(String).slice(0, 200));
  }
  return ok({ workspace: await describe(env, owned.install, owned.installedAt) });
};

const allowedReturnOrigins = (env: Cloudflare.Env): Set<string> =>
  new Set([new URL(websiteUrl(env)).origin, "https://stella.sh", "http://localhost:3000"]);

const readReturnTo = async (request: Request, env: Cloudflare.Env): Promise<URL | null> => {
  try {
    const body = (await request.json()) as { returnTo?: unknown };
    const url = new URL(String(body.returnTo ?? ""));
    return allowedReturnOrigins(env).has(url.origin) ? url : null;
  } catch {
    return null;
  }
};

const githubFailure = (error: unknown): Response => {
  if (error instanceof GithubError) return fail(error instanceof RepoNotFoundError ? 404 : 409, error.message);
  console.error(
    JSON.stringify({
      event: "slack_github_api_failed",
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  return fail(502, "GitHub didn't answer. Try again.");
};

const githubAction = async (
  request: Request,
  env: Cloudflare.Env,
  caller: OwnerCaller,
  teamId: string,
  action: SlackGithubAction,
): Promise<Response> => {
  if (!slackGithubConfigured(env)) return fail(503, "GitHub isn't set up for Stella Crew on this deployment.");
  const owned = await ownedInstallation(env, caller.ownerId, teamId);
  if (!owned) return fail(404, "That workspace isn't connected to your Stella account.");
  const connections = await listGithubConnections(env, teamId);
  const described = async () => await describe(env, owned.install, owned.installedAt);
  try {
    if (action === "connect" && request.method === "POST") {
      const returnTo = await readReturnTo(request, env);
      if (!returnTo) return fail(400, "returnTo must be a URL on the Stella website.");
      const url = await startGithubConnect(env, request, {
        ownerId: caller.ownerId,
        teamId,
        returnTo: returnTo.toString(),
      });
      return ok({ url });
    }
    if (action === "finish" && request.method === "POST") {
      const input = (await request.json().catch(() => ({}))) as Partial<SlackGithubFinishRequest>;
      const result = await finishGithubConnect(env, {
        ownerId: caller.ownerId,
        teamId,
        code: String(input.code ?? ""),
        ...(input.installationId ? { installationId: String(input.installationId) } : {}),
      });
      if (!result.ok) return fail(400, result.message);
      if ("choices" in result) return ok({ choices: result.choices } satisfies SlackGithubFinishResponse);
      await saveGithubConnection(env, teamId, result.connection);
      return ok({ workspace: await described() } satisfies SlackGithubFinishResponse);
    }
    if (action === "disconnect" && request.method === "POST") {
      // Repositories stay, reached as public until a connection covers them again.
      const input = await readJson<Partial<SlackGithubDisconnectRequest>>(request);
      const installationId = String(input?.installationId ?? (connections.length === 1 ? connections[0]!.installationId : ""));
      if (!installationId) return fail(400, "Say which GitHub account to disconnect.");
      if (!(await deleteGithubConnection(env, teamId, installationId))) {
        return fail(404, "That GitHub account isn't connected to this workspace.");
      }
      return ok({ workspace: await described() });
    }
    if (action === "repos" && request.method === "GET") {
      if (!connections.length) return fail(409, "Connect GitHub first.");
      return ok(await listInstallationRepos(env, connections));
    }
    if (action === "branches" && request.method === "GET") {
      const fullName = parseRepoName(new URL(request.url).searchParams.get("repo") ?? "");
      if (!fullName) return fail(400, "Pick a repository as owner/name.");
      const { viaGithub: _, ...found } = await listRepoBranches(env, connectionFor(connections, fullName), fullName);
      return ok(found satisfies SlackGithubBranchesResponse);
    }
  } catch (error) {
    return githubFailure(error);
  }
  return fail(405, "Method not allowed.");
};

const installStart = async (request: Request, env: Cloudflare.Env, caller: OwnerCaller): Promise<Response> => {
  const clientId = slackSecret(env, "SLACK_CLIENT_ID");
  if (!clientId || !slackConfigured(env)) return fail(503, "Slack isn't set up on this deployment.");
  const returnTo = await readReturnTo(request, env);
  if (!returnTo) return fail(400, "returnTo must be a URL on the Stella website.");
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
    anonymousMessage: "Sign in to your Stella account to set up Stella Crew.",
  });
  if (!verified.ok) return fail(rpcErrorStatus(verified.error.code), verified.error.message);
  const { caller } = verified;
  if (isList && request.method === "GET") return await list(env, caller);
  if (isInstall && request.method === "POST") return await installStart(request, env, caller);
  if (isOne) {
    const [rawTeam, section, action, ...rest] = pathname.slice(SLACK_WORKSPACES_PATH.length + 1).split("/");
    const teamId = decodeURIComponent(rawTeam ?? "");
    if (!/^[A-Z0-9]{2,32}$/u.test(teamId)) return fail(404, "Unknown workspace.");
    if (section === undefined && request.method === "POST") return await update(request, env, caller, teamId);
    if (section === "repos" && action === undefined && request.method === "POST") {
      return await addRepoRoute(request, env, caller, teamId);
    }
    const removing = rest.length === 1 && rest[0] === "remove";
    if (section === "repos" && action && (rest.length === 0 || removing) && request.method === "POST") {
      const repoId = decodeURIComponent(action);
      if (!/^r[0-9a-f]{12}$/u.test(repoId)) return fail(404, "Unknown repository.");
      return await updateRepoRoute(request, env, caller, teamId, repoId, removing);
    }
    if (
      section === "github" &&
      rest.length === 0 &&
      (action === "connect" || action === "finish" || action === "disconnect" || action === "repos" || action === "branches")
    ) {
      return await githubAction(request, env, caller, teamId, action);
    }
  }
  return fail(405, "Method not allowed.");
};
