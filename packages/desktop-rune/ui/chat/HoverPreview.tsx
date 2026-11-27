import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { layer } from "../theme";

const CLOSE_DELAY_MS = 160;

/** desktop-ui's `useHoverPreview`: open on hover or focus, close 160ms after leaving (so the pointer can cross into an interactive card). */
export function useHoverPreview() {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const openNow = useCallback(() => {
    cancel();
    setOpen(true);
  }, [cancel]);
  const scheduleClose = useCallback(() => {
    cancel();
    timer.current = setTimeout(() => {
      timer.current = null;
      setOpen(false);
    }, CLOSE_DELAY_MS);
  }, [cancel]);
  useEffect(() => cancel, [cancel]);
  const onHover = useCallback((inside: boolean) => (inside ? openNow() : scheduleClose()), [openNow, scheduleClose]);
  const onFocus = useCallback((focused: boolean) => (focused ? openNow() : scheduleClose()), [openNow, scheduleClose]);
  return { open, setOpen, onHover, onFocus, triggerProps: { onHover, onFocus } };
}

/** desktop-ui's `ChipPreviewPortal`: a card anchored over (or under) its trigger in the window's top layer, fading in. */
export function ChipPreview({
  anchor,
  open,
  side = "top",
  gap = 8,
  interactive,
  onHover,
  children,
  ...card
}: {
  anchor: string;
  open: boolean;
  side?: "top" | "bottom";
  gap?: number;
  interactive?: boolean;
  onHover?: (inside: boolean) => void;
  children: ReactNode;
} & Record<string, unknown>) {
  if (!open) return null;
  return (
    <col
      role="tooltip"
      anchor={{ to: anchor, side, align: "start", gap }}
      raise={layer.preview}
      inert={!interactive}
      onHover={interactive ? onHover : undefined}
      enter={{ opacity: 0, y: side === "top" ? 4 : -4, dur: 0.14 }}
      {...card}
    >
      {children}
    </col>
  );
}
