import type { Colors } from "../theme/colors";

/**
 * Ink-strength contract for the minimal agent row — mirrors the
 * desktop refinements in `agent-activity-row.css` on the mobile three-step
 * text ladder (textStrong / text / textMuted ≈ desktop strong / base / weak):
 *
 * - `glyphInk`: the status glyph (star / check / arrow) renders SOLID
 *   full-strength (`--text-strong`, no opacity dimming) — only the
 *   description keeps the muted/shimmer treatment.
 * - `titleInk`: the settled description steps up one notch from muted to the
 *   standard body ink (`--text-base`) — comfortably readable, still clearly
 *   secondary to main-chat text.
 * - `runningRestAlpha`: the running shimmer's resting base over
 *   `textStrong`, matching desktop `--text-shimmer-from: --text-base`
 *   (an 80% mix of the foreground) so settled and running rows agree.
 */
export const AGENT_ACTIVITY_INK = {
  glyphInk: "textStrong",
  titleInk: "text",
  runningRestAlpha: 0.8,
} as const satisfies {
  glyphInk: keyof Colors;
  titleInk: keyof Colors;
  runningRestAlpha: number;
};

/** What the minimal agent row's leading slot shows. */
export type AgentActivityGlyph = "star" | "check" | "arrow";
