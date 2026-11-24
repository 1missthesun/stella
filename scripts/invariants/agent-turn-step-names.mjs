import { readFileSync } from "node:fs";
import path from "node:path";

const EXECUTOR = "packages/executor-cloud/src/turn-timing.ts";
const BACKEND = "workers/cloud-builder/src/build-session/public-helpers.ts";

export async function check(root) {
  const executor = readFileSync(path.join(root, EXECUTOR), "utf8");
  const backend = readFileSync(path.join(root, BACKEND), "utf8");
  const executorPattern = executor.match(/const STEP_NAME = (\/[^\n]+\/u);/u)?.[1];
  if (!executorPattern) return [`${EXECUTOR} no longer declares STEP_NAME as a regex literal`];
  if (!backend.includes(`${executorPattern}.test(key)`)) {
    return [
      `${EXECUTOR} accepts turn step names matching ${executorPattern}, but ${BACKEND} no longer validates timing keys with that same pattern; a name it rejects drops the turn's whole timing log`,
    ];
  }
  return [];
}
