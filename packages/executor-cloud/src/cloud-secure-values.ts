import { spawn } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import path from "node:path";
import { toolStateEnvironment } from "@stella/contracts/cloud-tool-home";
import {
  SECRET_REDACTION_MARK,
  fingerprintSecrets,
  mergeSecretFingerprints,
  redactSecretFingerprints,
  type SecretFingerprints,
} from "@stella/contracts/secret-redaction";
import {
  SECURE_COMMAND_VALUE_ENV,
  resolveSecureCommand,
} from "@stella/contracts/secure-command";
import {
  secureFieldScript,
  secureFillHash,
  secureFillReceipt,
  type SecureFillMode,
  type SecureFillOutcome,
  type SecureFillPageReport,
} from "@stella/contracts/secure-fill";
import { redactSensitiveText } from "@stella/contracts/sensitive-data";
import {
  USER_ASK_SECRET_HANDLE_PREFIX,
  isUserAskSecretHandle,
  type SecureValueTarget,
  type SecureValueUseReceipt,
} from "@stella/contracts/user-ask";
import { isolateToolProcessLaunch } from "@stella/runtime/kernel/tools/process-isolation.js";
import {
  invalidateSecureValueFingerprints,
  setSecureValueFingerprintSource,
} from "@stella/runtime/kernel/shared/secure-value-redaction.js";
import type {
  CloudBrowserBridge,
  ToolProcessIdentity,
} from "@stella/runtime/kernel/tools/types.js";

/**
 * The secure values a cloud task was given (released by one of the user's
 * computers, or typed on a card and sealed to this task's key), held only in
 * this executor process's memory. Each is behind a handle the task spends
 * with use_secure_value; it works any number of times for 30 minutes (as a
 * fresh value on a computer), for the thread that asked, and is gone when the
 * process ends with the turn. The values' fingerprints outlive them, so a
 * value that turns up in later output is still redacted.
 */
export const CLOUD_SECURE_VALUE_TTL_MS = 30 * 60_000;

const COMMAND_TIMEOUT_MS = 120_000;
const COMMAND_OUTPUT_LIMIT = 4_000;
const RECEIPT_DETAIL_LIMIT = 2_000;
const COMMAND_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

type Held = {
  value: string;
  label: string;
  expiresAt: number;
  owner: string;
};

export type HeldValue = Readonly<{ handle: string; expiresAt: number }>;

export type CloudSecureValueStore = {
  /** Keep a value for this thread; resolves once its fingerprint reaches every redactor. */
  hold(value: string, label: string, owner: string): Promise<HeldValue>;
  /** Whether Stella would hide this text from the task anyway, so it should go back as a handle. */
  hides(value: string): boolean;
  resolve(
    handle: string,
    owner: string,
  ):
    | { ok: true; value: string; label: string; expiresAt: number }
    | { ok: false; reason: "expired" | "other_task" | "missing" };
  fingerprints(): SecretFingerprints;
};

/**
 * `load` gives the fingerprints kept for this thread (their salt is reused,
 * so old and new ones merge); `persist` stores them where Claude Code's hook
 * reads them.
 */
export const createCloudSecureValueStore = async (args: {
  load: () => Promise<SecretFingerprints>;
  persist: (fingerprints: SecretFingerprints) => Promise<void>;
  now?: () => number;
}): Promise<CloudSecureValueStore> => {
  const now = args.now ?? Date.now;
  const held = new Map<string, Held>();
  const expired = new Set<string>();
  let fingerprints = await args.load();
  const params = { baseA: fingerprints.baseA, baseB: fingerprints.baseB };
  let writing: Promise<void> = Promise.resolve();
  setSecureValueFingerprintSource(async () => fingerprints);

  const sweep = () => {
    const at = now();
    for (const [handle, entry] of held) {
      if (at >= entry.expiresAt) {
        held.delete(handle);
        expired.add(handle);
      }
    }
  };

  return {
    hold: async (value, label, owner) => {
      sweep();
      const handle = `${USER_ASK_SECRET_HANDLE_PREFIX}${randomUUID()}`;
      const expiresAt = now() + CLOUD_SECURE_VALUE_TTL_MS;
      held.set(handle, { value, label, expiresAt, owner });
      fingerprints = mergeSecretFingerprints(fingerprints, fingerprintSecrets([value], params));
      invalidateSecureValueFingerprints();
      const snapshot = fingerprints;
      writing = writing.then(() => args.persist(snapshot));
      await writing;
      return { handle, expiresAt };
    },
    hides: (value) =>
      Boolean(value) &&
      (redactSensitiveText(value) !== value ||
        redactSecretFingerprints(value, fingerprints) !== value),
    resolve: (handle, owner) => {
      sweep();
      const entry = held.get(handle);
      if (entry) {
        if (entry.owner !== owner) return { ok: false, reason: "other_task" };
        return { ok: true, value: entry.value, label: entry.label, expiresAt: entry.expiresAt };
      }
      return { ok: false, reason: expired.has(handle) ? "expired" : "missing" };
    },
    fingerprints: () => fingerprints,
  };
};

