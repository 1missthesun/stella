/**
 * Stella for Slack's repository: before an agent of a Slack workspace starts
 * in its container, the workspace's GitHub repository is cloned (or brought
 * up to date) under `/workspace/repos/<name>` on the workspace's branch,
 * outside the owner's world so it never syncs into their files.
 *
 * Through the workspace's GitHub connection the agent can push: the clone's
 * git asks `stella-git-credential` for a token on every operation, which
 * trades the container's repo capability (`repo-capability.ts`) for a fresh
 * installation token scoped to this one repository. `stella-preview` waits
 * for the repository's own preview of a pushed commit and prints its URL.
 * Nothing long-lived is written to the clone. A public repository, or one
 * with a token pasted before connections existed, is cloned without these.
 */

import type { ExecutionSession } from "../sandbox-client.js";
import { cloneToken } from "./github.js";
import { issueSlackRepoCapability } from "./repo-capability.js";
import { repoForConversation, repoOwnedBy } from "./settings.js";
import { SLACK_REPO_ROOT, isSlackConversationId } from "./workspace.js";

const TOOL_UID = 42424;
const CLONE_TIMEOUT_MS = 120_000;
const HELPER_DIR = "/opt/stella-slack";
const CREDENTIAL_HELPER = "/usr/local/bin/stella-git-credential";
const PREVIEW_HELPER = "/usr/local/bin/stella-preview";

const shellQuote = (value: string): string =>
  `'${value.replace(/'/gu, `'\\''`)}'`;

const CREDENTIAL_SCRIPT = `#!/bin/sh
# git credential helper for the Slack workspace's repository: a fresh token per operation.
[ "$1" = get ] || exit 0
cat >/dev/null
cap=$(cat ${HELPER_DIR}/capability 2>/dev/null) || exit 0
origin=$(cat ${HELPER_DIR}/origin 2>/dev/null) || exit 0
token=$(curl -fsS -m 20 -X POST -H "authorization: Bearer $cap" "$origin/api/slack/github/agent/token" | jq -r '.token // empty') || exit 0
[ -n "$token" ] || exit 0
printf 'username=x-access-token\\npassword=%s\\n' "$token"
`;

const PREVIEW_SCRIPT = `#!/bin/bash
# stella-preview [commit]
# Waits for the repository's own preview deployment of a pushed commit (Cloudflare
# Pages, Vercel, Netlify, GitHub deployments, ...) and prints its URL.
# Exit 0: URL printed. 2: the preview build failed. 3: this repository publishes
# no previews. 4: timed out. 1: couldn't check.
set -u
ref=\${1:-HEAD}
sha=$(git rev-parse "$ref" 2>/dev/null || printf '%s' "$ref")
limit=\${STELLA_PREVIEW_TIMEOUT:-600}
grace=\${STELLA_PREVIEW_GRACE:-120}
cap=$(cat ${HELPER_DIR}/capability 2>/dev/null) || { echo "No repository access in this container." >&2; exit 1; }
origin=$(cat ${HELPER_DIR}/origin)
start=$(date +%s)
none_since=$start
while :; do
  body=$(curl -sS -m 40 -H "authorization: Bearer $cap" "$origin/api/slack/github/agent/preview?sha=$sha")
  state=$(printf '%s' "$body" | jq -r '.state // "error"' 2>/dev/null || echo error)
  now=$(date +%s)
  case $state in
    ready) printf '%s\\n' "$(printf '%s' "$body" | jq -r .url)"; exit 0 ;;
    failed) echo "Preview failed: $(printf '%s' "$body" | jq -r '.detail + (if .url then " (" + .url + ")" else "" end)')" >&2; exit 2 ;;
    pending) none_since=$now; echo "waiting: $(printf '%s' "$body" | jq -r .detail)" >&2 ;;
    none) if [ $((now - none_since)) -ge "$grace" ]; then echo "No preview: this repository doesn't publish a preview for pushed commits." >&2; exit 3; fi ;;
    *) echo "Couldn't check the preview: $(printf '%s' "$body" | jq -r '.error // .' 2>/dev/null || printf '%s' "$body")" >&2; exit 1 ;;
  esac
  if [ $((now - start)) -ge "$limit" ]; then echo "Timed out waiting for the preview." >&2; exit 4; fi
  sleep 10
