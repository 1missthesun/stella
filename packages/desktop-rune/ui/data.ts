import type { Message } from "../host/store";

// A realistic Stella conversation: 52 messages with Markdown, lists and code blocks.
const pairs: [string, string][] = [
  ["Morning. What's on today?", "Good morning. Three things need you today:\n\n1. **Dentist at 10:30**, I moved your 10:00 sync to 14:00 and told the team.\n2. The **landing page review** is due by end of day.\n3. Your flight to Lisbon is on Friday; check-in opens tomorrow at 09:15.\n\nEverything else can wait."],
  ["Can you check if the deploy from last night went out?", "It did. `web@4.18.2` went live at 23:41 and the error rate has been flat since:\n\n- p95 latency **212 ms** (was 230 ms)\n- 0 new Sentry issues\n- 2 rollbacks available if you need one"],
  ["Nice. Draft a short note to the team about it", "Here's a draft:\n\n> Last night's deploy is out and stable. Pages load a bit faster (p95 212 ms, down from 230 ms) and nothing new is breaking. Thanks everyone for the quick reviews.\n\nWant me to post it in #eng?"],
  ["Post it", "Posted in **#eng**. Two reactions already."],
  ["I need a quick script that renames all the screenshots on my desktop by date", "This keeps the originals' extensions and never overwrites a file:\n\n```bash\n#!/usr/bin/env bash\nset -euo pipefail\ncd ~/Desktop\nfor f in Screenshot*.png; do\n  d=$(date -r \"$f\" +%Y-%m-%d_%H%M%S)\n  n=\"shot_$d.png\"\n  [ -e \"$n\" ] || mv -- \"$f\" \"$n\"\ndone\n```\n\nI can run it for you; it would rename **38 files**. I'll keep a list of old and new names beside them."],
  ["Run it", "Done. 38 files renamed, the list is in `~/Desktop/renamed.txt`."],
  ["What's the weather in Lisbon on Friday?", "Sunny, **24°C** in the afternoon, a light breeze off the river. Evenings drop to 16°C, so bring a light jacket."],
  ["Find me a dinner spot near the hotel for Friday, not too fancy", "Three good options within a 10 minute walk:\n\n- **Taberna da Rua das Flores**: small plates, no reservations, go before 19:30\n- **Cervejaria Ramiro**: seafood, loud and fun, ~€35 a head\n- **O Velho Eurico**: classic Portuguese, tiny, books out fast\n\nWant me to try booking O Velho Eurico for 20:00?"],
  ["Yes for two", "Booked: **O Velho Eurico, Friday 20:00, 2 people**. It's in your calendar with the address."],
  ["Explain what a React reconciler actually does, briefly", "React builds a tree of what the UI *should* be. The **reconciler** compares the new tree with the previous one and works out the smallest set of changes, then asks a **host** to apply them.\n\nReact DOM is one host (it creates and edits DOM nodes). React Native is another. You can write your own host that turns those changes into anything, for example a binary command stream for a native renderer."],
  ["Show me a tiny host config", "The core of it is a handful of functions:\n\n```ts\nconst host = {\n  createInstance(type, props) {\n    const id = nextId++;\n    ops.create(id, type);\n    ops.props(id, JSON.stringify(props));\n    return { id };\n  },\n  appendChild: (p, c) => ops.append(p.id, c.id),\n  removeChild: (p, c) => ops.remove(p.id, c.id),\n  commitUpdate: (i, _t, _old, next) => ops.props(i.id, JSON.stringify(next)),\n  resetAfterCommit: () => flushFrame(),\n};\n```\n\nEverything else is bookkeeping (priorities, timeouts, suspense hooks)."],
  ["Remind me to call mum on Sunday", "I'll remind you **Sunday at 11:00**. Want it earlier?"],
  ["11 is fine", "Great, it's set."],
  ["How much did I spend on cloud last month?", "**$412.80** in October:\n\n- Cloudflare Workers + R2: $188.10\n- Fly.io: $121.40\n- AWS (mostly S3 egress): $78.30\n- Everything else: $25.00\n\nThat's 9% less than September, mostly from the egress fix."],
  ["Why was egress so high before?", "The image thumbnails were served straight from S3 without a cache in front, so every view paid egress. Moving them behind the CDN cut S3 egress from **1.9 TB** to **240 GB**."],
  ["Write a Rust function that clamps a spring's bounce", "```rust\n/// Bounce lives in (-1, 1): 0 is critically damped, above 0 overshoots.\npub fn clamp_bounce(b: f32) -> f32 {\n    if !b.is_finite() {\n        return 0.0;\n    }\n    b.clamp(-0.99, 0.99)\n}\n```\n\nNon-finite input falls back to a calm, critically damped spring rather than propagating a `NaN` into every frame."],
  ["Summarise the design review notes from yesterday", "## Design review, Tuesday\n\n- The hero should show the **real product**, not an illustration.\n- Copy is too long; cut the subtitle entirely.\n- Motion on the pricing cards feels slow; aim for snappy, around 250 ms.\n- Keep the footer calm and dark.\n\nOwner for all four: you, due **Thursday**."],
  ["Turn that into a checklist in my notes", "Added to **Notes → Landing page** as a checklist with four items, due Thursday."],
  ["What's the difference between RSS and PSS?", "**RSS** counts every page a process has in memory, including shared libraries, so adding up RSS across processes double counts what they share.\n\n**PSS** splits each shared page evenly between the processes using it, so the PSS of a whole app is a fair total. For multi-process apps like Electron, PSS is the honest number."],
  ["Check my inbox for anything urgent", "Two things look urgent:\n\n1. **Stripe**: a payout failed because the bank details expired. It retries in 3 days.\n2. **Maya**: asking if the contract can be signed today.\n\nThe other 14 new emails are newsletters and receipts."],
  ["Reply to Maya that I'll sign by 5pm", "Sent to Maya:\n\n> Hi Maya, I'll sign it by 5pm today. Thanks for the nudge.\n\nI'll remind you at 16:30."],
  ["How long would it take to drive to the airport on Friday at 7am?", "About **24 minutes** at 07:00 on a Friday. Leave by 06:45 to be safe; there's roadwork near the second roundabout."],
  ["Book a taxi for 6:40", "Booked a taxi for **Friday 06:40** from home to the airport. The driver's details arrive the night before."],
  ["Give me a regex for ISO dates", "For `YYYY-MM-DD` with a sane month and day range:\n\n```ts\nconst iso = /^(\\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$/;\niso.test(\"2026-11-25\"); // true\niso.test(\"2026-13-01\"); // false\n```\n\nIt doesn't know that February has 28 or 29 days; parse with `Date` afterwards if that matters."],
  ["What's a good name for a sidebar section that shows running tasks?", "A few options, shortest first:\n\n- **Now**\n- **Running**\n- **In progress**\n- **Working on**\n\nI'd pick *Now*: short, and it reads well next to *Today* and *Earlier*."],
  ["Ok, what's left for today?", "Just two things:\n\n- Sign Maya's contract by 17:00 (reminder at 16:30)\n- Landing page review, due end of day\n\nYour 14:00 sync moved, so the afternoon is clear until then."],
];

export function initialMessages(): Message[] {
  const out: Message[] = [];
  let h = 8, m = 2;
  pairs.forEach(([q, a], i) => {
    const at = () => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    out.push({ id: `u${i}`, role: "user", text: q, at: at() });
    m += 1;
    out.push({ id: `a${i}`, role: "assistant", text: a, at: at() });
    m += 7; if (m >= 60) { m -= 60; h += 1; }
  });
  return out;
}

export const chats = {
  today: ["Morning plan", "Lisbon trip", "Deploy check", "Landing page review"],
  earlier: ["Cloud costs October", "Screenshot cleanup", "Contract with Maya", "React reconciler notes", "Spring physics", "Inbox triage"],
};
