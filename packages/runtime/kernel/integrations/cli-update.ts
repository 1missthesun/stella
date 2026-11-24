import { runCliCommand } from "./claude-cli-command.js";
import type { CliInstall, CliKeeper, CliRepairOutcome } from "./cli-keeper.js";

const UPDATE_TIMEOUT_MS = 20 * 60_000;

export type CliUpdateOutcome<Method extends string = string> =
  | { status: "not_installed" }
  | { status: "turned_off"; by: string; version: string | null }
  | { status: "current"; version: string | null; output: string }
  | { status: "updated"; from: string | null; version: string; output: string }
  | { status: "failed"; version: string | null; output: string }
  /** It couldn't start; Stella repaired it and it runs now. */
  | { status: "repaired"; version: string; problem: string; output: string }
  /** It can't start and Stella couldn't repair it. Turns run the last working copy, if any. */
  | {
      status: "unusable";
      problem: string;
      repair: CliRepairOutcome;
      method: Method;
      fallback: string | null;
    };

/**
 * Repairs an install that can't start and says how that went: "repaired"
 * once it starts again, else "unusable" with what the binary printed and what
 * the repair did.
 */
const repairUnusable = async <Method extends string>(
  keeper: CliKeeper<Method>,
  install: CliInstall<Method>,
  problem: string,
  env: NodeJS.ProcessEnv,
): Promise<CliUpdateOutcome<Method>> => {
  const repair = await keeper.repair(install, { env, force: true });
  const after = await keeper.inspect(env);
  if (after?.check.ok) {
    return {
      status: "repaired",
      version: after.check.version,
      problem,
      output: repair.status === "failed" ? repair.output : "",
    };
  }
  return {
    status: "unusable",
    problem: after && !after.check.ok ? after.check.problem : problem,
    repair,
    method: install.method,
    fallback: keeper.lastGoodVersion(env),
  };
};

/**
 * Keeps a CLI current and working. First it checks that the selected install
 * starts; one that doesn't is repaired, not updated. Then it runs the CLI's
 * own `update` through what PATH names. Whatever that leaves selected is
 * checked before Stella runs it: one that doesn't start is repaired, and
 * until then turns keep running the last one that did.
 */
export const updateCli = async <Method extends string>(
  keeper: CliKeeper<Method>,
  options: {
    env: NodeJS.ProcessEnv;
    commandEnv(executable: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
    turnedOffBy?(env: NodeJS.ProcessEnv): string | null;
  },
): Promise<CliUpdateOutcome<Method>> => {
  const { env } = options;
  const before = await keeper.inspect(env);
  if (!before) return { status: "not_installed" };
  if (!before.check.ok) {
    return await repairUnusable(keeper, before.install, before.check.problem, env);
  }
  const from = before.check.version;
  const by = options.turnedOffBy?.(env) ?? null;
  if (by) return { status: "turned_off", by, version: from };
  const launcher = before.install.launcher;
  // Not stopped when Stella quits: an update cut off midway (a version
  // manager downloading in the foreground) is what leaves an install broken.
  // Only a hang past the timeout is ended.
  const result = await runCliCommand(launcher, ["update"], {
    env: options.commandEnv(launcher, env),
    timeoutMs: UPDATE_TIMEOUT_MS,
  });
  const output = result.spawnError ? `${result.output}\n${result.spawnError}`.trim() : result.output;
  const after = await keeper.inspect(env);
  if (after && !after.check.ok) {
    return await repairUnusable(keeper, after.install, after.check.problem, env);
  }
  const version = after?.check.ok ? after.check.version : from;
  if (version && version !== from) {
    return { status: "updated", from, version, output };
  }
  return result.exitCode === 0
    ? { status: "current", version, output }
    : {
        status: "failed",
        version,
        output: result.timedOut ? `Timed out after ${UPDATE_TIMEOUT_MS / 60_000} minutes. ${output}` : output,
      };
};
