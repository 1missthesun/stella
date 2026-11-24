import { readFileSync } from "node:fs";
import path from "node:path";

const dir = "packages/runtime/kernel/computer-use";

const constantValue = (source, name) => {
  const match = source.match(new RegExp(`const ${name} = ("[^"]*"|[\\d_]+);`));
  return match ? match[1] : null;
};

export async function check(root) {
  const read = (file) => readFileSync(path.join(root, dir, file), "utf8");
  const protocol = read("protocol.ts");
  const kernel = read("kernel.ts");
  const worker = read("kernel-worker.ts");
  const problems = [];

  for (const name of [
    "NODE_REPL_TOOL_SEARCH_NAME",
    "NODE_REPL_TOOL_DESCRIBE_NAME",
    "NODE_REPL_TOOL_HISTORY_NAME",
    "NODE_REPL_TOOL_MEMORY_NAME",
  ]) {
    const value = constantValue(protocol, name);
    if (!value) problems.push(`protocol.ts no longer declares ${name} as a string literal`);
    else if (!worker.includes(`callTool(${value}`)) {
      problems.push(`kernel-worker.ts never calls callTool(${value}) inline for protocol.ts ${name}`);
    }
  }

  const uncaught = constantValue(kernel, "NODE_REPL_UNCAUGHT_ERROR_NAME");
  if (!uncaught) problems.push("kernel.ts no longer declares NODE_REPL_UNCAUGHT_ERROR_NAME as a string literal");
  else if (!worker.includes(`uncaught.name = ${uncaught};`)) {
    problems.push(`kernel-worker.ts does not set uncaught.name = ${uncaught} inline (kernel.ts NODE_REPL_UNCAUGHT_ERROR_NAME)`);
  }

  const drain = constantValue(protocol, "DEFAULT_NODE_REPL_TOOL_DRAIN_TIMEOUT_MS");
  const fallback = worker.match(/workerData\.maxToolDrainWaitMs\s*:\s*([\d_]+);/);
  if (!drain) problems.push("protocol.ts no longer declares DEFAULT_NODE_REPL_TOOL_DRAIN_TIMEOUT_MS as a number literal");
  else if (!fallback || fallback[1] !== drain) {
    problems.push(`kernel-worker.ts drain-wait fallback ${fallback?.[1] ?? "(missing)"} differs from protocol.ts DEFAULT_NODE_REPL_TOOL_DRAIN_TIMEOUT_MS ${drain}`);
  }

  return problems;
}
