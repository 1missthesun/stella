#!/usr/bin/env node
// Headless cloud-turn harness: drives one cloud conversation turn against the
// dev cloud-builder worker as a Pro test owner without launching the Electron
// verifier, then polls the conversation's canonical history on the worker
// until the turn's final assistant message lands.
//
//   node .agents/skills/verify-stella/cloud-turn.mjs --prompt "..." [--conversation <id>] [--email <owner>] [--wait 180] [--agent-runtime pi] [--watch-pi] [--locale es] [--attach <drive path>] [--engine chatgpt|provider [--provider <id>] --model <id> [--effort <level>]] [--wait-report]
//   (--prompt-file <path> instead of --prompt for prompts too long for one argument)
//
// `--agent-runtime pi` creates the conversation on the pi-durable runtime; it
// only takes effect on the turn that creates the conversation.
//
// `--locale` sends the turn with that reply-language locale, as a client in
// that language does.
//
// `--engine chatgpt --model <id>` sends the turn for the owner's ChatGPT plan
// (`--effort`, default `default`), as a client whose cloud engine is ChatGPT
// does. A test owner has no ChatGPT sign-in, so the gateway refuses the
// model call after checking it.
//
// `--engine provider --provider <id> --model <id>` sends the turn for a model
// on a provider key saved to the owner's account (`providers.setApiKey`).
//
// `--watch-pi` also opens the conversation socket with `pi=1`, prints the pi
// view's frames as they arrive, and folds them with the clients' reducer
// (`@stella/contracts/pi-chat`) into the final state it prints. Each user
// entry says whether the clients' rule (`piUserHidden`) hides it.
//
// `--wait-report` keeps polling past the turn's answer until an agent's
// report (`[Agent completed]`, `[Task failed]`, `[Task canceled]`) has arrived
// and been answered, for a turn that starts an agent.
//
// `--plan free [--allowance spent]` runs as a free owner (with its allowance
// used up), for checking what a free account can still run, like its own keys.
// `--plan plus|max` runs metered on that plan's budget; the default `pro` is
// unlimited.
//
// A follow-up into an existing conversation must arrive as the same owner, so
// pass the `--email` the first run printed together with its `--conversation`.
//
// Needs STELLA_ADMIN_API_SECRET (mints the test owner, dev only) from the
// environment or the gitignored workers/cloud-builder/.dev.vars, and
// STELLA_BACKEND_URL (defaults to the dev deployment).
//
// The route is `POST /conversations/:id/turns` with the test owner's JWT, as a
// signed-in client sends it. Nothing here prints a secret; evidence is the
// JSON the worker returns.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { ADMIN_SECRET_HELP, adminApiSecret } from "./cli/dev-vars.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const builderUrl = (
  process.env.STELLA_BACKEND_URL ?? "https://stella-v2-cloud-builder-dev.fromyou.workers.dev"
).replace(/\/+$/, "");
const promptFile = flag("--prompt-file");
const prompt = flag("--prompt") ?? (promptFile ? readFileSync(promptFile, "utf8") : undefined);
if (!prompt) {
  console.error("--prompt or --prompt-file is required");
  process.exit(2);
}
const waitSeconds = Number(flag("--wait", "180"));
const agentRuntime = flag("--agent-runtime");
const locale = flag("--locale");
const attach = flag("--attach");
const watchPi = args.includes("--watch-pi");
const waitReport = args.includes("--wait-report");
const isReport = (message) =>
  message?.role === "user" && /\[(Agent completed|Task failed|Task canceled)\]/.test(JSON.stringify(message.content ?? ""));
const engine = flag("--engine");
const execution = engine
  ? { engine, provider: flag("--provider", engine), model: flag("--model", ""), reasoningEffort: flag("--effort", "default") }
  : undefined;
const adminSecret = adminApiSecret();
if (!adminSecret) {
  console.error(`STELLA_ADMIN_API_SECRET is unavailable. ${ADMIN_SECRET_HELP}`);
  process.exit(2);
}

