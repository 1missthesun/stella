import sharp from "sharp";
import path from "path";

const DIR = "public/demos";
const SOURCES = [
  "canvas-sheet.png",
  "canvas-app.png",
  "canvas-multitask.png",
];
const QUALITY = 88;
const WIDTHS = [
  { width: 1280, suffix: "-1280" },
  { width: 2560, suffix: "" },
];

for (const file of SOURCES) {
  const input = path.join(DIR, file);
  const base = file.replace(/\.png$/, "");

  for (const { width, suffix } of WIDTHS) {
    const output = path.join(DIR, `${base}${suffix}.webp`);
    const info = await sharp(input)
      .resize(width)
      .webp({ quality: QUALITY, effort: 4 })
      .toFile(output);
    console.log(
      `${output}  ${info.width}x${info.height}  ${Math.round(info.size / 1024)}KB`,
    );
  }
}
