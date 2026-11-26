import crypto from "node:crypto";
import path from "node:path";
import { AGENT_IDS } from "@stella/contracts/agent-runtime";
import { ensurePrivateDir, writePrivateFile } from "@stella/node-shared/shared/private-fs.js";
import {
  createScheduleScriptAuthEnv,
  runScheduleScript,
  scheduleScriptsDir,
  SCRIPT_RUN_TIMEOUT_MS,
} from "../../shared/schedule-scripts.js";
import type { ToolDefinition } from "../types.js";

export type ScriptDraftToolOptions = {
  stellaDataDir: string;
  getStellaSiteAuth?: () => { baseUrl: string; authToken: string } | null;
  getCloudBackendAuth?: () => { baseUrl: string; authToken: string } | null;
};

const formatResult = (params: {
  scriptPath: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}): string => {
  const lines = [
    `scriptPath: ${params.scriptPath}`,
    `exitCode: ${params.exitCode}`,
    `durationMs: ${params.durationMs}`,
  ];
  if (params.timedOut) {
    lines.push(`timedOut: true (${SCRIPT_RUN_TIMEOUT_MS}ms cap)`);
  }
  lines.push("");
  lines.push("stdout:");
  lines.push(params.stdout.length > 0 ? params.stdout : "(empty)");
  lines.push("");
  lines.push("stderr:");
  lines.push(params.stderr.length > 0 ? params.stderr : "(empty)");
  return lines.join("\n");
};

export const createScriptDraftTool = (
  options: ScriptDraftToolOptions,
): ToolDefinition => ({
  name: "ScriptDraft",
  replay: "unsafe",
  agentTypes: [AGENT_IDS.ORCHESTRATOR, AGENT_IDS.GENERAL],
  demoted: {
    searchTerms: [
      "watch",
      "watcher",
      "sensor",
      "monitor",
      "schedule",
      "script",
      "check",
      "poll",
      "diff",
      "cron",
    ],
  },
  description:
    "Write a check script for a watch that needs this computer and dry-run it at once, returning its scriptPath, exitCode, stdout and stderr. Iterate until the dry-run is clean, then register it with `schedule_add({ kind: 'watch', runsOn: 'computer', scriptPath })`. A cloud watch takes `script` directly instead.",
  parameters: {
    type: "object",
    properties: {
      code: {
        type: "string",
        description:
          "Bun/TypeScript source. Print what changed to stdout only when something did (that output wakes the assistant); print nothing otherwise; exit non-zero when the check itself fails. Keep the last-seen baseline in `<scriptPath>.state.json` (the path is in env STELLA_SCHEDULE_SCRIPT_PATH). 30 s per run.",
      },
    },
    required: ["code"],
  },
  execute: async (args) => {
    const code = typeof args.code === "string" ? args.code : "";
    if (!code.trim()) {
      return { error: "code is required." };
    }

    const dir = scheduleScriptsDir(options.stellaDataDir);
    await ensurePrivateDir(dir);
    const scriptPath = path.join(dir, `${crypto.randomUUID()}.ts`);
    await writePrivateFile(scriptPath, code);

    const authEnv = createScheduleScriptAuthEnv(
      options.getStellaSiteAuth?.() ?? null,
      options.getCloudBackendAuth?.()?.baseUrl ?? null,
    );
    const runResult = await runScheduleScript(
      scriptPath,
      authEnv ? { env: authEnv } : undefined,
    );
    return {
      result: formatResult({
        scriptPath,
        exitCode: runResult.exitCode,
        stdout: runResult.stdout,
        stderr: runResult.stderr,
        durationMs: runResult.durationMs,
        timedOut: runResult.timedOut,
      }),
    };
  },
});
