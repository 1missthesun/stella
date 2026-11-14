import { execFile } from "node:child_process";
import { Effect } from "effect";
import { pollWithDeadline } from "./poll.js";
import {
  readProcessIdentity,
  type RecordedProcess,
  signalRecordedProcess,
} from "../../kernel/shared/process-identity.js";

const ALIVE_POLL_INTERVAL_MS = 50;
const SIGKILL_CONFIRM_BUDGET_MS = 1_000;

export type KillResult = { stopped: boolean; escalatedToSigkill: boolean };

class StillAliveError {
  readonly _tag = "StillAliveError";
}

class ExitConfirmDeadlineError {
  readonly _tag = "ExitConfirmDeadlineError";
}

const pidIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const waitForPidExit = (
  pid: number,
  budgetMs: number,
): Effect.Effect<boolean> =>
  pollWithDeadline({
    timeoutMs: budgetMs,
    intervalMs: ALIVE_POLL_INTERVAL_MS,
    attempt: Effect.suspend(() =>
      pidIsAlive(pid)
        ? Effect.fail(new StillAliveError())
        : Effect.succeed(true),
    ),
    retryWhile: (error) => error instanceof StillAliveError,
    onDeadline: () => new ExitConfirmDeadlineError(),
  }).pipe(Effect.catch(() => Effect.succeed(false)));

/**
 * Stop a worker from a stored pid: SIGTERM, then SIGKILL after `graceMs`.
 * Each signal goes only to the process that was recorded (start time or
 * the worker's own command line), never to whatever now holds the pid.
 */
export const killWorkerProcess = (
  recorded: RecordedProcess,
  graceMs: number,
  reason: string,
): Effect.Effect<KillResult> =>
  Effect.gen(function* () {
    const pid = recorded.pid;
    const first = signalRecordedProcess(recorded, "SIGTERM", { reason });
    if (first === "gone") return { stopped: true, escalatedToSigkill: false };
    if (first !== "sent") return { stopped: false, escalatedToSigkill: false };
    if (yield* waitForPidExit(pid, graceMs)) {
      return { stopped: true, escalatedToSigkill: false };
    }
    const second = signalRecordedProcess(recorded, "SIGKILL", {
      reason: `${reason}; still running ${graceMs}ms after SIGTERM`,
    });
    if (second === "gone") return { stopped: true, escalatedToSigkill: false };
    if (second !== "sent") return { stopped: true, escalatedToSigkill: false };
    if (yield* waitForPidExit(pid, SIGKILL_CONFIRM_BUDGET_MS)) {
      return { stopped: true, escalatedToSigkill: true };
    }
    return { stopped: false, escalatedToSigkill: true };
  });

export const stopPids = (
  processes: readonly RecordedProcess[],
  reason: string,
  graceMs = 750,
): Effect.Effect<void> =>
  processes.length === 0
    ? Effect.void
    : Effect.forEach(processes, (recorded) => killWorkerProcess(recorded, graceMs, reason), {
        concurrency: "unbounded",
        discard: true,
      });

/** Command-line parts that name a worker of this Stella root. */
export const workerCommandTags = (workerEntryPath: string, stellaAppDir: string): string[] => [
  workerEntryPath,
  `--stella-root`,
  stellaAppDir,
];

export const findSameRootWorkerPids = async (
  workerEntryPath: string,
  stellaAppDir: string,
): Promise<RecordedProcess[]> =>
  (await listSameRootWorkerPids(workerEntryPath, stellaAppDir)).map((pid) => ({
    pid,
    identity: readProcessIdentity(pid),
    commandIncludes: workerCommandTags(workerEntryPath, stellaAppDir),
  }));

const listSameRootWorkerPids = async (
  workerEntryPath: string,
  stellaAppDir: string,
): Promise<number[]> => {
  if (process.platform === "win32") {
    const powerShellLiteral = (value: string) =>
      `'${value.replace(/'/g, "''")}'`;
    const uniquePathVariants = (value: string) =>
      [value, value.replace(/\//g, "\\"), value.replace(/\\/g, "/")].filter(
        (entry, index, list) => entry && list.indexOf(entry) === index,
      );
    const powerShellArray = (values: string[]) =>
      `@(${values.map(powerShellLiteral).join(",")})`;
    const script = [
      "$ErrorActionPreference = 'SilentlyContinue'",
      `$entries = ${powerShellArray(uniquePathVariants(workerEntryPath))}`,
      `$roots = ${powerShellArray(uniquePathVariants(stellaAppDir))}`,
      `$currentPid = ${process.pid}`,
      "$stellaPids = @()",
      "$processes = Get-CimInstance Win32_Process -Filter \"CommandLine LIKE '%--stella-root%'\"",
      "foreach ($proc in $processes) {",
      "  $line = [string]$proc.CommandLine",
      "  if (-not $line -or [int]$proc.ProcessId -eq $currentPid) { continue }",
      "  $entryMatch = $false",
      "  foreach ($entry in $entries) { if ($line.Contains($entry)) { $entryMatch = $true; break } }",
      "  if (-not $entryMatch) { continue }",
      "  $rootMatch = $false",
      "  foreach ($root in $roots) { if ($line.Contains('--stella-root') -and $line.Contains($root)) { $rootMatch = $true; break } }",
      "  if ($rootMatch) { $stellaPids += [int]$proc.ProcessId }",
      "}",
      "$stellaPids | ConvertTo-Json -Compress",
    ].join("; ");
    const output = await new Promise<string>((resolve) => {
      execFile(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          script,
        ],
        { windowsHide: true, timeout: 5_000, maxBuffer: 1024 * 1024 },
        (error, stdout) => {
          resolve(error ? "" : stdout);
        },
      );
    });
    const raw = output.trim();
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      const values = Array.isArray(parsed) ? parsed : [parsed];
      return values
        .map((value) =>
          typeof value === "number"
            ? value
            : typeof value === "string"
              ? Number.parseInt(value, 10)
              : Number.NaN,
        )
        .filter(
          (pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid,
        );
    } catch {
      return [];
    }
  }
  const psOutput = await new Promise<string>((resolve) => {
    execFile("ps", ["-axo", "pid=,args="], (error, stdout) => {
      resolve(error ? "" : stdout);
    });
  });
  const pids: number[] = [];
  for (const line of psOutput.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(.*)$/);
    if (!match) continue;
    const pid = Number.parseInt(match[1] ?? "", 10);
    const args = match[2] ?? "";
    if (
      Number.isInteger(pid) &&
      pid > 0 &&
      pid !== process.pid &&
      args.includes(workerEntryPath) &&
      (args.includes(`--stella-root ${stellaAppDir}`) ||
        args.includes(`--stella-root=${stellaAppDir}`))
    ) {
      pids.push(pid);
    }
  }
  return pids;
};
