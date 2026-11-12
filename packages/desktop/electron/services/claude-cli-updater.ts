import fs from "node:fs";
import path from "node:path";
import { powerMonitor } from "electron";
import {
  updateClaudeCli,
  type ClaudeCliUpdateOutcome,
} from "@stella/runtime/kernel/integrations/claude-cli-update";
import { forgetClaudeCodeResolvedAliases } from "@stella/runtime/kernel/integrations/claude-code-resolved-models";
import { getFileLogger } from "@stella/runtime/observability/file-logger";

const STATE_FILE = "claude-cli-updates.json";
const CHECK_INTERVAL_MS = 12 * 60 * 60_000;
const RETRY_INTERVAL_MS = 60 * 60_000;
const NOT_INSTALLED_INTERVAL_MS = 15 * 60_000;
const AFTER_START_MS = 90_000;
const RESTART_QUIET_MS = 10 * 60_000;
const DUE_POLL_MS = 15 * 60_000;

type UpdaterState = {
  checkedAt?: number;
  status?: ClaudeCliUpdateOutcome["status"];
  version?: string | null;
};

// Until Claude Code is installed a check only looks for it, so it looks
// often: onboarding installs it minutes after the first check.
const intervalAfter = (status: UpdaterState["status"]): number =>
  status === "failed"
    ? RETRY_INTERVAL_MS
    : status === "not_installed"
      ? NOT_INSTALLED_INTERVAL_MS
      : CHECK_INTERVAL_MS;

/**
 * Keeps the Claude Code CLI current for someone who never opens it in a
 * terminal, where it would update itself: Stella only ever runs it
 * non-interactively. Checks shortly after Stella starts and then twice a day,
 * silently. A session moves to an installed update at the start of its next
 * turn (`ensureStreamingProcess` in the runtime).
 */
export class ClaudeCliUpdater {
  private readonly statePath: string;
  private readonly abort = new AbortController();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private started = false;
  private lastStatus: UpdaterState["status"] | null = null;
  private dueAt = Date.now() + AFTER_START_MS;
  private readonly onResume = () => this.arm();

  constructor(private readonly stellaDataDir: string) {
    this.statePath = path.join(stellaDataDir, STATE_FILE);
  }

  start(): void {
    if (process.env.STELLA_CLAUDE_CLI_UPDATES?.trim().toLowerCase() === "off") {
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

  /**
   * Claude Code was found where the last check found none: check now, so
   * it's on the schedule (and its version recorded) from the start.
   */
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
    let outcome: ClaudeCliUpdateOutcome;
    try {
      outcome = await updateClaudeCli({ signal: this.abort.signal });
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
    const version = "version" in outcome ? outcome.version : null;
    const previous = this.readState();
    if (version && previous.version && version !== previous.version) {
      await forgetClaudeCodeResolvedAliases(this.stellaDataDir);
    }
    this.writeState({
      checkedAt: Date.now(),
      status: outcome.status,
      version: version ?? previous.version ?? null,
    });
    const logger = getFileLogger();
    if (outcome.status === "failed") {
      logger?.warn("claude-cli.update-failed", { ...outcome });
    } else if (outcome.status !== previous.status || outcome.status === "updated") {
      logger?.process(`claude-cli.update-${outcome.status}`, { ...outcome });
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
    } catch {
      // The schedule is also held in memory; the file only spares a check
      // after a quick restart.
    }
  }
}
