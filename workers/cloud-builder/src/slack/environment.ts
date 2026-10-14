/**
 * Stella for Slack environments: what every agent container started from a
 * workspace's Slack runs with. One per repository, plus one (`repo_id` '')
 * for work that isn't about a repository (migrations/0015, 0016), edited by
 * the owner on stella.sh/crew. A container runs in the environment of the
 * repository its conversation works in (`repos.ts`).
 *
 * Network access is enforced by the container's network, not by the agent.
 * A Slack agent's container sends every HTTP and HTTPS request through
 * `SandboxEgress` (HTTPS is intercepted with a per-container CA the container
 * trusts), which calls `slackEgress` here. It reads the repository's current
 * environment (cached for seconds) and allows or refuses each request:
 *
 *   none     Stella itself, the engine's model API and the repository on
 *            GitHub; nothing else
 *   limited  also package registries, GitHub and other build hosts
 *            (`LIMITED_HOSTS`), the owner's extra hosts and the secrets' hosts
 *   full     everything; other ports reach the Internet directly too
 *
 * Under none and limited the container starts without Internet access, so
 * only ports 80 and 443 leave it, and only through here.
 *
 * Network secrets never enter the container. Their values are sealed in D1
 * and decrypted only here: an HTTPS request to a secret's host gets the
 * secret's header set to the value (replacing whatever the agent sent), and
 * redirects are handed back to the container rather than followed, so the
 * header never travels to another host. The agent sees a placeholder
 * variable named after the secret, so clients that insist on a key start.
 *
 * The setup script runs once per container start, before the agent, as the
 * agent's own user (never root) in the repository's checkout, under the same
 * network rules. Variables it exports (PATH included) carry over to the
 * agent. A failure is recorded with its log for the settings page, noted in
 * the Slack thread, and told to the agent, which goes on without it.
 */

import {
  SLACK_ALLOWED_HOSTS_MAX,
  SLACK_ENV_NAME_MAX_CHARS,
  SLACK_ENV_VARS_MAX_CHARS,
  SLACK_NETWORK_SECRET_MAX_CHARS,
  SLACK_NETWORK_SECRETS_MAX,
  SLACK_SETUP_SCRIPT_MAX_CHARS,
  type SlackNetworkLevel,
  type SlackNetworkSecret,
  type SlackSetupRun,
  type SlackWorkspaceEnvironment,
  type SlackWorkspaceEnvironmentUpdate,
} from "@stella/contracts/slack-workspace";
import { toolStateEnvironment, CLOUD_TOOL_HOME } from "@stella/contracts/cloud-tool-home";
import type { ExecutionSession } from "../sandbox-client.js";
import type { SandboxEgressPolicy } from "../sandbox-container.js";
import { WORLD_ROOT } from "../workspace.js";
import { slackTry } from "./api.js";
import { decryptToken, encryptToken } from "./crypto.js";
import { loadInstallation } from "./store.js";
import { resolveConversationRepo } from "./repos.js";

/** Hosts `limited` allows: package registries, source hosts and toolchain downloads. */
export const LIMITED_HOSTS: readonly string[] = [
  "github.com",
  "*.github.com",
  "*.githubusercontent.com",
  "ghcr.io",
  "gitlab.com",
  "*.gitlab.com",
  "bitbucket.org",
  "registry.npmjs.org",
  "*.npmjs.org",
  "registry.yarnpkg.com",
  "*.yarnpkg.com",
  "bun.sh",
  "*.bun.sh",
  "nodejs.org",
  "*.nodejs.org",
  "deno.land",
  "*.deno.land",
  "jsr.io",
  "*.jsr.io",
  "esm.sh",
  "cdn.jsdelivr.net",
  "unpkg.com",
  "pypi.org",
  "*.pypi.org",
  "files.pythonhosted.org",
  "astral.sh",
  "*.astral.sh",
  "crates.io",
  "*.crates.io",
  "*.rust-lang.org",
  "sh.rustup.rs",
  "proxy.golang.org",
  "sum.golang.org",
  "*.golang.org",
  "go.dev",
  "*.go.dev",
  "dl.google.com",
  "rubygems.org",
  "*.rubygems.org",
  "repo.maven.apache.org",
  "*.maven.org",
  "*.gradle.org",
  "packagist.org",
  "*.packagist.org",
  "getcomposer.org",
  "registry-1.docker.io",
  "auth.docker.io",
  "production.cloudflare.docker.com",
  "deb.debian.org",
  "security.debian.org",
  "*.ubuntu.com",
  "cdn.playwright.dev",
  "playwright.download.prss.microsoft.com",
];

/** The engines' own model APIs and sign-in refresh: an agent can't run without them. */
const ENGINE_HOSTS: readonly string[] = ["*.anthropic.com", "claude.ai", "*.claude.ai", "*.claude.com"];