const plan = flag("--plan", "pro");
const email = flag("--email", `agent-headless-${randomUUID().slice(0, 8)}@test.stella.local`);
const session = await (
  await fetch(`${builderUrl}/api/admin/test-accounts/session`, {
    method: "POST",
    headers: { authorization: `Bearer ${adminSecret}`, "content-type": "application/json" },
    body: JSON.stringify(
      plan === "pro"
        ? { email, plan: "pro", usageMode: "unlimited" }
        : { email, plan, ...(flag("--allowance") ? { allowance: flag("--allowance") } : {}) },
    ),
  })
).json();
const ownerId = session.ownerId;
const JWT_REFRESH_AFTER_MS = 10 * 60_000;
let jwt = session.token;
let jwtMintedAt = Date.now();
const refreshJwt = async () => {
  const response = await fetch(`${builderUrl}/api/auth/token`, { headers: { authorization: `Bearer ${session.sessionToken}` } });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.token) throw new Error(`Could not refresh the test account's JWT: HTTP ${response.status}.`);
  jwt = body.token;
  jwtMintedAt = Date.now();
};
const authedFetch = async (url, init = {}) => {
  if (Date.now() - jwtMintedAt > JWT_REFRESH_AFTER_MS) await refreshJwt();
  const send = () => fetch(url, { ...init, headers: { ...init.headers, authorization: `Bearer ${jwt}` } });
  const response = await send();
  if (response.status !== 401) return response;
  await refreshJwt();
  return send();
};
const conversationId = flag("--conversation", randomUUID());
const started = await authedFetch(`${builderUrl}/conversations/${conversationId}/turns`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
  },
  body: JSON.stringify({
    protocol: 1,
    clientMsgId: randomUUID(),
    prompt,
    lane: "chat",
    ...(agentRuntime ? { agentRuntime } : {}),
    ...(locale ? { locale } : {}),
    ...(attach ? { attachments: [attach] } : {}),
    ...(execution ? { execution } : {}),
  }),
});
const startedBody = await started.json().catch(() => null);
console.log(JSON.stringify({ ownerId, email, conversationId, status: started.status, response: startedBody }));
if (!started.ok) process.exit(1);

let pi;
if (watchPi) {
  const { emptyPiChat, reducePiChat, piMessageText, piUserHidden } = await import("../../../packages/contracts/pi-chat.ts");
  pi = { state: emptyPiChat(), frames: 0, piMessageText, piUserHidden };
  const socket = new WebSocket(
    `${builderUrl.replace(/^http/, "ws")}/conversations/${conversationId}/socket?protocol=1&pi=1`,
    ["stella.v1", `stella.token.${jwt}`],
  );
  pi.socket = socket;
  const brief = (entry) => ({
    id: entry.id,
    kind: entry.kind,
    text: piMessageText(entry.model?.[0]).slice(0, 80),
    ...(entry.kind === "pi.user" && entry.model?.[0]?.role === "user" ? { hidden: piUserHidden(entry.model[0]) } : {}),
  });
  socket.onmessage = (message) => {
    const frame = JSON.parse(String(message.data));
    if (frame.type === "pi.snapshot") {
      pi.frames += 1;
      pi.state = reducePiChat({ ...pi.state, hasOlder: frame.hasOlder }, [frame.snapshot]);
      console.log(JSON.stringify({ pi: "snapshot", entries: frame.snapshot.entries.length, running: Boolean(frame.snapshot.run), hasOlder: frame.hasOlder }));
      for (const entry of frame.snapshot.entries) console.log(JSON.stringify({ pi: "snapshot-entry", entry: brief(entry) }));
    } else if (frame.type === "pi.events") {
      pi.frames += 1;
      pi.state = reducePiChat(pi.state, frame.events);
      for (const event of frame.events) {
        if (event.type === "message_update") continue;
        const entry = event.entry ? brief(event.entry) : undefined;
        console.log(JSON.stringify({ pi: event.type, ...(entry ? { entry } : {}), ...(event.record ? { submission: event.record.status } : {}) }));
      }
    } else if (frame.type === "error") {
      console.log(JSON.stringify({ pi: "socket-error", frame }));
    }
  };
  socket.onclose = (event) => console.log(JSON.stringify({ pi: "socket-closed", code: event.code }));
}

const deadline = Date.now() + waitSeconds * 1000;
let printed = -1;
let promptAt = -1;
while (Date.now() < deadline) {
  const response = await authedFetch(`${builderUrl}/conversations/${conversationId}/history`);
  const body = await response.json().catch(() => null);
  const messages = Array.isArray(body?.history) ? body.history.map((entry) => JSON.parse(entry)) : [];
  if (promptAt < 0) {
    promptAt = messages.findLastIndex(
      (message) =>
        message.role === "user" &&
        JSON.stringify(message.content ?? "").includes(JSON.stringify(prompt).slice(1, -1)),
    );
    printed = promptAt;
  }
  for (let index = Math.max(printed + 1, 0); index < messages.length; index += 1) {
    console.log(JSON.stringify(messages[index]));
    printed = index;
  }
  const last = messages.at(-1);
  const reported = !waitReport || messages.slice(promptAt + 1).some(isReport);
  if (promptAt >= 0 && messages.length - 1 > promptAt && last?.role === "assistant" && last.stopReason !== "toolUse" && reported) {
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 5000));
}

if (pi) {
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const answers = pi.state.entries.filter((entry) => entry.kind === "pi.assistant");
  console.log(
    JSON.stringify({
      pi: "state",
      frames: pi.frames,
      entries: pi.state.entries.length,
      running: pi.state.running,
      lastAnswer: pi.piMessageText(answers.at(-1)?.model?.[0]).slice(0, 200),
    }),
  );
  pi.socket.close();
}
