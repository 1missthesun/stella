import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { chromium } from "playwright";
import { devices, slides, type Device } from "../src/store/slides";
import { findClippedText, waitForArt } from "./wait-for-art";

const base = process.env.STELLA_SCREENSHOT_URL ?? "http://localhost:3000";
const requested = (process.env.STELLA_SCREENSHOT_DEVICES ?? Object.keys(devices).join(",")).split(",");
for (const device of requested) if (!(device in devices)) throw new Error(`Unknown device: ${device}`);
const output = path.resolve(
  process.env.STELLA_SCREENSHOT_OUTPUT ?? `out/store-${new Date().toISOString().replace(/[:.]/g, "-")}`,
);
await mkdir(output, { recursive: false });
const browser = await chromium.launch({ headless: true, channel: process.env.STELLA_SCREENSHOT_BROWSER_CHANNEL });
const exported = [];
const clipped: string[] = [];
try {
  for (const device of requested as Device[]) {
    const spec = devices[device];
    await mkdir(path.join(output, spec.group));
    const page = await browser.newPage({ viewport: { width: spec.width, height: spec.height }, deviceScaleFactor: 1 });
    await page.goto(`${base}/?device=${device}&export=1`, { waitUntil: "networkidle" });
    await waitForArt(page);
    for (const [index, slide] of slides.entries()) {
      for (const problem of await findClippedText(page, slide.slug)) clipped.push(`${device}/${slide.slug}: ${problem}`);
      const file = `${spec.group}/${index + 1}-${slide.slug}.png`;
      const bytes = await page.locator(`[data-export-slide="${slide.slug}"]`).screenshot({
        path: path.join(output, file), animations: "disabled", caret: "hide", scale: "css",
      });
      exported.push({ file, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), sha256: createHash("sha256").update(bytes).digest("hex") });
      console.log(file);
    }
    await page.close();
  }
  await writeFile(path.join(output, "manifest.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), status: "review-required", exports: exported }, null, 2) + "\n");
} finally {
  await browser.close();
}
if (clipped.length) throw new Error(`Clipped text:\n${clipped.join("\n")}`);
console.log(`Review PNGs and manifest: ${output}`);