const SECRET_PLACEHOLDER = "stella-network-secret";
const CONTAINERS_CA = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
const SYSTEM_BUNDLE = "/etc/ssl/certs/ca-certificates.crt";
const TOOL_UID = 42424;
const SETUP_DIR = "/opt/stella-env";
/** Outside SETUP_DIR, which each run replaces. */
const SETUP_LOCK = "/opt/stella-env.lock";
const SETUP_TIMEOUT_S = 600;
const SETUP_LOG_CHARS = 16_000;
const POLICY_CACHE_MS = 5_000;

const DEFAULT_NAME = "Default";

/** Environments are on where `SLACK_ENVIRONMENTS` is "1" (dev until they ship). */
export const slackEnvironmentsEnabled = (env: Partial<Cloudflare.Env>): boolean =>
  (env as { SLACK_ENVIRONMENTS?: string }).SLACK_ENVIRONMENTS === "1";

const d1 = (env: Cloudflare.Env): D1Database => {
  if (!env.DB) throw new Error("The DB binding is missing.");
  return env.DB;
};

type EnvironmentRow = {
  team_id: string;
  repo_id: string;
  name: string;
  network: string;
  allowed_hosts: string;
  setup_script: string;
  env_vars: string;
  setup_status: string | null;
  setup_exit_code: number | null;
  setup_at: number | null;
  setup_ms: number | null;
  setup_log: string | null;
};

type SecretRow = { id: string; name: string; host: string; header: string; value_enc: string };

export type SlackEnvironment = SlackWorkspaceEnvironment;

const isLevel = (value: unknown): value is SlackNetworkLevel =>
  value === "none" || value === "limited" || value === "full";

const parseHosts = (raw: string): string[] => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((host): host is string => typeof host === "string") : [];
  } catch {
    return [];
  }
};

/** `repoId` "" is the environment of work that isn't about a repository. */
export const loadEnvironment = async (
  env: Cloudflare.Env,
  teamId: string,
  repoId: string,
): Promise<SlackEnvironment> => {
  const [row, secrets] = await Promise.all([
    d1(env)
      .prepare("SELECT * FROM slack_environments WHERE team_id = ? AND repo_id = ?")
      .bind(teamId, repoId)
      .first<EnvironmentRow>(),
    d1(env)
      .prepare(
        "SELECT id, name, host, header FROM slack_environment_secrets WHERE team_id = ? AND repo_id = ? ORDER BY created_at",
      )
      .bind(teamId, repoId)
      .all<SlackNetworkSecret>(),
  ]);
  return {
    name: row?.name || DEFAULT_NAME,
    network: isLevel(row?.network) ? row.network : "full",
    allowedHosts: row ? parseHosts(row.allowed_hosts) : [],
    secrets: secrets.results ?? [],
    setupScript: row?.setup_script ?? "",
    envVars: row?.env_vars ?? "",
    lastSetup:
      row?.setup_status === "succeeded" || row?.setup_status === "failed"
        ? {
            status: row.setup_status,
            exitCode: row.setup_exit_code,
            at: row.setup_at ?? 0,
            ms: row.setup_ms ?? 0,
            log: row.setup_log ?? "",
          }
        : null,
  };
};

export const deleteEnvironment = async (env: Cloudflare.Env, teamId: string): Promise<void> => {
  if (!slackEnvironmentsEnabled(env)) return;
  await d1(env).batch([
    d1(env).prepare("DELETE FROM slack_environments WHERE team_id = ?").bind(teamId),
    d1(env).prepare("DELETE FROM slack_environment_secrets WHERE team_id = ?").bind(teamId),
  ]);
};

// ---- validation ------------------------------------------------------------

const HOST_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/u;

