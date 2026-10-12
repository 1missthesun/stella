#!/usr/bin/env node
import { ADMIN_SECRET_HELP, adminApiSecret } from "../cli/dev-vars.mjs";

const TEST_ACCOUNT_SUFFIX = "@test.stella.local";
const DEV_BACKEND_URL = "https://stella-v2-cloud-builder-dev.fromyou.workers.dev";

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(2);
};

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const plan = (option("--plan") ?? "pro").toLowerCase();
if (!["free", "go", "pro"].includes(plan)) fail("--plan must be free, go, or pro.");
const email = (option("--email") ?? process.env.STELLA_VERIFY_ACCOUNT_EMAIL ?? "").trim().toLowerCase();
if (email && !email.endsWith(TEST_ACCOUNT_SUFFIX)) fail(`--email must end with ${TEST_ACCOUNT_SUFFIX}.`);

const backendUrl = (process.env.STELLA_BACKEND_URL?.trim() || DEV_BACKEND_URL).replace(/\/+$/, "");
const secret = adminApiSecret();
if (!secret) {
  fail(`STELLA_ADMIN_API_SECRET is unavailable. ${ADMIN_SECRET_HELP}`);
}

const body = { plan, ...(plan === "free" ? {} : { usageMode: "unlimited" }), ...(email ? { email } : {}) };
let response;
try {
  response = await fetch(`${backendUrl}/api/admin/test-accounts/session`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
} catch (error) {
  fail(`Test account request failed: ${error instanceof Error ? error.message : String(error)}`);
}
const text = await response.text();
let payload = null;
try {
  payload = JSON.parse(text);
} catch {
  payload = null;
}
if (!response.ok) {
  fail(
    response.status === 404
      ? `HTTP 404 from ${backendUrl}: test accounts are disabled there (only the dev backend sets STELLA_TEST_ACCOUNTS=1).`
      : `Test account mint returned HTTP ${response.status}: ${payload?.error ?? text.slice(0, 200)}`,
  );
}
if (typeof payload?.oneTimeToken !== "string" || !payload.oneTimeToken) {
  fail(`The backend at ${backendUrl} returned no oneTimeToken; deploy the current cloud-builder to it.`);
}

process.stdout.write(
  `${JSON.stringify({
    email: payload.email,
    ownerId: payload.ownerId,
    plan: payload.plan,
    url: `stella-mobile://dev-test-session?ott=${encodeURIComponent(payload.oneTimeToken)}`,
  })}\n`,
);
