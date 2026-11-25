import { derive, mixOklch, type Shadow, type Tokens } from "../theme";

const highlight = (t: Tokens): Shadow => ({ x: 0, y: 1, blur: 0, spread: 0, color: t.c.panelSurfaceHighlight, inset: true });

/** `--panel-surface-*`: the translucent panel gradient, its border and the inset top highlight. */
export const panelSurface = (t: Tokens) =>
  derive(t, "chat:panel-surface", (k) => ({
    gradient: k.gradient.panel,
    border: k.c.panelSurfaceBorder,
    hoverBorder: k.c.panelSurfaceBorderHover,
    shadows: [highlight(k)],
  }));

/** A floating preview card (`.event-window-preview-card` and friends): panel surface over the background, overlay shadow. */
export const previewCard = (t: Tokens) =>
  derive(t, "chat:preview-card", (k) => ({
    fill: k.c.background,
    gradient: k.gradient.panel,
    border: k.c.panelSurfaceBorder,
    shadows: [...k.shadow.overlay, highlight(k)],
  }));

/** `.context-pill` / `.event-context-chip`: primary-tinted pill colours, resting and hovered. */
export const pillColors = (t: Tokens) =>
  derive(t, "chat:pill", (k) => ({
    text: mixOklch(k.c.textStrong, 80, k.c.primary),
    icon: mixOklch(k.c.primary, 70, k.c.foreground),
    border: mixOklch(k.c.primary, 22, k.c.border),
    fill: mixOklch(k.c.primary, 10, k.c.card),
    hoverBorder: mixOklch(k.c.primary, 38, k.c.border),
    hoverFill: mixOklch(k.c.primary, 16, k.c.card),
  }));
