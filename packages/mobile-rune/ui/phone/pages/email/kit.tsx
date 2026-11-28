import type { ReactNode } from "react";
import type { Run } from "../../../../../desktop-rune/host/rune-jsx/props";
import { Icon } from "../../../../../desktop-rune/ui/kit";
import { alpha, derive, useTokens, type TextLook } from "../../../../../desktop-rune/ui/theme";
import { glyph, type GlyphName } from "../../icons";
import { rt } from "../../rn";

/** StyleSheet.hairlineWidth on a 3x screen. */
export const HAIR = 1 / 3;

/** EmailPage's colours: packages/mobile's `Colors` names, and its two quiet fills. */
export type EmailColors = {
  textStrong: string;
  textBase: string;
  textMuted: string;
  textWeaker: string;
  border: string;
  borderWeak: string;
  accent: string;
  accentForeground: string;
  danger: string;
  subtleFill: string;
  tonalFill: string;
};

export const useEmailColors = (): EmailColors =>
  derive(useTokens(), "rn-email-colors", (t) => ({
    textStrong: t.c.textStrong,
    textBase: t.c.textBase,
    textMuted: t.c.textWeak,
    textWeaker: t.c.textWeaker,
    border: t.c.border,
    borderWeak: t.c.borderWeak,
    accent: t.c.primary,
    accentForeground: t.c.primaryForeground,
    danger: t.c.destructive,
    subtleFill: alpha(t.dark ? "#ffffff" : "#000000", t.dark ? 0.045 : 0.03),
    tonalFill: alpha(t.dark ? "#ffffff" : "#000000", t.dark ? 0.075 : 0.055),
  }));

/** EmailPage's makeStyles text styles. */
export const T = {
  topCount: rt(16, 600, -0.25),
  topMeta: rt(12.5, 400),
  headerBtnText: rt(12.5, 500),
  headerBtnCount: rt(12, 500),
  sectionHeading: rt(12.5, 500),
  sectionCount: rt(12, 400),
  quietLine: rt(13.5, 400),
  itemTitle: rt(15.5, 600, -0.2, 21),
  itemTitleMuted: rt(15.5, 500, -0.2, 21),
  itemTime: rt(12, 400),
  itemMeta: rt(12.5, 500),
  itemGist: rt(14, 400, 0, 21),
  detailText: rt(13.5, 400, 0, 20),
  draftLabel: rt(12, 500),
  draftTo: rt(12, 400),
  draftBody: rt(13.5, 400, 0, 20.5),
  primaryBtnText: rt(13, 600, -0.1),
  secondaryBtnText: rt(13, 500),
  gmailBtnText: rt(12.5, 500),
  tellInput: rt(15, 400, 0, 21),
  ignoredLabel: rt(13.5, 500),
  senderName: rt(13.5, 500),
  senderCount: rt(13, 400),
  footerMetaText: rt(12, 400),
  emptyTitle: rt(17, 600, -0.25),
  emptyBody: rt(14, 400, 0, 20.5),
  backText: rt(13, 500),
  settingsTitle: rt(16, 600, -0.2),
  settingsRowMain: rt(14, 500, 0, 19.5),
  settingsRowSub: rt(12.5, 400, 0, 17.5),
  settingsRowValue: rt(13, 400),
  footnote: rt(12.5, 400, 0, 18),
} as const satisfies Record<string, TextLook>;

export const PRESSED = 0.97;

/** packages/mobile's tapLight. */
export const tapLight = (): void => __native.post(JSON.stringify({ cmd: "haptic", kind: "light" }));

export function formatWhen(at: number | undefined, locale: string): string {
  if (!at) return "";
  const date = new Date(at);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  try {
    return sameDay ? date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" }) : date.toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return date.toISOString().slice(0, 16).replace("T", " ");
  }
}

