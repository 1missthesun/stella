#!/usr/bin/env node
// Call a backend function or read a live view as a test account, without
// printing tokens. Targets STELLA_BACKEND_URL (default: the dev deployment);
// the admin secret comes from the environment or workers/cloud-builder/.dev.vars
// (Previews share dev's admin secret).
//
//   node backend-call.mjs call <name> [argsJson]   POST /api/rpc/<name>
//   node backend-call.mjs view <name> [argsJson]   first value of a live view
//   node backend-call.mjs history <conversationId> conversation history
//
// The account is STELLA_VERIFY_ACCOUNT_EMAIL, else the current desktop run's
// account (.run/current.json), so calls act as the signed-in desktop owner.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(skillRoot, "../../..");
const backend = (process.env.STELLA_BACKEND_URL?.trim() || "https://stella-v2-cloud-builder-dev.fromyou.workers.dev").replace(/\/+$/, "");

const devVar = (name) => {
  const file = path.join(repoRoot, "workers/cloud-builder/.dev.vars");
  if (!existsSync(file)) return "";
  const line = readFileSync(file, "utf8").split("\n").find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim().replace(/^"(.*)"$/, "$1") : "";
};

const fail = (message) => {
  console.error(message);
  process.exit(2);
};

const accountEmail = () => {
  const explicit = process.env.STELLA_VERIFY_ACCOUNT_EMAIL?.trim();
  if (explicit) return explicit;
  const pointer = path.join(skillRoot, ".run/current.json");
  const email = existsSync(pointer) ? JSON.parse(readFileSync(pointer, "utf8"))?.account?.email : "";
  if (!email) fail("No account: set STELLA_VERIFY_ACCOUNT_EMAIL or launch a desktop run with --account.");
  return email;
};

const mintJwt = async () => {
  const secret = process.env.STELLA_ADMIN_API_SECRET?.trim() || devVar("STELLA_ADMIN_API_SECRET");
  if (!secret) fail("STELLA_ADMIN_API_SECRET is unavailable.");
  const response = await fetch(`${backend}/api/admin/test-accounts/session`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify({ email: accountEmail(), plan: "pro", usageMode: "unlimited" }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.token) fail(`Test account mint returned HTTP ${response.status}: ${payload?.error ?? ""}`);
  return payload.token;
};

const [mode, name, rawArgs] = process.argv.slice(2);
if (!mode || !name || !["call", "view", "history"].includes(mode)) {
  fail("usage: backend-call.mjs call|view <name> [argsJson] | history <conversationId>");
}
const args = rawArgs ? JSON.parse(rawArgs) : {};
const jwt = await mintJwt();

if (mode === "call") {
  const response = await fetch(`${backend}/api/rpc/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify({ args }),
  });
  console.log(JSON.stringify(await response.json(), null, 2));
} else if (mode === "history") {
  const response = await fetch(`${backend}/conversations/${encodeURIComponent(name)}/history`, {
    headers: { authorization: `Bearer ${jwt}` },
  });
  console.log(JSON.stringify(await response.json(), null, 2));
} else {
  const socket = new WebSocket(`${backend.replace(/^http/, "ws")}/owners/me/live`, [
    "stella.live.v1",
    `stella.token.${jwt}`,
  ]);
  const timer = setTimeout(() => fail("Timed out waiting for the view."), 15_000);
  socket.addEventListener("open", () => socket.send(JSON.stringify({ t: "sub", id: "1", view: name, args })));
  socket.addEventListener("message", (event) => {
    const frame = JSON.parse(String(event.data));
    if (frame.id !== "1") return;
    clearTimeout(timer);
    console.log(JSON.stringify(frame.t === "value" ? frame.value : frame, null, 2));
    socket.close();
    process.exitCode = frame.t === "value" ? 0 : 1;
  });
  socket.addEventListener("close", (event) => {
    if (event.code !== 1000 && event.code !== 1005) fail(`Live socket closed: ${event.code} ${event.reason}`);
  });
}
