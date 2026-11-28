import type { ReactNode } from "react";
import { Icon, type IconData } from "../../../desktop-rune/ui/kit";
import { alpha, derive, font, look, useTokens, type TextLook, type Tokens } from "../../../desktop-rune/ui/theme";
import { AdaptiveGlass, chromeGlass, GlassSheen, useGlassBackdrop } from "../../../desktop-rune/ui/shell/glass";
import { glyph } from "./icons";

// packages/mobile's design kit in Rune's terms: its colours (theme/colors.ts makeColors), its
// Manrope text styles, and the airy rows, labels and rules its drawers and tab pages are built
// from (chat-settings/kit.tsx, settings/settings-styles.ts, airy-list.ts, sidebar/PanelPageHeader).

/** packages/mobile's `Colors`, from the same theme tokens. */
export type RnColors = {
  background: string;
  text: string;
  textMuted: string;
  textWeaker: string;
  textInteractive: string;
  border: string;
  borderStrong: string;
  accent: string;
  accentForeground: string;
  danger: string;
  ok: string;
  warning: string;
  surface: string;
  surfaceInset: string;
  /** packages/mobile's `fadeHex(colors.text, …)` fills: the bottom bar's pill, a highlighted row. */
  pill: string;
  dark: boolean;
};

export function rnColors(t: Tokens): RnColors {
  return derive(t, "rn-colors", (t) => ({
    background: t.c.background,
    text: t.c.textStrong,
    textMuted: t.c.textWeak,
    textWeaker: t.c.textWeaker,
    textInteractive: t.c.textInteractive,
    border: t.c.border,
    borderStrong: t.c.borderStrong,
    accent: t.c.primary,
    accentForeground: t.c.primaryForeground,
    danger: t.c.destructive,
    ok: t.c.success,
    warning: t.c.warning,
    surface: t.c.overlaySurface,
    surfaceInset: t.c.surfaceInset,
    pill: alpha(t.c.textStrong, t.dark ? 0.12 : 0.07),
    dark: t.dark,
  }));
}

export const useRn = (): RnColors => rnColors(useTokens());

/** A packages/mobile text style: Manrope at `size` and `weight`, its letter spacing in points, its line height in points (else the font's own). */
export function rt(size: number, weight: number, spacing = 0, lineHeight?: number, family?: string): TextLook {
  return look(size, weight, { em: spacing / size, lh: (lineHeight ?? size * 1.366) / size, ...(family ? { family } : {}) });
}

/** The drawers' and pages' inset from the screen's sides (KIT.gutter). */
export const GUTTER = 24;
/** The drawers' title row: 18 pt under the status bar, 44 pt tall (SIDEBAR_BRAND_TOP / ROW). */
export const BRAND_TOP = 18;
export const BRAND_ROW = 44;

export const TEXT = {
  /** The drawers' titles ("Account", "Chat settings"): Mona Sans. */
  drawerTitle: rt(27, 600, -0.6, undefined, font.display),
  pageTitle: rt(30, 700, -1, 38),
  sectionLabel: rt(15, 600),
  navLabel: rt(21, 600, -0.5),
  subtleNavLabel: rt(18, 600, -0.35),
  navMeta: rt(15, 600, -0.2),
  toggleLabel: rt(19, 600, -0.4),
  rowSub: rt(13.5, 500, 0, 19),
  hint: rt(14, 500, 0, 20),
  switcherTitle: rt(28, 700, -1, 34),
  switcherDetail: rt(14, 600),
  choiceLabel: rt(18, 600, -0.4),
  choiceDetail: rt(13, 500),
  textAction: rt(16, 600),
  back: rt(16, 600),
  identityPrimary: rt(17, 600, -0.3),
  identitySecondary: rt(14, 500),
  monogram: rt(15, 700, -0.2),
  listSection: rt(15, 600),
  listTitle: rt(19, 600, -0.4, 25),
  listDetail: rt(14, 500, 0, 20),
  listTrailing: rt(15, 600, -0.2),
  emptyMessage: rt(17, 500, -0.35, 23),
  emptyAction: rt(15, 600, -0.25),
  topTitle: rt(20, 700, -0.6),
  danger: rt(15.5, 600, -0.2),
  signOut: rt(18, 600, -0.35),
} as const;

/** packages/mobile's pressed rows: dimmed and a touch smaller. */
export const PRESS = { pressScale: 0.985 } as const;

