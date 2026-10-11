import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BackendClient } from "../../../../packages/contracts/backend/client";
import { migrateDesktopDatabase } from "../../../../packages/runtime/kernel/storage/schema";
import { SessionStore } from "../../../../packages/runtime/kernel/storage/session-store";
import { createClaudeSessionSync } from "../../../../packages/runtime/kernel/runner/claude-session-sync";
import { setClaudeSessionSyncSink } from "../../../../packages/runtime/kernel/integrations/claude-code-session-sync-sink";
import { runExternalSubagentTurn } from "../../../../packages/runtime/kernel/agent-runtime/external-engines";
import {
  claudeSessionProjectDir,
  resolveClaudeWorkingFolder,
} from "../../../../packages/runtime/kernel/integrations/claude-code-session-files";
import { shutdownClaudeCodeRuntime } from "../../../../packages/runtime/kernel/integrations/claude-code-session-runtime";

const argv = process.argv.slice(2);
const mode = argv[0];
const flag = (name: string, fallback?: string): string | undefined => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
};
const required = (name: string): string => {
  const value = flag(name);
  if (!value) {
    console.error(`Missing ${name}.`);
    process.exit(2);
  }
  return value;
};

const backendUrl =
  process.env.STELLA_BACKEND_URL?.trim() ||
  "https://stella-v2-cloud-builder-dev.fromyou.workers.dev";
const repoRoot = path.resolve(import.meta.dir, "../../../..");

const devVar = (name: string): string => {
  const file = path.join(repoRoot, "workers/cloud-builder/.dev.vars");
  if (!existsSync(file)) return "";
  const line = readFileSync(file, "utf8")
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim().replace(/^"(.*)"$/, "$1") : "";
};

const mintToken = async (email: string): Promise<{ token: string; ownerId: string }> => {
  const secret = process.env.STELLA_ADMIN_API_SECRET?.trim() || devVar("STELLA_ADMIN_API_SECRET");
  if (!secret) throw new Error("STELLA_ADMIN_API_SECRET is unavailable.");
  const response = await fetch(`${backendUrl}/api/admin/test-accounts/session`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify({ email, plan: "pro", usageMode: "unlimited" }),
  });
  if (!response.ok) throw new Error(`Test account mint failed: ${response.status}`);
  const body = (await response.json()) as { token: string; ownerId: string };
  return body;
};

const sessionLineCount = (file: string): number =>
  existsSync(file) ? readFileSync(file, "utf8").split("\n").filter((line) => line.trim()).length : 0;

const main = async () => {
  if (mode === "mint") {
    const email = required("--email");
    console.log(JSON.stringify(await mintToken(email)));
    return;
  }
  const threadId = required("--thread");
  const conversationId = flag("--conversation", "proof-conversation")!;
  const cwd = path.resolve(required("--cwd"));
  const configDir = flag("--config-dir");
  if (configDir) process.env.CLAUDE_CONFIG_DIR = path.resolve(configDir);
  const token =
    flag("--token") ?? process.env.STELLA_TEST_TOKEN ?? (await mintToken(required("--email"))).token;
  const dataDir = path.resolve(
    flag("--data-dir") ?? path.join(os.tmpdir(), `claude-session-sync-proof-${randomUUID().slice(0, 8)}`),
  );
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  const db = new Database(path.join(dataDir, "stella.sqlite"));
  migrateDesktopDatabase(db as never);
  const store = new SessionStore(db as never);
  const client = new BackendClient({ baseUrl: backendUrl, getToken: async () => token });
  const sync = createClaudeSessionSync({
    deviceId: flag("--device-id", `${os.hostname()}-proof`)!,
    db: db as never,
    getAuthToken: () => token,
    getBackend: () => ({
      append: async (args) => await client.call("claudeSessions.append", args),
      tag: async (args) => await client.call("claudeSessions.tag", args),
      latest: async (args) => await client.call("claudeSessions.latest", args),
      readChunk: async (args) => await client.call("claudeSessions.readChunk", args),
    }),
  });
  setClaudeSessionSyncSink(sync);
  const report: Record<string, unknown> = { mode, threadId, host: os.hostname(), cwd, dataDir };

  if (mode === "restore" || mode === "restore-resume") {
    const restored = await sync.restore({ threadId, configDir: process.env.CLAUDE_CONFIG_DIR ?? null, cwd });
    report.restore = restored;
    if (!restored) throw new Error("No synced session for this thread.");
    report.restoredLines = sessionLineCount(path.join(restored.projectDir, `${restored.sessionId}.jsonl`));
    if (mode === "restore") {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
  }

  const prompt = required("--prompt");
  const logAhead = flag("--log-ahead");
  const threadHistory = logAhead
    ? [
        { role: "user", content: [{ type: "text", text: "earlier request" }], timestamp: Date.now() - 2_000 },
        { role: "assistant", content: [{ type: "text", text: logAhead }], timestamp: Date.now() - 1_000 },
      ]
    : undefined;
  const workingFolder = await resolveClaudeWorkingFolder(cwd);
  const projectDir = claudeSessionProjectDir(process.env.CLAUDE_CONFIG_DIR ?? null, workingFolder);
  const result = await runExternalSubagentTurn({
    executionHost: "device",
    conversationId,
    storageMode: "cloud",
    userMessageId: randomUUID(),
    agentType: "general",
    userPrompt: prompt,
    agentContext: {
      systemPrompt: "You are a Stella general agent running a session continuity proof.",
      agentEngine: "claude_code_local",
      activeThreadId: threadId,
      ...(threadHistory ? { threadHistory } : {}),
    },
    toolExecutor: async () => ({ error: "No Stella tools in this proof." }),
    deviceId: flag("--device-id", `${os.hostname()}-proof`)!,
    stellaDataDir: dataDir,
    stellaAppDir: repoRoot,
    agentWorkingDirectory: cwd,
    resolvedLlm: {
      model: { id: "claude-code/default", provider: "claude-code", api: "anthropic-messages", name: "Claude Code" },
      route: "direct-provider",
      getApiKey: () => undefined,
    } as never,
    store,
    compactionScheduler: { schedule: async () => {} },
  } as never);
  const sessionId = store.getThreadExternalSessionId(threadId)?.split(":").pop() ?? null;
  report.turn = result;
  report.sessionId = sessionId;
  report.sessionFile = sessionId ? path.join(projectDir, `${sessionId}.jsonl`) : null;
  report.sessionLines = sessionId ? sessionLineCount(path.join(projectDir, `${sessionId}.jsonl`)) : 0;
  shutdownClaudeCodeRuntime();
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  report.flushed = await sync.flush(120_000);
  report.sessionBytesLocal = report.sessionFile && existsSync(String(report.sessionFile))
    ? readFileSync(String(report.sessionFile)).length
    : 0;
  const manifest = await client.call("claudeSessions.latest", { threadId });
  report.cloud = manifest
    ? {
        sessionId: manifest.sessionId,
        deviceId: manifest.deviceId,
        cliVersion: manifest.cliVersion,
        originCwd: manifest.originCwd,
        journalCursor: manifest.journalCursor,
        files: manifest.files.map((file) => ({
          path: file.path,
          generation: file.generation,
          length: file.length,
          chunks: file.chunks.length,
        })),
      }
    : null;
  console.log(JSON.stringify(report, null, 2));
};

try {
  await main();
} finally {
  shutdownClaudeCodeRuntime();
}
process.exit(0);
