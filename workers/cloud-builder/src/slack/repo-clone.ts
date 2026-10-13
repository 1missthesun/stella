/**
 * Stella for Slack's repository: before an agent of a Slack workspace starts
 * in its container, the workspace's GitHub repository is cloned (or brought
 * up to date) under `/workspace/repos/<name>`, outside the owner's world so it
 * never syncs into their files. The token (`cloneToken`: minted for this one
 * repository with contents:read through the workspace's GitHub connection)
 * only rides on the git command as a header; it is never written to the
 * clone's config, and it expires within the hour.
 */

import type { ExecutionSession } from "../sandbox-client.js";
import { cloneToken } from "./github.js";
import { repoForConversation } from "./settings.js";
import { SLACK_REPO_ROOT, isSlackConversationId } from "./workspace.js";

const TOOL_UID = 42424;
const CLONE_TIMEOUT_MS = 120_000;

const shellQuote = (value: string): string =>
  `'${value.replace(/'/gu, `'\\''`)}'`;

export const prepareSlackRepo = async (
  env: Partial<Cloudflare.Env>,
  session: Pick<ExecutionSession, "exec">,
  conversationId: string,
  log: (event: string, fields: Record<string, unknown>) => void,
): Promise<void> => {
  if (!isSlackConversationId(conversationId)) return;
  const repo = await repoForConversation(env as Cloudflare.Env, conversationId).catch(() => null);
  if (!repo) return;
  const token = await cloneToken(env as Cloudflare.Env, repo).catch(() => null);
  const name = repo.fullName.split("/")[1]!;
  const dir = `${SLACK_REPO_ROOT}/${name}`;
  const url = `https://github.com/${repo.fullName}.git`;
  const auth = token
    ? `-c ${shellQuote(`http.https://github.com/.extraheader=AUTHORIZATION: basic ${btoa(`x-access-token:${token}`)}`)}`
    : "";
  const git = `git -c safe.directory='*' -c advice.detachedHead=false ${auth}`;
  const branch = repo.branch ? shellQuote(repo.branch) : "";
  const command = [
    "set -e",
    "export GIT_TERMINAL_PROMPT=0",
    `mkdir -p ${SLACK_REPO_ROOT}`,
    `chown ${TOOL_UID}:${TOOL_UID} ${SLACK_REPO_ROOT}`,
    `chmod 0750 ${SLACK_REPO_ROOT}`,
    `if [ -d ${shellQuote(`${dir}/.git`)} ]; then`,
    `  ${git} -C ${shellQuote(dir)} fetch --quiet --depth 50 origin ${branch || "HEAD"}`,
    `  if ${git} -C ${shellQuote(dir)} diff --quiet HEAD; then ${git} -C ${shellQuote(dir)} merge --ff-only --quiet FETCH_HEAD || true; fi`,
    "else",
    `  rm -rf ${shellQuote(dir)}`,
    `  ${git} clone --quiet --depth 50 ${branch ? `--branch ${branch}` : ""} ${shellQuote(url)} ${shellQuote(dir)}`,
    "fi",
    `chown -R ${TOOL_UID}:${TOOL_UID} ${shellQuote(dir)}`,
  ].join("\n");
  const started = Date.now();
  try {
    const result = await session.exec(command, {
      origin: "internal",
      timeout: CLONE_TIMEOUT_MS,
    } as Parameters<ExecutionSession["exec"]>[1]);
    log(result.success ? "slack_repo_ready" : "slack_repo_failed", {
      repo: repo.fullName,
      access: token ? (token === repo.legacyToken ? "token" : "github") : "public",
      ms: Date.now() - started,
      ...(result.success
        ? {}
        : { exitCode: result.exitCode, stderr: String(result.stderr ?? "").replace(/basic [A-Za-z0-9+/=]+/gu, "basic ***").slice(0, 300) }),
    });
  } catch (error) {
    log("slack_repo_failed", {
      repo: repo.fullName,
      ms: Date.now() - started,
      message: (error instanceof Error ? error.message : String(error)).replace(/basic [A-Za-z0-9+/=]+/gu, "basic ***").slice(0, 300),
    });
  }
};