/** `example.com` or `*.example.com`, lower-cased; null when it isn't one. */
export const normalizeHostPattern = (input: string): string | null => {
  let host = input.trim().toLowerCase();
  if (!host) return null;
  host = host.replace(/^[a-z]+:\/\//u, "").replace(/[/:].*$/u, "").replace(/\.$/u, "");
  const wildcard = host.startsWith("*.");
  const bare = wildcard ? host.slice(2) : host;
  const labels = bare.split(".");
  if (labels.length < 2 || !labels.every((label) => HOST_LABEL.test(label))) return null;
  return wildcard ? `*.${bare}` : bare;
};

export const hostMatches = (pattern: string, host: string): boolean =>
  pattern.startsWith("*.") ? host.endsWith(pattern.slice(1)) : host === pattern;

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u;
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/u;

/** Variables Stella sets itself; the environment can't override them. */
const RESERVED_VARS = new Set([
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "PATH",
  "PWD",
  "OLDPWD",
  "SHLVL",
  "_",
  "NO_PROXY",
  "no_proxy",
  "NODE_OPTIONS",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "REQUESTS_CA_BUNDLE",
  "CURL_CA_BUNDLE",
  "PIP_CERT",
  "DENO_CERT",
  "GIT_SSL_CAINFO",
]);
const reservedVar = (name: string): boolean =>
  RESERVED_VARS.has(name) || name.startsWith("STELLA_") || name.startsWith("XDG_") || name.startsWith("BASH_");

/**
 * `.env` text: `KEY=value` per line, `export ` allowed, `#` comments, values
 * optionally in single quotes (literal) or double quotes (`\n`, `\"`, `\\`).
 */
export const parseEnvVars = (text: string): { vars: Record<string, string>; errors: string[] } => {
  const vars: Record<string, string> = {};
  const errors: string[] = [];
  text.split(/\r?\n/u).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const match = /^(?:export\s+)?([^=\s]+)\s*=\s*(.*)$/u.exec(line);
    if (!match) {
      errors.push(`Line ${index + 1} isn't KEY=value.`);
      return;
    }
    const [, name, rest] = match as unknown as [string, string, string];
    if (!ENV_NAME.test(name)) {
      errors.push(`Line ${index + 1}: ${name} isn't a valid variable name.`);
      return;
    }
    if (reservedVar(name)) {
      errors.push(`Line ${index + 1}: ${name} is set by Stella and can't be changed here.`);
      return;
    }
    let value = rest;
    if (value.startsWith("'")) {
      const end = value.indexOf("'", 1);
      value = end > 0 ? value.slice(1, end) : value.slice(1);
    } else if (value.startsWith('"')) {
      let decoded = "";
      for (let index = 1; index < value.length; index += 1) {
        const char = value[index]!;
        if (char === '"') break;
        if (char === "\\" && index + 1 < value.length) {
          const next = value[index + 1]!;
          decoded += next === "n" ? "\n" : next === "t" ? "\t" : next;
          index += 1;
        } else decoded += char;
      }
      value = decoded;
    } else {
      value = value.replace(/\s+#.*$/u, "").trim();
    }
    if (value.includes("\0")) {
      errors.push(`Line ${index + 1}: values can't contain NUL.`);
      return;
    }
    vars[name] = value;
  });
  return { vars, errors };
};

export type EnvironmentPatch = {
  name?: string;
  network?: SlackNetworkLevel;
  allowedHosts?: string[];
  setupScript?: string;
  envVars?: string;
  addSecrets?: Array<{ name: string; host: string; header: string; value: string }>;
  removeSecrets?: string[];
};

export const validateEnvironmentUpdate = (
  input: SlackWorkspaceEnvironmentUpdate,
  current: SlackEnvironment,
): { ok: true; patch: EnvironmentPatch } | { ok: false; message: string } => {
  if (!input || typeof input !== "object") return { ok: false, message: "Unknown environment settings." };
  const patch: EnvironmentPatch = {};
  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (!name) return { ok: false, message: "Give the environment a name." };
    if (name.length > SLACK_ENV_NAME_MAX_CHARS) {
      return { ok: false, message: `Names are limited to ${SLACK_ENV_NAME_MAX_CHARS} characters.` };
    }
    patch.name = name;
  }
  if (input.network !== undefined) {
    if (!isLevel(input.network)) return { ok: false, message: "Network access is none, limited or full." };
    patch.network = input.network;
  }
  if (input.allowedHosts !== undefined) {
    if (!Array.isArray(input.allowedHosts)) return { ok: false, message: "Allowed domains must be a list." };
    const hosts: string[] = [];
    for (const raw of input.allowedHosts) {
      if (!String(raw).trim()) continue;
      const host = normalizeHostPattern(String(raw));
      if (!host) return { ok: false, message: `${String(raw).slice(0, 80)} isn't a domain (example.com or *.example.com).` };
      if (!hosts.includes(host)) hosts.push(host);
    }
    if (hosts.length > SLACK_ALLOWED_HOSTS_MAX) {
      return { ok: false, message: `Up to ${SLACK_ALLOWED_HOSTS_MAX} extra domains.` };
    }
    patch.allowedHosts = hosts;
  }
  if (input.setupScript !== undefined) {
    const script = String(input.setupScript).replace(/\r\n/gu, "\n");
    if (script.length > SLACK_SETUP_SCRIPT_MAX_CHARS) {
      return { ok: false, message: `The setup script is limited to ${SLACK_SETUP_SCRIPT_MAX_CHARS} characters.` };
    }
    if (script.includes("\0")) return { ok: false, message: "The setup script can't contain NUL." };
    patch.setupScript = script;
  }
  if (input.envVars !== undefined) {
    const text = String(input.envVars).replace(/\r\n/gu, "\n");
    if (text.length > SLACK_ENV_VARS_MAX_CHARS) {
      return { ok: false, message: `Environment variables are limited to ${SLACK_ENV_VARS_MAX_CHARS} characters.` };
    }
    const { errors } = parseEnvVars(text);
    if (errors.length) return { ok: false, message: errors[0]! };
    patch.envVars = text;
  }
  const secrets = input.secrets;
  if (secrets !== undefined) {
    if (!secrets || typeof secrets !== "object") return { ok: false, message: "Unknown secret changes." };
    const remove = Array.isArray(secrets.remove) ? secrets.remove.map(String) : [];
    const kept = current.secrets.filter((secret) => !remove.includes(secret.id));
    const add: NonNullable<EnvironmentPatch["addSecrets"]> = [];
    for (const raw of Array.isArray(secrets.add) ? secrets.add : []) {
      const name = String(raw?.name ?? "").trim();
      if (!ENV_NAME.test(name) || reservedVar(name)) {
        return { ok: false, message: "Name each secret like an environment variable, e.g. OPENAI_API_KEY." };
      }
      if ([...kept, ...add].some((secret) => secret.name === name)) {
        return { ok: false, message: `There's already a secret named ${name}.` };
      }
      const host = normalizeHostPattern(String(raw?.host ?? ""));
      if (!host) return { ok: false, message: `Give ${name} the host it's for, e.g. api.example.com.` };
      const header = String(raw?.header ?? "").trim() || "Authorization";
      if (!HEADER_NAME.test(header) || /^(host|content-length|transfer-encoding|connection)$/iu.test(header)) {
        return { ok: false, message: `${header.slice(0, 64)} can't be used as the secret's header.` };
      }
      const value = String(raw?.value ?? "");
      if (!value.trim()) return { ok: false, message: `Enter a value for ${name}.` };
      if (value.length > SLACK_NETWORK_SECRET_MAX_CHARS || /[\r\n\0]/u.test(value)) {
        return { ok: false, message: `${name}'s value must be one line under ${SLACK_NETWORK_SECRET_MAX_CHARS} characters.` };
      }
      add.push({ name, host, header, value });
    }
    if (kept.length + add.length > SLACK_NETWORK_SECRETS_MAX) {
      return { ok: false, message: `Up to ${SLACK_NETWORK_SECRETS_MAX} network secrets.` };
    }
    if (add.length) patch.addSecrets = add;
    if (remove.length) patch.removeSecrets = remove;
  }
  return { ok: true, patch };
};

