import fs from "node:fs";
import path from "node:path";
import { forkTimeoutFiber } from "../cli/effect-runtime.js";
import { runCliCommand } from "./claude-cli-command.js";

/**
 * Which copy of a command-line AI (Claude Code, Google Antigravity) Stella
 * runs, and only one that has shown it runs. Each says where its installs are
 * and how each kind is repaired; checking, keeping the last working copy,
 * falling back to it and repairing are the same for both.
 */

const PROBE_TIMEOUT_MS = 15_000;
const FAILED_CHECK_TTL_MS = 30_000;
/** How long after a failed repair of the same binary Stella tries again by itself. */
const REPAIR_RETRY_MS = 30 * 60_000;
export const CLI_REPAIR_TIMEOUT_MS = 15 * 60_000;
const REPAIR_LOCK_STALE_MS = CLI_REPAIR_TIMEOUT_MS + 5 * 60_000;
const REPAIR_LOCK_POLL_MS = 2_000;
/** How long a turn with nothing else to run waits for a repair. */
const TURN_REPAIR_WAIT_MS = 10 * 60_000;
export const CLI_VERSION_PATTERN = /\b(\d+\.\d+\.\d+)\b/;

export type CliInstall<Method extends string = string> = {
  /** What PATH or the configured path names. */
  launcher: string;
  method: Method;
  /** What Stella runs: the launcher, or the binary behind a version manager's wrapper. */
  executable: string | null;
  /** Why there is no executable (the version manager couldn't name one). */
  problem?: string;
  /** The version manager's own program (mise). */
  manager?: string;
};

export type CliCheck = { ok: true; version: string } | { ok: false; problem: string };

export type CliLaunch = {
  executable: string;
  version: string;
  /** Changes whenever a different binary would run. */
  identity: string;
  /** Set when the selected one can't start and this is the last one that did. */
  fallback?: { selected: string; problem: string };
};

export type CliRepairOutcome =
  | { status: "repaired"; version: string; output: string }
  | { status: "failed"; output: string }
  | { status: "manual"; how: string }
  | { status: "skipped"; reason: string };

export type CliUnusable<Method extends string = string> = {
  install: CliInstall<Method> | null;
  problem: string;
  repair?: CliRepairOutcome;
};

export type SelectCliOptions = {
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  /**
   * What a broken install sets off: `wait` repairs it and, when there is no
   * working copy to run meanwhile, waits for the repair (a turn about to
   * start); `background` repairs it without waiting; `none` only reports.
   */
  repair?: "wait" | "background" | "none";
  /** Called once when the caller is about to wait for a repair. */
  onRepairing?: () => void;
};

