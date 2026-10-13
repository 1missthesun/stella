import { claudeUsageLimitOf } from "@stella/contracts/claude-usage-limit";
import { CLOUD_CLAUDE_ACCOUNTS_ROOT } from "@stella/contracts/cloud-native-state";
import {
  backupClaudeCloudLogins,
  claudeLoginContainer,
  restoreClaudeCloudLogins,
  seedTestClaudeLogin,
} from "../claude-cloud-login.js";
import { TEST_CLAUDE_EMAIL, testClaudeConfigured } from "../test-claude.js";

export const CLAUDE_DIGEST_MODEL = "haiku";
const CLI_TIMEOUT_SECONDS = 90;
const EXEC_TIMEOUT_MS = 150_000;

const SCRIPT = String.raw`set -u
umask 077
out() { jq -cn "$@"; }
dir=${CLOUD_CLAUDE_ACCOUNTS_ROOT}/$1
if [ ! -f "$dir/.credentials.json" ]; then out '{ok:false,signedOut:true}'; exit 0; fi
before=$(sha256sum "$dir/.credentials.json" | cut -c1-64)
work=$(mktemp -d)
cd "$work" || { out '{ok:false,error:"no work directory"}'; exit 0; }
printf '%s' "$PROMPT" | env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u CLAUDE_CODE_OAUTH_TOKEN \
  -u ANTHROPIC_BASE_URL -u ANTHROPIC_CUSTOM_HEADERS -u CLAUDE_CODE_EFFORT_LEVEL \
  CLAUDE_CONFIG_DIR="$work/config" CLAUDE_SECURESTORAGE_CONFIG_DIR="$dir" IS_SANDBOX=1 \
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 ENABLE_CLAUDEAI_MCP_SERVERS=false NO_COLOR=1 \
  timeout ${CLI_TIMEOUT_SECONDS} "$CLI" -p --model "$MODEL" ${'${EFFORT:+--effort "$EFFORT"}'} --output-format json --json-schema "$SCHEMA" \
    --tools "" --strict-mcp-config --setting-sources "" --disable-slash-commands \
    --no-session-persistence --system-prompt "$SYSTEM" >"$work/out" 2>"$work/err"
code=$?
after=$(sha256sum "$dir/.credentials.json" 2>/dev/null | cut -c1-64)
rotated=false
[ "$before" = "$after" ] || rotated=true
result=$(jq -c . "$work/out" 2>/dev/null | tail -n 1)
err=$({ tr -d '\000\033' <"$work/err"; } 2>/dev/null | tail -c 2000)
raw=$({ tr -d '\000\033' <"$work/out"; } 2>/dev/null | tail -c 2000)
rm -rf -- "$work"
out --argjson code "$code" --argjson rotated "$rotated" --arg result "$result" --arg err "$err" --arg raw "$raw" \
  '{ok:true,code:$code,rotated:$rotated,result:$result,stderr:$err,stdout:$raw}'
`;

const shellQuote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

export type ClaudeDigestOutcome =
  | { kind: "ok"; output: unknown; model: string }
  | { kind: "usage_limit"; resetsAt?: number; message: string }
  | { kind: "failed"; message: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const flat = (value: string, max: number): string => value.replace(/\s+/gu, " ").trim().slice(0, max);

export const runClaudeDigest = async (input: {
  env: Cloudflare.Env;
  ownerId: string;
  account: { key: string; email: string };
  systemPrompt: string;
  prompt: string;
  schema: Record<string, unknown>;
  cli?: string;
  /** Claude Code's `--effort`; its own default when absent. */
  effort?: "low" | "medium" | "high";
}): Promise<ClaudeDigestOutcome> => {
  const container = await claudeLoginContainer(input.env, input.ownerId);
  await restoreClaudeCloudLogins(input.env, input.ownerId, container);
  if (input.account.email === TEST_CLAUDE_EMAIL && testClaudeConfigured(input.env)) {
    await seedTestClaudeLogin(input.env, input.ownerId, container);
  }
  const exec = await container.exec(
    ["bash", "-c", shellQuote(SCRIPT), "claude-digest", shellQuote(input.account.key)].join(" "),
    {
      cwd: "/",
      timeout: EXEC_TIMEOUT_MS,
      env: {
        PROMPT: input.prompt,
        SYSTEM: input.systemPrompt,
        SCHEMA: JSON.stringify(input.schema),
        MODEL: CLAUDE_DIGEST_MODEL,
        CLI: input.cli ?? "claude",
        ...(input.effort ? { EFFORT: input.effort } : {}),
      },
    },
  );
  let report: Record<string, unknown>;
  try {
    const parsed = JSON.parse(exec.stdout.trim().split("\n").pop() ?? "") as unknown;
    if (!isRecord(parsed)) throw new Error("not an object");
    report = parsed;
  } catch {
    return { kind: "failed", message: `Claude Code didn't run (${flat(exec.stderr, 200) || `exit ${exec.exitCode}`}).` };
  }
  if (report.signedOut === true) {
    return { kind: "failed", message: `Claude isn't signed in to ${input.account.email} in your cloud.` };
  }
  if (report.ok !== true) return { kind: "failed", message: flat(String(report.error ?? "Claude Code didn't run."), 300) };
  if (report.rotated === true) {
    await backupClaudeCloudLogins(input.env, input.ownerId, container).catch(() => false);
  }
  let result: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(String(report.result ?? "")) as unknown;
    result = isRecord(parsed) ? parsed : null;
  } catch {
    result = null;
  }
  const failure =
    result === null
      ? `${String(report.stdout ?? "")} ${String(report.stderr ?? "")}`
      : result.is_error === true || result.subtype !== "success"
        ? `${String(result.result ?? "")} ${String(result.subtype ?? "")} ${String(report.stderr ?? "")}`
        : null;
  if (failure !== null) {
    const limit = claudeUsageLimitOf(failure);
    if (limit) {
      return {
        kind: "usage_limit",
        ...(limit.resetsAt !== undefined ? { resetsAt: limit.resetsAt } : {}),
        message: flat(failure, 300),
      };
    }
    return {
      kind: "failed",
      message: flat(failure, 300) || `Claude Code exited with status ${String(report.code)}.`,
    };
  }
  const usage = isRecord(result?.modelUsage) ? Object.keys(result.modelUsage) : [];
  return {
    kind: "ok",
    output: result?.structured_output,
    model: `claude-code/${usage[0] ?? CLAUDE_DIGEST_MODEL}`,
  };
};
