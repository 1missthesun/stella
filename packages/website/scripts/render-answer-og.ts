// Renders the 1200x630 share images for /ai and every /ai/<slug> page into
// public/og/ai/, in the answer pages' own type (Mona Sans + Martian Mono).
// Run after changing an answer page's eyebrow or headline:
//   bun scripts/render-answer-og.ts            (uses `chromium`; set CHROME to override)
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import { ANSWER_PAGES, PRICE_LINE } from "../src/lib/answers";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "public/og/ai");
const chrome = process.env.CHROME || "chromium";
const logo = readFileSync(path.join(root, "public/stella-logo.svg"), "utf8");

const esc = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function html(eyebrow: string, headline: string): string {
  const size = headline.length > 34 ? 96 : headline.length > 24 ? 108 : 124;
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Martian+Mono:wght@400&family=Mona+Sans:wght@500;700;820&display=block" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0}
html,body{width:1200px;height:630px;background:#fff;overflow:hidden}
body{position:relative;padding:64px 72px;font-family:"Mona Sans",sans-serif;color:#0a0a0d}
.brand{display:flex;align-items:center;gap:12px;font-weight:700;font-size:28px;letter-spacing:-.02em}
.brand svg{width:38px;height:38px}
.eyebrow{margin-top:58px;font-family:"Martian Mono",monospace;font-size:19px;letter-spacing:.08em;text-transform:uppercase;color:rgba(10,10,13,.5)}
h1{margin-top:22px;max-width:${headline.length > 34 ? 18 : 15}ch;font-size:${size}px;font-weight:820;line-height:.9;letter-spacing:-.062em}
.foot{position:absolute;left:72px;right:72px;bottom:56px;display:flex;justify-content:space-between;align-items:flex-end;padding-top:20px;border-top:1px solid rgba(10,10,13,.14);font-family:"Martian Mono",monospace;font-size:17px;color:rgba(10,10,13,.6)}
.foot b{font-weight:400;color:#703cff}
</style></head><body>
<div class="brand">${logo}<span>Stella</span></div>
<p class="eyebrow">${esc(eyebrow)}</p>
<h1>${esc(headline)}</h1>
<div class="foot"><span>${esc(PRICE_LINE)}</span><b>stella.sh</b></div>
</body></html>`;
}

function shoot(name: string, page: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "stella-og-"));
  try {
    const file = path.join(dir, "og.html");
    writeFileSync(file, page);
    execFileSync(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        "--window-size=1200,630",
        "--virtual-time-budget=6000",
        `--screenshot=${path.join(out, `${name}.png`)}`,
        `file://${file}`,
      ],
      { stdio: "ignore" },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`public/og/ai/${name}.png`);
}

mkdirSync(out, { recursive: true });
shoot("index", html("Stella answers", "Compared and explained."));
for (const page of ANSWER_PAGES) {
  shoot(page.slug, html(page.kind === "compare" ? "An honest comparison" : page.eyebrow, page.headline));
}
