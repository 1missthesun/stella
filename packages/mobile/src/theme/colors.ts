import {
  deriveTokens,
  getThemeById,
  mixSrgbCss,
  resolveThemeColors,
  type ThemeColors,
  type ThemeTokens,
} from "@stella/theme";

export type Colors = {
  background: string;
  backgroundWeak: string;
  backgroundStrong: string;
  surface: string;
  panel: string;
  surfaceInset: string;

  border: string;
  borderWeak: string;
  borderStrong: string;

  text: string;
  textBase: string;
  textMuted: string;
  textWeaker: string;
  textStrong: string;
  textInteractive: string;

  accent: string;
  accentHover: string;
  accentSoft: string;
  selectBorder: string;
  accentForeground: string;

  decorative: string;
  decorativeForeground: string;

  ok: string;
  warning: string;
  danger: string;
  info: string;

  card: string;
  cardForeground: string;
  muted: string;
  mutedForeground: string;

  panelSurfaceBgTop: string;
  panelSurfaceBgBottom: string;
  panelSurfaceBorder: string;
  panelSurfaceHighlight: string;

  userBubbleFill: string;
  userBubbleText: string;
  assistantBubbleFillTop: string;
  assistantBubbleFillBottom: string;
  assistantBubbleText: string;

  overlay: string;
};

export function makeColors(
  palette: ThemeColors,
  tokens: ThemeTokens,
  isDark: boolean,
): Colors {
  return {
    background: isDark ? "#000000" : palette.background,
    backgroundWeak: palette.backgroundWeak,
    backgroundStrong: palette.backgroundStrong,
    surface: tokens.overlaySurface,
    panel: palette.muted,
    surfaceInset: tokens.surfaceInset,

    border: palette.border,
    borderWeak: tokens.borderWeak,
    borderStrong: tokens.borderStrong,

    text: tokens.textStrong,
    textBase: tokens.textBase,
    textMuted: tokens.textWeak,
    textWeaker: tokens.textWeaker,
    textStrong: tokens.textStrong,
    textInteractive: tokens.textInteractive,

    accent: palette.primary,
    accentHover: palette.interactive,
    accentSoft: tokens.selectFill,
    selectBorder: tokens.selectBorder,
    accentForeground: palette.primaryForeground,

    decorative: palette.accent,
    decorativeForeground: palette.accentForeground,

    ok: palette.success,
    warning: palette.warning,
    danger: palette.error,
    info: palette.info,

    card: palette.card,
    cardForeground: palette.cardForeground,
    muted: palette.muted,
    mutedForeground: palette.mutedForeground,

    panelSurfaceBgTop: tokens.panelSurfaceBgTop,
    panelSurfaceBgBottom: tokens.panelSurfaceBgBottom,
    panelSurfaceBorder: tokens.panelSurfaceBorder,
    panelSurfaceHighlight: tokens.panelSurfaceHighlight,

    userBubbleFill: tokens.chatUserBubbleFill,
    userBubbleText: tokens.chatUserBubbleText,
    assistantBubbleFillTop: tokens.chatAssistantBubbleFillTop,
    assistantBubbleFillBottom: tokens.chatAssistantBubbleFillBottom,
    assistantBubbleText: tokens.chatAssistantBubbleText,

    overlay: mixSrgbCss(palette.foregroundStrong, 38, palette.background),
  };
}

function fallbackFor(isDark: boolean): Colors {
  const theme = getThemeById("default")!;
  const { colors, flat } = resolveThemeColors(theme, isDark);
  return makeColors(colors, deriveTokens(colors, isDark, { flat }), isDark);
}

export const lightColors: Colors = fallbackFor(false);
export const darkColors: Colors = fallbackFor(true);