export function SectionLabel({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) {
  const c = useRn();
  return (
    <row align="center" justify="between" gap={10} minH={20} mb={4}>
      <text role="heading" {...TEXT.sectionLabel} color={c.textMuted}>
        {children}
      </text>
      {trailing}
    </row>
  );
}

export function Hairline({ space = 22 }: { space?: number }) {
  const c = useRn();
  return <box w="full" h={0.5} my={space} fill={c.border} opacity={0.8} />;
}

export function Dot({ size = 8 }: { size?: number }) {
  const c = useRn();
  return <box w={size} h={size} radius={size / 2} fill={c.accent} shrink={false} />;
}

/** The back link and big title on a drawer's inner page (PanelPageHeader). */
export function PanelPageHeader({ back, onBack, title, mark }: { back: string; onBack: () => void; title: string; mark?: ReactNode }) {
  const c = useRn();
  return (
    <col mb={22}>
      <row role="button" label={`Back to ${back}`} focusable selfAlign="start" h={BRAND_ROW} gap={4} align="center" pressScale={0.97} onPress={onBack}>
        <Icon icon={glyph("chevron-left")} size={16} color={c.textMuted} />
        <text {...TEXT.back} color={c.textMuted} maxLines={1}>
          {back}
        </text>
      </row>
      <row align="center" gap={12} mt={6}>
        {mark}
        <text role="heading" {...TEXT.pageTitle} color={c.text} maxLines={2} shrink>
          {title}
        </text>
      </row>
    </col>
  );
}

/** A drawer's big title row ("Account", "Chat settings"). */
export function DrawerTitle({ children }: { children: string }) {
  const c = useRn();
  return (
    <row h={BRAND_ROW} align="center">
      <text role="heading" {...TEXT.drawerTitle} color={c.text} maxLines={1}>
        {children}
      </text>
    </row>
  );
}

/** SettingsContent's AiryNavRow: a big label, an optional quiet value, then a chevron or an outward arrow. */
export function NavRow({
  id,
  label,
  trailing,
  trailingDot,
  attention = false,
  subtle = false,
  external = false,
  chevron = false,
  onPress,
}: {
  id?: string;
  label: string;
  trailing?: string;
  trailingDot?: ReactNode;
  attention?: boolean;
  subtle?: boolean;
  external?: boolean;
  chevron?: boolean;
  onPress: () => void;
}) {
  const c = useRn();
  return (
    <row id={id} role="button" label={trailing ? `${label}, ${trailing}` : label} focusable minH={subtle ? 46 : 50} align="center" gap={12} {...PRESS} onPress={onPress}>
      <row grow={1} minW={0} align="center" gap={8}>
        <text {...(subtle ? TEXT.subtleNavLabel : TEXT.navLabel)} color={c.text} maxLines={1} shrink>
          {label}
        </text>
        {attention ? <Dot size={6} /> : null}
      </row>
      {trailing || trailingDot ? (
        <row align="center" gap={7} shrink maxW="46%">
          {trailingDot}
          {trailing ? (
            <text {...TEXT.navMeta} color={c.textMuted} maxLines={1} shrink>
              {trailing}
            </text>
          ) : null}
        </row>
      ) : null}
      {external ? <Icon icon={glyph("arrow-up-right")} size={15} color={c.textWeaker} /> : chevron ? <Icon icon={glyph("chevron-right")} size={15} color={c.textWeaker} /> : null}
    </row>
  );
}

/** packages/mobile's GlassToggle: an iOS switch, 51 × 31. */
export function Toggle({ id, value, label, onChange, disabled = false }: { id?: string; value: boolean; label: string; onChange: (next: boolean) => void; disabled?: boolean }) {
  const c = useRn();
  const off = c.dark ? "#39393d" : "#e9e9eb";
  return (
    <box
      id={id}
      role="switch"
      label={label}
      checked={value}
      focusable={!disabled}
      disabled={disabled}
      w={51}
      h={31}
      radius={15.5}
      shrink={false}
      fill={value ? c.accent : off}
      opacity={disabled ? 0.42 : 1}
      motion={{ dur: 0.25, bounce: 0.1 }}
      onPress={disabled ? undefined : () => onChange(!value)}
    >
      <box absolute={{ left: 2, top: 2 }} w={27} h={27} radius={13.5} fill="#ffffff" x={value ? 20 : 0} motion={{ dur: 0.28, bounce: 0.15 }} shadows={[{ x: 0, y: 3, blur: 8, color: "rgba(0,0,0,0.15)" }, { x: 0, y: 1, blur: 1, color: "rgba(0,0,0,0.06)" }]} />
    </box>
  );
}

/** A label with a quiet line under it and a control at the end (SettingsContent's toggleRow). */
export function ToggleRow({ label, sub, children }: { label: string; sub?: string; children: ReactNode }) {
  const c = useRn();
  return (
    <row minH={54} py={6} align="center" gap={12}>
      <col grow={1} minW={0} gap={3}>
        <text {...TEXT.toggleLabel} color={c.text}>
          {label}
        </text>
        {sub ? (
          <text {...TEXT.rowSub} color={c.textMuted} maxLines={2}>
            {sub}
          </text>
        ) : null}
      </col>
      {children}
    </row>
  );
}

/** chat-settings/kit's SwitcherFace: a glyph, a big title, an optional status line, and ⌃⌄. */
export function SwitcherFace({ glyph: mark, title, detail, detailTone = "muted" }: { glyph: ReactNode; title: string; detail?: string; detailTone?: "muted" | "ok" | "warning" }) {
  const c = useRn();
  return (
    <row minH={62} align="center" gap={12} w="full">
      <box w={30} h={30} center shrink={false}>
        {mark}
      </box>
      <col grow={1} minW={0}>
        <text {...TEXT.switcherTitle} color={c.text} maxLines={1}>
          {title}
        </text>
        {detail ? (
          <row align="center" gap={6}>
            {detailTone !== "muted" ? <box w={6} h={6} radius={3} fill={detailTone === "ok" ? c.ok : c.warning} /> : null}
            <text {...TEXT.switcherDetail} color={c.textMuted} maxLines={1} shrink>
              {detail}
            </text>
          </row>
        ) : null}
      </col>
      <Icon icon={glyph("chevrons-up-down")} size={15} color={c.textMuted} />
    </row>
  );
}

/** chat-settings/kit's ChoiceRow: a quiet label that turns full strength with a dot when chosen. */
export function ChoiceRow({ id, label, detail, selected = false, disabled = false, leading, trailing, onPress }: { id?: string; label: string; detail?: string; selected?: boolean; disabled?: boolean; leading?: ReactNode; trailing?: ReactNode; onPress: () => void }) {
  const c = useRn();
  return (
    <row id={id} role="radio" label={label} selected={selected} focusable={!disabled} minH={46} py={4} align="center" gap={12} opacity={disabled ? 0.4 : 1} pressScale={0.98} onPress={disabled ? undefined : onPress}>
      {leading ? (
        <box w={24} center>
          {leading}
        </box>
      ) : null}
      <col grow={1} minW={0}>
        <row align="center" gap={8}>
          <text {...TEXT.choiceLabel} color={selected ? c.text : c.textMuted} maxLines={1} shrink>
            {label}
          </text>
          {selected ? <Dot size={6} /> : null}
        </row>
        {detail ? (
          <text {...TEXT.choiceDetail} color={c.textWeaker} mt={1} maxLines={1}>
            {detail}
          </text>
        ) : null}
      </col>
      {trailing}
    </row>
  );
}

/** chat-settings/kit's TextAction: a short coloured link-like action. */
export function TextAction({ label, onPress, tone = "interactive", icon }: { label: string; onPress: () => void; tone?: "interactive" | "muted" | "danger"; icon?: IconData }) {
  const c = useRn();
  const color = tone === "danger" ? c.danger : tone === "muted" ? c.textMuted : c.textInteractive;
  return (
    <row role="button" label={label} focusable selfAlign="start" minH={32} align="center" gap={5} pressScale={0.97} onPress={onPress}>
      <text {...TEXT.textAction} color={color}>
        {label}
      </text>
      {icon ? <Icon icon={icon} size={13} color={color} /> : null}
    </row>
  );
}

/** A segmented choice drawn as words with a dot under the chosen one (the Thinking row, Appearance's modes). */
export function WordChoice<T extends string>({ options, value, onChange, look: textLook = TEXT.choiceDetail, justify = "between" }: { options: readonly { id: T; label: string }[]; value: T | null; onChange: (id: T) => void; look?: TextLook; justify?: "between" | "start" }) {
  const c = useRn();
  return (
    <row w="full" justify={justify} align="start" gap={justify === "start" ? 22 : 0} role="radiogroup">
      {options.map((o) => {
        const on = o.id === value;
        return (
          <col key={o.id} role="radio" label={o.label} selected={on} focusable align="center" gap={3} py={4} pressScale={0.96} onPress={() => onChange(o.id)}>
            <text {...textLook} weight={on ? 700 : textLook.weight} color={on ? c.text : c.textMuted}>
              {o.label}
            </text>
            <box w={5} h={5} radius={2.5} fill={on ? c.accent : "transparent"} />
          </col>
        );
      })}
    </row>
  );
}

/**
 * The phone's round glass controls: chromeGlass's, with a dark rim as quiet as packages/mobile's
 * iOS glass (a dark grey disc with no bright edge) instead of the desktop's lit one.
 */
export function phoneGlass(t: Tokens) {
  return derive(t, "rn-phone-glass", (t) => {
    const m = chromeGlass(t).controls;
    const glass = m.fx && "glass" in m.fx ? m.fx.glass : undefined;
    return { ...m, fx: glass && t.dark ? { ...m.fx, glass: { ...glass, rim: 0.07 } } : m.fx };
  });
}

/** packages/mobile's GlassIconButton: a 44 pt round glass button. */
export function GlassCircle({ id, icon, label, onPress, iconSize = 19, opacity, children }: { id: string; icon?: IconData; label: string; onPress: () => void; iconSize?: number; opacity?: number; children?: ReactNode }) {
  const t = useTokens();
  const m = phoneGlass(t);
  return (
    <AdaptiveGlass>
      <box id={id} role="button" label={label} focusable w={44} h={44} radius={22} center fx={m.fx} fill={m.fill} border={m.border} onBackdrop={useGlassBackdrop()} pressScale={0.92} opacity={opacity} onPress={onPress}>
        <GlassSheen radius={22} />
        {icon ? <Icon icon={icon} size={iconSize} color={t.c.textStrong} /> : null}
        {children}
      </box>
    </AdaptiveGlass>
  );
}
