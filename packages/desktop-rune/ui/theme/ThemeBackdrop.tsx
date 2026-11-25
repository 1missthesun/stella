import { useEffect, useRef, useState } from "react";
import type { GradientColor, GradientMode } from "@stella/theme";
import type { GradientReply, GradientRequest } from "./gradient-worker";
import { useTokens } from "./ThemeProvider";

const RENDER_SCALE = 0.6;

let worker: Worker | null = null;
let nextId = 0;
const waiting = new Map<number, (r: GradientReply) => void>();

function render(req: Omit<GradientRequest, "id">): Promise<GradientReply> {
  if (!worker) {
    const root = process.env.STELLA_RUNE_ROOT;
    worker = new Worker(root ? `${root}/ui/theme/gradient-worker.ts` : new URL("./gradient-worker.ts", import.meta.url).href);
    worker.onmessage = (e: MessageEvent<GradientReply>) => {
      waiting.get(e.data.id)?.(e.data);
      waiting.delete(e.data.id);
    };
  }
  const id = ++nextId;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    worker!.postMessage({ ...req, id });
  });
}

/**
 * The shell's shifting-gradient backdrop (desktop-ui's ShiftingGradient): the theme's blobs
 * rendered off the UI thread at 0.6× when the theme changes and stretched over the window, or
 * the plain background for flat themes.
 */
export function ThemeBackdrop({ id = "theme-backdrop", mode = "soft", colorMode = "relative" }: { id?: string; mode?: GradientMode; colorMode?: GradientColor }) {
  const t = useTokens();
  const size = useRef<{ w: number; h: number } | null>(null);
  const [measured, setMeasured] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const latest = useRef(0);
  const flat = t.flat || mode === "flat";

  useEffect(() => {
    if (flat || !size.current) return;
    const ticket = ++latest.current;
    void render({
      input: { colors: t.colors, isDark: t.dark, mode, colorMode, flat: t.flat, seedKey: t.themeId },
      width: size.current.w,
      height: size.current.h,
      scale: RENDER_SCALE,
    }).then((r) => {
      if (ticket === latest.current) setImage(r.path);
    });
  }, [t, mode, colorMode, flat, measured]);

  return (
    <box
      id={id}
      absolute={{ left: 0, top: 0, right: 0, bottom: 0 }}
      fill={t.c.background}
      onLayout={(r) => {
        size.current = { w: r.w, h: r.h };
        if (!measured && r.w > 0 && r.h > 0) setMeasured(true);
      }}
    >
      {!flat && image ? <image id={`${id}-image`} src={image} fit="stretch" w="full" h="full" enter={{ opacity: 0, dur: 0.25 }} /> : null}
    </box>
  );
}
