import fs from "node:fs";
import path from "node:path";
import { powerMonitor } from "electron";
import { callRuntimeAppService } from "./runtime-app-services.js";
import { getFileLogger } from "@stella/node-shared/observability/file-logger";

const CHECK_INTERVAL_MS = 12 * 60 * 60_000;
const RETRY_INTERVAL_MS = 60 * 60_000;
const NOT_INSTALLED_INTERVAL_MS = 15 * 60_000;
const UNUSABLE_INTERVAL_MS = 30 * 60_000;
const AFTER_START_MS = 90_000;
const RESTART_QUIET_MS = 10 * 60_000;
const DUE_POLL_MS = 15 * 60_000;

type CliUpdateOutcome = {
  status:
    | "not_installed"
    | "turned_off"
    | "current"
    | "updated"
    | "failed"
    | "repaired"
    | "unusable";
  version?: string | null;
  problem?: string;
  method?: unknown;
  repair?: { status?: string; output?: string; how?: string };
  fallback?: string | null;
  [key: string]: unknown;
};

type UpdaterState = {
  checkedAt?: number;
  status?: CliUpdateOutcome["status"];
  version?: string | null;
};

const intervalAfter = (status: UpdaterState["status"]): number =>
  status === "failed"
    ? RETRY_INTERVAL_MS
    : status === "unusable"
      ? UNUSABLE_INTERVAL_MS
      : status === "not_installed"
        ? NOT_INSTALLED_INTERVAL_MS
        : CHECK_INTERVAL_MS;

export type CliUpdaterOptions = {
  stateFile: string;
  offSwitch: string;
  log: string;
  service: "checkClaudeCliUpdate" | "checkAntigravityCliUpdate";
};

export const CLAUDE_CLI_UPDATER: CliUpdaterOptions = {
  stateFile: "claude-cli-updates.json",
  offSwitch: "STELLA_CLAUDE_CLI_UPDATES",
  log: "claude-cli",
  service: "checkClaudeCliUpdate",
};

export const ANTIGRAVITY_CLI_UPDATER: CliUpdaterOptions = {
  stateFile: "antigravity-cli-updates.json",
  offSwitch: "STELLA_ANTIGRAVITY_CLI_UPDATES",
  log: "antigravity-cli",
  service: "checkAntigravityCliUpdate",
};

export class CliUpdater {
  private readonly statePath: string;
  private readonly abort = new AbortController();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private started = false;
  private lastStatus: UpdaterState["status"] | null = null;
  private dueAt = Date.now() + AFTER_START_MS;
  private readonly onResume = () => this.arm();

  constructor(
    stellaDataDir: string,
    private readonly options: CliUpdaterOptions,
  ) {
    this.statePath = path.join(stellaDataDir, options.stateFile);
  }

  start(): void {
    if (process.env[this.options.offSwitch]?.trim().toLowerCase() === "off") {
      return;
    }
    const stored = this.readState();
    const last = stored.checkedAt ?? 0;
    const sinceLast = Date.now() - last;
    if (sinceLast >= 0 && sinceLast < RESTART_QUIET_MS) {
      this.dueAt = last + intervalAfter(stored.status);
    }
    this.started = true;
    powerMonitor.on("resume", this.onResume);
    this.arm();
  }

  noteCliFound(): void {
    if (!this.started || this.lastStatus !== "not_installed") return;
    this.dueAt = Date.now();
    this.arm();
  }

  dispose(): void {
    powerMonitor.off("resume", this.onResume);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.abort.abort();
  }

  // A sleeping computer stops timers, so a long one would fire late by the
  // time slept; short hops against the wall clock keep the schedule.
  private arm(): void {
    if (this.abort.signal.aborted) return;
    if (this.timer) clearTimeout(this.timer);
    const wait = Math.min(Math.max(this.dueAt - Date.now(), 0), DUE_POLL_MS);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (Date.now() >= this.dueAt) void this.check();
      else this.arm();
    }, wait);
    this.timer.unref?.();
  }

  private async check(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const previous = this.readState();
    let outcome: CliUpdateOutcome;
    try {
      outcome = await callRuntimeAppService<CliUpdateOutcome>(this.options.service, {
        previousVersion: previous.version ?? null,
      });
    } catch (error) {
      outcome = {
        status: "failed",
        version: null,
        output: error instanceof Error ? error.message : String(error),
      };
    }
    this.running = false;
    if (this.abort.signal.aborted) return;
    this.lastStatus = outcome.status;
    const version = outcome.version ?? null;
    this.writeState({
      checkedAt: Date.now(),
      status: outcome.status,
      version: version ?? previous.version ?? null,
    });
    const logger = getFileLogger();
    if (outcome.status === "failed") {
      logger?.warn(`${this.options.log}.update-failed`, { ...outcome });
    } else if (outcome.status === "unusable") {
      logger?.warn(`${this.options.log}.unusable`, {
        problem: outcome.problem,
        method: outcome.method,
        repair: outcome.repair?.status,
        ...(outcome.repair?.status === "failed" ? { repairOutput: outcome.repair.output } : {}),
        ...(outcome.repair?.status === "manual" ? { how: outcome.repair.how } : {}),
        fallback: outcome.fallback,
      });
    } else if (outcome.status === "repaired") {
      logger?.warn(`${this.options.log}.repaired`, { ...outcome });
    } else if (outcome.status !== previous.status || outcome.status === "updated") {
      logger?.process(`${this.options.log}.update-${outcome.status}`, { ...outcome });
    }
    this.dueAt = Date.now() + intervalAfter(outcome.status);
    this.arm();
  }

  private readState(): UpdaterState {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.statePath, "utf8")) as unknown;
      return parsed && typeof parsed === "object" ? (parsed as UpdaterState) : {};
    } catch {
      return {};
    }
  }

  private writeState(state: UpdaterState): void {
    try {
      fs.writeFileSync(this.statePath, `${JSON.stringify(state, null, 2)}\n`);
    } catch {}
  }
}
