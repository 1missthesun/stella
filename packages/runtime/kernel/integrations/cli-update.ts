import { runCliCommand } from "./claude-cli-command.js";
import type { CliInstall, CliKeeper, CliRepairOutcome } from "./cli-keeper.js";

const UPDATE_TIMEOUT_MS = 20 * 60_000;

export type CliUpdateOutcome<Method extends string = string> =
  | { status: "not_installed" }
  | { status: "turned_off"; by: string; version: string | null }
  | { status: "current"; version: string | null; output: string }
  | { status: "updated"; from: string | null; version: string; output: string }
  | { status: "failed"; version: string | null; output: string }
  | { status: "repaired"; version: string; problem: string; output: string }
  | {
      status: "unusable";
      problem: string;
      repair: CliRepairOutcome;
      method: Method;
      fallback: string | null;
    };

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
