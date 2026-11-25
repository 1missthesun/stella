import type { ReactNode } from "react";
import { derive, font, fontSize, look, mix, radius, type Tokens, useTokens } from "../theme";
import { Icon, type IconData } from "./icons";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "small" | "normal" | "large";

export type ButtonProps = {
  id?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  icon?: IconData;
  iconRight?: IconData;
  title?: string;
  label?: string;
  w?: number | "full";
  onPress?: () => void;
  children?: ReactNode;
};

const SIZES = {
  small: { h: 22, px: 8, gap: 4, text: look(fontSize.sm, font.emphasisWeight), icon: 12 },
  normal: { h: 24, px: 6, gap: 6, text: look(fontSize.sm, font.emphasisWeight), icon: 14 },
  large: { h: 32, px: 12, gap: 8, text: look(fontSize.md, font.emphasisWeight), icon: 16 },
} as const;

type Look = { fill?: string; hover?: string; press?: string; border?: string; text: string; opacity?: number; shadows?: Tokens["shadow"]["sm"]; pressScale?: number };

function looks(t: Tokens, variant: ButtonVariant, disabled: boolean): Look {
  const c = t.c;
  switch (variant) {
    case "primary":
      return disabled
        ? { fill: c.primary, border: c.border, text: c.primaryForeground, opacity: 0.5 }
        : { fill: c.primary, hover: c.primaryHover, press: c.primaryPress, border: c.border, text: c.primaryForeground };
    case "ghost":
      return disabled
        ? { text: c.mutedForeground, opacity: 0.7 }
        : { hover: c.ghostHover, press: c.ghostPress, text: c.foreground };
    default:
      return disabled
        ? { fill: c.muted, text: c.mutedForeground, shadows: t.shadow.xsBorder }
        : { fill: c.buttonSecondaryBase, hover: c.buttonSecondaryHover, press: c.buttonSecondaryBase, text: c.secondaryForeground, shadows: t.shadow.xsBorder, pressScale: 0.99 };
  }
}

/** desktop-ui's `Button` (`[data-component="button"]`): primary, secondary (default) and ghost; small, normal, large. */
export function Button({ id, variant = "secondary", size = "normal", disabled = false, icon, iconRight, title, label, w, onPress, children }: ButtonProps) {
  const t = useTokens();
  const s = SIZES[size];
  const l = derive(t, `button:${variant}:${disabled}`, (t) => looks(t, variant, disabled));
  return (
    <row
      id={id}
      role="button"
      label={label ?? (typeof children === "string" ? children : title)}
      title={title}
      focusable={!disabled}
      disabled={disabled}
      focusRing={{ width: 2, offset: 2, color: t.c.ring }}
      h={s.h}
      w={w}
      px={s.px + 1}
      gap={s.gap}
      align="center"
      justify="center"
      radius={radius.md}
      fill={l.fill}
      hover={l.hover}
      press={l.press}
      border={l.border}
      shadows={l.shadows}
      pressScale={l.pressScale}
      opacity={l.opacity}
      motion={{ dur: 0.15 }}
      onPress={disabled ? undefined : onPress}
    >
      {icon ? <Icon icon={icon} size={s.icon} color={l.text} /> : null}
      {children != null ? (
        <text {...s.text} color={l.text} truncate>
          {children}
        </text>
      ) : null}
      {iconRight ? <Icon icon={iconRight} size={s.icon} color={l.text} /> : null}
    </row>
  );
}

export type IconButtonProps = {
  id?: string;
  icon: IconData;
  label: string;
  size?: number;
  iconSize?: number;
  round?: boolean;
  active?: boolean;
  disabled?: boolean;
  color?: string;
  onPress?: () => void;
};

/** The square ghost icon button desktop-ui repeats across surfaces (dialog close, toolbars): muted, foreground on hover. */
export function IconButton({ id, icon, label, size = 24, iconSize = 16, round = false, active = false, disabled = false, color, onPress }: IconButtonProps) {
  const t = useTokens();
  const c = t.c;
  return (
    <box
      id={id}
      role="button"
      label={label}
      title={label}
      focusable={!disabled}
      disabled={disabled}
      focusRing={{ width: 2, offset: 2, color: c.ring }}
      w={size}
      h={size}
      center
      radius={round ? size / 2 : radius.sm}
      fill={active ? c.ghostHover : undefined}
      hover={disabled ? undefined : c.ghostHover}
      press={disabled ? undefined : c.ghostPress}
      hoverColor={disabled ? undefined : c.foreground}
      opacity={disabled ? 0.5 : undefined}
      onPress={disabled ? undefined : onPress}
    >
      <Icon icon={icon} size={iconSize} color={color ?? (active ? c.foreground : c.mutedForeground)} />
    </box>
  );
}

export type PillProps = {
  id?: string;
  large?: boolean;
  active?: boolean;
  tone?: "default" | "primary" | "danger";
  disabled?: boolean;
  icon?: IconData;
  title?: string;
  onPress?: () => void;
  children?: ReactNode;
};

/** desktop-ui's `.pill-btn` (and `--lg`, `--active`, `--primary`, `--danger`). */
export function Pill({ id, large = false, active = false, tone = "default", disabled = false, icon, title, onPress, children }: PillProps) {
  const t = useTokens();
  const c = t.c;
  const p = derive(t, `pill:${tone}:${active}`, () => {
    if (active) return { fill: c.selectFill, border: c.selectBorder, text: c.selectText, hover: c.selectFill, hoverText: c.selectText, press: c.selectFill, hoverBorder: c.selectBorder };
    if (tone === "primary") {
      const h = mix(c.foreground, 10, c.interactive);
      return { fill: c.interactive, border: c.interactive, text: c.interactiveForeground, hover: h, hoverText: c.interactiveForeground, press: mix(c.foreground, 16, c.interactive), hoverBorder: h };
    }
    if (tone === "danger") return { border: c.border, text: c.textWeak, hover: mix(c.destructive, 8, "transparent"), hoverText: c.destructive, press: c.ghostPress, hoverBorder: c.destructive };
    return { border: c.border, text: c.textWeak, hover: c.ghostHover, hoverText: c.textBase, press: c.ghostPress, hoverBorder: c.border };
  });
  const text = look(large ? fontSize.sm : fontSize.xs, 500, { em: 0 });
  return (
    <row
      id={id}
      role="button"
      title={title}
      focusable={!disabled}
      disabled={disabled}
      selected={active}
      focusRing={{ width: 2, offset: 2, color: c.ring }}
      minH={large ? 32 : 24}
      px={(large ? 16 : 12) + 1}
      py={(large ? 6 : 5) + 1}
      gap={6}
      align="center"
      justify="center"
      radius={radius.full}
      fill={p.fill}
      border={p.border}
      hover={disabled ? undefined : p.hover}
      press={disabled ? undefined : p.press}
      hoverBorder={disabled ? undefined : p.hoverBorder}
      hoverColor={disabled ? undefined : p.hoverText}
      opacity={disabled ? 0.45 : undefined}
      motion={{ dur: 0.15 }}
      onPress={disabled ? undefined : onPress}
    >
      {icon ? <Icon icon={icon} size={14} color={p.text} /> : null}
      {children != null ? (
        <text {...text} color={p.text}>
          {children}
        </text>
      ) : null}
    </row>
  );
}
