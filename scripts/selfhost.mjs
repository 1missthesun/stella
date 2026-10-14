#!/usr/bin/env bun
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir, platform, tmpdir, userInfo } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { generateCapabilityKeyPair } from "./lib/capability-keys.mjs";
import { qrSvg, qrTerminal } from "./lib/qr.mjs";

const HELP = `Run Stella on your own Cloudflare account.

  bun scripts/selfhost.mjs setup     Create or repair everything, deploy, and print a pairing QR
  bun scripts/selfhost.mjs update    Deploy the latest release (origin/master, or --ref <server-* tag>)
  bun scripts/selfhost.mjs pair      Print a new one-time pairing QR for another device
  bun scripts/selfhost.mjs recover   Lost every device? Rotate the admin key and print a pairing QR
  bun scripts/selfhost.mjs status    Show what is deployed and whether it is healthy
  bun scripts/selfhost.mjs destroy   Delete everything this install created (asks first)

Options
  --json                      One JSON line per step: {step,status,message,needsHuman?,url?}
  --prefix <name>             Names every worker, database, bucket and queue (default: stella)
  --name <text>               Your server's display name (setup; default: "My Stella")
  --account-id <id>           Cloudflare account to use when your login has several
  --subdomain <name>          workers.dev subdomain to register if the account has none
  --openrouter-key-file <f>   Optional OpenRouter key (or env OPENROUTER_API_KEY): read-aloud,
                              dictation and Stella's managed models
  --cloud-agent-hours <n>     Cap on cloud agent container hours per month (default 40, 0 = no cap)
  --cloud-agent-concurrency <n>  Cloud agents running at once (default 2)
  --ref <git ref>             update: deploy this ref instead of origin/master
  --no-fetch                  update: deploy this checkout as it is, without fetching
  --now                       update: skip the confirmation and the price-refresh wait
  --no-wait                   setup/pair: don't wait for a device to scan the code
  --yes                       destroy/update: don't ask for confirmation
  --verbose                   Stream wrangler's output to the terminal

State lives in ~/.config/stella-server/<accountId>-<prefix>.json (mode 600). Logs of every
run are in ~/.config/stella-server/logs/.`;

const ROOT = path.resolve(import.meta.dirname, "..");
const STATE_DIR = path.join(homedir(), ".config", "stella-server");
const LOG_DIR = path.join(STATE_DIR, "logs");
const CF_API = "https://api.cloudflare.com/client/v4";
const CAPABILITY_ISSUER = "stella-cloud-builder";
const CAPABILITY_KID = "builder-selfhost-1";
const WAIT_LIMIT_MS = 45 * 60_000;

const argv = process.argv.slice(2);
const command = argv.find((arg) => !arg.startsWith("--")) ?? "help";
const VALUE_FLAGS = new Set([
  "prefix",
  "name",
  "account-id",
  "subdomain",
  "openrouter-key-file",
  "ref",
  "cloud-agent-hours",
  "cloud-agent-concurrency",
]);
const options = {};
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (!arg.startsWith("--")) continue;
  const [key, inline] = arg.slice(2).split("=", 2);
  if (VALUE_FLAGS.has(key)) {
    options[key] = inline ?? argv[i + 1];
    if (inline === undefined) i += 1;
  } else {
    options[key] = true;
  }
}
const JSON_MODE = options.json === true;
const VERBOSE = options.verbose === true;
const PREFIX = String(options.prefix ?? process.env.STELLA_SELFHOST_PREFIX ?? "stella");

class Fatal extends Error {}

mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
const LOG_FILE = path.join(
  LOG_DIR,
  `${PREFIX}-${command}-${new Date().toISOString().replace(/[:.]/g, "-")}.log`,
);
const log = (text) => appendFileSync(LOG_FILE, text.endsWith("\n") ? text : `${text}\n`, { mode: 0o600 });

const COLORS = process.stdout.isTTY && !JSON_MODE;
const paint = (code, text) => (COLORS ? `\x1b[${code}m${text}\x1b[0m` : text);
const ICONS = {
  start: paint(36, "…"),
  ok: paint(32, "✓"),
  skip: paint(32, "✓"),
  waiting: paint(33, "!"),
  warn: paint(33, "!"),
  error: paint(31, "✗"),
  ready: paint(32, "★"),
  info: " ",
};

const emit = (step, status, message, extra = {}) => {
  const line = { step, status, message, ...extra };
  log(`[${new Date().toISOString()}] ${JSON.stringify(line)}`);
  if (JSON_MODE) {
    process.stdout.write(`${JSON.stringify(line)}\n`);
    return;
  }
  const head = `${ICONS[status] ?? " "} ${paint(1, step.padEnd(14))} ${message}`;
  console.log(head);
  if (extra.url && status !== "ready") console.log(`  ${paint(4, extra.url)}`);
};

