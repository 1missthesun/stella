import { Children, type ReactNode } from "react";
import { derive, font, mix, radius, useTokens, type Style, type Tokens } from "../../theme";
import { domEvent, useFormSubmit, type DomEvent } from "./press";
import { Ink, T, flowChildren } from "./text";
import { APP_TEXT, TextScope } from "./scope";

export type ButtonProps = Omit<Style, "size" | "onPress"> & {
  variant?: "primary" | "secondary" | "ghost";
  size?: "small" | "normal" | "large";
  className?: string;
  type?: "button" | "submit" | "reset";
  onClick?: (e: DomEvent) => void;
  disabled?: boolean;
  title?: string;
  "aria-label"?: string;
  "aria-expanded"?: boolean;
  "aria-pressed"?: boolean;
  "data-tone"?: string;
  children?: ReactNode;
  [data: `data-${string}`]: unknown;
};

type Look = Style & { text: Style };

const SIZE = {
  small: { h: 22, px: 8, gap: 4, size: 12, lh: 1.67 },
  normal: { h: 24, px: 6, gap: 6, size: 12, lh: 2 },
  large: { h: 32, px: 12, gap: 8, size: 14, lh: 1.43 },
} as const;

function buttonLook(t: Tokens, key: string): Look {
  const [variant, size, pill, lg, active, tone, disabled] = key.split(":");
  const c = t.c;
  const sz = SIZE[size as keyof typeof SIZE];
  const off = disabled === "1";
  if (pill === "1") {
    const large = lg === "1";
    const look: Look = {
      h: large || size === "large" ? 32 : 24,
      px: (large ? 16 : 12) + 1,
      gap: sz.gap,
      radius: radius.full,
      border: c.border,
      text: { size: large ? 12 : sz.size, weight: 500, em: 0, color: c.textWeak },
      motion: { dur: 0.15 },
    };
    if (off) return { ...look, opacity: 0.45 };
    if (active === "1") return { ...look, fill: c.selectFill, border: c.selectBorder, hover: c.selectFill, hoverBorder: c.selectBorder, text: { ...look.text, color: c.selectText } };
    if (tone === "primary") {
      const hover = mix(c.foreground, 10, c.interactive);
      return { ...look, fill: c.interactive, border: c.interactive, hover, hoverBorder: hover, press: mix(c.foreground, 16, c.interactive), text: { ...look.text, color: c.interactiveForeground } };
    }
    if (tone === "danger") return { ...look, hover: mix(c.destructive, 8, "transparent"), hoverBorder: c.destructive, hoverColor: c.destructive, press: mix(c.foreground, 10, "transparent") };
    return { ...look, hover: mix(c.foreground, 6, "transparent"), press: mix(c.foreground, 10, "transparent"), hoverColor: c.textBase };
  }
  const look: Look = { h: sz.h, px: sz.px + 1, gap: sz.gap, radius: radius.md, text: { size: sz.size, weight: font.emphasisWeight, lh: sz.lh, em: -0.01 }, motion: { dur: 0.15 } };
  if (variant === "primary") return off ? { ...look, fill: c.primary, border: c.border, opacity: 0.5, text: { ...look.text, color: c.primaryForeground } } : { ...look, fill: c.primary, border: c.border, hover: c.primaryHover, press: c.primaryPress, text: { ...look.text, color: c.primaryForeground } };
  if (variant === "ghost") return off ? { ...look, opacity: 0.7, text: { ...look.text, color: c.mutedForeground } } : { ...look, hover: c.ghostHover, press: c.ghostPress, text: { ...look.text, color: c.foreground } };
  return off
    ? { ...look, fill: c.muted, shadows: t.shadow.xsBorder, text: { ...look.text, color: c.mutedForeground } }
    : { ...look, fill: c.buttonSecondaryBase, hover: c.buttonSecondaryHover, shadows: t.shadow.xsBorder, pressScale: 0.99, text: { ...look.text, color: c.secondaryForeground } };
}

const textual = (children: ReactNode) => Children.toArray(children).every((c) => typeof c === "string" || typeof c === "number");

/** desktop-ui's `Button` with its `pill-btn` classes (`--lg`, `--active`, `--primary`, `--danger`) as they compute in Electron. */
export function Button({ variant = "secondary", size = "normal", className = "", type, onClick, disabled = false, title, children, "aria-label": ariaLabel, "aria-expanded": expanded, "aria-pressed": pressed, ...rest }: ButtonProps) {
  const t = useTokens();
  const submit = useFormSubmit();
  const classes = className.split(/\s+/);
  const pill = classes.includes("pill-btn");
  const tone = classes.includes("pill-btn--primary") ? "primary" : classes.includes("pill-btn--danger") ? "danger" : "";
  const key = [variant, size, pill ? 1 : 0, classes.includes("pill-btn--lg") ? 1 : 0, classes.includes("pill-btn--active") ? 1 : 0, tone, disabled ? 1 : 0].join(":");
  const { text, ...look } = derive(t, `compat-button:${key}`, (t) => buttonLook(t, key));
  const style: Style = {};
  for (const [k, v] of Object.entries(rest)) if (!k.startsWith("data-")) (style as Record<string, unknown>)[k] = v;
  const color = (style.color as string | undefined) ?? text.color;
  return (
    <row
      role="button"
      label={ariaLabel ?? (textual(children) ? Children.toArray(children).join("") : title)}
      title={title}
      expanded={expanded}
      selected={pressed}
      focusable={!disabled}
      disabled={disabled}
      focusRing={{ width: 2, offset: 2, color: t.c.ring }}
      align="center"
      justify="center"
      {...look}
      {...style}
      onPress={
        disabled
          ? undefined
          : () => {
              onClick?.(domEvent());
              if (type === "submit") submit?.();
            }
      }
    >
      <TextScope base={APP_TEXT}>
        <Ink.Provider value={color}>
          {textual(children) ? (
            <T {...text} color={color} nowrap shrink={false}>
              {children}
            </T>
          ) : (
            flowChildren(children, { ...text, color, nowrap: true })
          )}
        </Ink.Provider>
      </TextScope>
    </row>
  );
}
