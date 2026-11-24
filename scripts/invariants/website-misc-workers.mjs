import { readFileSync } from "node:fs";
import path from "node:path";

const parseJsonc = (text) =>
  JSON.parse(
    text
      .replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_, string) => string ?? "")
      .replace(/("(?:\\.|[^"\\])*")|,(?=\s*[}\]])/g, (_, string) => string ?? ""),
  );

export async function check(root) {
  const problems = [];
  const read = (...parts) => readFileSync(path.join(root, ...parts), "utf8");
  const wrangler = (worker) => parseJsonc(read("workers", worker, "wrangler.jsonc"));
  const environments = (config) => [["dev", config], ...Object.entries(config.env ?? {})];

  const attempts = Number(/DEAD_LETTER_MAX_ATTEMPTS = (\d+);/.exec(read("workers/model-gateway/src/usage-queue.ts"))?.[1]);
  for (const [env, config] of environments(wrangler("model-gateway"))) {
    const deadLetters = (config.queues?.consumers ?? []).filter(({ queue }) => /-dlq(-|$)/.test(queue));
    for (const { queue, max_retries } of deadLetters) {
      if (max_retries !== attempts) {
        problems.push(`model-gateway ${env}: ${queue} max_retries (${max_retries}) must equal DEAD_LETTER_MAX_ATTEMPTS (${attempts}) in usage-queue.ts`);
      }
    }
  }

  const namespaces = new Map();
  for (const [env, config] of environments(wrangler("telemetry"))) {
    for (const { name, namespace_id } of config.ratelimits ?? []) {
      const other = namespaces.get(namespace_id);
      if (other) problems.push(`telemetry: rate limiters ${other} and ${env}/${name} share namespace_id ${namespace_id}`);
      namespaces.set(namespace_id, `${env}/${name}`);
    }
  }

  const builder = wrangler("cloud-builder");
  for (const [env, config] of environments(wrangler("sites-host"))) {
    const host = (env === "dev" ? builder : builder.env?.[env])?.vars?.SITES_HOST;
    if (!(config.routes ?? []).some(({ pattern }) => pattern === `${host}/*`)) {
      problems.push(`sites-host ${env}: no route serves cloud-builder's SITES_HOST (${host})`);
    }
  }

  const preview = parseJsonc(read("packages", "website", "wrangler.problem-preview.jsonc"));
  if (
    preview.name !== "stella-website-problem-preview" ||
    "route" in preview ||
    "routes" in preview ||
    "env" in preview ||
    preview.vars?.NOINDEX !== "1"
  ) {
    problems.push("packages/website/wrangler.problem-preview.jsonc must stay its own unrouted worker with NOINDEX=1");
  }

  if (read("workers/canvas-share/src/index.ts").includes("allow-same-origin")) {
    problems.push("canvas-share: a shared page that runs scripts must never get allow-same-origin");
  }

  return problems;
}
