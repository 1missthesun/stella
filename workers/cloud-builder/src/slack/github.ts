import {
  SLACK_GITHUB_ERROR_PARAM,
  SLACK_GITHUB_RESULT_PARAM,
  type SlackGithubBranchesResponse,
  type SlackGithubInstallationChoice,
  type SlackGithubRepoOption,
  type SlackGithubReposResponse,
  type SlackWorkspaceGithub,
} from "@stella/contracts/slack-workspace";
import { signOAuthState, verifyOAuthState } from "../oauth-state.js";
import {
  exchangeUserCode,
  githubAppConfigured,
  githubAuthorizeUrl,
  GithubError,
  githubHeaders,
  GithubInstallationGoneError,
  githubInstallUrl,
  githubSecret,
  listUserInstallations,
  mintInstallationToken,
} from "../projects/github.js";
import { slackPublicOrigin } from "./config.js";
import { verifySlackRepoCapability } from "./repo-capability.js";
import {
  connectionFor,
  findRepoByName,
  listGithubConnections,
  repoOwnedBy,
  setGithubStatus,
  type SlackGithubConnection,
  type SlackRepoSettings,
} from "./repos.js";

export const SLACK_GITHUB_CALLBACK_PATH = "/api/slack/github/callback";
export const SLACK_GITHUB_WEBHOOK_PATH = "/api/slack/github/webhook";
export const SLACK_GITHUB_AGENT_TOKEN_PATH = "/api/slack/github/agent/token";
export const SLACK_GITHUB_AGENT_PREVIEW_PATH = "/api/slack/github/agent/preview";

const STATE_KIND = "slack_github";
const CONNECT_TTL_MS = 15 * 60_000;
const API = "https://api.github.com";
const REPO_PAGES = 10;
const BRANCH_PAGES = 5;
const MAX_WEBHOOK_BYTES = 1_000_000;
const PICKER_ACCESS = { contents: "read", metadata: "read" } as const;
const AGENT_ACCESS = {
  contents: "write",
  metadata: "read",
  deployments: "read",
  statuses: "read",
  checks: "read",
} as const;

const d1 = (env: Cloudflare.Env): D1Database => {
  if (!env.DB) throw new Error("The DB binding is missing.");
  return env.DB;
};

export const slackGithubConfigured = (env: Cloudflare.Env): boolean =>
  githubAppConfigured(env, "slack");

export const githubManageUrl = (connection: SlackGithubConnection): string =>
  connection.accountType === "Organization"
    ? `https://github.com/organizations/${encodeURIComponent(connection.account)}/settings/installations/${connection.installationId}`
    : `https://github.com/settings/installations/${connection.installationId}`;

export const describeGithub = (connection: SlackGithubConnection): SlackWorkspaceGithub => ({
  installationId: connection.installationId,
  account: connection.account,
  accountType: connection.accountType,
  status: connection.status,
  manageUrl: githubManageUrl(connection),
});

const callbackUrl = (env: Cloudflare.Env, request?: Request): string =>
  `${slackPublicOrigin(env, request)}${SLACK_GITHUB_CALLBACK_PATH}`;

const randomNonce = (): string =>
  [...crypto.getRandomValues(new Uint8Array(24))].map((byte) => byte.toString(16).padStart(2, "0")).join("");

export const startGithubConnect = async (
  env: Cloudflare.Env,
  request: Request,
  args: { ownerId: string; teamId: string; returnTo: string },
): Promise<string> => {
  const nonce = randomNonce();
  const exp = Date.now() + CONNECT_TTL_MS;
  await d1(env).prepare("DELETE FROM slack_github_connects WHERE expires_at < ?").bind(Date.now()).run();
  await d1(env)
    .prepare(
      "INSERT INTO slack_github_connects (nonce, owner_id, team_id, return_to, installations, expires_at) VALUES (?, ?, ?, ?, NULL, ?)",
    )
    .bind(nonce, args.ownerId, args.teamId, args.returnTo, exp)
    .run();
  const state = await signOAuthState(env, { ownerId: args.ownerId, kind: STATE_KIND, nonce, exp });
  return githubAuthorizeUrl(env, state, callbackUrl(env, request), "slack");
};

