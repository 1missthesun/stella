import { STELLA_STAR_PATH } from "@stella/contracts/stella-mark";
import { Icon, Icons, type IconData } from "../../../../desktop-rune/ui/kit";
import { useRn } from "../rn";

// packages/mobile's chat-settings/ProviderMark: Stella's gradient star, Claude's clay mark, a
// provider's colour mark or its glyph in the text colour, or an empty rounded square.

const BRAND_KEYS: Record<string, string> = {
  chatgpt: "openai",
  "kimi-coding": "kimi",
  "vercel-ai-gateway": "vercel",
  "github-copilot": "githubcopilot",
  antigravity: "gemini",
};

const BRAND_TINTS: Record<string, string> = {
  openrouter: "#6467f2",
};

const STAR_SPAN = 258.541;
const STAR_CENTER = 114.2705;

/** STELLA_STAR_PATH under MarkLayer's gradient, in its viewBox (-15 -15 258.541 258.541). */
const STELLA_STAR: IconData = {
  name: "phone/stella-star",
  view: STAR_SPAN,
  body:
    `<g transform="translate(15 15)"><defs><linearGradient id="phone-star-ink" gradientUnits="userSpaceOnUse" x1="${STAR_CENTER}" y1="${STAR_SPAN - 15}" x2="${STAR_CENTER}" y2="-15">` +
    `<stop offset="0" stop-color="#00aad8"/><stop offset="0.25" stop-color="#3493d9"/><stop offset="0.5" stop-color="#4878db"/><stop offset="0.75" stop-color="#7449c5"/><stop offset="1" stop-color="#be57a4"/>` +
    `</linearGradient></defs><path d="${STELLA_STAR_PATH}" fill="url(#phone-star-ink)"/></g>`,
} as IconData;

export function ProviderMark({ provider, size = 24 }: { provider: string; size?: number }) {
  const c = useRn();
  if (provider === "stella") return <Icon icon={STELLA_STAR} size={size} />;
  if (provider === "anthropic" || provider === "claude") return <Icon icon={Icons.mark.claude} size={size} />;
  const key = BRAND_KEYS[provider] ?? provider;
  const brands = Icons.brand as Record<string, IconData>;
  const colored = brands[`${key}-color`];
  if (colored) return <Icon icon={colored} size={size} />;
  const mono = brands[key];
  if (!mono) {
    return (
      <box w={size} h={size} center shrink={false}>
        <box w={size * 0.78} h={size * 0.78} radius={size * 0.28} border={c.textMuted} borderWidth={1.5} />
      </box>
    );
  }
  return <Icon icon={mono} size={size} color={BRAND_TINTS[key] ?? c.text} />;
}