/** Nothing of the value in text the task will read: verbatim, then by fingerprint and pattern. */
export const scrubSecureValue = (
  text: string,
  value: string,
  known: SecretFingerprints,
): string =>
  redactSensitiveText(
    redactSecretFingerprints(
      value ? text.split(value).join(SECRET_REDACTION_MARK) : text,
      known,
    ),
  );

const clockTimeUtc = (at: number): string => {
  const date = new Date(at);
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")} UTC`;
};

const inside = (candidate: string, root: string): boolean => {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

export type CloudSecureCommandScope = Readonly<{
  identity: ToolProcessIdentity;
  workspaceRoot: string;
  toolHome: string;
}>;

/**
 * One command as the tool user (the same uid, no privileges and no
 * capabilities as the task's own shell), in the workspace, with the value in
 * one environment variable for that process alone. Nothing of the executor's
 * own environment goes with it.
 */
const runSecureCommand = async (args: {
  scope: CloudSecureCommandScope;
  command: string;
  cwd: string;
  value: string;
}): Promise<{ ok: boolean; status: number | null; output: string; timedOut: boolean }> => {
  const launch = isolateToolProcessLaunch({
    command: "/bin/sh",
    commandArgs: ["-c", args.command],
    identity: args.scope.identity,
  });
  return await new Promise((resolve) => {
    let output = "";
    let settled = false;
    const child = spawn(launch.command, launch.args, {
      cwd: args.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      env: {
        PATH: COMMAND_PATH,
        HOME: args.scope.identity.home,
        USER: args.scope.identity.user,
        LOGNAME: args.scope.identity.user,
        LANG: "C.UTF-8",
        TMPDIR: "/tmp",
        ...toolStateEnvironment(args.scope.toolHome),
        [SECURE_COMMAND_VALUE_ENV]: args.value,
      },
      ...(launch.nativeIdentity
        ? { uid: launch.nativeIdentity.uid, gid: launch.nativeIdentity.gid }
        : {}),
    });
    const append = (chunk: unknown) => {
      if (output.length >= COMMAND_OUTPUT_LIMIT) return;
      output += String(chunk).slice(0, COMMAND_OUTPUT_LIMIT - output.length);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    const finish = (result: { ok: boolean; status: number | null; output: string; timedOut: boolean }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
      finish({ ok: false, status: null, output, timedOut: true });
    }, COMMAND_TIMEOUT_MS);
    timer.unref?.();
    child.on("error", (error) =>
      finish({ ok: false, status: null, output: error.message, timedOut: false }),
    );
    child.on("close", (code) =>
      finish({ ok: code === 0, status: code, output, timedOut: false }),
    );
  });
};

const isReport = (value: unknown): value is SecureFillPageReport =>
  !!value && typeof value === "object" && Array.isArray((value as { landed?: unknown }).landed);

/**
 * Fill the cloud browser's field the way a computer fills its own: the
 * value goes in once through `fill`, and the page scripts find where it is by
 * a salted hash and its length (never the value), clear it from a wrong
 * field, and report where it landed.
 */
const fillCloudBrowserField = async (args: {
  browser: CloudBrowserBridge;
  target: Extract<SecureValueTarget, { kind: "browser_field" }>;
  value: string;
}): Promise<SecureFillOutcome> => {
  const signal = new AbortController().signal;
  if (args.target.tabId) {
    await args.browser.call("focusTab", [args.target.tabId], signal);
  }
  const tabId = args.target.tabId ?? "current";
  const mode: SecureFillMode = args.target.mode ?? "fill";
  const seed = randomInt(0, 2 ** 31);
  const hash = secureFillHash(args.value, seed);
  const inspect = async (
    clear?: "all" | "visible-not-target",
  ): Promise<SecureFillPageReport | null> => {
    try {
      const result = await args.browser.call(
        "evaluate",
        [
          secureFieldScript({
            hash,
            seed,
            length: args.value.length,
            ...(mode === "clear" ? {} : { selector: args.target.selector }),
            ...(clear ? { clear } : {}),
          }),
        ],
        signal,
      );
      return isReport(result) ? result : null;
    } catch {
      return null;
    }
  };
  let cleared = 0;
  if (mode === "move" || mode === "clear") cleared = (await inspect("all"))?.cleared ?? 0;
  if (mode === "clear") return { tabId, cleared };
  try {
    await args.browser.call("fill", [args.target.selector, args.value], signal);
  } catch (error) {
    await inspect("all");
    throw error;
  }
  const report = await inspect("visible-not-target");
  return {
    tabId,
    cleared,
    ...(report && report.cleared > 0 ? { clearedWrong: report.cleared } : {}),
    report,
  };
};

export const MISSING_HANDLE_NOTES = {
  expired:
    "That handle has expired (a cloud task holds a value for 30 minutes). Call request_secure_input again: a value the user saved comes back without asking them.",
  other_task: "That handle belongs to another task; ask for the value with request_secure_input.",
  missing:
    "This task holds no value behind that handle. A cloud task's handles last only until its turn ends; call request_secure_input again (a saved value comes back without asking the user). A handle from one of the user's computers works only there.",
} as const;

/** use_secure_value in a cloud task. */
export const useCloudSecureValue = async (args: {
  store: CloudSecureValueStore;
  owner: string;
  handle: string;
  target: SecureValueTarget;
  scope: CloudSecureCommandScope;
  browser?: CloudBrowserBridge;
}): Promise<SecureValueUseReceipt> => {
  const usedAt = Date.now();
  const receipt = (ok: boolean, detail: string): SecureValueUseReceipt => ({
    handle: args.handle,
    target: args.target.kind,
    usedAt,
    detail: detail.slice(0, RECEIPT_DETAIL_LIMIT),
    ok,
  });
  if (args.target.kind === "keychain") {
    return receipt(
      false,
      "A cloud task has no keychain: nothing it stores outlasts its turn. Fill the value into the page or command that needs it now; a value the user saved comes back from request_secure_input whenever it is needed again.",
    );
  }
  if (!isUserAskSecretHandle(args.handle)) {
    return receipt(false, "That is not a secure value handle.");
  }
  const resolved = args.store.resolve(args.handle, args.owner);
  if (!resolved.ok) return receipt(false, MISSING_HANDLE_NOTES[resolved.reason]);
  const { value } = resolved;
  const known = args.store.fingerprints();
  if (args.target.kind === "command") {
    const prepared = resolveSecureCommand(args.target.command, args.target.placeholder);
    if (!prepared.ok) return receipt(false, prepared.error);
    const cwd = args.target.cwd
      ? path.resolve(args.scope.workspaceRoot, args.target.cwd)
      : args.scope.workspaceRoot;
    if (!inside(cwd, args.scope.workspaceRoot)) {
      return receipt(false, `cwd must be inside the workspace (${args.scope.workspaceRoot}).`);
    }
    const result = await runSecureCommand({ scope: args.scope, command: prepared.command, cwd, value });
    const output = scrubSecureValue(result.output, value, known).trim();
    const status = result.timedOut
      ? "timed out"
      : result.status === null
        ? "failed to start"
        : `exit ${result.status}`;
    return receipt(result.ok, `${status}${output ? `\n${output}` : ""}`);
  }
  if (!args.browser) {
    return receipt(false, "This task has no cloud browser to fill.");
  }
  const mode: SecureFillMode = args.target.mode ?? "fill";
  try {
    const outcome = await fillCloudBrowserField({ browser: args.browser, target: args.target, value });
    const written = secureFillReceipt({
      label: resolved.label,
      selector: args.target.selector,
      mode,
      outcome,
      usableUntil: clockTimeUtc(resolved.expiresAt),
    });
    return receipt(written.ok, scrubSecureValue(written.detail, value, known));
  } catch (error) {
    return receipt(
      false,
      scrubSecureValue(
        (error as Error)?.message || "The browser field could not be filled.",
        value,
        known,
      ),
    );
  }
};