/** iOS's small UIActivityIndicatorView. */
export function Spinner({ color, size = 20 }: { color: string; size?: number }) {
  return <Icon icon={glyph("activity")} size={size} color={color} spin={1} />;
}

export type BtnVariant = "primary" | "tonal" | "secondary" | "ghost" | "header";

/** EmailPage's primaryBtn, tonalBtn, secondaryBtn, ghostBtn and headerIconBtn. */
export function Btn({
  id,
  variant,
  label,
  text,
  textColor,
  icon,
  iconSize = 12,
  iconColor,
  disabled = false,
  dim = false,
  compact = false,
  onPress,
  children,
}: {
  id?: string;
  variant: BtnVariant;
  label: string;
  text?: string;
  textColor?: string;
  icon?: GlyphName;
  iconSize?: number;
  iconColor?: string;
  disabled?: boolean;
  dim?: boolean;
  compact?: boolean;
  onPress: () => void;
  children?: ReactNode;
}) {
  const c = useEmailColors();
  const box =
    variant === "primary"
      ? { minH: compact ? 30 : 34, px: compact ? 13 : 14, radius: 9, gap: 6, fill: c.accent }
      : variant === "tonal"
        ? { minH: 34, px: 14, radius: 9, gap: 6, fill: c.tonalFill, border: c.border, borderWidth: HAIR }
        : variant === "secondary"
          ? { minH: 32, px: 12, radius: 8, gap: 6, border: c.border, borderWidth: HAIR }
          : variant === "header"
            ? { h: 32, px: 10, radius: 8, gap: 5, fill: c.subtleFill }
            : { minH: 32, px: 8, radius: 8 };
  const look = variant === "primary" || variant === "tonal" ? T.primaryBtnText : variant === "header" ? T.headerBtnText : T.secondaryBtnText;
  const color = textColor ?? (variant === "primary" ? c.accentForeground : variant === "tonal" || variant === "secondary" ? c.textStrong : variant === "header" ? c.textBase : c.textMuted);
  return (
    <row
      id={id}
      role="button"
      label={label}
      focusable={!disabled}
      disabled={disabled}
      align="center"
      justify="center"
      shrink={false}
      {...box}
      opacity={dim ? 0.45 : 1}
      pressScale={disabled ? undefined : PRESSED}
      onPress={disabled ? undefined : onPress}
    >
      {icon ? <Icon icon={glyph(icon)} size={iconSize} color={iconColor ?? color} /> : null}
      {text ? (
        <text {...look} color={color} maxLines={1}>
          {text}
        </text>
      ) : null}
      {children}
    </row>
  );
}

const inlineRuns = (text: string, strong: string): Run[] =>
  text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter((part) => part.length > 0)
    .map((part) => (/^\*\*[^*]+\*\*$/.test(part) ? { t: part.slice(2, -2), w: 600, c: strong } : { t: part }));

/** EmailPage's MobileRichText: paragraphs and bullet lists with **bold** runs. */
export function RichText({ text }: { text: string }) {
  const c = useEmailColors();
  const chunks = text.split(/\n{2,}/);
  return (
    <col gap={8}>
      {chunks.map((chunk, chunkIndex) => {
        const lines = chunk.split("\n");
        if (lines.every((entry) => /^\s*[-•]\s+/.test(entry))) {
          return (
            <col key={chunkIndex} gap={5}>
              {lines.map((entry, lineIndex) => (
                <row key={lineIndex} align="start" gap={8}>
                  <text {...T.detailText} color={c.textWeaker} shrink={false}>
                    •
                  </text>
                  <text {...T.detailText} grow={1} minW={0} color={c.textMuted} spans={inlineRuns(entry.replace(/^\s*[-•]\s+/, ""), c.textStrong)} />
                </row>
              ))}
            </col>
          );
        }
        return <text key={chunkIndex} {...T.detailText} mb={2} color={c.textMuted} spans={inlineRuns(lines.join("\n"), c.textStrong)} />;
      })}
    </col>
  );
}
