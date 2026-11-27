import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const capture = (text, pattern) => pattern.exec(text)?.[1];

export async function check(root) {
  const problems = [];
  const site = path.join(root, "packages", "website");
  const read = (file) => readFileSync(path.join(site, file), "utf8");

  const config = read("next.config.ts");
  const pages = config.indexOf('source: "/chat-app/:path*"');
  const assets = config.indexOf('source: "/chat-app/assets/:path*"');
  if (pages < 0 || assets < 0 || assets < pages) {
    problems.push("next.config.ts: the /chat-app/assets/:path* headers must follow /chat-app/:path*, because Next keeps the last matching value");
  }

  for (const file of ["src/lib/moved-answers.ts", "src/lib/problems/moved-fix.ts"]) {
    if (/^\s*import\b|\bfrom\s+["']|\brequire\(/m.test(read(file))) {
      problems.push(`${file}: next.config.ts loads this file, so it can't import anything`);
    }
  }

  const key = capture(read("scripts/indexnow.ts"), /const KEY = "([0-9a-f]+)"/);
  const keyFile = path.join(site, "public", `${key}.txt`);
  if (!key || !existsSync(keyFile) || readFileSync(keyFile, "utf8").trim() !== key) {
    problems.push("scripts/indexnow.ts: IndexNow needs KEY served from public/<KEY>.txt");
  }

  const frame = read("src/app/chat/chat-frame-source.ts");
  const body = capture(frame, /^export function adoptChatFrameSource\([^)]*\): void \{\n([\s\S]*?)^\}/m);
  const outer = [...frame.matchAll(/^(?:export )?(?:const|let|var|function|class) (\w+)/gm)].map((match) => match[1]);
  const used = outer.filter((name) => body && new RegExp(`\\b${name}\\b`).test(body));
  if (!body || used.length > 0 || /^import /m.test(frame)) {
    problems.push(`src/app/chat/chat-frame-source.ts: adoptChatFrameSource runs as an inline script, so it can't use imports or module names (${used.join(", ")})`);
  }

  const dark = read("src/components/stella-demo/app.generated.css")
    .split("\n")
    .find((line) => line.startsWith('.sd[data-theme="dark"]'));
  const chat = capture(read("src/lib/problems/og.tsx"), /const CHAT = \{(.*)\};/) ?? "";
  for (const [color] of chat.matchAll(/#[0-9a-f]{6}/g)) {
    if (!dark?.includes(color)) problems.push(`src/lib/problems/og.tsx: CHAT color ${color} is not in the app's dark theme (app.generated.css)`);
  }

  const price = capture(read("src/lib/problems/index.ts"), /FREE_LINE = "([^"]+)"/);
  if (!price || !read("src/components/landing/opening.tsx").includes(`>${price}<`)) {
    problems.push("src/lib/problems/index.ts: FREE_LINE must match the home page's price line (landing/opening.tsx)");
  }

  return problems;
}