export const saveEnvironment = async (
  env: Cloudflare.Env,
  teamId: string,
  repoId: string,
  patch: EnvironmentPatch,
): Promise<void> => {
  const db = d1(env);
  const current = await loadEnvironment(env, teamId, repoId);
  const now = Date.now();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO slack_environments (team_id, repo_id, name, network, allowed_hosts, setup_script, env_vars, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (team_id, repo_id) DO UPDATE SET name = excluded.name, network = excluded.network,
           allowed_hosts = excluded.allowed_hosts, setup_script = excluded.setup_script,
           env_vars = excluded.env_vars, updated_at = excluded.updated_at`,
      )
      .bind(
        teamId,
        repoId,
        patch.name ?? current.name,
        patch.network ?? current.network,
        JSON.stringify(patch.allowedHosts ?? current.allowedHosts),
        patch.setupScript ?? current.setupScript,
        patch.envVars ?? current.envVars,
        now,
      ),
  ];
  for (const id of patch.removeSecrets ?? []) {
    statements.push(
      db
        .prepare("DELETE FROM slack_environment_secrets WHERE team_id = ? AND repo_id = ? AND id = ?")
        .bind(teamId, repoId, id),
    );
  }
  for (const secret of patch.addSecrets ?? []) {
    statements.push(
      db
        .prepare(
          `INSERT INTO slack_environment_secrets (team_id, repo_id, id, name, host, header, value_enc, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(teamId, repoId, crypto.randomUUID(), secret.name, secret.host, secret.header, await encryptToken(env, secret.value), now),
    );
  }
  await db.batch(statements);
  policyCache.delete(policyKey(teamId, repoId));
};

const NETWORK_SUMMARY: Record<SlackNetworkLevel, string> = {
  none: "no network access beyond Stella, the model API and the repository on GitHub",
  limited: "limited network access (package registries, GitHub and common build hosts",
  full: "full network access",
};

