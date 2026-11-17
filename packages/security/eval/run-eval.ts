/**
 * Model measurement for Stella Security: the same prompts and batch sizes the app uses,
 * on realistic cases with known answers, through OpenRouter (US-hosted providers only).
 *   bun eval/run-eval.ts --models openai/gpt-6-luna,deepseek/deepseek-v4.1-flash --reps 3
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { judgeChanges, triageEmails, type Story } from "../src/engine/judge.ts";
import { openRouterClient } from "../src/engine/model.ts";
import { buildFeed } from "../src/engine/news/feed.ts";
import { CHANGE_CASES } from "./changes-cases.ts";
import { EMAIL_CASES } from "./email-cases.ts";

const { values } = parseArgs({
  options: {
    models: { type: "string", default: "openai/gpt-6-luna,deepseek/deepseek-v4.1-flash,openai/gpt-6.1-terra,google/gemini-4-hydrogen" },
    reps: { type: "string", default: "3" },
    stories: { type: "string" },
    out: { type: "string", default: `${process.env.HOME}/.stella/outputs/stella-security/eval` },
    tasks: { type: "string", default: "changes,email,news" },
    reasoning: { type: "string" },
  },
});
const key = readFileSync(`${process.env.HOME}/.config/stella-security/openrouter-eval-key`, "utf8").trim();
const reps = Number(values.reps);
const tasks = new Set(values.tasks!.split(","));
mkdirSync(values.out!, { recursive: true });

// Today's real news with my labels: what must be found (and matchable), what must be left out.
const NEWS_MUST: { name: string; any: string[] }[] = [
  { name: "Optimizely 178-site skimmer", any: ["cnn.com", "bbc.com", "zoom.us", "ikea.com", "foxnews.com"] },
  { name: "Fandango card theft", any: ["fandango.com"] },
  { name: "Uber driver data", any: ["uber.com"] },
  { name: "StubHub breach", any: ["stubhub.com", "stubhub.ie", "stubhub.co.uk"] },
  { name: "Trezor orders", any: ["trezor.io"] },
  { name: "Fake EA reward site", any: ["ea.com"] },
  { name: "airBaltic bookings", any: ["airbaltic.com"] },
  { name: "CoinDCX customers", any: ["coindcx.com"] },
];
const NEWS_JUNK =
  /nsa\b|openai|extradit|flipper|seed|funding|\$125 million|supercomputer|fugaku|n-able|n-central|screenconnect|barracuda|infoblox|gitdoor|graphdoor|project zero|hertz|ipsos|iihf|hockey|andover|monadnock|crypto heist|power grid|delangue|tax accountant|bonta/i;

type Row = Record<string, unknown>;
const results: Row[] = [];
const stories: Story[] = values.stories ? JSON.parse(readFileSync(values.stories, "utf8")) : [];

await Promise.all(
  values.models!.split(",").map(async (modelId) => {
    const model = openRouterClient(modelId, key);
    const log = (s: string) => console.log(`[${modelId}] ${s}`);
    // ---- 1. computer changes
    if (tasks.has("changes"))
      for (let r = 0; r < reps; r++) {
        try {
          const res = await judgeChanges(model, CHANGE_CASES.map((c) => c.item), "mixed: each item names its own computer below");
          let score = 0;
          let falseAlarms = 0;
          let missedDanger = 0;
          let missing = 0;
          let dangerAsCheck = 0;
          const per: Row[] = [];
          for (const c of CHANGE_CASES) {
            const v = res.verdicts.find((x) => x.key === c.item.key);
            if (!v) {
              missing++;
              per.push({ note: c.note, expect: c.expect, got: "missing" });
              continue;
            }
            const flagged = v.verdict !== "fine";
            let s = 0;
            if (c.expect === "pass") {
              s = flagged ? 0 : 1;
              if (flagged) falseAlarms++;
            } else if (c.expect === "danger") {
              s = v.verdict === "danger" ? 1 : v.verdict === "check" ? 0.5 : 0;
              if (!flagged) missedDanger++;
              if (v.verdict === "check") dangerAsCheck++;
            } else s = flagged ? 1 : 0;
            score += s;
            per.push({ note: c.note, expect: c.expect, got: v.verdict, title: v.title, detail: v.detail, action: v.action });
          }
          results.push({ task: "changes", model: modelId, rep: r, score: score / CHANGE_CASES.length, falseAlarms, missedDanger, dangerAsCheck, missing, usage: res.usage, per });
          log(`changes rep${r}: ${((100 * score) / CHANGE_CASES.length).toFixed(1)}% falseAlarms=${falseAlarms} missedDanger=${missedDanger} dangerAsCheck=${dangerAsCheck} missing=${missing} cost=${res.usage.costUsd.toFixed(4)} ${res.usage.ms}ms`);
        } catch (e) {
          results.push({ task: "changes", model: modelId, rep: r, error: String(e) });
          log(`changes rep${r} ERROR ${e}`);
        }
      }
    // ---- 2. email
    if (tasks.has("email"))
      for (let r = 0; r < reps; r++) {
        try {
          const res = await triageEmails(model, EMAIL_CASES.map((c) => c.email));
          let right = 0;
          let fakeMissed = 0;
          let realCalledFake = 0;
          let normalFlagged = 0;
          let missing = 0;
          const per: Row[] = [];
          for (const c of EMAIL_CASES) {
            const v = res.verdicts.find((x) => x.key === c.email.key);
            if (!v) {
              missing++;
              continue;
            }
            if (v.verdict === c.expect) right++;
            if (c.expect === "fake" && v.verdict !== "fake") fakeMissed++;
            if (c.expect === "real_alert" && v.verdict === "fake") realCalledFake++;
            if (c.expect === "normal" && v.verdict !== "normal") normalFlagged++;
            per.push({ note: c.note, expect: c.expect, got: v.verdict, title: v.title, detail: v.detail });
          }
          results.push({ task: "email", model: modelId, rep: r, score: right / EMAIL_CASES.length, fakeMissed, realCalledFake, normalFlagged, missing, usage: res.usage, per });
          log(`email rep${r}: ${((100 * right) / EMAIL_CASES.length).toFixed(1)}% fakeMissed=${fakeMissed} realCalledFake=${realCalledFake} normalFlagged=${normalFlagged} missing=${missing} cost=${res.usage.costUsd.toFixed(4)} ${res.usage.ms}ms`);
        } catch (e) {
          results.push({ task: "email", model: modelId, rep: r, error: String(e) });
          log(`email rep${r} ERROR ${e}`);
        }
      }
    // ---- 3. news (once: it's the shared daily job)
    if (tasks.has("news") && stories.length) {
      try {
        const feed = await buildFeed(model, { stories });
        const domains = (t: { domains: string[] }) => t.domains.map((d) => d.toLowerCase());
        const found = NEWS_MUST.map((m) => ({ name: m.name, hit: feed.threats.some((t) => domains(t).some((d) => m.any.includes(d))) }));
        const recall = found.filter((f) => f.hit).length / NEWS_MUST.length;
        const junk = feed.threats.filter((t) => NEWS_JUNK.test(`${t.headline} ${t.title} ${t.sources.join(" ")}`));
        const matchable = feed.threats.filter((t) => t.domains.length || t.apps.length || t.extensions.length).length;
        const skim = feed.threats.filter((t) => domains(t).some((d) => ["cnn.com", "bbc.com", "zoom.us"].includes(d))).reduce((m, t) => Math.max(m, t.domains.length), 0);
        results.push({ task: "news", model: modelId, recall, found, junk: junk.map((t) => t.headline), threats: feed.threats.length, matchable, optimizelyDomains: skim, usage: feed.usage, feed });
        log(`news: recall ${(recall * 100).toFixed(0)}% threats=${feed.threats.length} matchable=${matchable} junk=${junk.length} optimizelyDomains=${skim} cost=${feed.usage.costUsd.toFixed(4)} ${feed.usage.ms}ms`);
      } catch (e) {
        results.push({ task: "news", model: modelId, error: String(e) });
        log(`news ERROR ${e}`);
      }
    }
  }),
);
const file = `${values.out}/results-${Date.now()}.json`;
writeFileSync(file, JSON.stringify(results, null, 1));
console.log("saved", file);
