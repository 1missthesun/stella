import type { ReactNode } from "react";
import { Avatar as KitAvatar, Keybind as KitKeybind, StellaMark } from "../Misc";
import { Icon, Icons, type IconData } from "../icons";
import { useTokens } from "../../theme";
import { useInk } from "./text";
import { Box } from "./icons";

export function Avatar({ fallback, src, background, foreground, size }: { fallback: string; src?: string; background?: string; foreground?: string; size?: "small" | "normal" | "large"; className?: string }) {
  return <KitAvatar fallback={fallback} src={src} background={background} foreground={foreground} size={size} />;
}

export function Keybind({ keys }: { keys: string | string[]; className?: string }) {
  return <KitKeybind keys={keys} />;
}

const BRAND_KEY_ALIASES: Record<string, string> = { chatgpt: "openai", "kimi-coding": "kimi", "vercel-ai-gateway": "vercel", "github-copilot": "githubcopilot", antigravity: "gemini" };
const BRAND_TINTS: Record<string, string> = { openai: "#10a37f", openrouter: "#6467f2" };

/** desktop-ui's `BrandIcon`: Stella's mark, Claude's mark, a provider's colour or tinted glyph, or a box. */
export function BrandIcon({ brand, size = 16, color }: { brand: string; size?: number; className?: string; color?: string }) {
  const t = useTokens();
  const ink = useInk();
  if (brand === "stella") return <StellaMark size={size} />;
  if (brand === "anthropic") return <Icon icon={Icons.mark.claude} size={size} />;
  const key = BRAND_KEY_ALIASES[brand] ?? brand;
  const brands = Icons.brand as Record<string, IconData>;
  const colored = brands[`${key}-color`];
  if (colored) return <Icon icon={colored} size={size} />;
  const glyph = brands[key];
  if (!glyph) return <Box size={size} strokeWidth={1.75} />;
  return <Icon icon={glyph} size={size} color={BRAND_TINTS[key] ?? color ?? ink ?? t.c.foreground} />;
}

export function ClaudeLogoIcon({ size = 16, variant = "mark" }: { size?: number; variant?: "mark" | "tile"; className?: string }) {
  return <Icon icon={variant === "tile" ? Icons.mark.claudeTile : Icons.mark.claude} size={size} />;
}

export function InlineStellaMark({ size = 16 }: { size?: number; className?: string; children?: ReactNode }) {
  return <StellaMark size={size} />;
}

/** Radix's `VisuallyHidden`: announced, out of the layout and never drawn. */
export function VisuallyHidden({ children }: { asChild?: boolean; children?: ReactNode }) {
  return (
    <col absolute={{ top: 0, left: 0 }} w={1} h={1} clip={0} opacity={0} inert>
      {children}
    </col>
  );
}