type ConnectRow = {
  nonce: string;
  owner_id: string;
  team_id: string;
  return_to: string;
  installations: string | null;
  expires_at: number;
};

const loadConnect = async (env: Cloudflare.Env, nonce: string): Promise<ConnectRow | null> => {
  const row = await d1(env)
    .prepare("SELECT * FROM slack_github_connects WHERE nonce = ?")
    .bind(nonce)
    .first<ConnectRow>();
  return row && row.expires_at > Date.now() ? row : null;
};

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );

const page = (title: string, detail: string, status = 200): Response =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${escapeHtml(title)}</title>` +
      `<body style="font-family:system-ui,-apple-system,sans-serif;max-width:34rem;margin:18vh auto;padding:0 1.5rem;line-height:1.5">` +
      `<h1 style="font-size:1.25rem;margin:0 0 .5rem">${escapeHtml(title)}</h1>` +
      `<p style="margin:0;color:#555">${escapeHtml(detail)}</p></body>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );

const back = (row: ConnectRow, param: string, value: string): Response => {
  const url = new URL(row.return_to);
  url.searchParams.set(param, value);
  url.searchParams.set("team", row.team_id);
  return new Response(null, { status: 302, headers: { location: url.toString(), "cache-control": "no-store" } });
};

const RESTART = "Start again from the Stella Crew page. Connect links work once and last 15 minutes.";

