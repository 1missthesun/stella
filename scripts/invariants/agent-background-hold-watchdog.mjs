import { readFileSync } from "node:fs";
import path from "node:path";

const HOLD = "packages/executor-cloud/src/native-agent-turn.ts";
const WATCHDOGS = [
  "workers/cloud-builder/src/build-session/container-turn.ts",
  "workers/cloud-builder/src/build-session/admission.ts",
];
const SEAL_HEADROOM_MS = 4 * 60_000;

const evaluate = (expression) => {
  if (!/^[\d_\s*]+$/u.test(expression)) return undefined;
  return expression
    .replaceAll("_", "")
    .split("*")
    .reduce((product, factor) => product * Number(factor.trim()), 1);
};

export async function check(root) {
  const problems = [];
  const holdSource = readFileSync(path.join(root, HOLD), "utf8");
  const hold = evaluate(
    holdSource.match(/const CLOUD_CLAUDE_BACKGROUND_HOLD_LIMIT_MS = ([^;]+);/u)?.[1] ?? "",
  );
  if (hold === undefined) return [`${HOLD}: CLOUD_CLAUDE_BACKGROUND_HOLD_LIMIT_MS is no longer a plain number`];
  for (const file of WATCHDOGS) {
    const source = readFileSync(path.join(root, file), "utf8");
    const watchdog = evaluate(source.match(/turn\.watchdogMs \?\? ([\d_\s*]+)\)/u)?.[1] ?? "");
    if (watchdog === undefined) {
      problems.push(`${file}: default turn watchdog (turn.watchdogMs ?? …) not found`);
    } else if (hold + SEAL_HEADROOM_MS > watchdog) {
      problems.push(
        `${HOLD}: a background hold of ${hold} ms leaves under ${SEAL_HEADROOM_MS} ms before ${file}'s ${watchdog} ms turn watchdog for sealing and checkpointing`,
      );
    }
  }
  return problems;
}
