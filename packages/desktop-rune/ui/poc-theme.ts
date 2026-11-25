// Stella's default theme tokens (packages/theme deriveTokens, "custom" default theme), resolved to hex.

export type Tokens = ReturnType<typeof tokens>;

export function tokens(dark: boolean) {
  return dark
    ? {
        bg: "#1c1c1e", bgWeak: "#161618", raised: "#2c2c2e", raisedHover: "#38383a", inset: "#29292b",
        textStrong: "#f5f5f7", text: "#d2d2d4", textWeak: "#ababad", textWeaker: "#89898b",
        border: "#3f3f41", borderWeak: "#323234", select: "#36374a",
        primary: "#0a84ff", bubble: "#2871c9", bubbleText: "#f2fbff",
        code: "#161618", codeInline: "#2f2f33", hover: "#ffffff0d", press: "#ffffff17",
      }
    : {
        bg: "#ffffff", bgWeak: "#f5f5f7", raised: "#ffffff", raisedHover: "#f6f6f6", inset: "#f4f4f4",
        textStrong: "#1d1d1f", text: "#464647", textWeak: "#686869", textWeaker: "#8e8e8f",
        border: "#e4e4e4", borderWeak: "#efefef", select: "#dfeeff",
        primary: "#0a84ff", bubble: "#2871c9", bubbleText: "#f2fbff",
        code: "#f5f5f7", codeInline: "#ececef", hover: "#0000000a", press: "#00000012",
      };
}

export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 };
export const radius = { s: 6, m: 10, l: 14, xl: 20 };
