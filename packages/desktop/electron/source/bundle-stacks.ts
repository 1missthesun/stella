import fs from "node:fs";
import { SourceMap } from "node:module";
import path from "node:path";
import { RENDERER_ORIGIN } from "./origin.js";
import { BUNDLE_SCRIPT_PREFIX, bundlesDirIn } from "./page-bundle-paths.js";

const FRAME = new RegExp(`${RENDERER_ORIGIN}${BUNDLE_SCRIPT_PREFIX}([\\w-]+)\\.js:(\\d+):(\\d+)`, "g");
const KEEP_MAP_MS = 30_000;

let kept: { id: string; map: Promise<SourceMap | null> } | null = null;

const mapFor = (cacheDir: string, id: string): Promise<SourceMap | null> => {
  if (kept?.id !== id) {
    const map = fs.promises
      .readFile(path.join(bundlesDirIn(cacheDir), `${id}.js.map`), "utf8")
      .then((body) => new SourceMap(JSON.parse(body)))
      .catch(() => null);
    const mine = { id, map };
    kept = mine;
    setTimeout(() => {
      if (kept === mine) kept = null;
    }, KEEP_MAP_MS).unref?.();
  }
  return kept!.map;
};

/** A renderer stack trace with the frames in page bundles put back on the source files they came from. */
export const resolveBundleFrames = async (text: string, cacheDir: string): Promise<string> => {
  const frames = [...text.matchAll(FRAME)];
  if (frames.length === 0) return text;
  const places = new Map<string, string>();
  for (const [frame, id, line, column] of frames) {
    const map = await mapFor(cacheDir, id!);
    const entry = map?.findEntry(Number(line) - 1, Number(column) - 1);
    if (entry && "originalSource" in entry && entry.originalSource) {
      places.set(frame!, `${RENDERER_ORIGIN}${entry.originalSource}:${entry.originalLine + 1}:${entry.originalColumn + 1}`);
    }
  }
  return text.replace(FRAME, (frame) => places.get(frame) ?? frame);
};
