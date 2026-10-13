import { buildDependencyBundle, type DepsBuildRequest } from "./deps.js";
import { loadDepTools } from "./tools.js";

/**
 * Builds one dependency bundle in a process of its own (see
 * `buildDependenciesApart` in deps.ts), then exits, so the memory rolldown
 * held for it goes back to the system. It may start before its request is
 * known: rolldown loads while the request (one JSON line on stdin) is on its
 * way, and a closed stdin with no request just ends it.
 */
const tools = loadDepTools();
tools.catch(() => undefined);

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  input += chunk;
});
process.stdin.on("end", () => {
  if (!input.trim()) process.exit(0);
  const request = JSON.parse(input) as DepsBuildRequest;
  buildDependencyBundle({
    ...request,
    loadTools: () => tools,
    log: (message) => process.stdout.write(`${message}\n`),
  }).then(
    () => process.exit(0),
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    },
  );
});
