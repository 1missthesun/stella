// node seed.mjs <cmd> ...   cmd: seed <n> <startIndex> | checkpoint <keptSeq> | probe | identity
import { readFileSync } from "node:fs";
const vars = Object.fromEntries(readFileSync(process.env.DEV_VARS, "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const backend = process.env.STELLA_BACKEND_URL.replace(/\/+$/, "");
const email = process.env.EMAIL, conv = process.env.CONV;
const mint = async () => {
  const r = await fetch(`${backend}/api/admin/test-accounts/session`, { method: "POST", headers: { authorization: `Bearer ${vars.STELLA_ADMIN_API_SECRET}`, "content-type": "application/json" }, body: JSON.stringify({ email, plan: "pro", usageMode: "unlimited" }) });
  return (await r.json()).token;
};
const rpc = async (jwt, name, args = {}) => (await (await fetch(`${backend}/api/rpc/${name}`, { method: "POST", headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" }, body: JSON.stringify(args) })).json());
const probe = async () => {
  const r = await fetch(`${backend}/conversations/${conv}/journal?limit=1`, { headers: { authorization: `Bearer ${vars.BUILDER_SERVICE_SECRET}` } });
  const j = await r.json();
  return { status: r.status, databaseBytes: j.databaseBytes, storedBytes: j.storedBytes, hot: j.hot, head: j.head?.headSeq, checkpoint: j.checkpoint && { throughSeq: j.checkpoint.throughSeq }, spills: j.spillObjects };
};
const syll = ["ka","lo","mi","ne","ru","ta","vi","so","pe","du","gri","fan","tel","bor","zu","qi","wex","yal","hom","jip"];
let rng = 12345; const rand = (n) => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng % n; };
const word = () => { let w = ""; const k = 2 + rand(3); for (let i = 0; i < k; i++) w += syll[rand(syll.length)]; return w; };
const text = (bytes, tag) => { let s = `Seeded note ${tag}. `; while (s.length < bytes) s += word() + (rand(12) === 0 ? ". " : " "); return s; };
const [cmd, a1, a2] = process.argv.slice(2);
if (cmd === "probe") { console.log(JSON.stringify(await probe())); process.exit(0); }
const jwt = await mint();
const ident = await rpc(jwt, "owner.identity");
const gen = ident.value.ownerGeneration;
if (cmd === "identity") { console.log(gen); process.exit(0); }
if (cmd === "checkpoint") {
  const r = await fetch(`${backend}/conversations/${conv}/checkpoint`, { method: "POST", headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" }, body: JSON.stringify({ expectedOwnerGeneration: gen, summary: "Summary of the seeded notes so far: the user shared many seeded notes; the codeword was PELICAN-7731.", firstKept: { seq: Number(a1) } }) });
  console.log(r.status, await r.text()); process.exit(0);
}
if (cmd === "seed") {
  const n = Number(a1), start = Number(a2 ?? 0);
  for (let i = start; i < start + n; i++) {
    const now = Date.now();
    const user = { role: "user", content: [{ type: "text", text: text(20000, `N${i}` + (i % 25 === 0 ? ` marker FLAMINGO${i}` : "")) }], timestamp: now };
    const asst = { role: "assistant", content: [{ type: "text", text: `Noted ${i}.` }], api: "openai-completions", provider: "stella", model: "seed", stopReason: "stop", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, timestamp: now + 1 };
    for (;;) {
      const r = await fetch(`${backend}/conversations/${conv}/journal`, { method: "POST", headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" }, body: JSON.stringify({ deviceId: "seed-device", expectedOwnerGeneration: gen, localTurnId: `seed-${i}`, source: "voice", records: [{ kind: "message", role: "user", payloadJson: JSON.stringify(user) }, { kind: "message", role: "assistant", payloadJson: JSON.stringify(asst) }] }) });
      if (r.status === 429) { await new Promise((res) => setTimeout(res, 5000)); continue; }
      if (!r.ok) { console.log(i, r.status, await r.text()); process.exit(1); }
      break;
    }
    if (i % 25 === 0) console.log(i, JSON.stringify(await probe()));
    await new Promise((res) => setTimeout(res, 1050));
  }
  console.log("done", JSON.stringify(await probe()));
}
