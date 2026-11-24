import { readFileSync } from "node:fs";
import path from "node:path";

const CLOUD = { file: "workers/cloud-builder/src/cloud-code-tool.ts", name: "CODE_EXCLUDED_TOOL_NAMES" };
const DEVICE = { file: "packages/runtime/kernel/computer-use/kernel.ts", name: "NODE_REPL_EXCLUDED_TOOL_NAMES" };

const members = (root, { file, name }) => {
  const text = readFileSync(path.join(root, file), "utf8");
  const match = new RegExp(`const ${name}\\b[^=]*=\\s*new Set\\(\\[([^\\]]*)\\]\\)`).exec(text);
  if (!match) return null;
  return match[1]
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .sort();
};

export async function check(root) {
  const cloud = members(root, CLOUD);
  const device = members(root, DEVICE);
  if (!cloud) return [`${CLOUD.file}: could not find ${CLOUD.name} = new Set([...])`];
  if (!device) return [`${DEVICE.file}: could not find ${DEVICE.name} = new Set([...])`];
  if (cloud.join("|") !== device.join("|")) {
    return [
      `${CLOUD.file} ${CLOUD.name} (${cloud.join(", ")}) must exclude the same tools from code as ${DEVICE.file} ${DEVICE.name} (${device.join(", ")})`,
    ];
  }
  return [];
}
