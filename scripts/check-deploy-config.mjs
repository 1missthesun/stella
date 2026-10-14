#!/usr/bin/env node
// Usage: node scripts/check-deploy-config.mjs <cloud-builder|model-gateway|canvas-share> [env]
// Fails a deploy whose Wrangler config breaks a deployment trust rule.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const stripJsonc = (text) => {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (inString) {
      out += char;
      if (char === "\\") {
        out += next;
        i += 1;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
    } else if (char === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      out += "\n";
    } else if (char === "/" && next === "*") {
      i = text.indexOf("*/", i + 2) + 1;
    } else {
      out += char;
    }
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
};

const readConfig = (worker) =>
  JSON.parse(stripJsonc(fs.readFileSync(path.join(root, "workers", worker, "wrangler.jsonc"), "utf8")));

const envConfig = (config, env) => {
  if (!env) return config;
  const named = config.env?.[env];
  if (!named) throw new Error(`No "${env}" environment in this Wrangler config.`);
  return named;
};

const PRODUCTION_FORBIDDEN_VARS = [
  "STELLA_TEST_ACCOUNTS",
  "STELLA_LOCAL_DEV_ORIGINS",
  "PREVIEW_BACKEND_HOST_SUFFIX",
  "ENABLE_DEV_ACCEPTANCE_PROBES",
];

/** Bindings the dev and production deployments intentionally share. */
const SHARED_ACROSS_ENVS = new Set(["r2:stella-canvas-shares"]);

const resourceIds = (config) => {
  const ids = new Map();
  for (const bucket of config.r2_buckets ?? []) ids.set(`r2:${bucket.bucket_name}`, bucket.binding);
  for (const db of config.d1_databases ?? []) ids.set(`d1:${db.database_id}`, db.binding);
  for (const kv of config.kv_namespaces ?? []) ids.set(`kv:${kv.id}`, kv.binding);
  for (const producer of config.queues?.producers ?? []) ids.set(`queue:${producer.queue}`, producer.binding);
  for (const consumer of config.queues?.consumers ?? []) {
    ids.set(`queue:${consumer.queue}`, "consumer");
    if (consumer.dead_letter_queue) ids.set(`queue:${consumer.dead_letter_queue}`, "dead letter");
  }
  return ids;
};

const parseJwks = (raw) => {
  const problems = [];
  let parsed;
  try {
    parsed = JSON.parse(raw ?? "");
  } catch {
    return { kids: [], problems: ["CAPABILITY_JWKS is not valid JSON."] };
  }
  const keys = Array.isArray(parsed?.keys) ? parsed.keys : [];
  if (keys.length === 0) problems.push("CAPABILITY_JWKS has no keys, so every capability would be refused.");
  for (const key of keys) {
    const jwk = key?.jwk ?? {};
    if (
      typeof key?.kid !== "string" ||
      key.issuer !== "stella-cloud-builder" ||
      jwk.kty !== "EC" ||
      jwk.crv !== "P-256" ||
      typeof jwk.x !== "string" ||
      typeof jwk.y !== "string"
    ) {
      problems.push(`CAPABILITY_JWKS key ${JSON.stringify(key?.kid)} is not a P-256 public key from stella-cloud-builder.`);
    }
    if ("d" in jwk) problems.push(`CAPABILITY_JWKS key ${JSON.stringify(key?.kid)} contains a private key.`);
  }
  return { kids: keys.map((key) => key?.kid), problems };
};

const check = (worker, env) => {
  const problems = [];
  const config = readConfig(worker);
  const target = envConfig(config, env);
  const production = env === "production" || (worker === "canvas-share" && !env);
  const vars = target.vars ?? {};

  if (production) {
    for (const name of PRODUCTION_FORBIDDEN_VARS) {
      if (name in vars) problems.push(`${name} is a dev/preview trust flag and must not be set in production.`);
    }
    for (const kv of target.kv_namespaces ?? []) {
      if (!/^[0-9a-f]{32}$/u.test(kv.id ?? "")) problems.push(`KV binding ${kv.binding} has a placeholder id "${kv.id}".`);
    }
    for (const db of target.d1_databases ?? []) {
      if (!/^[0-9a-f-]{36}$/u.test(db.database_id ?? "")) {
        problems.push(`D1 binding ${db.binding} has a placeholder id "${db.database_id}".`);
      }
    }
    if (env) {
      const devIds = resourceIds(config);
      for (const [id, binding] of resourceIds(target)) {
        if (devIds.has(id) && !SHARED_ACROSS_ENVS.has(id)) {
          problems.push(`Binding ${binding} uses ${id}, which the dev deployment also uses.`);
        }
      }
    }
  }

  if (worker === "model-gateway") {
    const jwks = parseJwks(vars.CAPABILITY_JWKS);
    problems.push(...jwks.problems);
    if (production) {
      if (jwks.kids.some((kid) => /preview|bn118/u.test(kid))) {
        problems.push("Production CAPABILITY_JWKS trusts a preview or acceptance signing key.");
      }
      const builderKid = envConfig(readConfig("cloud-builder"), "production").vars?.CAPABILITY_SIGNING_KID;
      if (!jwks.kids.includes(builderKid)) {
        problems.push(`Production CAPABILITY_JWKS lacks cloud-builder's production signing key "${builderKid}".`);
      }
    }
  }

  if (worker === "canvas-share" || (worker === "cloud-builder" && production)) {
    const share = readConfig("canvas-share");
    const shareHosts = (share.routes ?? []).map((route) => route.pattern);
    const builderVars = envConfig(readConfig("cloud-builder"), "production").vars ?? {};
    const shareHost = (() => {
      try {
        return new URL(builderVars.CANVAS_SHARE_BASE_URL).host;
      } catch {
        return null;
      }
    })();
    if (!shareHost || !shareHosts.includes(shareHost)) {
      problems.push(
        `cloud-builder production CANVAS_SHARE_BASE_URL (${builderVars.CANVAS_SHARE_BASE_URL}) is not a canvas-share route (${shareHosts.join(", ") || "none"}).`,
      );
    }
    if (worker === "canvas-share" && share.vars?.OWNER_SITE_URL !== builderVars.CANVAS_OWNER_SITE_URL) {
      problems.push(
        `canvas-share OWNER_SITE_URL (${share.vars?.OWNER_SITE_URL}) differs from cloud-builder production CANVAS_OWNER_SITE_URL (${builderVars.CANVAS_OWNER_SITE_URL}).`,
      );
    }
  }

  return problems;
};

const [worker, env] = process.argv.slice(2);
if (!["cloud-builder", "model-gateway", "canvas-share"].includes(worker ?? "")) {
  console.error("Usage: node scripts/check-deploy-config.mjs <cloud-builder|model-gateway|canvas-share> [env]");
  process.exit(2);
}
const problems = check(worker, env);
if (problems.length > 0) {
  console.error(`[check-deploy-config] ${worker}${env ? ` (${env})` : ""} is not safe to deploy:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`[check-deploy-config] ${worker}${env ? ` (${env})` : ""} ok`);