/** One line for the orchestrator's prompt: what its agents' containers run with. */
export const environmentSummary = (environment: SlackEnvironment): string => {
  const network =
    environment.network === "limited"
      ? `${NETWORK_SUMMARY.limited}${environment.allowedHosts.length ? `, plus ${environment.allowedHosts.join(", ")}` : ""})`
      : NETWORK_SUMMARY[environment.network];
  const { vars } = parseEnvVars(environment.envVars);
  const parts = [
    `"${environment.name}", ${network}`,
    environment.secrets.length
      ? `network secrets ${environment.secrets.map((secret) => `${secret.name} (sent as ${secret.header} to https://${secret.host})`).join(", ")}`
      : "",
    Object.keys(vars).length ? `variables ${Object.keys(vars).join(", ")}` : "",
    environment.setupScript.trim()
      ? `a setup script that runs before each agent's container starts${environment.lastSetup?.status === "failed" ? " (its last run failed)" : ""}`
      : "",
  ].filter(Boolean);
  return `${parts.join("; ")}.`;
};

// ---- egress ------------------------------------------------------------------

type EgressPolicy = {
  network: SlackNetworkLevel;
  allowed: string[];
  secrets: Array<{ host: string; header: string; value: string }>;
  repo: string | null;
};

const policyCache = new Map<string, { at: number; policy: Promise<EgressPolicy> }>();
const policyKey = (team: string, repoId: string): string => `${team}:${repoId}`;

const loadPolicy = async (env: Cloudflare.Env, team: string, repoId: string): Promise<EgressPolicy> => {
  const [environment, sealed, repo] = await Promise.all([
    loadEnvironment(env, team, repoId),
    d1(env)
      .prepare(
        "SELECT id, name, host, header, value_enc FROM slack_environment_secrets WHERE team_id = ? AND repo_id = ?",
      )
      .bind(team, repoId)
      .all<SecretRow>(),
    repoId
      ? d1(env)
          .prepare("SELECT full_name FROM slack_repos WHERE team_id = ? AND id = ?")
          .bind(team, repoId)
          .first<{ full_name: string }>()
      : Promise.resolve(null),
  ]);
  const secrets: EgressPolicy["secrets"] = [];
  for (const row of sealed.results ?? []) {
    const value = await decryptToken(env, row.value_enc).catch(() => null);
    if (value !== null) secrets.push({ host: row.host, header: row.header, value });
  }
  return {
    network: environment.network,
    allowed: environment.allowedHosts,
    secrets,
    repo: repo?.full_name?.toLowerCase() ?? null,
  };
};

const cachedPolicy = (env: Cloudflare.Env, team: string, repoId: string): Promise<EgressPolicy> => {
  const now = Date.now();
  const key = policyKey(team, repoId);
  const hit = policyCache.get(key);
  if (hit && now - hit.at < POLICY_CACHE_MS) return hit.policy;
  const policy = loadPolicy(env, team, repoId);
  policyCache.set(key, { at: now, policy });
  policy.catch(() => policyCache.delete(key));
  return policy;
};

const repoRequest = (url: URL, repo: string | null): boolean => {
  if (!repo || url.hostname !== "github.com") return false;
  const path = url.pathname.toLowerCase();
  return path === `/${repo}` || path === `/${repo}.git` || path.startsWith(`/${repo}/`) || path.startsWith(`/${repo}.git/`);
};

export type SlackEgressDeps = {
  containerId: string;
  team: string;
  /** The repository whose environment applies; "" for none. */
  repo: string;
  /** This Worker itself, for requests to Stella's own origin. */
  loopback: (request: Request) => Promise<Response>;
  /** The general agent policy, metered, for plain HTTP. */
  general: (request: Request) => Promise<Response>;
};

const LEVEL_LABEL: Record<SlackNetworkLevel, string> = { none: "None", limited: "Limited", full: "Full" };

export const slackEgress = async (
  request: Request,
  env: Cloudflare.Env,
  deps: SlackEgressDeps,
): Promise<Response> => {
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  const own = env.CLOUD_BUILDER_PUBLIC_URL ? new URL(env.CLOUD_BUILDER_PUBLIC_URL).hostname.toLowerCase() : null;
  if (host === own) return await deps.loopback(request);
  let policy: EgressPolicy;
  try {
    policy = await cachedPolicy(env, deps.team, deps.repo);
  } catch {
    return new Response("Stella couldn't read this workspace's network settings. Try again.\n", { status: 503 });
  }
  const secrets = url.protocol === "https:" ? policy.secrets.filter((secret) => hostMatches(secret.host, host)) : [];
  const allowed =
    policy.network === "full" ||
    ENGINE_HOSTS.some((pattern) => hostMatches(pattern, host)) ||
    repoRequest(url, policy.repo) ||
    (policy.network === "limited" &&
      (LIMITED_HOSTS.some((pattern) => hostMatches(pattern, host)) ||
        policy.allowed.some((pattern) => hostMatches(pattern, host)) ||
        policy.secrets.some((secret) => hostMatches(secret.host, host))));
  console.log(
    JSON.stringify({
      event: "slack_egress",
      team: deps.team,
      repo: deps.repo,
      network: policy.network,
      decision: allowed ? "allow" : "deny",
      scheme: url.protocol.replace(":", ""),
      host,
      ...(secrets.length ? { secrets: secrets.length } : {}),
    }),
  );
  if (!allowed) {
    return new Response(
      `Blocked: this environment has ${LEVEL_LABEL[policy.network]} network access, which doesn't include ${host}. The workspace owner can allow it at stella.sh/crew.\n`,
      { status: 403, headers: { "content-type": "text/plain; charset=utf-8", "x-stella-egress": "blocked" } },
    );
  }
  if (url.protocol !== "https:") return await deps.general(request);
  const headers = new Headers(request.headers);
  for (const secret of secrets) headers.set(secret.header, secret.value);
  return await fetch(new Request(request, { headers, redirect: "manual" }));
};

// ---- the container ------------------------------------------------------------

type ThreadRow = { team_id: string; channel_id: string; thread_key: string };

const threadOf = async (env: Cloudflare.Env, conversationId: string): Promise<ThreadRow | null> =>
  await d1(env)
    .prepare("SELECT team_id, channel_id, thread_key FROM slack_threads WHERE conversation_id = ? LIMIT 1")
    .bind(conversationId)
    .first<ThreadRow>();

/** The repository (id, "" for none) whose environment a conversation's agents run in. */
const repoIdFor = async (env: Cloudflare.Env, conversationId: string, thread: ThreadRow): Promise<string> => {
  const resolved = await resolveConversationRepo(env, conversationId, {
    teamId: thread.team_id,
    channelId: thread.channel_id,
  });
  return resolved?.repo?.id ?? "";
};

/** The network rules a Slack conversation's agent containers start under. */
export const egressForConversation = async (
  env: Cloudflare.Env,
  conversationId: string,
): Promise<SandboxEgressPolicy | null> => {
  const thread = await threadOf(env, conversationId);
  if (!thread) return null;
  const repo = await repoIdFor(env, conversationId, thread);
  const environment = await loadEnvironment(env, thread.team_id, repo);
  return { kind: "slack", team: thread.team_id, repo, internet: environment.network === "full" };
};

/** Whether a conversation's network access reaches a host on its own (Full, or a domain the owner added). */
export const conversationAllowsHost = async (env: Cloudflare.Env, conversationId: string, host: string): Promise<boolean> => {
  const thread = await threadOf(env, conversationId);
  if (!thread) return false;
  const repo = await repoIdFor(env, conversationId, thread);
  const policy = await cachedPolicy(env, thread.team_id, repo);
  return policy.network === "full" || (policy.network === "limited" && policy.allowed.some((pattern) => hostMatches(pattern, host)));
};

const shellQuote = (value: string): string => `'${value.replace(/'/gu, `'\\''`)}'`;

const writeFile = (path: string, content: string, mode: string): string =>
  `printf '%s' ${shellQuote(btoa(String.fromCharCode(...new TextEncoder().encode(content))))} | base64 -d > ${shellQuote(path)} && chmod ${mode} ${shellQuote(path)}`;

const sha256Hex = async (text: string): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const decodeEnvDump = (dump: string): Record<string, string> => {
  const vars: Record<string, string> = {};
  for (const entry of dump.split("\0")) {
    const eq = entry.indexOf("=");
    if (eq > 0) vars[entry.slice(0, eq)] = entry.slice(eq + 1);
  }
  return vars;
};

const BASE_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

/** What every Slack agent process trusts and sees, before the workspace's own variables. */
const baseAgentEnv = (environment: SlackEnvironment): Record<string, string> => ({
  NODE_EXTRA_CA_CERTS: CONTAINERS_CA,
  SSL_CERT_FILE: SYSTEM_BUNDLE,
  REQUESTS_CA_BUNDLE: SYSTEM_BUNDLE,
  CURL_CA_BUNDLE: SYSTEM_BUNDLE,
  PIP_CERT: SYSTEM_BUNDLE,
  DENO_CERT: SYSTEM_BUNDLE,
  STELLA_ENVIRONMENT: environment.name,
  STELLA_NETWORK_ACCESS: environment.network,
  ...(environment.secrets.length
    ? {
        STELLA_NETWORK_SECRETS: environment.secrets
          .map((secret) => `${secret.name}: ${secret.header} on https://${secret.host}`)
          .join("; "),
      }
    : {}),
  ...Object.fromEntries(environment.secrets.map((secret) => [secret.name, SECRET_PLACEHOLDER])),
});

