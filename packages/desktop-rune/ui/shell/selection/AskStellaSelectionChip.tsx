import { useCallback, useEffect, useRef, useState } from "react";
import { dispatchComposeText } from "@/shared/lib/stella-orb-chat";
import type { Layout } from "../../../host/rune-jsx/props";
import { Icon, Icons, StellaMark } from "../../kit";
import { engine } from "../../kit/engine";
import { parseColorOr } from "@stella/theme";
import { derive, fontSize, hex, layer, look, mix, useTokens, type Tokens } from "../../theme";
import { useWindowKeys } from "../window-keys";

const PILL_HEIGHT = 28;
const PILL_OFFSET = 8;
const PILL_MIN_WIDTH = 88;
const VIEWPORT_MARGIN = 6;
const MIN_CHARS = 2;
const COPY_BUTTON_EXTENT = 28 + 6;
const COPIED_RESET_MS = 1200;
const SCROLL_PROBE_MS = 100;
const MAIN_WINDOW = "main";

type Rect = { x: number; y: number; w: number; h: number };
type ChipState = { n: number | null; text: string; rect: Rect; left: number; top: number; clearCanvas?: () => void };

const hideZones = new Map<string, Layout>();
let pointerOnChip = false;

/** desktop-ui's `SELECTION_HIDE_SELECTORS`: a selection centred inside a registered surface (the chat tab, the top bar) gets no chip. */
export function setSelectionHideZone(id: string, rect: Layout | null): void {
  if (rect) hideZones.set(id, rect);
  else hideZones.delete(id);
}

const insideHideZone = (r: Rect) => {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  for (const z of hideZones.values()) if (cx >= z.x && cx <= z.x + z.w && cy >= z.y && cy <= z.y + z.h) return true;
  return false;
};

type CanvasSelection = { text: string; rect: Rect; clear: () => void } | null;
const canvasListeners = new Set<(s: CanvasSelection) => void>();

/** A main-window canvas page's `stella:canvas-selection`, its rect already in window points. */
export function publishCanvasSelection(selection: CanvasSelection): void {
  for (const listener of canvasListeners) listener(selection);
}

const computePillPosition = (r: Rect) => {
  const pillWidth = Math.max(PILL_MIN_WIDTH, r.w * 0.5);
  const maxLeft = window.innerWidth - (pillWidth + COPY_BUTTON_EXTENT) - VIEWPORT_MARGIN;
  const left = Math.max(VIEWPORT_MARGIN, Math.min(r.x + r.w / 2 - pillWidth / 2, maxLeft));
  const naturalTop = r.y - PILL_HEIGHT - PILL_OFFSET;
  const top = naturalTop < VIEWPORT_MARGIN ? r.y + r.h + PILL_OFFSET : naturalTop;
  return { left, top: top < VIEWPORT_MARGIN ? VIEWPORT_MARGIN : Math.min(top, window.innerHeight - PILL_HEIGHT - VIEWPORT_MARGIN) };
};

const chipState = (n: number | null, text: string, rect: Rect | undefined, clearCanvas?: () => void): ChipState | null => {
  if (!rect || text.trim().length < MIN_CHARS || (rect.w === 0 && rect.h === 0) || (n !== null && insideHideZone(rect))) return null;
  return { n, text, rect, ...computePillPosition(rect), clearCanvas };
};

const over = (fg: string, bg: string) => {
  const a = parseColorOr(fg);
  const b = parseColorOr(bg);
  const ch = (x: number, y: number) => x * a.a + y * (1 - a.a);
  return hex(`rgb(${ch(a.r, b.r)}, ${ch(a.g, b.g)}, ${ch(a.b, b.b)})`);
};

const chipLook = (tk: Tokens) =>
  derive(tk, "ask-stella-selection-chip", (t) => {
    const surface = t.vars["--overlay-surface"]!;
    return {
      rest: over(surface, t.c.background),
      hover: over(mix(t.c.foreground, 6, surface), t.c.background),
      press: over(mix(t.c.foreground, 10, surface), t.c.background),
      border: t.vars["--overlay-border"]!,
      borderStrong: t.vars["--overlay-border-strong"]!,
    };
  });

const LABEL = look(fontSize.sm, 400, { lh: 1, em: -0.0125 });

