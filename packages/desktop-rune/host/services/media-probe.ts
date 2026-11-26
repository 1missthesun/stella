// Rune's offscreen media probe (master: services/offscreen-media-probe.ts). Master plays the clip
// in a hidden Chromium page from `stella-media:`; WebKitGTK's media player takes no custom scheme,
// so the engine reads the clip with Rune's own decoder (the one its `<video>` plays with) and
// master's page stays the fallback for what that decoder doesn't open.

import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { engine } from "../bridge";

const PROBE_MODULE = path.resolve(import.meta.dir, "../../../desktop/electron/services/offscreen-media-probe.ts");

const master = () =>
  createRequire(import.meta.url)(PROBE_MODULE) as {
    __electron_offscreenVideoPoster(filePath: string, boxWidth: number, boxHeight: number): Promise<string | null>;
    __electron_offscreenMediaDurationMs(filePath: string): Promise<number | null>;
  };

let posters = 0;

export const offscreenVideoPoster = async (
  filePath: string,
  boxWidth: number,
  boxHeight: number,
): Promise<string | null> => {
  const out = path.join(os.tmpdir(), `stella-rune-poster-${process.pid}-${(posters += 1)}.jpg`);
  try {
    const probed = await engine.media.probe(filePath, { width: Math.round(boxWidth), height: Math.round(boxHeight), out });
    if (probed.poster) return `data:image/jpeg;base64,${(await fs.readFile(probed.poster)).toString("base64")}`;
  } catch {
    // Rune's decoder can't open it: master's page may.
  } finally {
    await fs.rm(out, { force: true });
  }
  return await master().__electron_offscreenVideoPoster(filePath, boxWidth, boxHeight);
};

export const offscreenMediaDurationMs = async (filePath: string): Promise<number | null> => {
  const probed = await engine.media.probe(filePath).catch(() => null);
  const ms = probed && Number.isFinite(probed.duration) ? Math.round(probed.duration * 1000) : 0;
  return ms > 0 ? ms : await master().__electron_offscreenMediaDurationMs(filePath);
};
