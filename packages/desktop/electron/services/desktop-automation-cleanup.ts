import { execFileSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";

import { resolveStatePath } from "@stella/runtime/kernel/cli/shared";
import { resolveAutomationSocketPath } from "@stella/runtime/kernel/computer-use/automation-socket-paths";
import { resolveNativeHelperPath } from "../native-helper-path.js";
import { pidRunsExecutable, terminateOwnedProcess } from "./process-identity.js";

const stellaComputerStateRoot = () =>
  path.join(resolveStatePath(), "stella-computer");

const sessionsDir = (root: string) => path.join(root, "sessions");
// Pre-socket-relocation layout; swept so sockets left behind by older builds
// don't linger. Current sockets live under ~/.stella/computer-sockets (see
// runtime/kernel/computer-use/automation-socket-paths.ts).
const legacySocketsDir = (root: string) => path.join(root, "daemon-sockets");

const readPidFile = (filePath: string): number | null => {
  try {
    const raw = readFileSync(filePath, "utf8").trim();
    if (!raw) return null;
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
};

const TERM_GRACE_MS = 150;

const parsePsRows = (
  output: string,
): Array<{
  pid: number;
  ppid: number;
  command: string;
}> =>
  output
    .split(/\r?\n/)
    .map((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
      if (!match) return null;
      return {
        pid: Number.parseInt(match[1]!, 10),
        ppid: Number.parseInt(match[2]!, 10),
        command: match[3]!,
      };
    })
    .filter((row): row is { pid: number; ppid: number; command: string } =>
      Boolean(row && Number.isFinite(row.pid) && Number.isFinite(row.ppid)),
    );

const findOrphanedDesktopAutomationPids = (): number[] => {
  if (process.platform === "win32") return [];
  const helperPath = resolveNativeHelperPath("desktop_automation");
  if (!helperPath) return [];

  try {
    const output = execFileSync("ps", ["-axo", "pid=,ppid=,command="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parsePsRows(output)
      .filter(
        (row) =>
          row.pid !== process.pid &&
          row.ppid === 1 &&
          row.command.includes(helperPath) &&
          /\bdaemon\b/.test(row.command),
      )
      .map((row) => row.pid);
  } catch {
    return [];
  }
};

/**
 * Stops every stella-computer daemon on quit so the next launch spawns a fresh
 * one from the on-disk binary: macOS keeps the old code mapped under a running
 * process.
 */
export const stopAllDesktopAutomationDaemons = async (): Promise<void> => {
  const root = stellaComputerStateRoot();
  const sessions = sessionsDir(root);
  const macHelperPath =
    process.platform === "win32"
      ? null
      : resolveNativeHelperPath("desktop_automation");
  const windowsHelperPath =
    process.platform === "win32"
      ? resolveNativeHelperPath("stella-computer-helper")
      : null;

  const targets = new Map<number, () => boolean>();
  if (macHelperPath) {
    for (const pid of findOrphanedDesktopAutomationPids()) {
      targets.set(pid, () => pidRunsExecutable(pid, macHelperPath, ["daemon"]));
    }
  }
  const pidFiles: string[] = [];
  const sessionNames: string[] = [];

  if (existsSync(sessions)) {
    let entries: string[];
    try {
      entries = readdirSync(sessions);
    } catch {
      entries = [];
    }

    for (const name of entries) {
      const sessionPath = path.join(sessions, name);
      let isDir = false;
      try {
        isDir = statSync(sessionPath).isDirectory();
      } catch {
        continue;
      }
      if (!isDir) continue;
      sessionNames.push(name);

      const macPidFile = path.join(sessionPath, "automation.pid");
      const windowsPidFile = path.join(sessionPath, "windows-daemon", "helper.pid");
      const macPid = readPidFile(macPidFile);
      if (macPid !== null && macHelperPath) {
        targets.set(macPid, () =>
          pidRunsExecutable(macPid, macHelperPath, ["--pid-file", macPidFile]),
        );
      }
      const windowsPid = readPidFile(windowsPidFile);
      if (windowsPid !== null && windowsHelperPath) {
        targets.set(windowsPid, () =>
          pidRunsExecutable(windowsPid, windowsHelperPath),
        );
      }
      for (const pidFile of [macPidFile, windowsPidFile]) {
        if (existsSync(pidFile)) pidFiles.push(pidFile);
      }
    }
  }

  await Promise.all(
    Array.from(targets, ([pid, stillOwned]) =>
      terminateOwnedProcess(pid, stillOwned, TERM_GRACE_MS),
    ),
  );

  for (const pidFile of pidFiles) {
    rmSync(pidFile, { force: true });
    if (path.basename(path.dirname(pidFile)) === "windows-daemon") {
      rmSync(path.dirname(pidFile), { recursive: true, force: true });
    }
  }
  for (const name of sessionNames) {
    rmSync(resolveAutomationSocketPath(root, name), { force: true });
  }
  const legacySockets = legacySocketsDir(root);
  if (existsSync(legacySockets)) {
    let socketEntries: string[];
    try {
      socketEntries = readdirSync(legacySockets);
    } catch {
      return;
    }
    for (const entry of socketEntries) {
      if (!entry.endsWith(".sock")) continue;
      rmSync(path.join(legacySockets, entry), { force: true });
    }
  }
};