function ChipButton({ id, label, title, square, onPress, children }: { id: string; label: string; title: string; square?: boolean; onPress: () => void; children: React.ReactNode }) {
  const tk = useTokens();
  const l = chipLook(tk);
  const [hover, setHover] = useState(false);
  return (
    <row
      id={id}
      role="button"
      label={label}
      title={title}
      h={PILL_HEIGHT}
      w={square ? 28 : undefined}
      px={square ? 0 : 12 + 1}
      gap={7}
      align="center"
      justify={square ? "center" : undefined}
      radius={999}
      fill={l.rest}
      hoverFill={l.hover}
      pressFill={l.press}
      border={l.border}
      hoverBorder={l.borderStrong}
      pressBorder={l.borderStrong}
      shadows={tk.shadow.overlayDrop}
      y={hover ? -1 : 0}
      focusable={false}
      motion={{ dur: 0.12 }}
      onHover={(inside) => {
        pointerOnChip = inside;
        setHover(inside);
      }}
      onPress={onPress}
    >
      {children}
    </row>
  );
}

/** desktop-ui's `AskStellaSelectionChip`: Ask Stella and Copy over the main window's settled text selection, or a canvas page's. */
export function AskStellaSelectionChip() {
  const tk = useTokens();
  const [chip, setChip] = useState<ChipState | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chipRef = useRef(chip);
  chipRef.current = chip;

  useEffect(() => {
    setCopied(false);
    if (!chip) pointerOnChip = false;
  }, [chip]);
  useEffect(() => () => void (copiedTimer.current && clearTimeout(copiedTimer.current)), []);

  useEffect(() => {
    const offSelection = stella.on("selection", (e) => {
      if (e.window !== null && e.window !== MAIN_WINDOW) return;
      if ("cleared" in e) {
        if (!pointerOnChip) setChip((current) => (current && current.n !== null ? null : current));
        return;
      }
      setChip(chipState(e.n, e.text, e.rect));
    });
    const onCanvas = (s: CanvasSelection) => setChip((current) => (s ? chipState(null, s.text, s.rect, s.clear) : current && current.n === null ? null : current));
    canvasListeners.add(onCanvas);
    const onResize = () => setChip(null);
    window.addEventListener("resize", onResize);
    return () => {
      offSelection();
      canvasListeners.delete(onCanvas);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const shownN = chip?.n ?? null;
  useEffect(() => {
    if (shownN === null) return;
    const probe = setInterval(() => {
      void stella.engine.selection.get(MAIN_WINDOW).then((s) => {
        const current = chipRef.current;
        if (!current || current.n !== shownN) return;
        const r = s?.rect;
        if (r ? r.x !== current.rect.x || r.y !== current.rect.y : !pointerOnChip) setChip(null);
      });
    }, SCROLL_PROBE_MS);
    return () => clearInterval(probe);
  }, [shownN]);

  useWindowKeys(["Escape"], () => {
    if (!chipRef.current) return false;
    setChip(null);
  });

  const ask = useCallback(() => {
    const current = chipRef.current;
    setChip(null);
    if (!current) return;
    const text = current.text;
    if (current.n === null) current.clearCanvas?.();
    else void stella.engine.blur(MAIN_WINDOW).catch(() => {});
    const chatContext = { window: null, browserUrl: null, selectedText: text, regionScreenshots: [] };
    window.electronAPI?.capture?.setContext?.(chatContext);
    dispatchComposeText({ text: "", chatContext, selectedText: text });
  }, []);

  const copy = useCallback(async () => {
    const text = chipRef.current?.text;
    if (!text || !(await engine.writeText(text).catch(() => false))) return;
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
  }, []);

  if (!chip) return null;
  return (
    <row
      key={`${chip.n ?? "canvas"}:${chip.left}:${chip.top}`}
      id="ask-stella-selection-chip-group"
      fixed
      absolute={{ left: chip.left, top: chip.top }}
      raise={layer.selectionChip}
      align="center"
      gap={6}
      noWindowDrag
      enter={{ opacity: 0, y: 2, dur: 0.12 }}
    >
      <ChipButton id="ask-stella-selection-chip" label="Ask Stella" title="Ask Stella about this selection" onPress={ask}>
        <StellaMark size={14} />
        <text {...LABEL} nowrap color={tk.c.textStrong}>Ask Stella</text>
      </ChipButton>
      <ChipButton id="ask-stella-selection-copy" square label={copied ? "Copied" : "Copy"} title={copied ? "Copied" : "Copy"} onPress={() => void copy()}>
        <Icon icon={copied ? Icons.stella.Check : Icons.stella.Copy} size={14} strokeWidth={2} color={tk.c.textStrong} />
      </ChipButton>
    </row>
  );
}
