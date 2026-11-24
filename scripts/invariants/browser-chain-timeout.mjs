import { readFileSync } from "node:fs";
import path from "node:path";

const SOURCES = [
  ["packages/runtime/kernel/browser-use/protocol.ts", /export const MAX_BROWSER_CHAIN_TIMEOUT_MS = ([\d_ *]+);/],
  ["packages/stella-browser/cli/src/native/actions.rs", /const MAX_CHAIN_RUNTIME_MS: u64 = ([\d_ *]+);/],
];

function evaluate(expression) {
  return expression
    .split("*")
    .map((factor) => Number(factor.trim().replaceAll("_", "")))
    .reduce((product, factor) => product * factor, 1);
}

export async function check(root) {
  const problems = [];
  const values = [];
  for (const [file, pattern] of SOURCES) {
    const match = readFileSync(path.join(root, file), "utf8").match(pattern);
    if (!match) {
      problems.push(`${file}: chain timeout ceiling declaration not found`);
      continue;
    }
    values.push(`${file}=${evaluate(match[1])}`);
  }
  if (problems.length === 0 && new Set(values.map((entry) => entry.split("=")[1])).size > 1) {
    problems.push(`browser chain timeout ceiling differs: ${values.join(", ")}`);
  }
  return problems;
}
