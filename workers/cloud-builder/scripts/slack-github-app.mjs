#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const AUTH = { dev: "https://auth-dev.stella.sh", production: "https://auth.stella.sh" };
const NAMES = { dev: "Stella Crew (dev)", production: "Stella Crew" };

const args = process.argv.slice(2);
const command = args[0];
const flag = (name) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};
const env = flag("env");
if (!["manifest", "store"].includes(command) || !(env in AUTH)) {
  console.error("Usage: slack-github-app.mjs manifest|store --env dev|production [--org <login>] [--code <code>]");
  process.exit(2);
}

if (command === "manifest") {
  const auth = AUTH[env];
  const manifest = {
    name: NAMES[env],
    url: "https://stella.sh/slack",
    description: "Lets Stella's agents in your Slack workspace work on the repositories you choose and share previews.",
    public: true,
    redirect_url: "https://stella.sh/slack",
    callback_urls: [`${auth}/api/slack/github/callback`],
    setup_url: `${auth}/api/slack/github/callback`,
    setup_on_update: true,
    request_oauth_on_install: false,
    hook_attributes: { url: `${auth}/api/slack/github/webhook`, active: true },
    default_permissions: {
      contents: "write",
      metadata: "read",
      deployments: "read",
      statuses: "read",
      checks: "read",
    },
    default_events: [],
  };
  const org = flag("org");
  console.log(
    JSON.stringify(
      {
        postTo: org
          ? `https://github.com/organizations/${encodeURIComponent(org)}/settings/apps/new`
          : "https://github.com/settings/apps/new",
        manifest,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const code = flag("code");
if (!code || !/^[A-Za-z0-9_-]{8,100}$/.test(code)) {
  console.error("--code is the `code` GitHub put on the redirect URL.");
  process.exit(2);
}
const response = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, {
  method: "POST",
  headers: { accept: "application/vnd.github+json", "user-agent": "stella-cloud" },
});
if (!response.ok) {
  console.error(`GitHub refused the code (${response.status}). Codes work once and expire after an hour.`);
  process.exit(1);
}
const app = await response.json();
const secrets = {
  SLACK_GITHUB_APP_ID: String(app.id ?? ""),
  SLACK_GITHUB_APP_SLUG: app.slug ?? "",
  SLACK_GITHUB_APP_CLIENT_ID: app.client_id ?? "",
  SLACK_GITHUB_APP_CLIENT_SECRET: app.client_secret ?? "",
  SLACK_GITHUB_APP_PRIVATE_KEY: app.pem ?? "",
  SLACK_GITHUB_WEBHOOK_SECRET: app.webhook_secret ?? "",
};
for (const [name, value] of Object.entries(secrets)) {
  if (value) continue;
  if (name === "SLACK_GITHUB_WEBHOOK_SECRET") {
    console.warn("GitHub returned no webhook secret; uninstalls are then noticed only when GitHub refuses a token.");
    delete secrets[name];
    continue;
  }
  console.error(`GitHub's answer had no value for ${name}.`);
  process.exit(1);
}
const wranglerEnv = env === "production" ? ["--env", "production"] : [];
for (const [name, value] of Object.entries(secrets)) {
  const result = spawnSync("bunx", ["wrangler", "secret", "put", name, ...wranglerEnv], {
    input: value,
    stdio: ["pipe", "ignore", "pipe"],
    encoding: "utf8",
  });
  if (result.status !== 0) {
    console.error(`Storing ${name} failed: ${(result.stderr ?? "").split("\n").slice(-3).join(" ")}`);
    process.exit(1);
  }
  console.log(`stored ${name}`);
}
console.log(`App: ${app.html_url}`);
