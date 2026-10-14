#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PREVIEW_WORKER = "stella-v2-cloud-builder-preview";
const WORKERS_DEV_SUBDOMAIN = "fromyou";
const DATABASE_PREFIX = "stella-v2-preview-";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wranglerBin = path.join(workerRoot, "node_modules", ".bin", "wrangler");
const args = process.argv.slice(2);
const command = args[0];
const option = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};

const fail = (message) => {
  console.error(`preview: ${message}`);
  process.exit(1);
};

const wranglerEnv = () => {
  const env = { ...process.env };
  delete env.CLOUDFLARE_API_TOKEN;
  return env;
};

const wrangler = (wranglerArgs, { input, capture = false, allowFailure = false } = {}) => {
  const result = spawnSync(wranglerBin, wranglerArgs, {
    cwd: workerRoot,
    env: wranglerEnv(),
    input,
    stdio: [input === undefined ? "inherit" : "pipe", capture ? "pipe" : "inherit", capture ? "pipe" : "inherit"],
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0 && !allowFailure) {
    if (capture) process.stderr.write(`${result.stdout ?? ""}${result.stderr ?? ""}`);
    fail(`wrangler ${wranglerArgs.slice(0, 3).join(" ")} failed.`);
  }
  return result;
};

const extraVars = () =>
  args.flatMap((arg, index) => (arg === "--var" && args[index + 1]?.includes(":") ? [args[index + 1]] : []));

const branchName = () => {
  const result = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: workerRoot, encoding: "utf8" });
  const branch = result.status === 0 ? result.stdout.trim() : "";
  return branch && branch !== "HEAD" ? branch : "";
};

const previewName = () => {
  const raw = option("name") ?? branchName();
  if (!raw) fail("pass --name <name> (no git branch to default to).");
  const name = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const maxLength = 63 - PREVIEW_WORKER.length - 1;
  if (!name || name.length > maxLength) {
    fail(`preview name "${name}" must be 1-${maxLength} characters of a-z, 0-9 and "-" (it prefixes the workers.dev hostname).`);
  }
  return name;
};

const previewUrl = (name) => `https://${name}-${PREVIEW_WORKER}.${WORKERS_DEV_SUBDOMAIN}.workers.dev`;
const databaseName = (name) => `${DATABASE_PREFIX}${name}`;

const listDatabases = () => {
  const result = wrangler(["d1", "list", "--json"], { capture: true });
  return JSON.parse(result.stdout).filter((database) => database.name.startsWith(DATABASE_PREFIX));
};

const ensureDatabase = (name) => {
  const existing = listDatabases().find((database) => database.name === databaseName(name));
  if (existing) return existing.uuid;
  wrangler(["d1", "create", databaseName(name)], { capture: true });
  const created = listDatabases().find((database) => database.name === databaseName(name));
  if (!created) fail(`could not create D1 database ${databaseName(name)}.`);
  return created.uuid;
};

const withGeneratedConfig = (name, contents, run) => {
  const file = path.join(workerRoot, `wrangler.preview-${name}-${process.pid}.jsonc`);
  writeFileSync(file, contents);
  try {
    return run(file);
  } finally {
    rmSync(file, { force: true });
  }
};

