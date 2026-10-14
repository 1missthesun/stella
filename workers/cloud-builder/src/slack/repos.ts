import { decryptToken } from "./crypto.js";

const d1 = (env: Cloudflare.Env): D1Database => {
  if (!env.DB) throw new Error("The DB binding is missing.");
  return env.DB;
};

export type SlackGithubStatus = "active" | "suspended" | "revoked";

export type SlackGithubConnection = {
  installationId: string;
  account: string;
  accountType: string;
  status: SlackGithubStatus;
};

export type SlackRepoRecord = {
  teamId: string;
  id: string;
  fullName: string;
  branch: string;
  hasToken: boolean;
  rules: string;
  previewAccess: string | null;
  previewTtlDays: number | null;
};

export type SlackRepoSettings = {
  teamId: string;
  id: string;
  fullName: string;
  branch: string;
  /** A token pasted before GitHub connections existed. */
  legacyToken: string | null;
  github: SlackGithubConnection | null;
};

type RepoRow = {
  team_id: string;
  id: string;
  full_name: string;
  branch: string;
  token_enc: string | null;
  rules: string;
  preview_access: string | null;
  preview_ttl_days: number | null;
};

const fromRow = (row: RepoRow): SlackRepoRecord => ({
  teamId: row.team_id,
  id: row.id,
  fullName: row.full_name,
  branch: row.branch ?? "",
  hasToken: Boolean(row.token_enc),
  rules: row.rules ?? "",
  previewAccess: row.preview_access,
  previewTtlDays: row.preview_ttl_days,
});

const isGithubStatus = (value: unknown): value is SlackGithubStatus =>
  value === "active" || value === "suspended" || value === "revoked";

export const listGithubConnections = async (
  env: Cloudflare.Env,
  teamId: string,
): Promise<SlackGithubConnection[]> => {
  const rows = await d1(env)
    .prepare(
      "SELECT installation_id, account, account_type, status FROM slack_github_connections WHERE team_id = ? ORDER BY created_at",
    )
    .bind(teamId)
    .all<{ installation_id: string; account: string; account_type: string; status: string }>();
  return (rows.results ?? []).map((row) => ({
    installationId: row.installation_id,
    account: row.account,
    accountType: row.account_type,
    status: isGithubStatus(row.status) ? row.status : "active",
  }));
};

export const saveGithubConnection = async (
  env: Cloudflare.Env,
  teamId: string,
  connection: SlackGithubConnection,
): Promise<void> => {
  await d1(env)
    .prepare(
      `INSERT INTO slack_github_connections (team_id, installation_id, account, account_type, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (team_id, installation_id) DO UPDATE SET account = excluded.account,
         account_type = excluded.account_type, status = excluded.status`,
    )
    .bind(teamId, connection.installationId, connection.account, connection.accountType, connection.status, Date.now())
    .run();
};

export const deleteGithubConnection = async (
  env: Cloudflare.Env,
  teamId: string,
  installationId: string,
): Promise<boolean> => {
  const result = await d1(env)
    .prepare("DELETE FROM slack_github_connections WHERE team_id = ? AND installation_id = ?")
    .bind(teamId, installationId)
    .run();
  return (result.meta.changes ?? 0) > 0;
};

export const setGithubStatus = async (
  env: Cloudflare.Env,
  installationId: string,
  status: SlackGithubStatus,
): Promise<number> => {
  const result = await d1(env)
    .prepare("UPDATE slack_github_connections SET status = ? WHERE installation_id = ? AND status != ?")
    .bind(status, installationId, status)
    .run();
  return result.meta.changes ?? 0;
};

export const repoOwnedBy = (github: SlackGithubConnection | null, fullName: string): boolean =>
  Boolean(github?.account) &&
  fullName.split("/")[0]!.toLowerCase() === github!.account.toLowerCase();

export const connectionFor = (
  connections: SlackGithubConnection[],
  fullName: string,
): SlackGithubConnection | null => {
  const owned = connections.filter((connection) => repoOwnedBy(connection, fullName));
  return owned.find((connection) => connection.status === "active") ?? owned[0] ?? null;
};

export const listRepos = async (env: Cloudflare.Env, teamId: string): Promise<SlackRepoRecord[]> => {
  const rows = await d1(env)
    .prepare("SELECT * FROM slack_repos WHERE team_id = ? ORDER BY created_at, full_name")
    .bind(teamId)
    .all<RepoRow>();
  return (rows.results ?? []).map(fromRow);
};

export const loadRepo = async (
  env: Cloudflare.Env,
  teamId: string,
  repoId: string,
): Promise<SlackRepoRecord | null> => {
  const row = await d1(env)
    .prepare("SELECT * FROM slack_repos WHERE team_id = ? AND id = ?")
    .bind(teamId, repoId)
    .first<RepoRow>();
  return row ? fromRow(row) : null;
};