done
`;

const writeFile = (path: string, content: string, mode: string, owner: string): string =>
  `printf '%s' ${shellQuote(btoa(content))} | base64 -d > ${shellQuote(path)} && chown ${owner} ${shellQuote(path)} && chmod ${mode} ${shellQuote(path)}`;

const redact = (value: string): string =>
  value.replace(/basic [A-Za-z0-9+/=]+/gu, "basic ***").replace(/sr1\.[A-Za-z0-9._-]+/gu, "sr1.***").slice(0, 300);

export const prepareSlackRepo = async (
  env: Partial<Cloudflare.Env>,
  session: Pick<ExecutionSession, "exec">,
  conversationId: string,
  origin: string,
  log: (event: string, fields: Record<string, unknown>) => void,
): Promise<void> => {
  if (!isSlackConversationId(conversationId)) return;
  const repo = await repoForConversation(env as Cloudflare.Env, conversationId).catch(() => null);
  if (!repo) return;
  const viaGithub = Boolean(
    repo.github && repo.github.status === "active" && repoOwnedBy(repo.github, repo.fullName),
  );
  const capability = viaGithub
    ? await issueSlackRepoCapability(env as Cloudflare.Env, { team: repo.teamId, repo: repo.fullName }).catch(() => null)
    : null;
  const token = capability ? null : await cloneToken(env as Cloudflare.Env, repo).catch(() => null);
  const name = repo.fullName.split("/")[1]!;
  const dir = `${SLACK_REPO_ROOT}/${name}`;
  const url = `https://github.com/${repo.fullName}.git`;
  const auth = capability
    ? `-c credential.helper= -c credential.helper=${CREDENTIAL_HELPER}`
    : token
      ? `-c ${shellQuote(`http.https://github.com/.extraheader=AUTHORIZATION: basic ${btoa(`x-access-token:${token}`)}`)}`
      : "";
  const git = `git -c safe.directory='*' -c advice.detachedHead=false ${auth}`;
  const branch = repo.branch ? shellQuote(repo.branch) : "";
  const helpers = capability
    ? [
        `mkdir -p ${HELPER_DIR}`,
        `chown root:${TOOL_UID} ${HELPER_DIR}`,
        `chmod 0750 ${HELPER_DIR}`,
        writeFile(`${HELPER_DIR}/capability`, capability, "0640", `root:${TOOL_UID}`),
        writeFile(`${HELPER_DIR}/origin`, origin, "0644", "root:root"),
        writeFile(CREDENTIAL_HELPER, CREDENTIAL_SCRIPT, "0755", "root:root"),
        writeFile(PREVIEW_HELPER, PREVIEW_SCRIPT, "0755", "root:root"),
      ]
    : [`rm -rf ${HELPER_DIR}`];
  const config = `git -c safe.directory='*' -C ${shellQuote(dir)} config`;
  const configure = capability
    ? [
        `${config} --unset-all credential.helper || true`,
        `${config} --add credential.helper ''`,
        `${config} --add credential.helper ${CREDENTIAL_HELPER}`,
        `${config} user.name ${shellQuote("Stella")}`,
        `${config} user.email ${shellQuote("stella@stella.sh")}`,
        `${config} push.default upstream`,
      ]
    : [];
  const command = [
    "set -e",
    "export GIT_TERMINAL_PROMPT=0",
    ...helpers,
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
    ...configure,
    `chown -R ${TOOL_UID}:${TOOL_UID} ${shellQuote(dir)}`,
  ].join("\n");
  const started = Date.now();
  const access = capability ? "github" : token ? "token" : "public";
  try {
    const result = await session.exec(command, {
      origin: "internal",
      timeout: CLONE_TIMEOUT_MS,
    } as Parameters<ExecutionSession["exec"]>[1]);
    log(result.success ? "slack_repo_ready" : "slack_repo_failed", {
      repo: repo.fullName,
      access,
      ms: Date.now() - started,
      ...(result.success
        ? {}
        : { exitCode: result.exitCode, stderr: redact(String(result.stderr ?? "")) }),
    });
  } catch (error) {
    log("slack_repo_failed", {
      repo: repo.fullName,
      access,
      ms: Date.now() - started,
      message: redact(error instanceof Error ? error.message : String(error)),
    });
  }
};