const up = () => {
  const name = previewName();
  const url = previewUrl(name);
  const databaseId = ensureDatabase(name);
  console.log(`preview: ${name} uses D1 ${databaseName(name)} (${databaseId}).`);

  const migrations = JSON.stringify({
    name: PREVIEW_WORKER,
    compatibility_date: "2026-07-22",
    d1_databases: [
      { binding: "DB", database_name: databaseName(name), database_id: databaseId, migrations_dir: "migrations" },
    ],
  });
  withGeneratedConfig(`${name}-migrations`, migrations, (config) =>
    wrangler(["d1", "migrations", "apply", databaseName(name), "--remote", "--config", config], { input: "y\n" }),
  );

  const source = readFileSync(path.join(workerRoot, "wrangler.jsonc"), "utf8");
  if (!source.includes("PREVIEW_D1_DATABASE_ID")) fail("wrangler.jsonc has no previews D1 placeholder.");
  const config = source
    .replaceAll("PREVIEW_D1_DATABASE_ID", databaseId)
    .replaceAll("PREVIEW_D1_DATABASE_NAME", databaseName(name));
  const result = withGeneratedConfig(name, config, (file) =>
    wrangler(
      [
        "preview",
        "--config",
        file,
        "--worker-name",
        PREVIEW_WORKER,
        "--name",
        name,
        "--message",
        `${branchName() || name} @ ${spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: workerRoot, encoding: "utf8" }).stdout.trim()}`,
        "--var",
        `CLOUD_BUILDER_PUBLIC_URL:${url}`,
        ...extraVars().flatMap((entry) => ["--var", entry]),
        "--json",
      ],
      { capture: true },
    ),
  );
  process.stderr.write(result.stderr ?? "");
  let deployed;
  try {
    deployed = JSON.parse(result.stdout.slice(result.stdout.search(/^\{$/m)));
  } catch {
    process.stdout.write(result.stdout);
    fail("could not read wrangler preview's JSON output.");
  }
  const urls = JSON.stringify(deployed);
  if (!urls.includes(new URL(url).hostname)) {
    console.error(JSON.stringify(deployed, null, 2));
    fail(`the Preview did not report ${url}; CLOUD_BUILDER_PUBLIC_URL would be wrong.`);
  }
  console.log(
    JSON.stringify({ preview: name, url, database: databaseName(name), deployment: deployed }, null, 2),
  );
  console.log(`\nexport STELLA_BACKEND_URL=${url}`);
};

const down = () => {
  const name = previewName();
  wrangler(["preview", "delete", "--worker-name", PREVIEW_WORKER, "--name", name, "--skip-confirmation"], {
    allowFailure: true,
  });
  const database = listDatabases().find((entry) => entry.name === databaseName(name));
  if (database) wrangler(["d1", "delete", databaseName(name), "--skip-confirmation"]);
  console.log(`preview: ${name} deleted.`);
};

const list = () => {
  for (const database of listDatabases()) {
    const name = database.name.slice(DATABASE_PREFIX.length);
    console.log(`${name}\t${previewUrl(name)}\t${database.created_at ?? ""}`);
  }
};

const devVar = (name) => {
  const file = path.join(workerRoot, ".dev.vars");
  if (!existsSync(file)) return "";
  const line = readFileSync(file, "utf8")
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim().replace(/^"(.*)"$/, "$1") : "";
};

const setupSecrets = () => {
  const keyFile = option("capability-key-file");
  if (!keyFile || !existsSync(keyFile)) {
    fail("pass --capability-key-file <PKCS8 PEM of the builder-preview-1 key>.");
  }
  const shared = (name) => {
    const value = process.env[name]?.trim() || devVar(name);
    if (!value) fail(`${name} is unset (environment or workers/cloud-builder/.dev.vars).`);
    return value;
  };
  const secrets = {
    CAPABILITY_SIGNING_KEY: readFileSync(keyFile, "utf8"),
    BUILDER_SERVICE_SECRET: shared("BUILDER_SERVICE_SECRET"),
    STELLA_ADMIN_API_SECRET: shared("STELLA_ADMIN_API_SECRET"),
    BETTER_AUTH_SECRET: randomBytes(32).toString("base64"),
    OWNER_SECRETS_KEK: randomBytes(32).toString("base64"),
    OAUTH_STATE_SECRET: randomBytes(32).toString("base64"),
    MEDIA_SIGNING_SECRET: randomBytes(32).toString("base64"),
  };
  const name = option("name");
  for (const [key, value] of Object.entries(secrets)) {
    wrangler(["preview", "base-config", "secret", "put", key, "--worker-name", PREVIEW_WORKER], {
      input: value,
      capture: true,
    });
    if (name) {
      wrangler(["preview", "secret", "put", key, "--worker-name", PREVIEW_WORKER, "--name", name], {
        input: value,
        capture: true,
      });
    }
    console.log(`preview: ${key} set${name ? ` (base config and ${name})` : " (base config)"}.`);
  }
};

const rotationSecrets = () => {
  const name = option("name");
  if (!name) fail("pass --name <name>: rotation secrets go on one Preview, never the base config.");
  const secrets = {
    BETTER_AUTH_SECRET_V2: randomBytes(48).toString("base64"),
    BUILDER_SERVICE_SECRET_V2: randomBytes(48).toString("base64"),
    OWNER_SECRETS_KEK_V2: randomBytes(32).toString("base64"),
  };
  for (const [key, value] of Object.entries(secrets)) {
    wrangler(["preview", "secret", "put", key, "--worker-name", PREVIEW_WORKER, "--name", previewName()], {
      input: value,
      capture: true,
    });
    console.log(`preview: ${key} set (${previewName()}).`);
  }
};

const commands = {
  up,
  down,
  list,
  url: () => console.log(previewUrl(previewName())),
  "setup-secrets": setupSecrets,
  "rotation-secrets": rotationSecrets,
};
if (!commands[command]) {
  console.error(
    "usage: bun run preview -- up|down|list|url [--name <name>] | setup-secrets --capability-key-file <pem> | rotation-secrets --name <name>",
  );
  process.exit(2);
}
commands[command]();
