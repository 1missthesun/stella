import { app, clipboard, dialog, type BrowserWindow } from "electron";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { rm, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { getMainLogger } from "./observability/main-logger.js";
import { visibleDialogParent } from "./windows/dialog-parent.js";

/**
 * Linux real-time CPU limit (RLIMIT_RTTIME).
 *
 * Without RealtimeKit, xdg-desktop-portal reports a real-time budget of 0 and
 * PipeWire's client library sets RLIMIT_RTTIME to 0 in every process that
 * loads it: the desktop shell or app menu that starts Stella, and Stella's own
 * main process once Show Stella captures the screen. Children inherit it, and
 * the kernel SIGKILLs a process under a hard limit of 0 as soon as one of its
 * threads arms a CPU-time timer: Stella's GPU process, renderers and services
 * die at random with no log line.
 *
 * The launcher raises a low soft limit, restarts itself under the user's
 * systemd when the hard limit is 0, and sets DISABLE_RTKIT=1 when RealtimeKit
 * is missing so PipeWire inside Stella leaves the limit alone. Here main does
 * the same check for starts without the launcher (a checkout), logs what it
 * finds, and tells the user once when the limit is still 0, since only their
 * system can lift it.
 */

type LimitValue = number | "unlimited";
type RealtimeCpuLimit = { soft: LimitValue; hard: LimitValue };
type RtkitState = "present" | "absent" | "unknown";

type RealtimeLimitCheck = {
  limit: RealtimeCpuLimit | null;
  rtkit: RtkitState;
  zero: boolean;
  /** The next start of Stella lifts the limit by itself (see launcherCuresOnNextStart). */
  curedOnNextStart: boolean;
};

const RTKIT_BUS_NAME = "org.freedesktop.RealtimeKit1";
const NOTICE_FILE = "realtime-limit-notice.json";
const PIPEWIRE_FIX_COMMAND =
  "mkdir -p ~/.config/pipewire/client.conf.d && " +
  "printf '%s\\n' 'module.rt.args = { rtportal.enabled = false rtkit.enabled = false }' " +
  "> ~/.config/pipewire/client.conf.d/50-no-zero-rttime.conf";

let check: Promise<RealtimeLimitCheck> | null = null;

const parseLimitValue = (value: string | undefined): LimitValue | null => {
  if (value === "unlimited") return "unlimited";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const readRealtimeCpuLimit = (): RealtimeCpuLimit | null => {
  try {
    const line = readFileSync("/proc/self/limits", "utf8")
      .split("\n")
      .find((entry) => entry.startsWith("Max realtime timeout"));
    if (!line) return null;
    const [soft, hard] = line
      .slice("Max realtime timeout".length)
      .trim()
      .split(/\s+/);
    const parsedSoft = parseLimitValue(soft);
    const parsedHard = parseLimitValue(hard);
    return parsedSoft === null || parsedHard === null
      ? null
      : { soft: parsedSoft, hard: parsedHard };
  } catch {
    return null;
  }
};

const gdbusCall = (method: string, args: string[] = []): Promise<string | null> =>
  new Promise((resolve) => {
    execFile(
      "gdbus",
      [
        "call",
        "--system",
        "--dest",
        "org.freedesktop.DBus",
        "--object-path",
        "/org/freedesktop/DBus",
        "--method",
        `org.freedesktop.DBus.${method}`,
        ...args,
      ],
      { timeout: 3_000 },
      (error, stdout) => resolve(error ? null : String(stdout)),
    );
  });

const probeRtkit = async (): Promise<RtkitState> => {
  const owned = await gdbusCall("NameHasOwner", [RTKIT_BUS_NAME]);
  if (owned === null) return "unknown";
  if (owned.includes("true")) return "present";
  const activatable = await gdbusCall("ListActivatableNames");
  if (activatable === null) return "unknown";
  return activatable.includes(`'${RTKIT_BUS_NAME}'`) ? "present" : "absent";
};

const isZero = (limit: RealtimeCpuLimit | null) =>
  limit !== null && (limit.soft === 0 || limit.hard === 0);

/**
 * Started by a launcher from before the fix: every launcher since passes
 * STELLA_LAUNCHER_RTKIT. That happens right after an app update, which restarts
 * Electron under the launcher already running; the launcher updates itself on
 * the next start, and the new one restarts under the user's systemd with fresh
 * limits. Nothing for the user to fix, so this is logged, not shown.
 */
const launcherCuresOnNextStart = () =>
  process.env.STELLA_LAUNCHER?.trim() === "1" &&
  !process.env.STELLA_LAUNCHER_RTKIT?.trim();

const runCheck = async (): Promise<RealtimeLimitCheck> => {
  const fromLauncher = process.env.STELLA_LAUNCHER_RTKIT?.trim();
  const rtkit: RtkitState =
    fromLauncher === "present" || fromLauncher === "absent"
      ? fromLauncher
      : await probeRtkit();
  // Started without the launcher: keep PipeWire in this process (screen
  // capture) and what it starts from setting the limit to 0.
  if (rtkit === "absent" && !process.env.DISABLE_RTKIT) {
    process.env.DISABLE_RTKIT = "1";
  }
  const limit = readRealtimeCpuLimit();
  const zero = isZero(limit);
  const curedOnNextStart = zero && launcherCuresOnNextStart();
  const fields = {
    soft: limit?.soft ?? "unknown",
    hard: limit?.hard ?? "unknown",
    rtkit,
    disableRtkit: process.env.DISABLE_RTKIT ?? "",
    launcher: curedOnNextStart
      ? "predates-fix: cured on the next start"
      : (process.env.STELLA_LAUNCHER_RTTIME ?? ""),
  };
  const logger = getMainLogger();
  if (zero) {
    logger?.error("linux.realtime-limit-zero", fields);
    console.warn(
      `[linux] Real-time CPU limit (RLIMIT_RTTIME) is ${fields.soft}/${fields.hard}: ` +
        "Linux will kill Stella's processes that use CPU-time timers.",
    );
  } else {
    logger?.process("linux.realtime-limit", fields);
  }
  return { limit, rtkit, zero, curedOnNextStart };
};

/** Starts the check once (Linux only). Call early in main. */
export const startLinuxRealtimeLimitCheck = (): void => {
  if (process.platform !== "linux" || check) return;
  check = runCheck().catch((error) => {
    console.debug(
      "[linux] Real-time limit check failed:",
      error instanceof Error ? error.message : String(error),
    );
    return {
      limit: null,
      rtkit: "unknown" as const,
      zero: false,
      curedOnNextStart: false,
    };
  });
};

const noticeText = (rtkit: RtkitState) => {
  const what =
    "Stella was started with a real-time CPU limit of 0, so Linux can close parts of it " +
    "without warning: the window may reload or Stella may quit on its own.";
  if (rtkit === "absent") {
    return {
      detail:
        `${what}\n\n` +
        "This happens when RealtimeKit (rtkit) is not installed: PipeWire then sets that limit " +
        "in your desktop, and every app you open from it inherits it.\n\n" +
        "To fix it, install rtkit (for example sudo pacman -S rtkit, or sudo apt install rtkit), " +
        "then log out and back in.\n\n" +
        "Or, without installing anything, turn off PipeWire's real-time request for apps: " +
        "Copy Command puts the command on your clipboard. Run it in a terminal, then log out " +
        "and back in.",
      buttons: ["Copy Command", "OK"],
    };
  }
  return {
    detail:
      `${what}\n\n` +
      "Whatever opened Stella passed that limit on. Log out and back in, then open Stella from " +
      "your app menu. If it keeps happening, run ulimit -r in a terminal: it should not say 0. " +
      "Desktops without RealtimeKit (rtkit) cause this through PipeWire, and installing rtkit " +
      "fixes it.",
    buttons: ["OK"],
  };
};

/**
 * Tells the user once when the limit is 0 and Stella cannot lift it by itself.
 * Remembered in userData until a start with a healthy limit, so the problem
 * coming back is told again.
 */
export const noticeLinuxRealtimeLimitOnce = async (options: {
  showDialog: boolean;
  window?: BrowserWindow | null;
}): Promise<void> => {
  if (!check) return;
  const { zero, rtkit, curedOnNextStart } = await check;
  const marker = path.join(app.getPath("userData"), NOTICE_FILE);
  if (!zero) {
    await rm(marker, { force: true }).catch(() => {});
    return;
  }
  if (!options.showDialog || curedOnNextStart) return;
  const told = await readFile(marker, "utf8").then(
    () => true,
    () => false,
  );
  if (told) return;
  await writeFile(
    marker,
    `${JSON.stringify({ toldAt: new Date().toISOString(), rtkit })}\n`,
  ).catch(() => {});
  const { detail, buttons } = noticeText(rtkit);
  const dialogOptions = {
    type: "warning" as const,
    title: "Stella",
    message: "Linux may close Stella without warning on this computer",
    detail,
    buttons,
    defaultId: buttons.length - 1,
    cancelId: buttons.length - 1,
    noLink: true,
  };
  const parent = visibleDialogParent(null, options.window);
  const result = parent
    ? await dialog.showMessageBox(parent, dialogOptions)
    : await dialog.showMessageBox(dialogOptions);
  getMainLogger()?.process("linux.realtime-limit-notice", {
    rtkit,
    choice: buttons[result.response] ?? "",
  });
  if (buttons[result.response] === "Copy Command") {
    clipboard.writeText(PIPEWIRE_FIX_COMMAND);
  }
};
