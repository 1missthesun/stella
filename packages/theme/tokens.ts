import type { ThemeColors } from "./types";
import {
  generateGradientTokens,
  mixOklchCss,
  mixSrgbCss,
  relativeOklch,
  withAlpha,
} from "./color";

export interface ThemeTokens {
  background: string;
  backgroundStrong: string;
  foreground: string;
  card: string;
  cardForeground: string;
  primary: string;
  primaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  border: string;
  interactive: string;
  success: string;
  warning: string;
  info: string;

  textInteractive: string;

  textStrong: string;
  textBase: string;
  textWeak: string;
  textWeaker: string;

  borderStrong: string;
  borderBase: string;
  borderWeak: string;

  surfaceInset: string;
  surfaceRaised: string;
  surfaceRaisedHover: string;
  buttonSecondaryBase: string;
  buttonSecondaryHover: string;

  overlaySurface: string;
  overlayBorder: string;
  overlayBorderStrong: string;

  panelSurfaceBg: string;
  panelSurfaceBgTop: string;
  panelSurfaceBgBottom: string;
  panelSurfaceBorder: string;
  panelSurfaceBorderHover: string;
  panelSurfaceHighlight: string;

  selectFill: string;
  selectBorder: string;

  chatUserBubbleFill: string;
  chatUserBubbleText: string;
  chatAssistantBubbleFillTop: string;
  chatAssistantBubbleFillBottom: string;
  chatAssistantBubbleText: string;
}

export interface DeriveTokensOptions {
  flat: boolean;
}

const RATIOS = {
  light: {
    textBase: 82,
    textWeak: 67,
    textWeaker: 50,
    borderStrong: 20,
    borderBase: 12,
    borderWeak: 7,
    surfaceInset: 5,
    surfaceRaisedHover: 4,
    buttonSecondaryBase: 5,
    buttonSecondaryHover: 9,
    overlayBorder: 32,
    overlayBorderStrong: 44,
    panelSurfaceBg: 0.5,
    panelSurfaceBgTop: 0.46,
    panelSurfaceBgBottom: 0.58,
    panelSurfaceHighlight: 0.42,
  },
  dark: {
    textBase: 84,
    textWeak: 66,
    textWeaker: 50,
    borderStrong: 24,
    borderBase: 16,
    borderWeak: 10,
    surfaceInset: 6,
    surfaceRaisedHover: 6,
    buttonSecondaryBase: 8,
    buttonSecondaryHover: 14,
    overlayBorder: 42,
    overlayBorderStrong: 56,
    panelSurfaceBg: 0.62,
    panelSurfaceBgTop: 0.56,
    panelSurfaceBgBottom: 0.7,
    panelSurfaceHighlight: 0.1,
  },
} as const;

function bubbleGate(l: number): number {
  return Math.max(0, Math.min(1, (l - 0.65) * 10000));
}

export function deriveTokens(
  colors: ThemeColors,
  isDark: boolean,
  { flat }: DeriveTokensOptions,
): ThemeTokens {
  const r = isDark ? RATIOS.dark : RATIOS.light;
  const { background: bg, foreground: fg, card, border, primary } = colors;

  const gradient = generateGradientTokens(
    {
      primary: colors.primary,
      success: colors.success,
      warning: colors.warning,
      info: colors.info,
      interactive: colors.interactive,
    },
    isDark,
  );

  const panelSurfaceBgTop = withAlpha(bg, r.panelSurfaceBgTop);
  const panelSurfaceBgBottom = withAlpha(bg, r.panelSurfaceBgBottom);
  const panelSurfaceBorder = isDark ? border : withAlpha(border, 0.6);
  const surfaceRaised = card;

  const chatUserBubbleFill = relativeOklch(primary, ({ l, c, h }) => {
    const gate = bubbleGate(l);
    return {
      l: (1 - gate) * Math.min(l, 0.55) + gate * Math.max(l, 0.7),
      c: c * 0.75,
      h,
    };
  });
  const chatUserBubbleText = relativeOklch(
    chatUserBubbleFill,
    ({ l, c, h }) => ({
      l: 0.985 - bubbleGate(l) * 0.835,
      c: c * 0.12,
      h,
    }),
  );

  return {
    background: bg,
    backgroundStrong: colors.backgroundStrong,
    foreground: fg,
    card,
    cardForeground: colors.cardForeground,
    primary,
    primaryForeground: colors.primaryForeground,
    muted: colors.muted,
    mutedForeground: colors.mutedForeground,
    accent: colors.accent,
    accentForeground: colors.accentForeground,
    destructive: colors.error,
    border,
    interactive: colors.interactive,
    success: colors.success,
    warning: colors.warning,
    info: colors.info,

    textInteractive: gradient.textInteractive,

    textStrong: fg,
    textBase: mixSrgbCss(fg, r.textBase, bg),
    textWeak: mixSrgbCss(fg, r.textWeak, bg),
    textWeaker: mixSrgbCss(fg, r.textWeaker, bg),

    borderStrong: mixSrgbCss(fg, r.borderStrong, bg),
    borderBase: mixSrgbCss(fg, r.borderBase, bg),
    borderWeak: mixSrgbCss(fg, r.borderWeak, bg),

    surfaceInset: mixSrgbCss(fg, r.surfaceInset, bg),
    surfaceRaised,
    surfaceRaisedHover: mixSrgbCss(fg, r.surfaceRaisedHover, card),
    buttonSecondaryBase: mixSrgbCss(fg, r.buttonSecondaryBase, card),
    buttonSecondaryHover: mixSrgbCss(fg, r.buttonSecondaryHover, card),

    overlaySurface: colors.backgroundStrong,
    overlayBorder: mixSrgbCss(fg, r.overlayBorder, bg),
    overlayBorderStrong: mixSrgbCss(fg, r.overlayBorderStrong, bg),

    panelSurfaceBg: withAlpha(bg, r.panelSurfaceBg),
    panelSurfaceBgTop,
    panelSurfaceBgBottom,
    panelSurfaceBorder,
    panelSurfaceBorderHover: mixOklchCss(fg, 18, panelSurfaceBorder),
    panelSurfaceHighlight: withAlpha("white", r.panelSurfaceHighlight),

    selectFill: mixOklchCss(primary, 15, surfaceRaised),
    selectBorder: mixOklchCss(primary, 38, surfaceRaised),

    chatUserBubbleFill,
    chatUserBubbleText,
    chatAssistantBubbleFillTop: flat ? colors.muted : panelSurfaceBgTop,
    chatAssistantBubbleFillBottom: flat ? colors.muted : panelSurfaceBgBottom,
    chatAssistantBubbleText: fg,
  };
}