export const findRepoByName = async (
  env: Cloudflare.Env,
  teamId: string,
  fullName: string,
): Promise<SlackRepoRecord | null> => {
  const row = await d1(env)
    .prepare("SELECT * FROM slack_repos WHERE team_id = ? AND full_name = ? COLLATE NOCASE")
    .bind(teamId, fullName)
    .first<RepoRow>();
  return row ? fromRow(row) : null;
};

const newRepoId = (): string =>
  `r${[...crypto.getRandomValues(new Uint8Array(6))].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;

export const addRepo = async (
  env: Cloudflare.Env,
  teamId: string,
  repo: { fullName: string; branch: string },
): Promise<SlackRepoRecord> => {
  const id = newRepoId();
  const now = Date.now();
  await d1(env)
    .prepare(
      `INSERT INTO slack_repos (team_id, id, full_name, branch, token_enc, rules, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, '', ?, ?)`,
    )
    .bind(teamId, id, repo.fullName, repo.branch, now, now)
    .run();
  return (await loadRepo(env, teamId, id))!;
};

export type RepoPatch = {
  branch?: string;
  rules?: string;
  previewAccess?: string;
  previewTtlDays?: number;
  dropToken?: boolean;
};

export const updateRepo = async (
  env: Cloudflare.Env,
  teamId: string,
  repoId: string,
  patch: RepoPatch,
): Promise<void> => {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.branch !== undefined) (sets.push("branch = ?"), values.push(patch.branch));
  if (patch.rules !== undefined) (sets.push("rules = ?"), values.push(patch.rules));
  if (patch.previewAccess !== undefined) (sets.push("preview_access = ?"), values.push(patch.previewAccess));
  if (patch.previewTtlDays !== undefined) (sets.push("preview_ttl_days = ?"), values.push(patch.previewTtlDays));
  if (patch.dropToken) sets.push("token_enc = NULL");
  if (!sets.length) return;
  sets.push("updated_at = ?");
  values.push(Date.now());
  await d1(env)
    .prepare(`UPDATE slack_repos SET ${sets.join(", ")} WHERE team_id = ? AND id = ?`)
    .bind(...values, teamId, repoId)
    .run();
};

export const removeRepo = async (env: Cloudflare.Env, teamId: string, repoId: string): Promise<void> => {
  const db = d1(env);
  await db.batch([
    db.prepare("DELETE FROM slack_repos WHERE team_id = ? AND id = ?").bind(teamId, repoId),
    db.prepare("DELETE FROM slack_environments WHERE team_id = ? AND repo_id = ?").bind(teamId, repoId),
    db.prepare("DELETE FROM slack_environment_secrets WHERE team_id = ? AND repo_id = ?").bind(teamId, repoId),
    db.prepare("DELETE FROM slack_channel_repos WHERE team_id = ? AND repo_id = ?").bind(teamId, repoId),
    db.prepare("DELETE FROM slack_conversation_repos WHERE team_id = ? AND repo_id = ?").bind(teamId, repoId),
  ]);
};

export const deleteWorkspaceRepos = async (env: Cloudflare.Env, teamId: string): Promise<void> => {
  const db = d1(env);
  await db.batch([
    db.prepare("DELETE FROM slack_repos WHERE team_id = ?").bind(teamId),
    db.prepare("DELETE FROM slack_github_connections WHERE team_id = ?").bind(teamId),
    db.prepare("DELETE FROM slack_channel_repos WHERE team_id = ?").bind(teamId),
    db.prepare("DELETE FROM slack_conversation_repos WHERE team_id = ?").bind(teamId),
  ]);
};

export const repoSettings = async (
  env: Cloudflare.Env,
  record: SlackRepoRecord,
  connections?: SlackGithubConnection[],
): Promise<SlackRepoSettings> => {
  const row = record.hasToken
    ? await d1(env)
        .prepare("SELECT token_enc FROM slack_repos WHERE team_id = ? AND id = ?")
        .bind(record.teamId, record.id)
        .first<{ token_enc: string | null }>()
    : null;
  return {
    teamId: record.teamId,
    id: record.id,
    fullName: record.fullName,
    branch: record.branch,
    legacyToken: row?.token_enc ? await decryptToken(env, row.token_enc).catch(() => null) : null,
    github: connectionFor(connections ?? (await listGithubConnections(env, record.teamId)), record.fullName),
  };
};

export const listChannelDefaults = async (
  env: Cloudflare.Env,
  teamId: string,
): Promise<Array<{ channelId: string; repoId: string; channelName: string }>> => {
  const rows = await d1(env)
    .prepare("SELECT channel_id, repo_id, channel_name FROM slack_channel_repos WHERE team_id = ? ORDER BY channel_name")
    .bind(teamId)
    .all<{ channel_id: string; repo_id: string; channel_name: string }>();
  return (rows.results ?? []).map((row) => ({
    channelId: row.channel_id,
    repoId: row.repo_id,
    channelName: row.channel_name,
  }));
};

export const setChannelDefault = async (
  env: Cloudflare.Env,
  teamId: string,
  channelId: string,
  repoId: string | null,
  channelName: string,
): Promise<void> => {
  if (repoId === null) {
    await d1(env)
      .prepare("DELETE FROM slack_channel_repos WHERE team_id = ? AND channel_id = ?")
      .bind(teamId, channelId)
      .run();
    return;
  }
  await d1(env)
    .prepare(
      `INSERT INTO slack_channel_repos (team_id, channel_id, repo_id, channel_name, set_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (team_id, channel_id) DO UPDATE SET repo_id = excluded.repo_id,
         channel_name = excluded.channel_name, set_at = excluded.set_at`,
    )
    .bind(teamId, channelId, repoId, channelName.slice(0, 200), Date.now())
    .run();
};

export const removeChannelDefaults = async (
  env: Cloudflare.Env,
  teamId: string,
  repoId: string,
  channelIds: string[],
): Promise<void> => {
  if (!channelIds.length) return;
  const db = d1(env);
  await db.batch(
    channelIds.map((channelId) =>
      db
        .prepare("DELETE FROM slack_channel_repos WHERE team_id = ? AND channel_id = ? AND repo_id = ?")
        .bind(teamId, channelId, repoId),
    ),
  );
};

export const setConversationRepo = async (
  env: Cloudflare.Env,
  conversationId: string,
  teamId: string,
  repoId: string | null,
): Promise<void> => {
  if (repoId === null) {
    await d1(env).prepare("DELETE FROM slack_conversation_repos WHERE conversation_id = ?").bind(conversationId).run();
    return;
  }
  await d1(env)
    .prepare(
      `INSERT INTO slack_conversation_repos (conversation_id, team_id, repo_id, set_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (conversation_id) DO UPDATE SET team_id = excluded.team_id, repo_id = excluded.repo_id,
         set_at = excluded.set_at`,
    )
    .bind(conversationId, teamId, repoId, Date.now())
    .run();
};

export type ConversationRepo = {
  teamId: string;
  repo: SlackRepoRecord | null;
  source: "chosen" | "channel" | "only" | "none";
};

export const resolveConversationRepo = async (
  env: Cloudflare.Env,
  conversationId: string,
  known?: { teamId: string; channelId: string },
): Promise<ConversationRepo | null> => {
  const db = d1(env);
  const place =
    known ??
    (await db
      .prepare("SELECT team_id AS teamId, channel_id AS channelId FROM slack_threads WHERE conversation_id = ? LIMIT 1")
      .bind(conversationId)
      .first<{ teamId: string; channelId: string }>());
  const chosenRow = await db
    .prepare("SELECT team_id, repo_id FROM slack_conversation_repos WHERE conversation_id = ?")
    .bind(conversationId)
    .first<{ team_id: string; repo_id: string }>();
  const teamId = place?.teamId ?? chosenRow?.team_id;
  if (!teamId) return null;
  const repos = await listRepos(env, teamId);
  if (chosenRow && chosenRow.team_id === teamId) {
    if (chosenRow.repo_id === "") return { teamId, repo: null, source: "none" };
    const chosen = repos.find((repo) => repo.id === chosenRow.repo_id);
    if (chosen) return { teamId, repo: chosen, source: "chosen" };
  }
  if (place?.channelId) {
    const row = await db
      .prepare("SELECT repo_id FROM slack_channel_repos WHERE team_id = ? AND channel_id = ?")
      .bind(teamId, place.channelId)
      .first<{ repo_id: string }>();
    const channelRepo = row ? repos.find((repo) => repo.id === row.repo_id) : undefined;
    if (channelRepo) return { teamId, repo: channelRepo, source: "channel" };
  }
  if (repos.length === 1) return { teamId, repo: repos[0]!, source: "only" };
  return { teamId, repo: null, source: "none" };
};

export const repoForConversation = async (
  env: Cloudflare.Env,
  conversationId: string,
): Promise<SlackRepoSettings | null> => {
  const resolved = await resolveConversationRepo(env, conversationId);
  if (!resolved?.repo) return null;
  return await repoSettings(env, resolved.repo);
};

export const conversationChoseNone = async (env: Cloudflare.Env, conversationId: string): Promise<boolean> =>
  (
    await d1(env)
      .prepare("SELECT repo_id FROM slack_conversation_repos WHERE conversation_id = ?")
      .bind(conversationId)
      .first<{ repo_id: string }>()
  )?.repo_id === "";