export type CliKeeperSpec<Method extends string> = {
  /** The CLI's name in logs and messages. */
  label: string;
  log: string;
  /** Stella's folder for it under its data folder's cache. */
  stateDirectory: string;
  /** What a kept copy's file name starts with. */
  program: string;
  commandEnv(executable: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
  /** What PATH names; throws when none is installed and it's the person's to install. */
  currentInstall(env: NodeJS.ProcessEnv): Promise<CliInstall<Method>>;
  /** Why a version that runs still can't be used (too old), if so. */
  versionProblem?(version: string): string | undefined;
  /**
   * Why a version not run here before can't replace the kept one, if so.
   * Asked once per binary; what it accepts isn't asked about again.
   */
  selfCheck?(executable: string, kept: string, env: NodeJS.ProcessEnv): Promise<string | undefined>;
  repairable: readonly Method[];
  runRepair(install: CliInstall<Method>, env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<CliRepairOutcome>;
  afterRepair?(): void;
  manualRepair(install: CliInstall<Method> | null): string;
  unusable(detail: CliUnusable<Method>): Error;
};

export const cliRealPath = (file: string): string => {
  try {
    return fs.realpathSync(file);
  } catch {
    return path.resolve(file);
  }
};

const fileIdentity = (file: string): string | null => {
  try {
    const real = fs.realpathSync(file);
    const stat = fs.statSync(real);
    return `${real}:${stat.mtimeMs}:${stat.size}`;
  } catch {
    return null;
  }
};

const writeJson = (file: string, value: unknown) => {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temp, file);
};

/**
 * Whether the kept copy is whole and its own file. An older Stella kept a hard
 * link, which is damaged with the install it's meant to stand in for.
 */
const isSeparateCopy = (saved: string, source: string): boolean => {
  try {
    const copy = fs.statSync(saved, { bigint: true });
    const original = fs.statSync(source, { bigint: true });
    return copy.size === original.size && (copy.ino !== original.ino || copy.dev !== original.dev);
  } catch {
    return false;
  }
};

/** A program file that runs on its own: not a script that needs its package beside it. */
const isStandaloneProgram = (file: string): boolean => {
  try {
    const handle = fs.openSync(file, "r");
    try {
      const head = Buffer.alloc(4);
      fs.readSync(handle, head, 0, 4, 0);
      return head.subarray(0, 2).toString("latin1") !== "#!";
    } finally {
      fs.closeSync(handle);
    }
  } catch {
    return false;
  }
};

type LastGood = {
  version: string;
  /** Where it was installed. */
  binary: string;
  /** Stella's own copy of it, which no installer removes. */
  saved: string | null;
  verifiedAt: number;
};

type RepairRecord = { target: string; at: number; status: CliRepairOutcome["status"] };

const describeRunFailure = (
  executable: string,
  result: Awaited<ReturnType<typeof runCliCommand>>,
): string => {
  if (result.spawnError) return `can't be run (${result.spawnError}).`;
  if (result.timedOut) {
    return `didn't answer \`--version\` within ${PROBE_TIMEOUT_MS / 1000} seconds.`;
  }
  const printed = (result.stderr || result.stdout).trim();
  const code = result.exitCode ?? "unknown";
  return printed
    ? `exited with code ${code}: ${printed}`
    : `exited with code ${code} without printing anything.`;
};

export const createCliKeeper = <Method extends string>(spec: CliKeeperSpec<Method>) => {
  /**
   * Stella's own copy of the last CLI that ran, under its data folder. Only
   * where Stella has one (the desktop and headless Stella); a cloud container
   * keeps its own fallback in the image.
   */
  const stateDir = (env: NodeJS.ProcessEnv): string | null => {
    const data = env.STELLA_DATA_DIR?.trim() || process.env.STELLA_DATA_DIR?.trim();
    return data ? path.join(path.resolve(data), "cache", spec.stateDirectory) : null;
  };

  const checkCache = new Map<string, { check: CliCheck; at: number }>();

  /** Asks the binary for its version. Exit 0 with a version on stdout is a binary that runs. */
  const probe = async (
    executable: string,
    env: NodeJS.ProcessEnv = process.env,
    options: { fresh?: boolean } = {},
  ): Promise<CliCheck> => {
    const identity = fileIdentity(executable);
    if (!identity) {
      return { ok: false, problem: "doesn't exist." };
    }
    const cached = options.fresh ? undefined : checkCache.get(identity);
    if (cached && (cached.check.ok || Date.now() - cached.at < FAILED_CHECK_TTL_MS)) {
      return cached.check;
    }
    const result = await runCliCommand(executable, ["--version"], {
      env: spec.commandEnv(executable, env),
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    const version = result.exitCode === 0 ? CLI_VERSION_PATTERN.exec(result.stdout)?.[1] : undefined;
    const versionProblem = version
      ? (spec.versionProblem?.(version) ?? (await selfCheckProblem(executable, version, identity, env)))
      : undefined;
    const check: CliCheck =
      version && !versionProblem
        ? { ok: true, version }
        : { ok: false, problem: versionProblem ?? describeRunFailure(executable, result) };
    checkCache.set(identity, { check, at: Date.now() });
    return check;
  };

  /** A process started from this binary exited before it said anything: check it again next time. */
  const noteLaunchFailed = (executable: string): void => {
    const identity = fileIdentity(executable);
    if (identity) checkCache.delete(identity);
  };

  const lastGoodFile = (dir: string) => path.join(dir, "last-good.json");

  const readLastGood = (dir: string): LastGood | null => {
    try {
      const parsed = JSON.parse(fs.readFileSync(lastGoodFile(dir), "utf8")) as LastGood;
      return typeof parsed?.version === "string" && typeof parsed.binary === "string"
        ? parsed
        : null;
    } catch {
      return null;
    }
  };

  const acceptedFile = (dir: string) => path.join(dir, "accepted.json");

  /** The spec's self-check, where there is a kept copy of another version to fall back to. */
  const selfCheckProblem = async (
    executable: string,
    version: string,
    identity: string,
    env: NodeJS.ProcessEnv,
  ): Promise<string | undefined> => {
    const dir = spec.selfCheck ? stateDir(env) : null;
    if (!dir || !spec.selfCheck) return undefined;
    const kept = readLastGood(dir);
    if (!kept?.saved || kept.version === version || !fs.existsSync(kept.saved)) return undefined;
    if (cliRealPath(executable) === cliRealPath(kept.saved)) return undefined;
    try {
      if ((JSON.parse(fs.readFileSync(acceptedFile(dir), "utf8")) as { identity?: unknown }).identity === identity) {
        return undefined;
      }
    } catch {
      // None accepted yet.
    }
    const problem = await spec.selfCheck(executable, kept.saved, env);
    if (!problem) {
      try {
        writeJson(acceptedFile(dir), { identity, version, at: Date.now() });
      } catch {
        // Only spares asking again.
      }
    }
    return problem;
  };

  const saveCopy = async (dir: string, real: string, version: string): Promise<string | null> => {
    if (!isStandaloneProgram(real)) return null;
    const savedDir = path.join(dir, "last-good");
    await fs.promises.mkdir(savedDir, { recursive: true });
    const name = `${spec.program}-${version}${process.platform === "win32" ? ".exe" : ""}`;
    const target = path.join(savedDir, name);
    if (!isSeparateCopy(target, real)) {
      const temp = path.join(savedDir, `.${name}.${process.pid}.tmp`);
      try {
        await fs.promises.rm(temp, { force: true });
        // A clone where the file system can, a copy elsewhere.
        await fs.promises.copyFile(real, temp, fs.constants.COPYFILE_FICLONE);
        if (process.platform !== "win32") await fs.promises.chmod(temp, 0o755);
        // Windows won't replace a program that is running (an old hard link is
        // the installed one), but lets it be renamed; the loop below removes it
        // once it can.
        if (process.platform === "win32") {
          await fs.promises.rename(target, `${target}.${Date.now()}.old`).catch(() => undefined);
        }
        await fs.promises.rename(temp, target);
      } catch (error) {
        await fs.promises.rm(temp, { force: true }).catch(() => undefined);
        throw error;
      }
    }
    for (const entry of await fs.promises.readdir(savedDir)) {
      if (entry !== name && entry.startsWith(`${spec.program}-`)) {
        // One still running stays until a later save.
        await fs.promises.rm(path.join(savedDir, entry), { force: true }).catch(() => undefined);
      }
    }
    return target;
  };

  let saving: Promise<void> = Promise.resolve();

  /** Keeps this verified binary as the one to fall back to. */
  const rememberLastGood = (env: NodeJS.ProcessEnv, executable: string, version: string) => {
    const dir = stateDir(env);
    if (!dir) return;
    const real = cliRealPath(executable);
    const known = readLastGood(dir);
    if (
      known?.version === version &&
      known.binary === real &&
      (known.saved === null || isSeparateCopy(known.saved, real))
    ) {
      return;
    }
    saving = saving.then(async () => {
      try {
        await fs.promises.mkdir(dir, { recursive: true });
        let saved: string | null = null;
        try {
          saved = await saveCopy(dir, real, version);
        } catch (error) {
          console.warn(`[${spec.log}] couldn't keep a copy of the working ${spec.label}`, {
            binary: real,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        writeJson(lastGoodFile(dir), {
          version,
          binary: real,
          saved,
          verifiedAt: Date.now(),
        } satisfies LastGood);
      } catch (error) {
        console.warn(`[${spec.log}] couldn't record the working ${spec.label}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  };

  /** The last copy that ran here, if it still does. */
  const lastGoodLaunch = async (
    env: NodeJS.ProcessEnv,
    exclude: string | null,
  ): Promise<CliLaunch | null> => {
    const dir = stateDir(env);
    if (!dir) return null;
    await saving;
    const known = readLastGood(dir);
    if (!known) return null;
    const excluded = exclude ? cliRealPath(exclude) : null;
    for (const candidate of [known.binary, known.saved]) {
      if (!candidate || cliRealPath(candidate) === excluded) continue;
      const check = await probe(candidate, env);
      if (check.ok) {
        return {
          executable: candidate,
          version: check.version,
          identity: `${fileIdentity(candidate)}:${check.version}`,
        };
      }
    }
    return null;
  };

  /** The version Stella last saw run here, for anything that only needs to know. */
  const lastGoodVersion = (env: NodeJS.ProcessEnv = process.env): string | null => {
    const dir = stateDir(env);
    return dir ? (readLastGood(dir)?.version ?? null) : null;
  };

  const repairFile = (dir: string) => path.join(dir, "repair.json");

  const readRepair = (dir: string): RepairRecord | null => {
    try {
      return JSON.parse(fs.readFileSync(repairFile(dir), "utf8")) as RepairRecord;
    } catch {
      return null;
    }
  };

  const repairLock = (dir: string) => path.join(dir, "repair.lock");

  /** Held by a Stella process that is still running; one that quit or crashed midway holds nothing. */
  const repairLockHeld = (dir: string): boolean => {
    try {
      if (Date.now() - fs.statSync(repairLock(dir)).mtimeMs > REPAIR_LOCK_STALE_MS) return false;
    } catch {
      return false;
    }
    try {
      const owner = Number(fs.readFileSync(path.join(repairLock(dir), "owner"), "utf8"));
      if (!Number.isInteger(owner) || owner <= 0) return true;
      process.kill(owner, 0);
      return true;
    } catch (error) {
      // Not written yet, or the owner is another user's: held.
      return (error as NodeJS.ErrnoException).code !== "ESRCH";
    }
  };

  const takeRepairLock = (dir: string): boolean => {
    const lock = repairLock(dir);
    fs.mkdirSync(dir, { recursive: true });
    const take = () => {
      fs.mkdirSync(lock);
      fs.writeFileSync(path.join(lock, "owner"), String(process.pid));
      return true;
    };
    try {
      return take();
    } catch {
      try {
        if (!repairLockHeld(dir)) {
          fs.rmSync(lock, { recursive: true, force: true });
          return take();
        }
      } catch {
        // Another process took it in between.
      }
      return false;
    }
  };

  const releaseRepairLock = (dir: string) =>
    fs.rmSync(repairLock(dir), { recursive: true, force: true });

  const repairs = new Map<string, Promise<CliRepairOutcome>>();

  /**
   * Repairs the install the way it was made (the spec's `runRepair`). One repair at a time across Stella's processes; one that failed
   * isn't retried by itself for half an hour (`force` does).
   */
  const repairInstall = async (
    install: CliInstall<Method>,
    options: { env?: NodeJS.ProcessEnv; signal?: AbortSignal; force?: boolean } = {},
  ): Promise<CliRepairOutcome> => {
    const env = options.env ?? process.env;
    const dir = stateDir(env);
    if (!dir) return { status: "skipped", reason: `Stella keeps no ${spec.label} state here.` };
    if (!spec.repairable.includes(install.method)) {
      return { status: "manual", how: spec.manualRepair(install) };
    }
    const target = install.executable ?? install.launcher;
    const key = `${install.method}:${target}`;
    const running = repairs.get(key);
    if (running) return await running;
    const last = readRepair(dir);
    if (
      !options.force &&
      last?.target === key &&
      last.status !== "repaired" &&
      Date.now() - last.at < REPAIR_RETRY_MS
    ) {
      return { status: "skipped", reason: "A repair of this install failed a few minutes ago." };
    }
    const work = (async (): Promise<CliRepairOutcome> => {
      if (!takeRepairLock(dir)) {
        // Another Stella process is repairing: wait for it to finish.
        while (repairLockHeld(dir)) {
          if (options.signal?.aborted) return { status: "skipped", reason: "Stopped." };
          await new Promise<void>((resolve) => void forkTimeoutFiber(REPAIR_LOCK_POLL_MS, resolve));
        }
        return { status: "skipped", reason: "Repaired by another Stella process." };
      }
      try {
        console.warn(`[${spec.log}] repairing ${spec.label}`, { method: install.method, target });
        let outcome = await spec.runRepair(install, env, options.signal);
        if (outcome.status === "repaired") {
          const now = (await spec.currentInstall(env)).executable;
          const check = now ? await probe(now, env, { fresh: true }) : undefined;
          if (check && !check.ok) outcome = { status: "failed", output: check.problem };
        }
        try {
          writeJson(repairFile(dir), { target: key, at: Date.now(), status: outcome.status } satisfies RepairRecord);
        } catch {
          // Only spares a repeat attempt.
        }
        spec.afterRepair?.();
        console.warn(`[${spec.log}] repair finished`, {
          method: install.method,
          status: outcome.status,
          ...(outcome.status === "failed" ? { output: outcome.output.slice(-500) } : {}),
        });
        return outcome;
      } finally {
        releaseRepairLock(dir);
      }
    })().finally(() => repairs.delete(key));
    repairs.set(key, work);
    return await work;
  };

  const fallbacksNoted = new Set<string>();

  /**
   * The copy to run now. Throws the CLI's own "not found" error when none is
   * installed, and the spec's unusable error (with what the binary printed and
   * what to do) when the installed one can't start and nothing else can stand in.
   */
  const select = async (
    options: SelectCliOptions = {},
  ): Promise<CliLaunch> => {
    const env = options.env ?? process.env;
    const install = await spec.currentInstall(env);
    const target = install.executable;
    const check: CliCheck = target
      ? await probe(target, env)
      : { ok: false, problem: install.problem ?? "names no binary." };
    if (check.ok && target) {
      rememberLastGood(env, target, check.version);
      return {
        executable: target,
        version: check.version,
        identity: `${fileIdentity(target)}:${check.version}`,
      };
    }
    const problem = check.ok ? "" : check.problem;
    const mode = options.repair ?? "background";
    // Never tied to the caller's signal: a stopped turn must not cut off an
    // install midway, which is how an install ends up broken.
    const repair = mode === "none" ? null : repairInstall(install, { env });
    const fallback = await lastGoodLaunch(env, target);
    if (fallback) {
      const noted = `${target ?? install.launcher}>${fallback.identity}`;
      if (!fallbacksNoted.has(noted)) {
        fallbacksNoted.add(noted);
        console.warn(`[${spec.log}] running the last working ${spec.label} instead`, {
          selected: target ?? install.launcher,
          fallback: fallback.executable,
          version: fallback.version,
          problem: problem.slice(0, 500),
        });
      }
      void repair?.catch(() => undefined);
      return { ...fallback, fallback: { selected: target ?? install.launcher, problem } };
    }
    let outcome: CliRepairOutcome | undefined;
    if (repair && mode === "wait") {
      options.onRepairing?.();
      outcome = await Promise.race([
        repair,
        new Promise<CliRepairOutcome>((resolve, reject) => {
          const stopTimer = forkTimeoutFiber(TURN_REPAIR_WAIT_MS, () =>
            resolve({ status: "skipped", reason: "The repair is still running." }),
          );
          // Stopping the turn stops the wait, not the repair.
          options.signal?.addEventListener(
            "abort",
            () => {
              stopTimer();
              reject(options.signal?.reason ?? new Error("Stopped."));
            },
            { once: true },
          );
        }),
      ]);
      if (outcome.status === "repaired" || outcome.status === "skipped") {
        const again = await select({ ...options, repair: "none" }).catch(
          () => null,
        );
        if (again) return again;
      }
    } else {
      void repair?.catch(() => undefined);
    }
    const detail: CliUnusable<Method> = {
      install,
      problem,
      ...(outcome && outcome.status !== "skipped" ? { repair: outcome } : {}),
    };
    throw spec.unusable(detail);
  };

  /** What `select` would pick, without repairing anything: for checks that only look. */
  const inspect = async (
    env: NodeJS.ProcessEnv = process.env,
  ): Promise<{ install: CliInstall<Method>; check: CliCheck } | null> => {
    let install: CliInstall<Method>;
    try {
      install = await spec.currentInstall(env);
    } catch {
      return null;
    }
    const check: CliCheck = install.executable
      ? await probe(install.executable, env, { fresh: true })
      : { ok: false, problem: install.problem ?? "names no binary." };
    if (check.ok && install.executable) rememberLastGood(env, install.executable, check.version);
    return { install, check };
  };

  return { probe, noteLaunchFailed, lastGoodVersion, repair: repairInstall, select, inspect };
};

export type CliKeeper<Method extends string = string> = ReturnType<typeof createCliKeeper<Method>>;
