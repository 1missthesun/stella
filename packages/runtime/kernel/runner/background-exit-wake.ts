import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { redactSecureValuesInText } from "../shared/secure-value-redaction.js";
import type { ShellExitSnapshot, UntoldTaskShell } from "../tools/shell.js";

type WriteExitLog = (
  sessionId: string,
  contents: string,
) => Promise<string | null> | string | null;
type WakeOwner = { conversationId: string; agentId: string };
type WakeIdentity = WakeOwner | string;
type WakeBatch = { exits: ShellExitSnapshot[]; eventId: string };
type WakeEntry = WakeOwner & {
  disposers: Map<string, () => void>;
  collected: string[];
  timer: ReturnType<typeof setTimeout> | null;
  firstExitAt: number | null;
  deliveryFailures: number;
  flushPromise: Promise<void> | null;
  pendingDelivery: WakeBatch | null;
};
export type BackgroundExitWakeDeps = {
  watchShellExit: (sessionId: string, listener: () => void) => () => void;
  /** Takes a command's end to tell; null when its owner already knows. */
  claimShellExit: (sessionId: string) => ShellExitSnapshot | null;
  /** Puts back an end that could not be told. */
  releaseShellExit: (sessionId: string) => void;
  getThreadStatus?: (
    agentId: string,
    conversationId: string,
  ) => Promise<string>;
  writeExitLog?: WriteExitLog;
  deliver: (
    args: WakeOwner & {
      eventId: string;
      isCurrent: () => boolean;
      text: string;
    },
  ) => Promise<boolean>;
  now?: () => number;
};
export type BackgroundExitWake = ReturnType<typeof createBackgroundExitWake>;
const EXIT_LOG_DIRNAME = "background-exits";
const EXIT_LOG_TTL_MS = 24 * 60 * 60 * 1000;
const COALESCE_WINDOW_MS = 2_000;
const MAX_COALESCE_MS = 15_000;
const DELIVERY_RETRY_BASE_MS = 1_000;
const DELIVERY_RETRY_MAX_MS = 30_000;
const INLINE_OUTPUT_CHARS = 2_000;
const HEAD_SHARE = 0.3;
const formatDuration = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 90) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}m`;
  return `${(minutes / 60).toFixed(1)}h`;
};
export const truncateMiddle = (value: string, max = INLINE_OUTPUT_CHARS) => {
  if (value.length <= max) return value;
  const headChars = Math.floor(max * HEAD_SHARE);
  const tailChars = max - headChars;
  const dropped = value.length - max;
  return [
    value.slice(0, headChars),
    `\n… [${dropped} characters omitted] …\n`,
    value.slice(value.length - tailChars),
  ].join("");
};
const describeExit = (exit: ShellExitSnapshot, logPath: string | null) => {
  const outcome = exit.stoppedWithTask
    ? "was stopped when you were stopped,"
    : exit.exitCode === 0
      ? "succeeded"
      : exit.exitCode === null
        ? "ended without an exit code"
        : `failed with exit code ${exit.exitCode}`;
  const lines = [
    `$ ${exit.command}`,
    `  ${outcome} after ${formatDuration(exit.completedAt - exit.startedAt)} (cwd: ${exit.cwd})`,
  ];
  const output = exit.output.trim();
  if (!output) {
    lines.push("  (no output captured)");
    return lines.join("\n");
  }
  lines.push("", truncateMiddle(output));
  if (output.length > INLINE_OUTPUT_CHARS && logPath) {
    lines.push("", `Full captured output: ${logPath}`);
  }
  return lines.join("\n");
};
const finishedLine = (exits: ShellExitSnapshot[]) =>
  exits.length === 1
    ? "a command you left running in the background has finished."
    : `${exits.length} commands you left running in the background have finished.`;
const describeExits = async (
  exits: ShellExitSnapshot[],
  writeExitLog: WriteExitLog | undefined,
): Promise<string> => {
  const described: string[] = [];
  for (const exit of exits) {
    let logPath: string | null = null;
    if (exit.output.length > INLINE_OUTPUT_CHARS && writeExitLog) {
      try {
        logPath = await writeExitLog(exit.sessionId, exit.output);
      } catch {
        logPath = null;
      }
    }
    described.push(describeExit(exit, logPath));
  }
  return await redactSecureValuesInText(described.join("\n\n"));
};
const buildWakeText = async (
  exits: ShellExitSnapshot[],
  writeExitLog: WriteExitLog | undefined,
) =>
  [
    `[wake: ${finishedLine(exits)}]`,
    "",
    await describeExits(exits, writeExitLog),
    "",
    "You were resumed for this. Continue the work that was waiting on it, or say what you found.",
  ].join("\n");
/** What a working agent is told, once, of its background commands that ended meanwhile. */
export const takeEndedCommands = async (
  shells: {
    listUntoldTaskShells: (agentId: string) => UntoldTaskShell[];
    claimShellExit: (sessionId: string) => ShellExitSnapshot | null;
  },
  agentId: string,
  writeExitLog?: WriteExitLog,
): Promise<string | undefined> => {
  const exits = shells
    .listUntoldTaskShells(agentId)
    .filter((session) => session.ended)
    .map((session) => shells.claimShellExit(session.sessionId))
    .filter((exit) => exit !== null);
  if (exits.length === 0) return undefined;
  return `While you worked, ${finishedLine(exits)}\n\n${await describeExits(exits, writeExitLog)}`;
};
const buildWakeEventId = (entry: WakeOwner, exits: ShellExitSnapshot[]) => {
  const completionIdentity = exits
    .map((exit) => [exit.sessionId, exit.completedAt, exit.exitCode])
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
  const digest = createHash("sha256")
    .update(
      JSON.stringify([entry.conversationId, entry.agentId, completionIdentity]),
    )
    .digest("hex");
  return `background-exit:${digest}`;
};
export const writeBackgroundExitLog = (
  stellaDataDir: string,
  sessionId: string,
  contents: string,
): string | null => {
  try {
    const dir = path.join(stellaDataDir, EXIT_LOG_DIRNAME);
    fs.mkdirSync(dir, { recursive: true });
    const cutoff = Date.now() - EXIT_LOG_TTL_MS;
    for (const name of fs.readdirSync(dir)) {
      const stale = path.join(dir, name);
      try {
        if (fs.statSync(stale).mtimeMs < cutoff)
          fs.rmSync(stale, { force: true });
      } catch {
        // A file that vanished under us needs no pruning.
      }
    }
    const logPath = path.join(dir, `${sessionId}.log`);
    fs.writeFileSync(logPath, contents, "utf-8");
    return logPath;
  } catch {
    return null;
  }
};
export const createBackgroundExitWake = (deps: BackgroundExitWakeDeps) => {
  const now = deps.now ?? (() => Date.now());
  let disposed = false;
  const armed = new Map<string, WakeEntry>();
  const ownerKey = (conversationId: string, agentId: string) =>
    JSON.stringify([conversationId, agentId]);
  const keysFor = (identity: WakeIdentity) => {
    if (typeof identity !== "string") {
      return [ownerKey(identity.conversationId, identity.agentId)];
    }
    return [...armed.entries()]
      .filter(([, entry]) => entry.agentId === identity)
      .map(([key]) => key);
  };
  const clearEntry = (key: string, entry: WakeEntry) => {
    if (armed.get(key) !== entry) return;
    for (const dispose of entry.disposers.values()) dispose();
    entry.disposers.clear();
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    armed.delete(key);
    // A delivery under way puts its own back when it fails.
    if (!entry.flushPromise) {
      for (const exit of entry.pendingDelivery?.exits ?? []) deps.releaseShellExit(exit.sessionId);
    }
  };
  const disarm = (identity: WakeIdentity) => {
    for (const key of keysFor(identity)) {
      const entry = armed.get(key);
      if (entry) clearEntry(key, entry);
    }
  };
  const scheduleTimer = (key: string, entry: WakeEntry, delay: number) => {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      void flush(key);
    }, delay);
    entry.timer.unref?.();
  };
  const scheduleRetry = (key: string, entry: WakeEntry) => {
    if (armed.get(key) !== entry || disposed) return;
    const exponent = Math.min(Math.max(0, entry.deliveryFailures - 1), 10);
    const delay = Math.min(
      DELIVERY_RETRY_BASE_MS * 2 ** exponent,
      DELIVERY_RETRY_MAX_MS,
    );
    scheduleTimer(key, entry, delay);
  };
  const flushEntry = async (key: string, entry: WakeEntry): Promise<void> => {
    if (armed.get(key) !== entry) return;
    const batch =
      entry.pendingDelivery ??
      ((): WakeBatch | null => {
        const exits = entry.collected
          .splice(0)
          .map((sessionId) => deps.claimShellExit(sessionId))
          .filter((exit) => exit !== null);
        if (exits.length === 0) return null;
        return {
          exits,
          eventId: buildWakeEventId(entry, exits),
        };
      })();
    if (batch && !entry.pendingDelivery) entry.pendingDelivery = batch;
    const exits = batch?.exits ?? [];
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    entry.firstExitAt = null;
    if (exits.length === 0) {
      if (entry.disposers.size === 0) clearEntry(key, entry);
      return;
    }
    const isCurrent = () => !disposed && armed.get(key) === entry;
    // Disarmed before it was told (the agent started working again): that turn tells it.
    const release = () => {
      for (const exit of exits) deps.releaseShellExit(exit.sessionId);
    };
    if (deps.getThreadStatus) {
      try {
        const status = await deps.getThreadStatus(
          entry.agentId,
          entry.conversationId,
        );
        if (!isCurrent()) {
          release();
          return;
        }
        if (status === "canceled") {
          clearEntry(key, entry);
          return;
        }
      } catch {
        // Status is an optimization; deliver rather than drop the wake.
      }
    }
    if (!isCurrent()) {
      release();
      return;
    }
    const text = await buildWakeText(exits, deps.writeExitLog);
    if (!isCurrent()) {
      release();
      return;
    }
    try {
      const delivered = await deps.deliver({
        conversationId: entry.conversationId,
        agentId: entry.agentId,
        eventId: batch!.eventId,
        isCurrent,
        text,
      });
      if (!isCurrent()) {
        if (!delivered) release();
        return;
      }
      if (!delivered) {
        entry.deliveryFailures += 1;
        scheduleRetry(key, entry);
        return;
      }
      entry.pendingDelivery = null;
      entry.deliveryFailures = 0;
      if (entry.collected.length > 0) {
        scheduleFlush(key);
        return;
      }
      if (
        entry.disposers.size === 0 &&
        entry.collected.length === 0 &&
        entry.timer === null
      ) {
        clearEntry(key, entry);
      }
    } catch (error) {
      if (isCurrent()) {
        entry.deliveryFailures += 1;
        scheduleRetry(key, entry);
      } else release();
      console.warn(
        `[background-wake] failed to deliver exit wake to ${entry.agentId}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  };
  const flush = (key: string): Promise<void> => {
    const entry = armed.get(key);
    if (!entry) return Promise.resolve();
    if (entry.flushPromise) return entry.flushPromise;
    const attempt = flushEntry(key, entry).finally(() => {
      if (entry.flushPromise === attempt) entry.flushPromise = null;
    });
    entry.flushPromise = attempt;
    return attempt;
  };
  const scheduleFlush = (key: string) => {
    const entry = armed.get(key);
    if (!entry) return;
    const startedAt = entry.firstExitAt ?? now();
    entry.firstExitAt = startedAt;
    const remaining = Math.max(0, startedAt + MAX_COALESCE_MS - now());
    const delay = Math.min(COALESCE_WINDOW_MS, remaining);
    scheduleTimer(key, entry, delay);
  };
  return {
    arm: (args: {
      conversationId: string;
      agentId?: string | null;
      sessionIds: string[];
      interrupted?: boolean;
    }): string[] => {
      const { agentId } = args;
      if (!agentId || disposed) {
        return [];
      }
      const identity = {
        conversationId: args.conversationId,
        agentId,
      };
      const key = ownerKey(identity.conversationId, identity.agentId);
      disarm(identity);
      if (args.interrupted || args.sessionIds.length === 0) return [];
      const entry: WakeEntry = {
        conversationId: args.conversationId,
        agentId,
        disposers: new Map(),
        collected: [],
        timer: null,
        firstExitAt: null,
        deliveryFailures: 0,
        flushPromise: null,
        pendingDelivery: null,
      };
      armed.set(key, entry);
      for (const sessionId of new Set(args.sessionIds)) {
        try {
          const dispose = deps.watchShellExit(sessionId, () => {
            const live = armed.get(key);
            if (live !== entry) return;
            entry.disposers.delete(sessionId);
            entry.collected.push(sessionId);
            scheduleFlush(key);
          });
          entry.disposers.set(sessionId, dispose);
        } catch {
          // One malformed/stale session must not keep the remaining
          // owner-scoped watchers from being armed.
        }
      }
      if (entry.disposers.size === 0) clearEntry(key, entry);
      return [...entry.disposers.keys()];
    },
    disarm,
    flushNow: async (identity: WakeIdentity) => {
      await Promise.all(keysFor(identity).map((key) => flush(key)));
    },
    armedThreadIds: () => [...armed.values()].map((entry) => entry.agentId),
    armedOwners: () =>
      [...armed.values()].map((entry) => ({
        conversationId: entry.conversationId,
        agentId: entry.agentId,
      })),
    dispose: () => {
      disposed = true;
      for (const [key, entry] of [...armed.entries()]) clearEntry(key, entry);
    },
  };
};
