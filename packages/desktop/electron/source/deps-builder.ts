import { buildDependencyBundle, type DepsBuildRequest } from "./deps.js";
import { loadDepTools } from "./tools.js";

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
