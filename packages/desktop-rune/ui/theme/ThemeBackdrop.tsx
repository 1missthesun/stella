import { useEffect, useRef, useState } from "react";
import type { GradientColor, GradientMode } from "@stella/theme";
import { renderGradientFile, type GradientReply, type GradientRequest } from "./gradient-file";
import { useTokens } from "./ThemeProvider";

const RENDER_SCALE = 0.6;
const WORKER_ANSWER_MS = 4000;

let worker: Worker | null = null;
let nextId = 0;
const waiting = new Map<number, (r: GradientReply | null) => void>();

const dropWorker = () => {
  worker?.terminate();
  worker = null;
  for (const answer of waiting.values()) answer(null);
  waiting.clear();
};

function inWorker(req: GradientRequest): Promise<GradientReply | null> {
  if (!worker) {
    const root = process.env.STELLA_RUNE_ROOT;
    worker = new Worker(root ? `${root}/ui/theme/gradient-worker.ts` : new URL("./gradient-worker.ts", import.meta.url).href);
    worker.onmessage = (e: MessageEvent<GradientReply>) => {
      waiting.get(e.data.id)?.(e.data);
      waiting.delete(e.data.id);
    };
    worker.onerror = dropWorker;
  }
  const sent = worker;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (waiting.delete(req.id)) resolve(null);
      if (worker === sent && waiting.size === 0) dropWorker();
    }, WORKER_ANSWER_MS);
    waiting.set(req.id, (reply) => {
      clearTimeout(timer);
      resolve(reply);
    });
    sent.postMessage(req);
  });
}

async function render(req: Omit<GradientRequest, "id">): Promise<GradientReply> {
  const full = { ...req, id: ++nextId };
  return (await inWorker(full)) ?? renderGradientFile(full);
}

/**
 * The shell's shifting-gradient backdrop (desktop-ui's ShiftingGradient): the theme's blobs
 * rendered off the UI thread at 0.6× when the theme changes and stretched over the window, or
 * the plain background for flat themes.
 */
export function ThemeBackdrop({ id = "theme-backdrop", mode = "soft", colorMode = "relative" }: { id?: string; mode?: GradientMode; colorMode?: GradientColor }) {
  const t = useTokens();
  const size = useRef<{ w: number; h: number } | null>(window.innerWidth > 0 && window.innerHeight > 0 ? { w: window.innerWidth, h: window.innerHeight } : null);
  const [measured, setMeasured] = useState(size.current !== null);
  const [image, setImage] = useState<string | null>(null);
  const latest = useRef(0);
  const flat = t.flat;

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
