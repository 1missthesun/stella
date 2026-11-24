import { buildDependencyBundle, type DepsBuildRequest } from "./deps.js";
import { buildPageBundle, type PageBundleRequest } from "./page-bundle.js";
import { loadDepTools, loadOxcTools } from "./tools.js";

const tools = loadDepTools();
tools.catch(() => undefined);

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  input += chunk;
});
process.stdin.on("end", () => {
  if (!input.trim()) process.exit(0);
  const request = JSON.parse(input) as DepsBuildRequest | PageBundleRequest;
  const log = (message: string) => process.stdout.write(`${message}\n`);
  const build =
    request.kind === "page"
      ? buildPageBundle({
          request,
          loadTools: async () => ({ ...(await tools), ...(await loadOxcTools()) }),
          log,
        })
      : buildDependencyBundle({ ...request, loadTools: () => tools, log });
  build.then(
    () => process.exit(0),
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    },
  );
});
