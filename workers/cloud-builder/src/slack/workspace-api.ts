/**
 * Stella for Slack's settings API for stella.sh
 * (`@stella/contracts/slack-workspace`). Bearer-authenticated; a workspace is
 * listed and changed only by the Stella account that owns it.
 *
 *   GET  /api/slack/workspaces            the caller's workspaces, settings and choices
 *   POST /api/slack/workspaces/:teamId    change settings, rules or notes
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
  type SlackGithubFinishRequest,
  type SlackGithubFinishResponse,
  type SlackWorkspaceRepo,
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
  repoOwnedBy,
  resolveModelChoice,
  saveWorkspaceSettings,
  type SlackWorkspaceSettings,
  workspaceOptions,
  type SettingsPatch,
} from "./settings.js";
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

const describe = async (
  env: Cloudflare.Env,
  install: SlackInstallation,
  installedAt: number,
): Promise<SlackWorkspace> => {
  const ownerId = install.ownerId!;
  const [loaded, rules, memory] = await Promise.all([
    loadWorkspaceSettings(env, install.teamId),
    readText(env, ownerId, rulesPath(install.homeFolder)),
    readText(env, ownerId, workspaceNotesPath(install.homeFolder)),
  ]);
  let settings = loaded;
  if (settings.github && slackGithubConfigured(env)) {
    const status = await checkInstallation(env, settings.github);
    if (status && status !== settings.github.status) {
      settings = { ...settings, github: { ...settings.github, status } };
    }
  }
  return {
    teamId: install.teamId,
    teamName: install.teamName,
    homeFolder: install.homeFolder,
    installedAt,
    engine: settings.engine,
    model: settings.model,
    effort: settings.effort,
    slackCommands: settings.slackCommands,
    github: describeGithub(settings.github),
    repo: repoView(settings),
    previews: await describePreviews(env, install.teamId, install.ownerId),
    environment: slackEnvironmentsEnabled(env) ? await loadEnvironment(env, install.teamId) : null,
    rules,
    memory,
    slackUrl: `https://app.slack.com/client/${encodeURIComponent(install.teamId)}`,
  };
};

const repoView = (settings: SlackWorkspaceSettings): SlackWorkspaceRepo | null => {
  const repo = settings.repo;
  if (!repo) return null;
  const github = settings.github;
  const access: SlackWorkspaceRepo["access"] =
    github && github.status !== "revoked" && repoOwnedBy(github, repo.fullName)
      ? "github"
      : repo.hasToken
        ? "token"
        : "public";
  return { fullName: repo.fullName, branch: repo.branch, access };
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
  if (input.repo === null) patch.repo = null;
  else if (input.repo !== undefined) {
    const fullName = parseRepoName(String(input.repo.fullName ?? ""));
    if (!fullName) return fail(400, "Enter the repository as owner/name.");
    const branch = parseBranch(input.repo.branch);
    if (branch === null) return fail(400, "That branch name isn't valid.");
    const unchanged = current.repo?.fullName === fullName && current.repo.branch === branch;
    let viaGithub = false;
    if (!unchanged) {
      try {
        const found = await listRepoBranches(env, current.github, fullName);
        viaGithub = found.viaGithub;
        if (branch && !found.truncated && !found.branches.includes(branch)) {
          return fail(400, `GitHub can't find the branch ${branch} in ${fullName}.`);
        }
      } catch (error) {
        if (error instanceof RepoNotFoundError) return fail(400, error.message);
      }
    }
    patch.repo = { fullName, branch, dropToken: viaGithub };
  }
  const previews = input.previews;
  if (previews !== undefined) {
    if (!previews || typeof previews !== "object") return fail(400, "Unknown preview settings.");
    if (previews.access !== undefined && previews.access !== "public" && previews.access !== "members") {
      return fail(400, "Previews are either public or for workspace members.");
    }
    if (previews.ttlDays !== undefined && !isPreviewTtl(previews.ttlDays)) {
      return fail(400, "That expiry isn't one of the choices.");
    }
  }
  let environmentPatch: EnvironmentPatch | null = null;
  if (input.environment !== undefined) {
    if (!slackEnvironmentsEnabled(env)) return fail(400, "Environments aren't available yet.");
    const checked = validateEnvironmentUpdate(input.environment, await loadEnvironment(env, teamId));
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
  if (environmentPatch && Object.keys(environmentPatch).length) {
    await saveEnvironment(env, teamId, environmentPatch);
    console.log(
      JSON.stringify({
        event: "slack_environment_changed",
        teamId,
        fields: Object.keys(environmentPatch),
      }),
    );
  }
  const { install } = owned;
  if (input.rules !== undefined) await writeText(env, caller.ownerId, rulesPath(install.homeFolder), String(input.rules));
  if (input.memory !== undefined) {
    await writeText(env, caller.ownerId, workspaceNotesPath(install.homeFolder), String(input.memory));
  }
  return ok({ workspace: await describe(env, install, owned.installedAt) });
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
  if (!slackGithubConfigured(env)) return fail(503, "GitHub isn't set up for Stella for Slack on this deployment.");
  const owned = await ownedInstallation(env, caller.ownerId, teamId);
  if (!owned) return fail(404, "That workspace isn't connected to your Stella account.");
  const settings = await loadWorkspaceSettings(env, teamId);
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
      await saveWorkspaceSettings(env, teamId, { github: result.connection });
      return ok({ workspace: await described() } satisfies SlackGithubFinishResponse);
    }
    if (action === "disconnect" && request.method === "POST") {
      const github = settings.github;
      const dropRepo = Boolean(github && settings.repo && repoOwnedBy(github, settings.repo.fullName));
      await saveWorkspaceSettings(env, teamId, { github: null, ...(dropRepo ? { repo: null } : {}) });
      return ok({ workspace: await described() });
    }
    if (action === "repos" && request.method === "GET") {
      if (!settings.github) return fail(409, "Connect GitHub first.");
      return ok(await listInstallationRepos(env, settings.github));
    }
    if (action === "branches" && request.method === "GET") {
      const fullName = parseRepoName(new URL(request.url).searchParams.get("repo") ?? "");
      if (!fullName) return fail(400, "Pick a repository as owner/name.");
      const { viaGithub: _, ...found } = await listRepoBranches(env, settings.github, fullName);
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
    anonymousMessage: "Sign in to your Stella account to set up Stella for Slack.",
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
