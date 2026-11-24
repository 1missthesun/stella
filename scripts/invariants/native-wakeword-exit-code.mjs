import { readFileSync } from "node:fs";
import path from "node:path";

const listener = "packages/native/wakeword/src/main.rs";
const service = "packages/desktop/electron/services/wakeword-service.ts";

export async function check(root) {
  const rust = readFileSync(path.join(root, listener), "utf8").match(/const INPUT_CHANGED_EXIT_CODE: i32 = (\d+);/);
  const ts = readFileSync(path.join(root, service), "utf8").match(/const INPUT_CHANGED_EXIT_CODE = (\d+);/);
  if (!rust) return [`${listener}: INPUT_CHANGED_EXIT_CODE not found`];
  if (!ts) return [`${service}: INPUT_CHANGED_EXIT_CODE not found`];
  if (rust[1] !== ts[1]) {
    return [`the wake-word listener exits with ${rust[1]} when its input changes, but the desktop app restarts it on ${ts[1]}`];
  }
  return [];
}
