#!/usr/bin/env bun
/**
 * Stella Security from the command line: runs the same check the app runs and prints it.
 *   bun src/cli.ts scan [--data-dir DIR] [--model openai/gpt-6-luna] [--json] [--email a@b.com]
 * Read-only on this computer: it reads files and settings, never changes them.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { openRouterClient, type ModelClient } from "./engine/model.ts";
import { DEV_BACKEND, createStellaAccount } from "./app/stella-account.ts";
import { runScan } from "./engine/scan.ts";
import { defaultDataDir } from "./engine/state.ts";
import { home } from "./engine/util.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "data-dir": { type: "string" },
    model: { type: "string", default: "deepseek/deepseek-v4.1-flash" },
    json: { type: "boolean", default: false },
    email: { type: "string", multiple: true },
    /** Development: sign in as a Stella dev test account (needs STELLA_ADMIN_API_SECRET) and use Stella's gateway. */
    "stella-test-account": { type: "string" },
    /** Download the shared news feed from a Stella backend instead of reading the news here. */
    "feed-url": { type: "string" },
  },
});

const cmd = positionals[0] ?? "scan";
if (cmd !== "scan") throw new Error(`unknown command ${cmd}`);
const keyFile = process.env.STELLA_SECURITY_OPENROUTER_KEY_FILE ?? home(".config/stella-security/openrouter-eval-key");
let key = process.env.OPENROUTER_API_KEY;
try {
  key ??= readFileSync(keyFile, "utf8").trim();
} catch {
  /* no model: plain checks only */
}
let model: ModelClient | undefined = key && !values["stella-test-account"] ? openRouterClient(values.model!, key) : undefined;
if (values["stella-test-account"]) {
  const admin = process.env.STELLA_ADMIN_API_SECRET;
  if (!admin) throw new Error("STELLA_ADMIN_API_SECRET is needed for --stella-test-account");
  const r = await fetch(`${DEV_BACKEND}/api/admin/test-accounts/session`, { method: "POST", headers: { authorization: `Bearer ${admin}`, "content-type": "application/json" }, body: JSON.stringify({ email: values["stella-test-account"], plan: "plus" }) });
  if (!r.ok) throw new Error(`test account: HTTP ${r.status}`);
  const { sessionToken } = (await r.json()) as { sessionToken: string };
  const mem: Record<string, string> = {};
  const acct = createStellaAccount(DEV_BACKEND, { get: (k) => mem[k], set: (k, v) => (v === undefined ? delete mem[k] : (mem[k] = v), undefined) });
  acct.useSession(sessionToken);
  model = await acct.model(values.model!);
}
const summary = await runScan({
  dataDir: values["data-dir"] ?? defaultDataDir(),
  ...(model ? { model } : {}),
  ...(values.email ? { emails: values.email } : {}),
  ...(values["feed-url"] ? { feedUrl: values["feed-url"] } : {}),
  onProgress: (l) => !values.json && console.error(`… ${l}`),
});
if (values.json) console.log(JSON.stringify(summary, null, 1));
else {
  const n = summary.needsYou.length;
  console.log(`\n${n === 0 ? "You're safe." : `${n} thing${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} you`}\n`);
  for (const f of summary.needsYou) console.log(`● ${f.title}\n  ${f.detail}${f.action ? `\n  [${f.action.label}]` : ""}\n`);
  console.log("Handled");
  for (const h of summary.handled) console.log(`  ${h.text}`);
  if (summary.errors.length) console.log("\nCouldn't check:", summary.errors.map((e) => `${e.check}: ${e.message}`).join("; "));
  console.log(`\n${((summary.finishedAt - summary.startedAt) / 1000).toFixed(1)}s · model calls ${summary.model.calls} · $${summary.model.costUsd.toFixed(4)}`);
}
