// Rune's `serveRendererSource`. Electron main builds desktop-ui for Chromium in a source worker;
// in Rune the UI is the host's hot-swapped `ui/`, so only the protocols WebViews read from
// (stella-media, canvas) are served, and interface changes go to the host's UI swap.

import { serveCanvasProtocol } from "../../../desktop/electron/source/canvas-protocol";
import { serveMediaProtocol } from "../../../desktop/electron/source/media-protocol";
import { RENDERER_ORIGIN } from "../../../desktop/electron/source/origin";

export type RendererApplyOutcome =
  | { mode: "none" | "hot" }
  | { mode: "swap"; swaps: number }
  | { mode: "reload"; reason?: string }
  | { mode: "failed"; error: string; reloaded: boolean };

type RendererSourceHandle = {
  applyChanges(paths: string[], options?: { reload?: boolean }): Promise<RendererApplyOutcome>;
  quietFor(): Promise<number | null>;
  dispose(): void;
};

export type UiSwapTarget = {
  apply(paths: string[], options?: { reload?: boolean }): Promise<RendererApplyOutcome>;
  quietFor(): Promise<number | null>;
};

let target: UiSwapTarget | null = null;

/** The host's UI loader registers here so app-source interface changes reach the running UI. */
export function setUiSwapTarget(next: UiSwapTarget | null) {
  target = next;
}

export const serveRendererSource = (options: { partition: string; log: (message: string) => void }): RendererSourceHandle => {
  serveMediaProtocol(options.partition, { readerOrigin: RENDERER_ORIGIN });
  serveCanvasProtocol(options.partition);
  return {
    async applyChanges(paths, applyOptions) {
      if (!target) return { mode: "reload", reason: "The interface host is not running." };
      return await target.apply(paths, applyOptions);
    },
    async quietFor() {
      return (await target?.quietFor()) ?? null;
    },
    dispose() {
      target = null;
    },
  };
};