const callback = async (request: Request, env: Cloudflare.Env): Promise<Response> => {
  const url = new URL(request.url);
  const stateToken = url.searchParams.get("state")?.trim() ?? "";
  const code = url.searchParams.get("code")?.trim();
  const installationId = url.searchParams.get("installation_id")?.trim();
  if (url.searchParams.get("setup_action") === "request" && !installationId) {
    return page(
      "Install request sent",
      "GitHub asked an owner of that organization to approve Stella Crew. Connect GitHub again once they have.",
    );
  }
  const state = stateToken ? await verifyOAuthState(env, stateToken) : null;
  if (!state || state.kind !== STATE_KIND) return page("That GitHub link expired", RESTART, 400);
  const row = await loadConnect(env, state.nonce);
  if (!row || row.owner_id !== state.ownerId) return page("That GitHub link expired", RESTART, 400);
  if (url.searchParams.get("error") === "access_denied") {
    return back(row, SLACK_GITHUB_ERROR_PARAM, "You canceled connecting GitHub.");
  }
  try {
    if (!code) {
      if (!installationId) return back(row, SLACK_GITHUB_ERROR_PARAM, "GitHub didn't finish installing Stella Crew.");
      // Back from installing or reconfiguring the App: the installation id in
      // the query proves nothing, so confirm through the user again.
      return Response.redirect(githubAuthorizeUrl(env, stateToken, callbackUrl(env, request), "slack"), 302);
    }
    const userToken = await exchangeUserCode(env, code, callbackUrl(env, request), "slack");
    const installations = await listUserInstallations(userToken);
    if (installations.length === 0) {
      if (state.extra?.installing === "1") {
        return back(row, SLACK_GITHUB_ERROR_PARAM, "Stella Crew isn't installed on any account you can reach.");
      }
      const installState = await signOAuthState(env, { ...state, extra: { installing: "1" } });
      return Response.redirect(githubInstallUrl(env, installState, "slack"), 302);
    }
    const choices: SlackGithubInstallationChoice[] = installations.map((item) => ({
      installationId: String(item.id),
      account: (item.account?.login ?? "").slice(0, 200),
      accountType: (item.account?.type ?? "").slice(0, 50),
    }));
    await d1(env)
      .prepare("UPDATE slack_github_connects SET installations = ? WHERE nonce = ?")
      .bind(JSON.stringify(choices), row.nonce)
      .run();
    return back(row, SLACK_GITHUB_RESULT_PARAM, row.nonce);
  } catch (error) {
    if (!(error instanceof GithubError)) {
      console.error(
        JSON.stringify({
          event: "slack_github_callback_failed",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    return back(
      row,
      SLACK_GITHUB_ERROR_PARAM,
      error instanceof GithubError ? error.message : "Stella hit an error connecting GitHub. Try again.",
    );
  }
};

export type FinishResult =
  | { ok: true; connection: SlackGithubConnection }
  | { ok: true; choices: SlackGithubInstallationChoice[] }
  | { ok: false; message: string };

export const finishGithubConnect = async (
  env: Cloudflare.Env,
  args: { ownerId: string; teamId: string; code: string; installationId?: string },
): Promise<FinishResult> => {
  const row = await loadConnect(env, args.code);
  if (!row || !row.installations) {
    return { ok: false, message: "That GitHub connection expired. Connect GitHub again." };
  }
  if (row.owner_id !== args.ownerId || row.team_id !== args.teamId) {
    await d1(env).prepare("DELETE FROM slack_github_connects WHERE nonce = ?").bind(row.nonce).run();
    return { ok: false, message: "That GitHub connection was started by a different Stella account." };
  }
  const choices = JSON.parse(row.installations) as SlackGithubInstallationChoice[];
  const chosen = args.installationId
    ? choices.find((choice) => choice.installationId === args.installationId)
    : choices.length === 1
      ? choices[0]
      : undefined;
  if (!chosen) {
    if (args.installationId) return { ok: false, message: "Pick one of the GitHub accounts listed." };
    return { ok: true, choices };
  }
  await d1(env).prepare("DELETE FROM slack_github_connects WHERE nonce = ?").bind(row.nonce).run();
  return {
    ok: true,
    connection: {
      installationId: chosen.installationId,
      account: chosen.account,
      accountType: chosen.accountType,
      status: "active",
    },
  };
};

export class RepoNotFoundError extends GithubError {}

const minted = async (
  env: Cloudflare.Env,
  connection: SlackGithubConnection,
  repo?: string,
  permissions: Record<string, "read" | "write"> = PICKER_ACCESS,
): Promise<string> => {
  try {
    return (
      await mintInstallationToken(env, {
        installationId: connection.installationId,
        app: "slack",
        permissions,
        ...(repo ? { repo } : {}),
      })
    ).token;
  } catch (error) {
    if (error instanceof GithubInstallationGoneError) {
      await setGithubStatus(env, connection.installationId, error.status === 403 ? "suspended" : "revoked");
    }
    throw error;
  }
};

export const checkInstallation = async (
  env: Cloudflare.Env,
  connection: SlackGithubConnection,
): Promise<SlackGithubConnection["status"] | null> => {
  try {
    await minted(env, connection);
    if (connection.status !== "active") await setGithubStatus(env, connection.installationId, "active");
    return "active";
  } catch (error) {
    if (error instanceof GithubInstallationGoneError) return error.status === 403 ? "suspended" : "revoked";
    return null;
  }
};

const get = async <T>(token: string | null, path: string): Promise<{ status: number; body: T | null; next: boolean }> => {
  const headers = githubHeaders(token ? `Bearer ${token}` : "");
  if (!token) delete headers.authorization;
  const response = await fetch(`${API}/${path}`, { headers, signal: AbortSignal.timeout(10_000) });
  const body = response.ok ? ((await response.json()) as T) : null;
  return { status: response.status, body, next: /rel="next"/u.test(response.headers.get("link") ?? "") };
};

export const listInstallationRepos = async (
  env: Cloudflare.Env,
  connections: SlackGithubConnection[],
): Promise<SlackGithubReposResponse> => {
  const repos: SlackGithubRepoOption[] = [];
  let truncated = false;
  const active = connections.filter((connection) => connection.status === "active");
  for (const connection of active) {
    const found = await listConnectionRepos(env, connection);
    truncated ||= found.truncated;
    for (const repo of found.repos) {
      if (!repos.some((seen) => seen.fullName.toLowerCase() === repo.fullName.toLowerCase())) repos.push(repo);
    }
  }
  repos.sort((a, b) => a.fullName.localeCompare(b.fullName));
  return { repos, truncated };
};

const listConnectionRepos = async (
  env: Cloudflare.Env,
  connection: SlackGithubConnection,
): Promise<SlackGithubReposResponse> => {
  const token = await minted(env, connection);
  const repos: SlackGithubRepoOption[] = [];
  let truncated = false;
  for (let page = 1; page <= REPO_PAGES; page += 1) {
    const result = await get<{
      repositories?: Array<{ full_name?: string; private?: boolean; default_branch?: string }>;
    }>(token, `installation/repositories?per_page=100&page=${page}`);
    if (!result.body) throw new GithubError("GitHub wouldn't list the repositories Stella can see.");
    for (const repo of result.body.repositories ?? []) {
      if (!repo.full_name) continue;
      repos.push({ fullName: repo.full_name, private: repo.private === true, defaultBranch: repo.default_branch ?? "" });
    }
    if (!result.next) break;
    if (page === REPO_PAGES) truncated = true;
  }
  repos.sort((a, b) => a.fullName.localeCompare(b.fullName));
  return { repos, truncated };
};

export const listRepoBranches = async (
  env: Cloudflare.Env,
  connection: SlackGithubConnection | null,
  fullName: string,
): Promise<SlackGithubBranchesResponse & { viaGithub: boolean }> => {
  const owned = connection && connection.status === "active" && repoOwnedBy(connection, fullName);
  const token = owned ? await minted(env, connection, fullName.split("/")[1]) : null;
  const repo = await get<{ default_branch?: string }>(token, `repos/${fullName}`);
  if (!repo.body) {
    throw new (repo.status === 404 ? RepoNotFoundError : GithubError)(
      repo.status === 404
        ? owned
          ? `Stella can't see ${fullName}. Add it to the GitHub connection's repositories.`
          : `GitHub can't find ${fullName}. If it's private, connect GitHub and give Stella access to it.`
        : `GitHub didn't answer for ${fullName} (${repo.status}). Try again.`,
    );
  }
  const branches: string[] = [];
  let truncated = false;
  for (let page = 1; page <= BRANCH_PAGES; page += 1) {
    const result = await get<Array<{ name?: string }>>(token, `repos/${fullName}/branches?per_page=100&page=${page}`);
    if (!result.body) break;
    for (const branch of result.body) if (branch.name) branches.push(branch.name);
    if (!result.next) break;
    if (page === BRANCH_PAGES) truncated = true;
  }
  const defaultBranch = repo.body.default_branch ?? "";
  if (defaultBranch && !branches.includes(defaultBranch)) branches.unshift(defaultBranch);
  branches.sort((a, b) => (a === defaultBranch ? -1 : b === defaultBranch ? 1 : a.localeCompare(b)));
  return { branches, defaultBranch, truncated, viaGithub: Boolean(token) };
};

/**
 * The token an agent clones with: minted for this one repository with
 * `contents: read` when the workspace's GitHub connection owns it, else a
 * token pasted before connections existed, else none (public).
 */
export const cloneToken = async (env: Cloudflare.Env, repo: SlackRepoSettings): Promise<string | null> => {
  const connection = repo.github;
  if (connection && connection.status !== "revoked" && repoOwnedBy(connection, repo.fullName)) {
    try {
      return await minted(env, connection, repo.fullName.split("/")[1], AGENT_ACCESS);
    } catch (error) {
      console.warn(
        JSON.stringify({
          event: "slack_repo_token_failed",
          teamId: repo.teamId,
          repo: repo.fullName,
          message: error instanceof Error ? error.message.slice(0, 200) : String(error),
        }),
      );
    }
  }
  return repo.legacyToken;
};

export type SlackPreview =
  | { state: "ready"; url: string; source: string }
  | { state: "pending"; detail: string }
  | { state: "failed"; detail: string; url?: string }
  | { state: "none" };

const PREVIEW_HOST =
  /https:\/\/[A-Za-z0-9.-]+\.(?:pages\.dev|workers\.dev|vercel\.app|netlify\.app|onrender\.com|fly\.dev|surge\.sh|github\.io|web\.app|firebaseapp\.com|amplifyapp\.com|railway\.app|up\.railway\.app)(?:\/[^\s)|"'<>\]]*)?/gu;
const DEPLOYISH = /pages|vercel|netlify|deploy|preview|workers|cloudflare|render|firebase|amplify|railway/iu;

const previewUrls = (...texts: Array<string | null | undefined>): string[] =>
  texts.flatMap((text) => (text ? [...text.matchAll(PREVIEW_HOST)].map((match) => match[0]!) : []));

export const findPreview = async (token: string, fullName: string, sha: string): Promise<SlackPreview> => {
  let pending: string | null = null;
  let failed: { detail: string; url?: string } | null = null;

  const deployments = await get<Array<{ id: number; environment?: string }>>(
    token,
    `repos/${fullName}/deployments?sha=${sha}&per_page=10`,
  );
  for (const deployment of deployments.body ?? []) {
    const statuses = await get<Array<{ state?: string; environment_url?: string; target_url?: string; log_url?: string }>>(
      token,
      `repos/${fullName}/deployments/${deployment.id}/statuses?per_page=1`,
    );
    const latest = statuses.body?.[0];
    const url = latest?.environment_url || "";
    if (latest?.state === "success" && url) {
      return { state: "ready", url, source: `deployment ${deployment.environment ?? ""}`.trim() };
    }
    if (!latest || ["queued", "in_progress", "pending"].includes(latest.state ?? "")) {
      pending ??= `deployment ${deployment.environment ?? ""} is ${latest?.state ?? "queued"}`.trim();
    } else if (["failure", "error"].includes(latest.state ?? "")) {
      failed ??= { detail: `deployment ${deployment.environment ?? ""} failed`.trim(), ...(latest.log_url ? { url: latest.log_url } : {}) };
    }
  }

  const checks = await get<{
    check_runs?: Array<{
      name?: string;
      status?: string;
      conclusion?: string | null;
      details_url?: string;
      output?: { summary?: string | null; text?: string | null };
      app?: { slug?: string };
    }>;
  }>(token, `repos/${fullName}/commits/${sha}/check-runs?per_page=50`);
  for (const run of checks.body?.check_runs ?? []) {
    const label = `${run.app?.slug ?? ""} ${run.name ?? ""}`;
    const urls = previewUrls(run.output?.summary, run.output?.text, run.details_url);
    if (!urls.length && !DEPLOYISH.test(label)) continue;
    if (run.status === "completed" && run.conclusion === "success" && urls[0]) {
      return { state: "ready", url: urls[0], source: run.name ?? "check run" };
    }
    if (run.status !== "completed") pending ??= `${run.name ?? "a check"} is ${run.status ?? "queued"}`;
    else if (run.conclusion && !["success", "neutral", "skipped"].includes(run.conclusion)) {
      failed ??= { detail: `${run.name ?? "a check"} ${run.conclusion}`, ...(run.details_url ? { url: run.details_url } : {}) };
    }
  }

  const combined = await get<{ statuses?: Array<{ context?: string; state?: string; target_url?: string | null; description?: string | null }> }>(
    token,
    `repos/${fullName}/commits/${sha}/status`,
  );
  for (const status of combined.body?.statuses ?? []) {
    const urls = previewUrls(status.target_url, status.description);
    if (!urls.length && !DEPLOYISH.test(status.context ?? "")) continue;
    if (status.state === "success" && urls[0]) return { state: "ready", url: urls[0], source: status.context ?? "status" };
    if (status.state === "pending") pending ??= `${status.context ?? "a status"} is pending`;
    else if (status.state === "failure" || status.state === "error") {
      failed ??= { detail: `${status.context ?? "a status"} failed`, ...(status.target_url ? { url: status.target_url } : {}) };
    }
  }

  if (pending) return { state: "pending", detail: pending };
  if (failed) return { state: "failed", ...failed };
  return { state: "none" };
};

const agentConnection = async (
  env: Cloudflare.Env,
  request: Request,
): Promise<{ connection: SlackGithubConnection; fullName: string; branch: string } | Response> => {
  const header = request.headers.get("authorization") ?? "";
  const claims = header.startsWith("Bearer ") ? await verifySlackRepoCapability(env, header.slice(7).trim()) : null;
  if (!claims) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const repo = await findRepoByName(env, claims.team, claims.repo);
  const github = repo ? connectionFor(await listGithubConnections(env, claims.team), repo.fullName) : null;
  if (!repo || !github) {
    return Response.json({ error: "This workspace no longer gives agents this repository." }, { status: 403 });
  }
  if (github.status !== "active") {
    return Response.json({ error: `GitHub access to ${github.account} was removed. The workspace owner needs to reconnect it.` }, { status: 403 });
  }
  return { connection: github, fullName: repo.fullName, branch: repo.branch };
};

const agentToken = async (request: Request, env: Cloudflare.Env): Promise<Response> => {
  const access = await agentConnection(env, request);
  if (access instanceof Response) return access;
  try {
    const token = await minted(env, access.connection, access.fullName.split("/")[1], AGENT_ACCESS);
    return Response.json({ token }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof GithubError ? error.message : "GitHub didn't issue a token." },
      { status: 502 },
    );
  }
};

const agentPreview = async (request: Request, env: Cloudflare.Env): Promise<Response> => {
  const access = await agentConnection(env, request);
  if (access instanceof Response) return access;
  const sha = new URL(request.url).searchParams.get("sha") ?? "";
  if (!/^[0-9a-f]{7,40}$/u.test(sha)) return Response.json({ error: "Pass the commit as ?sha=<full sha>." }, { status: 400 });
  try {
    const token = await minted(env, access.connection, access.fullName.split("/")[1], AGENT_ACCESS);
    return Response.json(await findPreview(token, access.fullName, sha), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof GithubError ? error.message : "GitHub didn't answer." },
      { status: 502 },
    );
  }
};

const hmacHex = async (secret: string, body: string): Promise<string> => {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body)))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const constantTimeEqual = (left: string, right: string): boolean => {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
};

const webhook = async (request: Request, env: Cloudflare.Env): Promise<Response> => {
  const secret = githubSecret(env, "GITHUB_WEBHOOK_SECRET", "slack");
  if (!secret) return Response.json({ error: "Not configured" }, { status: 503 });
  if (Number(request.headers.get("content-length") ?? "0") > MAX_WEBHOOK_BYTES) {
    return Response.json({ error: "Payload too large" }, { status: 413 });
  }
  const raw = await request.text();
  if (raw.length > MAX_WEBHOOK_BYTES) return Response.json({ error: "Payload too large" }, { status: 413 });
  if (!constantTimeEqual(request.headers.get("x-hub-signature-256") ?? "", `sha256=${await hmacHex(secret, raw)}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const event = request.headers.get("x-github-event") ?? "";
  if (event !== "installation") return Response.json({ ok: true, ignored: event });
  let body: { action?: string; installation?: { id?: number } };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }
  const installationId = body.installation?.id;
  const status =
    body.action === "deleted"
      ? "revoked"
      : body.action === "suspend"
        ? "suspended"
        : body.action === "unsuspend"
          ? "active"
          : null;
  if (typeof installationId !== "number" || !status) return Response.json({ ok: true, ignored: body.action ?? "" });
  const changed = await setGithubStatus(env, String(installationId), status);
  console.log(JSON.stringify({ event: "slack_github_installation", installationId, status, workspaces: changed }));
  return Response.json({ ok: true });
};

export const handleSlackGithubRoute = async (request: Request, env: Cloudflare.Env): Promise<Response | null> => {
  const { pathname } = new URL(request.url);
  if (pathname === SLACK_GITHUB_CALLBACK_PATH && request.method === "GET") return await callback(request, env);
  if (pathname === SLACK_GITHUB_WEBHOOK_PATH && request.method === "POST") return await webhook(request, env);
  if (pathname === SLACK_GITHUB_AGENT_TOKEN_PATH && request.method === "POST") return await agentToken(request, env);
  if (pathname === SLACK_GITHUB_AGENT_PREVIEW_PATH && request.method === "GET") return await agentPreview(request, env);
  return null;
};
