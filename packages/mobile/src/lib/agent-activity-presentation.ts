import type { Colors } from "../theme/colors";

export const AGENT_ACTIVITY_INK = {
  glyphInk: "textStrong",
  titleInk: "text",
  runningRestAlpha: 0.8,
} as const satisfies {
  glyphInk: keyof Colors;
  titleInk: keyof Colors;
  runningRestAlpha: number;
};

export type AgentActivityGlyph = "star" | "check" | "arrow";