const recordSetup = async (env: Cloudflare.Env, teamId: string, repoId: string, run: SlackSetupRun): Promise<void> => {
  await d1(env)
    .prepare(
      `UPDATE slack_environments SET setup_status = ?, setup_exit_code = ?, setup_at = ?, setup_ms = ?, setup_log = ?
       WHERE team_id = ? AND repo_id = ?`,
    )
    .bind(run.status, run.exitCode, run.at, run.ms, run.log, teamId, repoId)
    .run();
};

const noteInThread = async (env: Cloudflare.Env, thread: ThreadRow, text: string): Promise<void> => {
  const install = await loadInstallation(env, thread.team_id);
  if (!install) return;
  await slackTry(install.botToken, "chat.postMessage", {
    channel: thread.channel_id,
    ...(thread.thread_key === "dm" ? {} : { thread_ts: thread.thread_key }),
    text,
  });
};

/** Hosts the egress proxy refused during a run, from its 403 bodies in the log. */
export const blockedHostsIn = (log: string): string[] => {
  const hosts = new Set<string>();
  for (const match of log.matchAll(/network access, which doesn't include ([a-z0-9.-]+)\./giu)) {
    if (match[1]) hosts.add(match[1].toLowerCase());
  }
  return [...hosts].slice(0, 5);
};

const NOISE = [/^\s*at\s/u, /^rm: cannot remove '\/var\/cache\/apt/u, /^\s*$/u, /^\s*[\^~]+\s*$/u, /^\s*[}\])]+;?\s*$/u];

/** The line of a failed run's log most likely to say why. */
const failureLine = (log: string): string => {
  const lines = log.split("\n").filter((line) => !NOISE.some((pattern) => pattern.test(line)));
  const telling = [...lines].reverse().find((line) => /error|failed|not found|denied|refused|cannot|can't|unable|timed? ?out/iu.test(line));
  return (telling ?? lines[lines.length - 1] ?? "").trim().slice(0, 200);
};

const setupFailureNote = (
  environment: SlackEnvironment,
  reason: string,
  log: string,
  blocked: string[],
): string => {
  if (blocked.length) {
    const list = blocked.map((host) => `\`${host}\``).join(", ");
    return `:warning: The setup script for the *${environment.name}* environment ${reason} because its ${LEVEL_LABEL[environment.network]} network access blocked ${list}. To allow ${blocked.length === 1 ? "it" : "them"}, the workspace owner can ${environment.network === "none" ? "switch network access to Limited and add" : "add"} ${list} under *Also allow these domains* in this repository's environment on stella.sh/crew (or choose Full access). Continuing without the setup script.`;
  }
  const line = failureLine(log);
  return `:warning: The setup script for the *${environment.name}* environment ${reason}${line ? `: \`${line.replace(/`/gu, "'")}\`` : ""}. Continuing without it. The full log is on stella.sh/crew.`;
};

export type PreparedEnvironment = {
  /** For the agent's daemon, and so every command it runs. */
  env: Record<string, string>;
  /** Told to the agent with its first result. */
  notice?: string;
};

/**
 * Before a Slack agent starts: the workspace's variables, and the setup
 * script once per container start, in `cwd` (the repository's checkout).
 */
export const prepareSlackEnvironment = async (
  env: Cloudflare.Env,
  session: Pick<ExecutionSession, "exec">,
  conversationId: string,
  cwd: string,
  log: (event: string, fields: Record<string, unknown>) => void,
): Promise<PreparedEnvironment | null> => {
  const thread = await threadOf(env, conversationId);
  if (!thread) return null;
  const repoId = await repoIdFor(env, conversationId, thread);
  const environment = await loadEnvironment(env, thread.team_id, repoId);
  const { vars } = parseEnvVars(environment.envVars);
  const agentEnv: Record<string, string> = { ...baseAgentEnv(environment), ...vars };
  const script = environment.setupScript.trim() ? environment.setupScript : "";
  if (!script) return { env: agentEnv };

  const key = (await sha256Hex(`${repoId}\0${script}\0${environment.envVars}\0${environment.network}`)).slice(0, 16);
  // One run per container start. Agents that start together (one thread
  // starting two at once) wait on the lock for the first one's run and take
  // its result, so the script runs, is recorded and is reported once.
  const ran = `${SETUP_DIR}/ran-${key}`;
  const savedEnv = `${SETUP_DIR}/env-${key}`;

  const scriptEnv: Record<string, string> = {
    PATH: BASE_PATH,
    HOME: WORLD_ROOT,
    USER: "stella-tools",
    LOGNAME: "stella-tools",
    LANG: "C.UTF-8",
    ...toolStateEnvironment(CLOUD_TOOL_HOME),
    ...agentEnv,
  };
  const out = `${SETUP_DIR}/out`;
  const runner = `#!/bin/bash
trap 'env -0 > ${out}/env' EXIT
cd ${shellQuote(cwd)} 2>/dev/null || cd ${shellQuote(WORLD_ROOT)}
. ${SETUP_DIR}/setup.sh
`;
  const envArgs = Object.entries(scriptEnv)
    .map(([name, value]) => `${name}=${shellQuote(value)}`)
    .join(" ");
  const report = [
    `tail -c ${SETUP_LOG_CHARS} ${SETUP_DIR}/log`,
    `printf '\\n__STELLA_SETUP_EXIT__%s' "$code"`,
    "exit 0",
  ];
  const command = [
    `exec 9>${SETUP_LOCK} && chmod 0600 ${SETUP_LOCK}`,
    `flock -w ${SETUP_TIMEOUT_S + 30} 9 || { printf "__STELLA_SETUP_CACHED__Another agent's setup run didn't finish.\\n__STELLA_SETUP_EXIT__"; exit 0; }`,
    "boot=$(cat /proc/sys/kernel/random/boot_id)",
    `if [ -f ${ran} ] && [ "$(sed -n 1p ${ran})" = "$boot" ]; then`,
    `  code=$(sed -n 2p ${ran})`,
    "  printf '__STELLA_SETUP_CACHED__'",
    ...report.map((line) => `  ${line}`),
    "fi",
    "set -e",
    `rm -rf ${SETUP_DIR} && mkdir -p ${out}`,
    `chmod 0755 ${SETUP_DIR} && chown ${TOOL_UID}:${TOOL_UID} ${out} && chmod 0700 ${out}`,
    writeFile(`${SETUP_DIR}/setup.sh`, script, "0644"),
    writeFile(`${SETUP_DIR}/run.sh`, runner, "0755"),
    "set +e",
    `env -i ${envArgs} timeout -k 10 ${SETUP_TIMEOUT_S}s /usr/bin/setpriv --reuid=${TOOL_UID} --regid=${TOOL_UID} --clear-groups --no-new-privs --bounding-set=-all --inh-caps=-all --ambient-caps=-all -- /bin/bash ${SETUP_DIR}/run.sh > ${SETUP_DIR}/log 2>&1 < /dev/null`,
    "code=$?",
    // A root-owned copy of what the script exported, for agents that start later.
    `if [ "$code" = 0 ]; then install -m 0600 ${out}/env ${savedEnv} 2>/dev/null || : > ${savedEnv}; fi`,
    `printf '%s\\n%s\\n' "$boot" "$code" > ${ran}`,
    ...report,
  ].join("\n");
  const started = Date.now();
  const result = await session.exec(command, {
    origin: "internal",
    timeout: (2 * SETUP_TIMEOUT_S + 90) * 1000,
  } as Parameters<ExecutionSession["exec"]>[1]);
  const ms = Date.now() - started;
  const cached = result.stdout.startsWith("__STELLA_SETUP_CACHED__");
  const stdout = cached ? result.stdout.slice("__STELLA_SETUP_CACHED__".length) : result.stdout;
  const exitMatch = /__STELLA_SETUP_EXIT__(\d*)$/u.exec(stdout);
  const exitCode = exitMatch?.[1] ? Number(exitMatch[1]) : null;
  const output = (exitMatch ? stdout.slice(0, exitMatch.index) : `${stdout}${result.stderr}`)
    .replace(/\n$/u, "")
    .slice(-SETUP_LOG_CHARS);
  const succeeded = exitCode === 0;
  const timedOut = exitCode === 124 || exitCode === 137;
  if (!cached) {
    await recordSetup(env, thread.team_id, repoId, {
      status: succeeded ? "succeeded" : "failed",
      exitCode,
      at: started,
      ms,
      log: timedOut ? `${output}\n\n(Stopped after ${SETUP_TIMEOUT_S / 60} minutes.)` : output,
    }).catch(() => undefined);
    log(succeeded ? "slack_setup_succeeded" : "slack_setup_failed", { team: thread.team_id, repo: repoId, exitCode, ms });
  }
  if (!succeeded) {
    const reason = timedOut
      ? `didn't finish within ${SETUP_TIMEOUT_S / 60} minutes`
      : exitCode === null
        ? "couldn't run"
        : `failed (exit ${exitCode})`;
    const blocked = blockedHostsIn(output);
    if (!cached) {
      await noteInThread(env, thread, setupFailureNote(environment, reason, output, blocked)).catch(() => undefined);
    }
    return {
      env: agentEnv,
      notice: `The environment's setup script ${reason}, so tools it installs may be missing.${
        blocked.length ? ` It needed ${blocked.join(", ")}, which this environment's network access doesn't include.` : ""
      } The end of its log:\n${output.slice(-1500)}`,
    };
  }
  const after = await session.exec(`cat ${savedEnv}`, { origin: "internal", timeout: 30_000 } as Parameters<
    ExecutionSession["exec"]
  >[1]);
  const exported = after.success ? decodeEnvDump(after.stdout) : {};
  const changed: Record<string, string> = {};
  for (const [name, value] of Object.entries(exported)) {
    if (name === "PATH") {
      if (value !== scriptEnv.PATH) changed.PATH = value;
    } else if (ENV_NAME.test(name) && !reservedVar(name) && scriptEnv[name] !== value) {
      changed[name] = value;
    }
  }
  return { env: { ...agentEnv, ...changed } };
};
