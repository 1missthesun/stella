import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { waitForArt } from "./wait-for-art";

const base = process.env.STELLA_SCREENSHOT_URL ?? "http://localhost:3000";
const output = path.resolve(process.env.STELLA_SCREENSHOT_OUTPUT ?? "out/feature-graphic");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.STELLA_SCREENSHOT_BROWSER_CHANNEL });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
  await page.goto(`${base}/feature-graphic`, { waitUntil: "networkidle" });
  await waitForArt(page);
  await page.locator("[data-export-feature-graphic]").screenshot({ path: path.join(output, "feature-graphic.png"), scale: "css" });
  console.log(path.join(output, "feature-graphic.png"));
} finally {
  await browser.close();
}