const fail = (step, message, extra = {}) => {
  emit(step, "error", message, { log: LOG_FILE, ...extra });
  const error = new Fatal(message);
  error.reported = true;
  throw error;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const childEnv = (accountId) => {
  const env = { ...process.env, WRANGLER_SEND_METRICS: "false", NO_COLOR: "1", FORCE_COLOR: "0" };
  delete env.CLOUDFLARE_API_TOKEN;
  delete env.CLOUDFLARE_API_KEY;
  if (accountId) env.CLOUDFLARE_ACCOUNT_ID = accountId;
  return env;
};

const run = (cmd, args, { cwd = ROOT, input, accountId, quiet = false, secretOutput = false, timeoutMs } = {}) =>
  new Promise((resolve) => {
    if (!secretOutput) log(`$ ${cmd} ${args.join(" ")}  (in ${path.relative(ROOT, cwd) || "."})`);
    const child = spawn(cmd, args, { cwd, env: childEnv(accountId), stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timer = null;
    if (timeoutMs) timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (!secretOutput) log(String(chunk));
      if (VERBOSE && !quiet && !secretOutput && !JSON_MODE) process.stderr.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (!secretOutput) log(String(chunk));
      if (VERBOSE && !quiet && !secretOutput && !JSON_MODE) process.stderr.write(chunk);
    });
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      resolve({ status: 127, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on("close", (status) => {
      if (timer) clearTimeout(timer);
      resolve({ status: status ?? 1, stdout, stderr });
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });

const tail = (text, lines = 25) => text.trim().split("\n").slice(-lines).join("\n");

const which = (bin) => {
  const result = spawnSync(platform() === "win32" ? "where" : "which", [bin], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim().split("\n")[0] : null;
};

const openUrl = (url) => {
  if (JSON_MODE) return;
  const opener = platform() === "darwin" ? "open" : platform() === "win32" ? "explorer" : "xdg-open";
  try {
    spawn(opener, [url], { stdio: "ignore", detached: true }).unref();
  } catch {}
};

const waitFor = async (step, { message, url, check, intervalMs = 10_000, extra = {} }) => {
  emit(step, "waiting", message, { needsHuman: true, ...(url ? { url } : {}), ...extra });
  openUrl(url);
  const started = Date.now();
  let reminded = Date.now();
  while (Date.now() - started < WAIT_LIMIT_MS) {
    await sleep(intervalMs);
    const done = await check();
    if (done) return done;
    if (Date.now() - reminded > 5 * 60_000) {
      emit(step, "waiting", `Still waiting: ${message}`, { needsHuman: true, ...(url ? { url } : {}), ...extra });
      reminded = Date.now();
    }
  }
  return fail(step, `Gave up waiting after ${Math.round(WAIT_LIMIT_MS / 60_000)} minutes. Run the same command again when it's done; it picks up where it stopped.`);
};

const validatePrefix = (prefix) => {
  if (!/^[a-z][a-z0-9-]{1,28}[a-z0-9]$/.test(prefix)) {
    throw new Fatal("--prefix must be 3–30 characters of a-z, 0-9 and -, starting with a letter.");
  }
  if (prefix === "stella-v2" || prefix.startsWith("stella-v2-")) {
    throw new Fatal("--prefix can't be stella-v2 or start with stella-v2-: those names belong to Stella's own deployment.");
  }
};

const names = (prefix) => ({
  workers: {
    cloudBuilder: `${prefix}-cloud-builder`,
    modelGateway: `${prefix}-model-gateway`,
    browserGateway: `${prefix}-browser-gateway`,
    appsHost: `${prefix}-apps-host`,
    canvasShare: `${prefix}-share`,
    sites: `${prefix}-sites`,
  },
  appsAuth: `${prefix}-apps-auth`,
  container: `${prefix}-cloud-builder-sandbox-do`,
  d1: `${prefix}-db`,
  kv: {
    APP_ROUTES: `${prefix}-app-routes`,
    ASN_POLICY: `${prefix}-asn-policy`,
    CONFIG_SNAPSHOT: `${prefix}-gateway-config`,
    OWNER_ENFORCEMENT: `${prefix}-owner-enforcement`,
  },
  r2: {
    appBuilds: `${prefix}-app-builds`,
    agentHome: `${prefix}-agent-home`,
    conversationArchive: `${prefix}-conversation-archive`,
    worlds: `${prefix}-worlds`,
    drive: `${prefix}-drive`,
    media: `${prefix}-media`,
    canvasShares: `${prefix}-canvas-shares`,
    browserProfiles: `${prefix}-browser-profiles`,
  },
  queues: { usage: `${prefix}-gateway-usage`, usageDlq: `${prefix}-gateway-usage-dlq` },
  artifacts: `${prefix}-app`,
});

const N = names(PREFIX);

const statePath = (accountId) => path.join(STATE_DIR, `${accountId}-${PREFIX}.json`);

const readState = (accountId) => {
  const file = statePath(accountId);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
};

const writeState = (state) => {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  const file = statePath(state.accountId);
  state.updatedAt = new Date().toISOString();
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
};

const findStateAccounts = () => {
  if (!existsSync(STATE_DIR)) return [];
  return readdirSync(STATE_DIR)
    .filter((file) => file.endsWith(`-${PREFIX}.json`))
    .map((file) => file.slice(0, -`-${PREFIX}.json`.length))
    .filter((id) => /^[a-f0-9]{32}$/.test(id));
};

const wranglerBin = () => {
  const require = createRequire(path.join(ROOT, "workers", "cloud-builder", "package.json"));
  return path.join(path.dirname(require.resolve("wrangler/package.json")), "bin", "wrangler.js");
};

const nodeBin = () => which("node") ?? "node";

const wrangler = (args, opts = {}) => run(nodeBin(), [wranglerBin(), ...args], { cwd: path.join(ROOT, "workers", "cloud-builder"), ...opts });

let cfToken = null;
const loadToken = async () => {
  const result = await run(nodeBin(), [wranglerBin(), "auth", "token", "--json"], {
    cwd: path.join(ROOT, "workers", "cloud-builder"),
    secretOutput: true,
    quiet: true,
  });
  if (result.status !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout.slice(result.stdout.indexOf("{")));
    return typeof parsed.token === "string" && parsed.token ? parsed.token : null;
  } catch {
    return null;
  }
};

const cf = async (method, apiPath, body, { raw = false } = {}) => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!cfToken) cfToken = await loadToken();
    if (!cfToken) throw new Fatal("Not signed in to Cloudflare (wrangler login).");
    const response = await fetch(`${CF_API}${apiPath}`, {
      method,
      headers: {
        authorization: `Bearer ${cfToken}`,
        ...(body !== undefined && !raw ? { "content-type": "application/json" } : {}),
      },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
    if (response.status === 401 && attempt === 0) {
      cfToken = null;
      continue;
    }
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    log(`cf ${method} ${apiPath} → ${response.status}${json?.success === false ? ` ${JSON.stringify(json.errors)}` : ""}`);
    return { status: response.status, ok: response.ok && json?.success !== false, json, text };
  }
  throw new Fatal("Cloudflare rejected the login token.");
};

const cfErrors = (res) =>
  (res.json?.errors ?? []).map((error) => `${error.code ?? ""} ${error.message ?? ""}`.trim()).join("; ") ||
  res.text.slice(0, 300);

const cfList = async (apiPath, pick = (json) => json.result) => {
  const items = [];
  for (let page = 1; page < 50; page += 1) {
    const sep = apiPath.includes("?") ? "&" : "?";
    const res = await cf("GET", `${apiPath}${sep}page=${page}&per_page=100`);
    if (!res.ok) throw new Fatal(`Cloudflare API ${apiPath}: ${cfErrors(res)}`);
    const batch = pick(res.json) ?? [];
    items.push(...batch);
    const info = res.json.result_info;
    if (!info || batch.length === 0 || (info.total_pages && page >= info.total_pages) || batch.length < 100) break;
  }
  return items;
};

const stripJsonc = (text) => {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === "\\") {
        out += text[i + 1];
        i += 1;
      } else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 1;
    } else out += c;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
};

const readWorkerConfig = (worker) => {
  const raw = JSON.parse(stripJsonc(readFileSync(path.join(ROOT, "workers", worker, "wrangler.jsonc"), "utf8")));
  const { env, previews, $schema, ...base } = raw;
  return structuredClone({ ...base, ...(env?.production ?? {}) });
};

const gitOut = (args) => {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
};

const releaseInfo = () => {
  const commit = gitOut(["rev-parse", "HEAD"]);
  if (!commit) throw new Fatal(`${ROOT} is not a git checkout of Stella. Clone https://github.com/1missthesun/stella-v2 and run this from it.`);
  const dirty = Boolean(gitOut(["status", "--porcelain", "--untracked-files=no"]));
  const tag = dirty ? null : gitOut(["describe", "--tags", "--exact-match", "--match", "server-*", "HEAD"]);
  return { commit, dirty, version: tag ?? `${commit.slice(0, 12)}${dirty ? " with local changes" : ""}` };
};

const ratelimitNamespace = (prefix) => String(100_000 + (createHash("sha256").update(prefix).digest().readUInt32BE(0) % 800_000));

const hex = () => randomBytes(32).toString("hex");
const base64 = () => randomBytes(32).toString("base64");
const base64url = () => randomBytes(32).toString("base64url");

const urlsFor = (subdomain) => {
  const at = (worker) => `https://${worker}.${subdomain}.workers.dev`;
  return {
    backend: at(N.workers.cloudBuilder),
    modelGateway: at(N.workers.modelGateway),
    appsHost: at(N.workers.appsHost),
    appsAuth: at(N.appsAuth),
    canvasShare: at(N.workers.canvasShare),
    sites: at(N.workers.sites),
  };
};

const GEN_DIR = path.join(ROOT, ".selfhost", PREFIX);

const absolutize = (worker, cfg) => {
  const dir = path.join(ROOT, "workers", worker);
  const abs = (value) => (typeof value === "string" && !path.isAbsolute(value) ? path.join(dir, value) : value);
  if (cfg.main) cfg.main = abs(cfg.main);
  if (cfg.base_dir) cfg.base_dir = abs(cfg.base_dir);
  if (cfg.build) {
    cfg.build = { ...cfg.build, cwd: dir };
    delete cfg.build.watch_dir;
  }
  if (cfg.assets?.directory) cfg.assets.directory = abs(cfg.assets.directory);
  for (const db of cfg.d1_databases ?? []) if (db.migrations_dir) db.migrations_dir = abs(db.migrations_dir);
  for (const container of cfg.containers ?? []) {
    if (container.image && !container.image.includes(":") && !container.image.includes("@")) container.image = abs(container.image);
    for (const image of Object.values(container.images ?? {})) {
      if (image.dockerfile) image.dockerfile = abs(image.dockerfile);
      if (image.build_context) image.build_context = abs(image.build_context);
    }
  }
  return cfg;
};

const commonWorker = (cfg, name) => {
  cfg.name = name;
  delete cfg.routes;
  delete cfg.route;
  cfg.preview_urls = false;
  return cfg;
};

const buildConfigs = (state, { billing }) => {
  const urls = state.urls;
  const r = state.resources;
  const configs = {};

  const cb = commonWorker(absolutize("cloud-builder", readWorkerConfig("cloud-builder")), N.workers.cloudBuilder);
  cb.workers_dev = true;
  const vars = { ...cb.vars };
  for (const key of [
    "STELLA_AUTH_URL",
    "STELLA_TEST_ACCOUNTS",
    "STELLA_LOCAL_DEV_ORIGINS",
    "SLACK_ENVIRONMENTS",
    "STELLA_EMAIL_FROM",
    "ENABLE_DEV_ACCEPTANCE_PROBES",
    "STELLA_DEPLOYMENT_IDENTITY",
  ]) delete vars[key];
  Object.assign(vars, {
    TELEMETRY_ENVIRONMENT: "production",
    APPS_HOST_BASE_URL: urls.appsHost,
    TRUSTED_APPS_HOST_BASE_URL: urls.appsAuth,
    MODEL_GATEWAY_URL: urls.modelGateway,
    CAPABILITY_SIGNING_KID: CAPABILITY_KID,
    CLOUD_BUILDER_PUBLIC_URL: urls.backend,
    R2_S3_ENDPOINT: `https://${state.accountId}.r2.cloudflarestorage.com`,
    R2_DRIVE_BUCKET: N.r2.drive,
    R2_MEDIA_BUCKET: N.r2.media,
    R2_BACKUP_BUCKET: N.r2.appBuilds,
    CANVAS_SHARE_BASE_URL: urls.canvasShare,
    CANVAS_OWNER_SITE_URL: "",
    SITES_HOST: "",
    SITES_SHARED_ORIGIN: urls.sites,
    ADMIN_ACCESS_TEAM_DOMAIN: "off",
    ADMIN_ACCESS_AUD: "off",
    STELLA_OWNER_MODE: "1",
      STELLA_CLOUD_AGENT_MONTHLY_HOURS: String(state.caps?.monthlyHours ?? 40),
    STELLA_CLOUD_AGENT_MAX_CONCURRENT: String(state.caps?.maxConcurrent ?? 2),
  });
  cb.vars = vars;
  delete cb.send_email;
  cb.artifacts = [{ binding: "ARTIFACTS", namespace: N.artifacts }];
  cb.services = (cb.services ?? [])
    .filter((service) => service.binding !== "TELEMETRY")
    .map((service) => {
      if (service.binding === "BROWSER_GATEWAY") return { ...service, service: N.workers.browserGateway };
      if (service.binding.startsWith("MODEL_GATEWAY")) return { ...service, service: N.workers.modelGateway };
      throw new Fatal(`cloud-builder has a service binding this script doesn't know: ${service.binding}. Update scripts/selfhost.mjs.`);
    });
  const bucketFor = {
    APP_BUILDS: N.r2.appBuilds,
    BACKUP_BUCKET: N.r2.appBuilds,
    AGENT_HOME: N.r2.agentHome,
    CONVERSATION_ARCHIVE: N.r2.conversationArchive,
    WORLDS_BUCKET: N.r2.worlds,
    DRIVE: N.r2.drive,
    MEDIA: N.r2.media,
    CANVAS_SHARES: N.r2.canvasShares,
  };
  cb.r2_buckets = (cb.r2_buckets ?? []).map((bucket) => {
    if (!bucketFor[bucket.binding]) throw new Fatal(`cloud-builder has an R2 binding this script doesn't know: ${bucket.binding}.`);
    return { binding: bucket.binding, bucket_name: bucketFor[bucket.binding] };
  });
  cb.d1_databases = (cb.d1_databases ?? []).map((db) => ({ ...db, database_name: N.d1, database_id: r.d1.id }));
  cb.kv_namespaces = (cb.kv_namespaces ?? []).map((kv) => {
    if (!r.kv[kv.binding]) throw new Fatal(`cloud-builder has a KV binding this script doesn't know: ${kv.binding}.`);
    return { binding: kv.binding, id: r.kv[kv.binding] };
  });
  cb.containers = (cb.containers ?? []).map((container) => ({ ...container, name: N.container }));
  cb.durable_objects = {
    bindings: (cb.durable_objects?.bindings ?? []).map((binding) =>
      binding.script_name ? { ...binding, script_name: N.workers.modelGateway } : binding,
    ),
  };
  if (cb.secrets?.required) {
    cb.secrets.required = cb.secrets.required.filter((name) => !["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"].includes(name));
  }
  configs["cloud-builder"] = cb;

  const mg = commonWorker(absolutize("model-gateway", readWorkerConfig("model-gateway")), N.workers.modelGateway);
  mg.workers_dev = true;
  const mgVars = { ...mg.vars };
  delete mgVars.PREVIEW_BACKEND_HOST_SUFFIX;
  delete mgVars.STELLA_TEST_ACCOUNTS;
  mgVars.STELLA_BACKEND_URL = urls.backend;
  mgVars.CAPABILITY_JWKS = state.capabilityJwks;
  mgVars.STELLA_OWNER_MODE = "1";
  mg.vars = mgVars;
  mg.services = billing
    ? (mg.services ?? []).map((service) => {
        if (service.binding !== "BILLING") throw new Fatal(`model-gateway has a service binding this script doesn't know: ${service.binding}.`);
        return { ...service, service: N.workers.cloudBuilder };
      })
    : [];
  mg.kv_namespaces = (mg.kv_namespaces ?? []).map((kv) => {
    if (!r.kv[kv.binding]) throw new Fatal(`model-gateway has a KV binding this script doesn't know: ${kv.binding}.`);
    return { binding: kv.binding, id: r.kv[kv.binding] };
  });
  mg.queues = {
    producers: (mg.queues?.producers ?? []).map((producer) => ({ ...producer, queue: N.queues.usage })),
    consumers: (mg.queues?.consumers ?? []).map((consumer) => ({
      ...consumer,
      queue: N.queues.usage,
      dead_letter_queue: N.queues.usageDlq,
    })),
  };
  mg.ratelimits = (mg.ratelimits ?? []).map((limit, index) => ({
    ...limit,
    namespace_id: String(Number(ratelimitNamespace(PREFIX)) + index),
  }));
  if (mg.secrets?.required) mg.secrets.required = mg.secrets.required.filter((name) => name !== "OPENROUTER_API_KEY");
  configs["model-gateway"] = mg;

  const bg = commonWorker(absolutize("browser-gateway", readWorkerConfig("browser-gateway")), N.workers.browserGateway);
  bg.workers_dev = false;
  bg.r2_buckets = (bg.r2_buckets ?? []).map((bucket) => ({ ...bucket, bucket_name: N.r2.browserProfiles }));
  configs["browser-gateway"] = bg;

  const ah = commonWorker(absolutize("apps-host", readWorkerConfig("apps-host")), N.workers.appsHost);
  ah.workers_dev = true;
  ah.services = (ah.services ?? []).map((service) => ({ ...service, service: N.workers.cloudBuilder }));
  configs["apps-host"] = ah;

  const cs = commonWorker(absolutize("canvas-share", readWorkerConfig("canvas-share")), N.workers.canvasShare);
  cs.workers_dev = true;
  cs.vars = { ...cs.vars, OWNER_SITE_URL: "" };
  cs.r2_buckets = (cs.r2_buckets ?? []).map((bucket) => ({ ...bucket, bucket_name: N.r2.canvasShares }));
  configs["canvas-share"] = cs;

  const sh = commonWorker(absolutize("sites-host", readWorkerConfig("sites-host")), N.workers.sites);
  sh.workers_dev = true;
  sh.vars = { ...sh.vars, SITES_APEX: "" };
  sh.services = (sh.services ?? []).map((service) => ({ ...service, service: N.workers.cloudBuilder }));
  configs["sites-host"] = sh;

  for (const cfg of Object.values(configs)) {
    cfg.account_id = state.accountId;
    const text = JSON.stringify(cfg).split(ROOT).join("<root>");
    const foreign = [
      ...(text.match(/stella-v2-[a-z0-9-]+|stella(?:share|sites)\.app|auth(?:-dev)?\.stella\.sh/g) ?? []),
      ...[...text.matchAll(/https:\/\/([a-z0-9-]+)\.[a-z0-9-]+\.workers\.dev/g)]
        .filter((match) => !match[1].startsWith(`${PREFIX}-`))
        .map((match) => match[0]),
    ];
    if (foreign.length) {
      throw new Fatal(`Generated config for ${cfg.name} still names Stella's own deployment (${foreign[0]}). Update scripts/selfhost.mjs.`);
    }
  }
  return configs;
};

const writeConfigs = (configs) => {
  mkdirSync(GEN_DIR, { recursive: true });
  writeFileSync(path.join(ROOT, ".selfhost", ".gitignore"), "*\n");
  const files = {};
  for (const [worker, cfg] of Object.entries(configs)) {
    const file = path.join(GEN_DIR, `${worker}.json`);
    writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`);
    files[worker] = file;
  }
  return files;
};

const preflight = async () => {
  const step = "preflight";
  const nodeVersion = spawnSync("node", ["--version"], { encoding: "utf8" });
  const nodeMajor = Number(/^v(\d+)/.exec(nodeVersion.stdout ?? "")?.[1] ?? 0);
  if (nodeMajor < 22) {
    fail(step, "Node.js 22 or newer is needed (wrangler and the build scripts run on it).", {
      needsHuman: true,
      url: "https://nodejs.org/en/download",
    });
  }
  const bunVersion = spawnSync("bun", ["--version"], { encoding: "utf8" });
  if (bunVersion.status !== 0) {
    fail(step, "Bun is needed: curl -fsSL https://bun.sh/install | bash", { needsHuman: true, url: "https://bun.sh" });
  }
  if (!which("git")) fail(step, "git is needed.", { needsHuman: true });
  let hasWrangler = true;
  try {
    wranglerBin();
  } catch {
    hasWrangler = false;
  }
  if (!hasWrangler) {
    emit(step, "start", "Installing the server's dependencies (bun run deps backend)…");
    const result = await run("bun", ["run", "deps", "backend"], { timeoutMs: 20 * 60_000 });
    if (result.status !== 0) fail(step, `bun run deps backend failed:\n${tail(result.stderr || result.stdout)}`);
  }
  emit(step, "ok", `node ${nodeVersion.stdout.trim()}, bun ${bunVersion.stdout.trim()}, wrangler ready`);
};

const dockerReady = async () => {
  if (!which("docker")) return { ok: false, reason: "missing" };
  const result = await run("docker", ["info", "--format", "{{.ServerVersion}}"], { quiet: true, timeoutMs: 20_000 });
  return result.status === 0 ? { ok: true, version: result.stdout.trim() } : { ok: false, reason: "stopped" };
};

const ensureDocker = async () => {
  const step = "docker";
  let state = await dockerReady();
  if (state.ok) {
    emit(step, "ok", `Docker ${state.version} is running`);
    return;
  }
  const mac = platform() === "darwin";
  const how =
    state.reason === "missing"
      ? mac
        ? "Docker is needed to build the cloud agents' sandbox image. Install Docker Desktop (https://www.docker.com/products/docker-desktop/) and open it once, or install colima: brew install colima docker && colima start --vm-type vz --vz-rosetta"
        : "Docker is needed to build the cloud agents' sandbox image. Install Docker Engine (https://docs.docker.com/engine/install/) and start it."
      : mac
        ? "Docker is installed but not running. Open Docker Desktop (or run: colima start) and wait until it says it's running."
        : "Docker is installed but not running. Start it (sudo systemctl start docker) and make sure your user can run `docker info`.";
  await waitFor(step, {
    message: how,
    url: state.reason === "missing" ? (mac ? "https://www.docker.com/products/docker-desktop/" : "https://docs.docker.com/engine/install/") : undefined,
    check: async () => {
      state = await dockerReady();
      return state.ok ? state : null;
    },
  });
  emit(step, "ok", `Docker ${state.version} is running`);
};

const ensureLogin = async () => {
  const step = "login";
  cfToken = await loadToken();
  if (cfToken) {
    const accounts = await cf("GET", "/accounts?per_page=50");
    if (accounts.ok) {
      emit(step, "ok", "Signed in to Cloudflare");
      return;
    }
    log(`token check failed: ${accounts.status}`);
    cfToken = null;
  }
  emit(step, "start", "Signing in to Cloudflare (wrangler login)…");
  const child = spawn(nodeBin(), [wranglerBin(), "login", "--browser=false"], {
    cwd: path.join(ROOT, "workers", "cloud-builder"),
    env: childEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let announced = false;
  let output = "";
  const onData = (chunk) => {
    output += chunk;
    const match = /(https:\/\/dash\.cloudflare\.com\/oauth2\/auth\S+)/.exec(output);
    if (match && !announced) {
      announced = true;
      emit(step, "waiting", "Open this link and allow wrangler access to your Cloudflare account (create a free account there if you don't have one).", {
        needsHuman: true,
        url: match[1],
      });
      openUrl(match[1]);
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  const status = await new Promise((resolve) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), WAIT_LIMIT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  log(output.replace(/https:\/\/dash\.cloudflare\.com\/oauth2\/auth\S+/g, "<login url>"));
  cfToken = await loadToken();
  if (status !== 0 || !cfToken) fail(step, "Cloudflare sign-in didn't finish. Run the command again to retry.");
  emit(step, "ok", "Signed in to Cloudflare");
};

const resolveAccount = async () => {
  const step = "account";
  const accounts = await cfList("/accounts");
  if (accounts.length === 0) fail(step, "This Cloudflare login has no accounts.");
  let account;
  const wanted = options["account-id"] ?? process.env.CLOUDFLARE_ACCOUNT_ID;
  if (wanted) {
    account = accounts.find((entry) => entry.id === wanted);
    if (!account) fail(step, `Account ${wanted} isn't one this login can use.`);
  } else if (accounts.length === 1) {
    account = accounts[0];
  } else {
    const known = findStateAccounts().filter((id) => accounts.some((entry) => entry.id === id));
    if (known.length === 1) account = accounts.find((entry) => entry.id === known[0]);
    else
      fail(step, `This login can use several accounts; pass --account-id with one of: ${accounts.map((entry) => `${entry.id} (${entry.name})`).join(", ")}`, {
        accounts: accounts.map((entry) => ({ id: entry.id, name: entry.name })),
      });
  }
  emit(step, "ok", `${account.name} (${account.id})`);
  return account;
};

const workersPaid = async (accountId) => {
  const res = await cf("GET", `/accounts/${accountId}/containers/me`);
  return res.ok && Number(res.json?.result?.limits?.total_vcpu ?? 0) > 0;
};

const ensureWorkersPaid = async (accountId) => {
  const step = "workers-paid";
  if (await workersPaid(accountId)) {
    emit(step, "ok", "Workers Paid plan is active");
    return;
  }
  await waitFor(step, {
    message:
      "Stella needs the Workers Paid plan ($5/month plus usage) for containers and Durable Objects. Open the page, choose Workers Paid and add a payment method.",
    url: `https://dash.cloudflare.com/${accountId}/workers/plans`,
    check: () => workersPaid(accountId),
    intervalMs: 15_000,
  });
  emit(step, "ok", "Workers Paid plan is active");
};

const ensureSubdomain = async (accountId, state) => {
  const step = "subdomain";
  const res = await cf("GET", `/accounts/${accountId}/workers/subdomain`);
  let subdomain = res.ok ? res.json?.result?.subdomain : null;
  if (!subdomain) {
    const base = String(options.subdomain ?? `${userInfo().username || "stella"}`)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    const candidates = options.subdomain ? [base] : [`${base}-stella`, `${base}-stella-${randomBytes(2).toString("hex")}`, `stella-${randomBytes(4).toString("hex")}`];
    for (const candidate of candidates) {
      const put = await cf("PUT", `/accounts/${accountId}/workers/subdomain`, { subdomain: candidate });
      if (put.ok) {
        subdomain = put.json?.result?.subdomain ?? candidate;
        emit(step, "ok", `Registered ${subdomain}.workers.dev (new subdomains can take a few minutes to start answering)`);
        break;
      }
      log(`subdomain ${candidate} refused: ${cfErrors(put)}`);
    }
    if (!subdomain) fail(step, "Couldn't register a workers.dev subdomain. Pick one with --subdomain <name>, or set it in the dashboard.", {
      needsHuman: true,
      url: `https://dash.cloudflare.com/${accountId}/workers/subdomain`,
    });
  } else {
    emit(step, "ok", `${subdomain}.workers.dev`);
  }
  if (state.subdomain && state.subdomain !== subdomain) {
    emit(step, "warn", `The account's workers.dev subdomain changed from ${state.subdomain} to ${subdomain}; every URL moves with it.`);
  }
  return subdomain;
};

const r2Enabled = async (accountId) => {
  const res = await cf("GET", `/accounts/${accountId}/r2/buckets?per_page=1`);
  if (res.ok) return true;
  log(`r2 check: ${cfErrors(res)}`);
  return false;
};

const ensureR2 = async (accountId) => {
  const step = "r2";
  if (await r2Enabled(accountId)) {
    emit(step, "ok", "R2 is enabled");
    return;
  }
  await waitFor(step, {
    message: "R2 storage isn't enabled on this account yet. Open the page and click to enable R2 (the free tier covers a personal server; it needs the payment method you already added).",
    url: `https://dash.cloudflare.com/${accountId}/r2/overview`,
    check: () => r2Enabled(accountId),
    intervalMs: 10_000,
  });
  emit(step, "ok", "R2 is enabled");
};

const R2_CORS = {
  rules: [
    {
      allowed: { origins: ["*"], methods: ["GET", "PUT", "HEAD"], headers: ["*"] },
      exposeHeaders: ["ETag", "Content-Length", "Content-Type", "Content-Range"],
      maxAgeSeconds: 3600,
    },
  ],
};

const ensureResources = async (accountId, state) => {
  const step = "resources";
  emit(step, "start", "Creating the database, storage buckets, key-value stores and queues (or finding the ones from last time)…");
  const created = [];
  state.resources ??= {};

  const dbs = await cfList(`/accounts/${accountId}/d1/database?name=${encodeURIComponent(N.d1)}`);
  let db = dbs.find((entry) => entry.name === N.d1);
  if (!db) {
    const res = await cf("POST", `/accounts/${accountId}/d1/database`, { name: N.d1 });
    if (!res.ok) fail(step, `Couldn't create D1 database ${N.d1}: ${cfErrors(res)}`);
    db = res.json.result;
    created.push(N.d1);
  }
  state.resources.d1 = { name: N.d1, id: db.uuid };

  const namespaces = await cfList(`/accounts/${accountId}/storage/kv/namespaces`);
  state.resources.kv ??= {};
  for (const [binding, title] of Object.entries(N.kv)) {
    let ns = namespaces.find((entry) => entry.title === title);
    if (!ns) {
      const res = await cf("POST", `/accounts/${accountId}/storage/kv/namespaces`, { title });
      if (!res.ok) fail(step, `Couldn't create KV namespace ${title}: ${cfErrors(res)}`);
      ns = res.json.result;
      created.push(title);
    }
    state.resources.kv[binding] = ns.id;
  }

  const bucketRes = await cf("GET", `/accounts/${accountId}/r2/buckets?name_contains=${encodeURIComponent(PREFIX)}&per_page=1000`);
  if (!bucketRes.ok) fail(step, `Couldn't list R2 buckets: ${cfErrors(bucketRes)}`);
  const buckets = new Set((bucketRes.json.result?.buckets ?? []).map((bucket) => bucket.name));
  for (const bucket of Object.values(N.r2)) {
    if (buckets.has(bucket)) continue;
    const res = await cf("POST", `/accounts/${accountId}/r2/buckets`, { name: bucket });
    if (!res.ok && !/already exists|10004/i.test(cfErrors(res))) fail(step, `Couldn't create R2 bucket ${bucket}: ${cfErrors(res)}`);
    created.push(bucket);
  }
  state.resources.r2 = Object.values(N.r2);
  for (const bucket of [N.r2.drive, N.r2.media]) {
    const res = await cf("PUT", `/accounts/${accountId}/r2/buckets/${bucket}/cors`, R2_CORS);
    if (!res.ok) fail(step, `Couldn't set CORS on ${bucket}: ${cfErrors(res)}`);
  }
  const lifecycle = await cf("PUT", `/accounts/${accountId}/r2/buckets/${N.r2.media}/lifecycle`, {
    rules: [
      {
        id: "tts-expiry",
        enabled: true,
        conditions: { prefix: "tts/" },
        deleteObjectsTransition: { condition: { type: "Age", maxAge: 86_400 } },
      },
    ],
  });
  if (!lifecycle.ok) fail(step, `Couldn't set the read-aloud expiry rule on ${N.r2.media}: ${cfErrors(lifecycle)}`);

  const queues = await cfList(`/accounts/${accountId}/queues`);
  state.resources.queues ??= {};
  for (const queue of [N.queues.usageDlq, N.queues.usage]) {
    let found = queues.find((entry) => entry.queue_name === queue);
    if (!found) {
      const res = await cf("POST", `/accounts/${accountId}/queues`, { queue_name: queue });
      if (!res.ok) fail(step, `Couldn't create queue ${queue}: ${cfErrors(res)}`);
      found = res.json.result;
      created.push(queue);
    }
    state.resources.queues[queue] = found.queue_id;
  }
  writeState(state);
  emit(step, "ok", created.length ? `Created ${created.length}: ${created.join(", ")}` : "All resources already exist");
};

const listSecrets = async (worker, configFile, accountId) => {
  const result = await wrangler(["secret", "list", "--config", configFile, "--format", "json"], { accountId, quiet: true });
  if (result.status !== 0) {
    if (/10007|does not exist|not found|workers\.api\.error\.script_not_found/i.test(`${result.stderr}\n${result.stdout}`)) return new Set();
    throw new Fatal(`Couldn't list ${worker}'s secrets:\n${tail(result.stderr || result.stdout)}`);
  }
  const start = result.stdout.indexOf("[");
  return new Set(JSON.parse(result.stdout.slice(start)).map((entry) => entry.name));
};

const readOpenRouterKey = () => {
  const file = options["openrouter-key-file"];
  if (file) {
    const value = readFileSync(path.resolve(file), "utf8").trim();
    if (!value) throw new Fatal(`${file} is empty.`);
    return value;
  }
  return process.env.OPENROUTER_API_KEY?.trim() || null;
};

const planSecrets = async (state, files) => {
  const step = "secrets";
  const accountId = state.accountId;
  const existing = {};
  for (const worker of ["cloud-builder", "model-gateway", "browser-gateway", "canvas-share"]) {
    existing[worker] = await listSecrets(worker, files[worker], accountId);
  }
  const set = { "cloud-builder": {}, "model-gateway": {}, "browser-gateway": {}, "canvas-share": {} };
  const generated = {
    BUILDER_SERVICE_SECRET: hex,
    BETTER_AUTH_SECRET: hex,
    MEDIA_SIGNING_SECRET: hex,
    OWNER_SECRETS_KEK: base64,
    OAUTH_STATE_SECRET: hex,
  };
  for (const [name, make] of Object.entries(generated)) {
    if (!existing["cloud-builder"].has(name)) set["cloud-builder"][name] = make();
  }
  const notes = [];
  if (!existing["cloud-builder"].has("STELLA_ADMIN_API_SECRET") || !state.adminSecret) {
    if (existing["cloud-builder"].has("STELLA_ADMIN_API_SECRET")) notes.push("admin key rotated (this computer had no copy)");
    state.adminSecret = hex();
    set["cloud-builder"].STELLA_ADMIN_API_SECRET = state.adminSecret;
  }
  if (!existing["cloud-builder"].has("CAPABILITY_SIGNING_KEY") || !state.capabilityJwks) {
    if (existing["cloud-builder"].has("CAPABILITY_SIGNING_KEY")) notes.push("capability key rotated (its public half was lost)");
    const pair = await generateCapabilityKeyPair();
    set["cloud-builder"].CAPABILITY_SIGNING_KEY = pair.privateKeyPem;
    state.capabilityJwks = JSON.stringify({ keys: [{ kid: CAPABILITY_KID, issuer: CAPABILITY_ISSUER, jwk: pair.publicJwk }] });
  }
  if (!existing["browser-gateway"].has("BROWSER_PROFILE_KEK_V1")) set["browser-gateway"].BROWSER_PROFILE_KEK_V1 = base64url();
  const viewOnBuilder = existing["cloud-builder"].has("CANVAS_SHARE_VIEW_SECRET");
  const viewOnShare = existing["canvas-share"].has("CANVAS_SHARE_VIEW_SECRET");
  if (!viewOnBuilder || !viewOnShare) {
    const value = hex();
    set["cloud-builder"].CANVAS_SHARE_VIEW_SECRET = value;
    set["canvas-share"].CANVAS_SHARE_VIEW_SECRET = value;
    if (viewOnBuilder || viewOnShare) notes.push("private-canvas link key re-paired");
  }
  const openRouter = readOpenRouterKey();
  if (openRouter) {
    set["model-gateway"].OPENROUTER_API_KEY = openRouter;
    if (!existing["cloud-builder"].has("OPENROUTER_API_KEY") || options["openrouter-key-file"]) {
      set["cloud-builder"].OPENROUTER_API_KEY = openRouter;
    }
  }
  state.optional = {
    openRouter: Boolean(openRouter) || existing["model-gateway"].has("OPENROUTER_API_KEY"),
  };
  writeState(state);
  const counts = Object.entries(set)
    .filter(([, values]) => Object.keys(values).length)
    .map(([worker, values]) => `${worker} ${Object.keys(values).length}`);
  emit(step, "ok", `${counts.length ? `New secrets: ${counts.join(", ")}` : "Every secret is already set"}${notes.length ? ` (${notes.join("; ")})` : ""}. Values are never printed.`);
  return set;
};

const withSecretsFile = async (values, fn) => {
  if (!values || Object.keys(values).length === 0) return fn(null);
  const dir = mkdtempSync(path.join(tmpdir(), "stella-selfhost-"));
  const file = path.join(dir, "secrets.json");
  try {
    writeFileSync(file, JSON.stringify(values), { mode: 0o600 });
    return await fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const deployWorker = async (state, worker, file, { secrets, vars = {}, label, step = "deploy" } = {}) => {
  emit(step, "start", `${label ?? worker}…`);
  const started = Date.now();
  const result = await withSecretsFile(secrets, (secretsFile) =>
    wrangler(
      [
        "deploy",
        "--config",
        file,
        ...(secretsFile ? ["--secrets-file", secretsFile] : []),
        ...Object.entries(vars).flatMap(([key, value]) => ["--var", `${key}:${value}`]),
      ],
      { accountId: state.accountId, timeoutMs: 60 * 60_000 },
    ),
  );
  if (result.status !== 0) {
    const output = `${result.stdout}\n${result.stderr}`;
    if (/workers\.dev subdomain|register a workers\.dev/i.test(output)) {
      fail(step, `${worker}: the account has no workers.dev subdomain yet.`);
    }
    fail(step, `${worker} failed to deploy:\n${tail(output)}`);
  }
  if (secrets) for (const name of Object.keys(secrets)) delete secrets[name];
  emit(step, "ok", `${worker} deployed (${Math.round((Date.now() - started) / 1000)}s)`);
  return result;
};

const workerExists = async (accountId, name) => {
  const res = await cf("GET", `/accounts/${accountId}/workers/scripts/${name}/settings`);
  return res.ok;
};

const migrate = async (state, files) => {
  const step = "migrations";
  emit(step, "start", "Applying database migrations…");
  const result = await wrangler(["d1", "migrations", "apply", N.d1, "--remote", "--config", files["cloud-builder"]], {
    accountId: state.accountId,
    input: "y\n",
  });
  if (result.status !== 0) fail(step, `D1 migrations failed:\n${tail(`${result.stdout}\n${result.stderr}`)}`);
  emit(step, "ok", /No migrations to apply/i.test(result.stdout) ? "Database is up to date" : "Database migrations applied");
};

const deployCloudBuilder = async (state, file, secrets, release) => {
  const step = "deploy";
  emit(step, "start", "Preparing the sandbox image inputs…");
  const prepared = await run(nodeBin(), ["scripts/prepare-image.mjs"], { cwd: path.join(ROOT, "workers", "cloud-builder") });
  if (prepared.status !== 0) fail(step, `prepare-image failed:\n${tail(prepared.stderr || prepared.stdout)}`);
  await deployWorker(state, "cloud-builder", file, {
    secrets,
    label: "cloud-builder (backend + cloud agents; builds and uploads the sandbox image, first time 5–15 min)",
  });
  const check = await run(nodeBin(), ["scripts/check-container-metadata.mjs", "--deployed", "--wrangler-config", file], {
    cwd: path.join(ROOT, "workers", "cloud-builder"),
    accountId: state.accountId,
  });
  if (check.status !== 0) fail("containers", `The deployed backend has no container image: ${tail(check.stderr || check.stdout, 6)}`);
  emit("containers", "ok", "Sandbox image and code bundle are attached to the live version");
};

const publishAppSource = async (state) => {
  const step = "app-source";
  emit(step, "start", `Publishing the desktop app's source to Artifacts namespace ${N.artifacts}…`);
  const result = await run(
    nodeBin(),
    ["scripts/publish-app-source.mjs", "--namespace", N.artifacts, "--backend", state.urls.backend],
    { accountId: state.accountId, timeoutMs: 30 * 60_000 },
  );
  if (result.status !== 0) fail(step, `App source publish failed:\n${tail(`${result.stdout}\n${result.stderr}`)}`);
  const unchanged = /nothing to publish|unchanged/i.test(result.stdout);
  emit(step, "ok", unchanged ? "Desktop source already up to date" : "Desktop source published");
};

const http = async (url, init = {}, timeoutMs = 20_000) => {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: response.status, ok: response.ok, json, text };
  } catch (error) {
    return { status: 0, ok: false, json: null, text: error instanceof Error ? error.message : String(error) };
  }
};

const admin = (state, method, apiPath, body) =>
  http(`${state.urls.backend}${apiPath}`, {
    method,
    headers: { authorization: `Bearer ${state.adminSecret}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const waitHealthy = async (state) => {
  const step = "verify";
  const deadline = Date.now() + 10 * 60_000;
  let last = "";
  while (Date.now() < deadline) {
    const res = await http(`${state.urls.backend}/healthz`);
    if (res.ok && res.json?.ok) return;
    last = `${res.status} ${res.text.slice(0, 120)}`;
    log(`healthz: ${last}`);
    await sleep(10_000);
  }
  fail(step, `${state.urls.backend}/healthz never answered (last: ${last}). A new workers.dev subdomain can take a while; run setup again in a few minutes.`);
};

const ensureOwner = async (state) => {
  const step = "owner";
  const res = await admin(state, "POST", "/api/admin/selfhost/owner", { name: state.serverName });
  if (!res.ok || !res.json?.userId) fail(step, `Couldn't create the owner (${res.status}): ${res.text.slice(0, 300)}`);
  state.ownerUserId = res.json.userId;
  state.serverId = res.json.serverId;
  writeState(state);
  emit(step, "ok", `${res.json.created ? "Created" : "Found"} the owner of "${res.json.name ?? state.serverName}"`);
};

const verify = async (state, release) => {
  const step = "verify";
  emit(step, "start", "Checking the server…");
  await waitHealthy(state);
  const ready = await http(`${state.urls.backend}/readyz`);
  if (!ready.ok || ready.json?.ok !== true) {
    fail(step, `/readyz isn't ready: ${ready.text.slice(0, 400)}`);
  }
  const discovery = await http(`${state.urls.backend}/.well-known/stella`);
  const d = discovery.json;
  const problems = [];
  if (!discovery.ok || d?.kind !== "stella-server") problems.push(`/.well-known/stella answered ${discovery.status}`);
  else {
    if (d.ownerMode !== true) problems.push("ownerMode is not on");
    if (state.serverId && d.serverId !== state.serverId) problems.push(`serverId ${d.serverId} ≠ ${state.serverId}`);
    if (release && d.commit !== release.commit) problems.push(`commit ${d.commit} ≠ ${release.commit}`);
    if (d.urls?.backend?.replace(/\/+$/, "") !== state.urls.backend) problems.push(`urls.backend ${d.urls?.backend}`);
    if (d.features?.billing !== false) problems.push("billing is on");
  }
  if (problems.length) fail(step, `Discovery check failed: ${problems.join("; ")}`);
  const gateway = await http(`${state.urls.modelGateway}/healthz`);
  if (!gateway.ok) fail(step, `Model gateway /healthz answered ${gateway.status}`);
  const sites = await http(`${state.urls.sites}/__stella/healthz`);
  if (!sites.ok) emit(step, "warn", `Sites host answered ${sites.status} (sites may not open until it does)`);
  emit(step, "ok", `Healthy: ${d.name} ${d.version}, api ${d.api?.version}, features on: ${Object.entries(d.features ?? {}).filter(([, on]) => on).map(([key]) => key).join(", ") || "none"}`);
  return d;
};

const pairingStatus = async (state, pairingId) => {
  const res = await admin(state, "GET", `/api/auth/device-pairing/status?pairingId=${encodeURIComponent(pairingId)}`);
  return res.ok ? res.json : null;
};

const mintPairing = async (state, { wait }) => {
  const step = "pair";
  const res = await admin(state, "POST", "/api/auth/device-pairing/start", { label: "selfhost CLI" });
  if (!res.ok || !res.json?.link) {
    if (res.status === 401 || res.status === 403) {
      fail(step, `The server refused this computer's admin key (${res.status}). Run: bun scripts/selfhost.mjs recover${PREFIX === "stella" ? "" : ` --prefix ${PREFIX}`}`);
    }
    fail(step, `Couldn't start a pairing (${res.status}): ${res.text.slice(0, 300)}`);
  }
  const { pairingId, link, expiresAt } = res.json;
  const qrFile = path.join(STATE_DIR, `pair-${PREFIX}.svg`);
  writeFileSync(qrFile, qrSvg(link), { mode: 0o600 });
  const minutes = Math.max(1, Math.round((expiresAt - Date.now()) / 60_000));
  if (!JSON_MODE) {
    console.log("");
    console.log(qrTerminal(link));
    console.log("");
    console.log(`  Phone: open the Stella app → Connect your own server → scan this code.`);
    console.log(`  Desktop: open this link on the computer (or paste it in Stella → Connect to your own server):`);
    console.log(`  ${link}`);
    console.log(`  The code works once and expires in ${minutes} minutes. New code: bun scripts/selfhost.mjs pair${PREFIX === "stella" ? "" : ` --prefix ${PREFIX}`}`);
    console.log("");
  }
  emit(step, "ready", `Server ready. Scan the QR (${qrFile}) with the Stella app, or open the link on a computer with Stella. One use, expires in ${minutes} minutes.`, {
    url: link,
    link,
    expiresAt,
    qrFile,
    backend: state.urls.backend,
  });
  if (!wait || JSON_MODE) return;
  console.log("  Waiting for a device to scan it (Ctrl-C to stop; the code stays valid)…");
  const deadline = Math.min(expiresAt, Date.now() + 10 * 60_000);
  while (Date.now() < deadline) {
    await sleep(3_000);
    const status = await pairingStatus(state, pairingId);
    if (status?.status === "claimed") {
      emit("pair", "ok", `Paired: ${status.deviceName ?? "a device"} is connected to your server.`);
      return;
    }
    if (status && status.status !== "pending") {
      emit("pair", "warn", `The code is ${status.status}. Run pair again for a new one.`);
      return;
    }
  }
  emit("pair", "warn", "Nobody scanned the code in time. Run pair again for a new one.");
};

const baseState = (account) => {
  const state = readState(account.id) ?? {
    version: 1,
    prefix: PREFIX,
    accountId: account.id,
    createdAt: new Date().toISOString(),
  };
  state.accountName = account.name;
  return state;
};

const requireState = async () => {
  await ensureLogin();
  const account = await resolveAccount();
  const state = readState(account.id);
  return { account, state };
};

const deployEverything = async (state, { first, waitForPrices }) => {
  const release = releaseInfo();
  if (release.dirty) emit("release", "warn", "Your checkout has local changes; they will be deployed as-is.");
  emit("release", "ok", `Deploying ${release.version}`);
  let files = writeConfigs(buildConfigs(state, { billing: true }));
  const secrets = await planSecrets(state, files);
  files = writeConfigs(buildConfigs(state, { billing: true }));
  await migrate(state, files);
  await deployWorker(state, "browser-gateway", files["browser-gateway"], { secrets: secrets["browser-gateway"], label: "browser-gateway (cloud browser)" });
  const builderLive = await workerExists(state.accountId, N.workers.cloudBuilder);
  if (!builderLive) {
    const firstPass = writeConfigs({ "model-gateway-first": buildConfigs(state, { billing: false })["model-gateway"] });
    await deployWorker(state, "model-gateway", firstPass["model-gateway-first"], {
      secrets: secrets["model-gateway"],
      label: "model-gateway, first pass (the backend it reports to doesn't exist yet)",
    });
  }
  await deployCloudBuilder(state, files["cloud-builder"], secrets["cloud-builder"], release);
  if (waitForPrices && builderLive) {
    emit("deploy", "start", "Waiting 2 minutes for the model gateway's price list to pick up the new backend (--now skips)…");
    await sleep(120_000);
  }
  await deployWorker(state, "model-gateway", files["model-gateway"], { secrets: secrets["model-gateway"], label: "model-gateway" });
  await deployWorker(state, "apps-host", files["apps-host"], { label: "apps-host (your apps)" });
  await deployWorker(state, "canvas-share", files["canvas-share"], { secrets: secrets["canvas-share"], label: "share (canvas share links)" });
  await deployWorker(state, "sites-host", files["sites-host"], { label: "sites (Stella sites)" });
  state.deployed = { commit: release.commit, at: new Date().toISOString() };
  writeState(state);
  await publishAppSource(state);
  return release;
};

const applyCaps = (state) => {
  state.caps ??= { monthlyHours: 40, maxConcurrent: 2 };
  for (const [flag, key, min] of [
    ["cloud-agent-hours", "monthlyHours", 0],
    ["cloud-agent-concurrency", "maxConcurrent", 1],
  ]) {
    if (options[flag] === undefined) continue;
    const value = Number(options[flag]);
    if (!Number.isInteger(value) || value < min || value > 10_000) throw new Fatal(`--${flag} must be a whole number of at least ${min}.`);
    state.caps[key] = value;
  }
};

const setup = async () => {
  await preflight();
  await ensureLogin();
  const account = await resolveAccount();
  const state = baseState(account);
  if (options.name) state.serverName = String(options.name).slice(0, 80);
  state.serverName ??= "My Stella";
  applyCaps(state);
  writeState(state);
  await ensureWorkersPaid(account.id);
  await ensureR2(account.id);
  const subdomain = await ensureSubdomain(account.id, state);
  state.subdomain = subdomain;
  state.urls = urlsFor(subdomain);
  writeState(state);
  await ensureDocker();
  await ensureResources(account.id, state);
  const release = await deployEverything(state, { first: !state.deployed, waitForPrices: false });
  await waitHealthy(state);
  await ensureOwner(state);
  await verify(state, release);
  await mintPairing(state, { wait: !options["no-wait"] });
};

const confirm = async (question) => {
  if (options.yes) return true;
  if (JSON_MODE || !process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
};

const update = async () => {
  await preflight();
  const { state } = await requireState();
  if (!state?.urls) fail("update", `No install named ${PREFIX} on this account. Run setup first.`);
  applyCaps(state);
  writeState(state);
  if (!options["no-fetch"]) {
    const step = "fetch";
    const ref = options.ref ? String(options.ref) : "origin/master";
    const fetched = await run("git", ["fetch", "--tags", "origin", "master"]);
    if (fetched.status !== 0) fail(step, `git fetch failed:\n${tail(fetched.stderr)}`);
    const target = gitOut(["rev-parse", `${ref}^{commit}`]);
    if (!target) fail(step, `${ref} isn't a commit or tag here.`);
    const head = gitOut(["rev-parse", "HEAD"]);
    const contains = spawnSync("git", ["merge-base", "--is-ancestor", target, head], { cwd: ROOT }).status === 0;
    if (head !== target && !(contains && !options.ref)) {
      if (gitOut(["status", "--porcelain", "--untracked-files=no"])) {
        fail(step, `Your checkout has local changes, so it can't move to ${ref}. Commit or stash them, or run update --no-fetch to deploy what you have.`);
      }
      const branch = gitOut(["symbolic-ref", "--short", "-q", "HEAD"]);
      const moved = branch && !options.ref
        ? await run("git", ["merge", "--ff-only", target])
        : await run("git", ["checkout", "--detach", target]);
      if (moved.status !== 0) fail(step, `Couldn't move the checkout to ${ref}:\n${tail(moved.stderr || moved.stdout)}`);
      emit(step, "ok", `Checked out ${ref} (${target.slice(0, 12)})`);
      const deps = await run("bun", ["run", "deps", "backend"], { timeoutMs: 20 * 60_000 });
      if (deps.status !== 0) fail(step, `bun run deps backend failed:\n${tail(deps.stderr || deps.stdout)}`);
      const again = spawnSync(process.execPath, [path.join(ROOT, "scripts", "selfhost.mjs"), ...argv, "--no-fetch"], { stdio: "inherit" });
      process.exit(again.status ?? 1);
    }
    emit(step, "ok", head === target ? `Already at ${ref} (${target.slice(0, 12)})` : `This checkout already has ${ref} plus local commits; deploying it as it is`);
  }
  emit("update", "warn", "Deploying restarts the backend: cloud agent turns in progress stop and need to be retried.");
  if (!options.now && !options.yes && !JSON_MODE && !(await confirm("Deploy now?"))) {
    emit("update", "info", "Nothing changed.");
    return;
  }
  await ensureDocker();
  await ensureResources(state.accountId, state);
  const release = await deployEverything(state, { first: false, waitForPrices: !options.now });
  await ensureOwner(state);
  const discovered = await verify(state, release);
  if (discovered.version) {
    state.deployed.version = discovered.version;
    writeState(state);
  }
  emit("update", "ready", `Your server runs ${discovered.version ?? release.version}.`, { url: state.urls.backend, version: discovered.version ?? release.version });
};

const pair = async () => {
  const { state } = await requireState();
  if (!state?.adminSecret || !state.urls) {
    fail("pair", `This computer has no admin key for ${PREFIX}. Run: bun scripts/selfhost.mjs recover${PREFIX === "stella" ? "" : ` --prefix ${PREFIX}`}`);
  }
  await mintPairing(state, { wait: !options["no-wait"] });
};

const recover = async () => {
  const step = "recover";
  await ensureLogin();
  const account = await resolveAccount();
  const state = baseState(account);
  if (!(await workerExists(account.id, N.workers.cloudBuilder))) {
    fail(step, `There's no ${N.workers.cloudBuilder} on this account. Check --prefix (and --account-id), or run setup.`);
  }
  const sub = await cf("GET", `/accounts/${account.id}/workers/subdomain`);
  const subdomain = sub.json?.result?.subdomain;
  if (!subdomain) fail(step, "This account has no workers.dev subdomain, so its server can't be reached.");
  state.subdomain = subdomain;
  state.urls = urlsFor(subdomain);
  const secret = hex();
  const result = await wrangler(["secret", "put", "STELLA_ADMIN_API_SECRET", "--name", N.workers.cloudBuilder], {
    accountId: account.id,
    input: secret,
  });
  if (result.status !== 0) fail(step, `Couldn't set the new admin key:\n${tail(result.stderr || result.stdout)}`);
  state.adminSecret = secret;
  writeState(state);
  emit(step, "ok", `Rotated the admin key; saved to ${statePath(account.id)}`);
  const checkConfig = path.join(GEN_DIR, "cloud-builder.json");
  if (existsSync(checkConfig)) {
    const check = await run(nodeBin(), ["scripts/check-container-metadata.mjs", "--deployed", "--wrangler-config", checkConfig], {
      cwd: path.join(ROOT, "workers", "cloud-builder"),
      accountId: account.id,
    });
    if (check.status !== 0) emit("containers", "warn", "The live version lost its container image; run update to restore cloud agents.");
  }
  await waitHealthy(state);
  await mintPairing(state, { wait: !options["no-wait"] });
};

const status = async () => {
  const { state } = await requireState();
  if (!state?.urls) fail("status", `No install named ${PREFIX} on this account (no state in ${STATE_DIR}).`);
  const health = await http(`${state.urls.backend}/healthz`);
  const ready = await http(`${state.urls.backend}/readyz`);
  const discovery = await http(`${state.urls.backend}/.well-known/stella`);
  const workers = {};
  for (const name of Object.values(N.workers)) workers[name] = await workerExists(state.accountId, name);
  const local = releaseInfo();
  const d = discovery.json;
  emit("status", health.ok && ready.json?.ok ? "ok" : "warn", `${d?.name ?? state.serverName} at ${state.urls.backend}: ${health.ok ? "up" : `down (${health.status})`}, ${ready.json?.ok ? "ready" : `not ready ${JSON.stringify(ready.json?.checks ?? ready.text.slice(0, 120))}`}`, {
    url: state.urls.backend,
    serverVersion: d?.version ?? null,
    deployed: state.deployed ?? null,
    checkout: local.version,
    workers,
    hasAdminKey: Boolean(state.adminSecret),
    urls: state.urls,
  });
  if (!JSON_MODE) {
    console.log(`  Server version: ${d?.version ?? "unknown"}  ·  this checkout: ${local.version}`);
    for (const [name, ok] of Object.entries(workers)) console.log(`  ${ok ? "✓" : "✗"} ${name}`);
    console.log(`  Admin key on this computer: ${state.adminSecret ? "yes" : "no (run recover)"}`);
  }
};

const emptyBucket = async (accountId, bucket) => {
  let deleted = 0;
  for (let round = 0; round < 1000; round += 1) {
    const res = await cf("GET", `/accounts/${accountId}/r2/buckets/${bucket}/objects?per_page=1000`);
    if (!res.ok) throw new Fatal(`Couldn't list ${bucket}: ${cfErrors(res)}`);
    const keys = (res.json.result ?? []).map((object) => object.key);
    if (keys.length === 0) return deleted;
    for (let i = 0; i < keys.length; i += 16) {
      await Promise.all(
        keys.slice(i, i + 16).map((key) =>
          cf("DELETE", `/accounts/${accountId}/r2/buckets/${bucket}/objects/${key.split("/").map(encodeURIComponent).join("/")}`),
        ),
      );
    }
    deleted += keys.length;
  }
  return deleted;
};

const destroy = async () => {
  const step = "destroy";
  await ensureLogin();
  const account = await resolveAccount();
  const accountId = account.id;
  const state = readState(accountId);
  const found = [];
  const scripts = await cfList(`/accounts/${accountId}/workers/scripts`);
  const workerNames = Object.values(N.workers).filter((name) => scripts.some((script) => script.id === name));
  for (const name of workerNames) found.push(`worker ${name}`);
  const apps = await cf("GET", `/accounts/${accountId}/containers/applications`);
  const containerApps = (apps.ok ? apps.json.result ?? [] : []).filter(
    (app) => app.name === N.container || app.name?.startsWith(`${N.workers.cloudBuilder}-`),
  );
  for (const app of containerApps) found.push(`container app ${app.name}`);
  const dbs = await cfList(`/accounts/${accountId}/d1/database?name=${encodeURIComponent(N.d1)}`);
  const db = dbs.find((entry) => entry.name === N.d1);
  if (db) found.push(`D1 ${N.d1}`);
  const namespaces = (await cfList(`/accounts/${accountId}/storage/kv/namespaces`)).filter((ns) => Object.values(N.kv).includes(ns.title));
  for (const ns of namespaces) found.push(`KV ${ns.title}`);
  const bucketRes = await cf("GET", `/accounts/${accountId}/r2/buckets?name_contains=${encodeURIComponent(PREFIX)}&per_page=1000`);
  const buckets = (bucketRes.json?.result?.buckets ?? []).map((bucket) => bucket.name).filter((name) => Object.values(N.r2).includes(name));
  for (const bucket of buckets) found.push(`R2 ${bucket}`);
  const queues = (await cfList(`/accounts/${accountId}/queues`)).filter((queue) => Object.values(N.queues).includes(queue.queue_name));
  for (const queue of queues) found.push(`queue ${queue.queue_name}`);
  const artifacts = await wrangler(["artifacts", "namespaces", "get", N.artifacts, "--json"], { accountId, quiet: true });
  const hasArtifacts = artifacts.status === 0;
  if (hasArtifacts) found.push(`Artifacts namespace ${N.artifacts}`);
  if (found.length === 0 && !state) {
    emit(step, "ok", `Nothing named ${PREFIX}-* exists on ${account.name}.`);
    return;
  }
  emit(step, "warn", `This deletes, on ${account.name}: ${found.join(", ") || "nothing remote"}${state ? `, and ${statePath(accountId)}` : ""}. Every conversation, file and setting on this server is lost.`, { resources: found });
  if (!(await confirm(`Delete all of it?`))) {
    emit(step, "info", JSON_MODE || !process.stdin.isTTY ? "Not confirmed. Pass --yes to delete." : "Nothing deleted.");
    return;
  }
  const problems = [];
  for (const name of [N.workers.sites, N.workers.canvasShare, N.workers.appsHost, N.workers.modelGateway, N.workers.cloudBuilder, N.workers.browserGateway]) {
    if (!workerNames.includes(name)) continue;
    const res = await cf("DELETE", `/accounts/${accountId}/workers/scripts/${name}?force=true`);
    if (!res.ok) problems.push(`worker ${name}: ${cfErrors(res)}`);
    else emit(step, "ok", `Deleted worker ${name}`);
  }
  for (const app of containerApps) {
    const res = await cf("DELETE", `/accounts/${accountId}/containers/applications/${app.id}`);
    if (!res.ok && res.status !== 404) problems.push(`container app ${app.name}: ${cfErrors(res)}`);
    else emit(step, "ok", `Deleted container app ${app.name}`);
  }
  if (db) {
    const res = await cf("DELETE", `/accounts/${accountId}/d1/database/${db.uuid}`);
    if (!res.ok) problems.push(`D1 ${N.d1}: ${cfErrors(res)}`);
    else emit(step, "ok", `Deleted D1 ${N.d1}`);
  }
  for (const ns of namespaces) {
    const res = await cf("DELETE", `/accounts/${accountId}/storage/kv/namespaces/${ns.id}`);
    if (!res.ok) problems.push(`KV ${ns.title}: ${cfErrors(res)}`);
    else emit(step, "ok", `Deleted KV ${ns.title}`);
  }
  for (const bucket of buckets) {
    try {
      const count = await emptyBucket(accountId, bucket);
      const res = await cf("DELETE", `/accounts/${accountId}/r2/buckets/${bucket}`);
      if (!res.ok) problems.push(`R2 ${bucket}: ${cfErrors(res)}`);
      else emit(step, "ok", `Deleted R2 ${bucket}${count ? ` (${count} objects)` : ""}`);
    } catch (error) {
      problems.push(`R2 ${bucket}: ${error.message}`);
    }
  }
  for (const queue of queues.sort((a) => (a.queue_name === N.queues.usageDlq ? 1 : -1))) {
    const res = await cf("DELETE", `/accounts/${accountId}/queues/${queue.queue_id}`);
    if (!res.ok) problems.push(`queue ${queue.queue_name}: ${cfErrors(res)}`);
    else emit(step, "ok", `Deleted queue ${queue.queue_name}`);
  }
  if (hasArtifacts) {
    const res = await cf("DELETE", `/accounts/${accountId}/artifacts/namespaces/${N.artifacts}`);
    if (!res.ok) problems.push(`Artifacts ${N.artifacts}: ${cfErrors(res)} (delete it in the dashboard under Artifacts)`);
    else emit(step, "ok", `Deleted Artifacts namespace ${N.artifacts}`);
  }
  if (problems.length) fail(step, `Some things couldn't be deleted (state kept so you can run destroy again):\n  ${problems.join("\n  ")}`);
  if (state) rmSync(statePath(accountId), { force: true });
  rmSync(path.join(STATE_DIR, `pair-${PREFIX}.svg`), { force: true });
  rmSync(GEN_DIR, { recursive: true, force: true });
  emit(step, "ready", `Everything named ${PREFIX}-* is gone from ${account.name}.`);
};

const COMMANDS = { setup, update, pair, recover, status, destroy };

const main = async () => {
  if (command === "help" || options.help || !COMMANDS[command]) {
    console.log(HELP);
    process.exit(command === "help" || options.help ? 0 : 2);
  }
  validatePrefix(PREFIX);
  log(`selfhost ${command} ${argv.filter((arg) => !arg.includes("key")).join(" ")}`);
  await COMMANDS[command]();
};

main().then(
  () => process.exit(0),
  (error) => {
    if (!(error instanceof Fatal)) {
      log(String(error?.stack ?? error));
      emit(command, "error", `Unexpected error: ${error?.message ?? error}`, { log: LOG_FILE });
    } else if (!error.reported) {
      emit(command, "error", error.message, { log: LOG_FILE });
    }
    if (!JSON_MODE) console.error(`\n${paint(31, "Stopped.")} Run the same command again after fixing it; it picks up where it stopped. Log: ${LOG_FILE}`);
    process.exit(1);
  },
);
