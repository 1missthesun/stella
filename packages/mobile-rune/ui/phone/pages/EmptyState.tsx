import type { Frame, Loop } from "../../../../desktop-rune/host/rune-jsx/props";
import { Icon } from "../../../../desktop-rune/ui/kit";
import { StellaCharacter } from "../../../../desktop-rune/ui/kit/StellaCharacter";
import { alpha, hex, useTokens } from "../../../../desktop-rune/ui/theme";
import { AdaptiveGlass, GlassSheen, useGlassBackdrop } from "../../../../desktop-rune/ui/shell/glass";
import { glyph } from "../icons";
import { TEXT, useRn, type RnColors } from "../rn";
import { phoneGlass } from "../rn";

// packages/mobile's EmptyState: Stella's mark in a soft halo, with the page's motif around it
// (a clock dial with a sweeping hand, app tiles orbiting, files fanned above), one line, and a
// glass "ask Stella" action. Its motion is all transforms on still drawings (Rune `loop`s), so it
// costs the GPU a few quads a frame and never redraws a vector.

export type EmptyStateMotif = "files" | "schedule" | "apps" | "mail";

const ART = 184;
const CENTER = ART / 2;
const MARK = 74;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const BRAND = ["#00aad8", "#3493d9", "#4878db", "#7449c5", "#be57a4"] as const;

/** A colour as SVG paint, its alpha split out (the vector renderer reads no 8-digit hex). */
const svgColor = (attr: string, css: string) => {
  const h = hex(css);
  if (h.length === 9) return `${attr}="${h.slice(0, 7)}" ${attr}-opacity="${+(parseInt(h.slice(7), 16) / 255).toFixed(3)}"`;
  return `${attr}="${h}"`;
};

/** A loop sampled from a smooth function of time, `period` seconds long. */
function sampled(period: number, frame: (p: number) => Omit<Frame, "at">, samples = 32): Loop {
  return { kind: "sequence", period, ease: "linear", frames: Array.from({ length: samples + 1 }, (_, i) => ({ at: i / samples, ...frame(i / samples) })) };
}

const spin = (period: number, dir: 1 | -1): Loop => ({ kind: "sequence", period, ease: "linear", frames: [0, 0.25, 0.5, 0.75, 1].map((at) => ({ at, rotate: dir * at * TAU })) });

const gradientDef = (id: string) => `<defs><linearGradient id="${id}" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${BRAND[0]}"/><stop offset="0.5" stop-color="${BRAND[2]}"/><stop offset="1" stop-color="${BRAND[4]}"/></linearGradient></defs>`;

function Halo({ dark, live }: { dark: boolean; live: boolean }) {
  const body = `<defs><radialGradient id="halo" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${BRAND[2]}" stop-opacity="${dark ? 0.34 : 0.22}"/><stop offset="0.55" stop-color="${BRAND[3]}" stop-opacity="${dark ? 0.12 : 0.08}"/><stop offset="1" stop-color="${BRAND[3]}" stop-opacity="0"/></radialGradient></defs><circle cx="${CENTER}" cy="${CENTER}" r="${CENTER}" fill="url(#halo)"/>`;
  return (
    <box absolute={{ left: 0, top: 0 }} w={ART} h={ART} loop={live ? sampled(6, (p) => ({ scale: 1 + 0.05 * Math.sin(p * TAU), opacity: 0.85 + 0.15 * Math.sin(p * TAU) })) : undefined}>
      <icon svg={body} name={`rn-empty/halo/${dark ? "d" : "l"}`} view={ART} size={ART} />
    </box>
  );
}

const PAGE_W = 58;
const PAGE_H = 74;
const PAGES = [
  { x: -42, y: -30, rotate: -15, phase: 0, variant: "lines" },
  { x: 42, y: -30, rotate: 15, phase: 2.1, variant: "media" },
  { x: 0, y: -42, rotate: 0, phase: 4.2, variant: "image" },
] as const;

function pageBody(variant: (typeof PAGES)[number]["variant"], c: RnColors): string {
  const line = alpha(c.textMuted, 0.28);
  const card = `<rect x="0.5" y="0.5" width="${PAGE_W - 1}" height="${PAGE_H - 1}" rx="11" ${svgColor("fill", c.surface)} ${svgColor("stroke", c.border)} stroke-width="1"/>`;
  const bar = (x: number, y: number, w: number) => `<rect x="${x}" y="${y}" width="${w}" height="4" rx="2" ${svgColor("fill", line)}/>`;
  if (variant === "image")
    return `${gradientDef("f")}${card}<rect x="8" y="8" width="${PAGE_W - 16}" height="30" rx="6" fill="url(#f)" opacity="0.9"/><circle cx="${PAGE_W - 18}" cy="17" r="3.2" fill="#ffffff" opacity="0.85"/><path d="M8 34 L22 22 L32 31 L38 26 L${PAGE_W - 8} 36 L${PAGE_W - 8} 38 L8 38 Z" fill="#ffffff" opacity="0.35"/>${bar(8, 47, 34)}${bar(8, 56, 24)}`;
  if (variant === "lines") return `${gradientDef("f")}${card}<rect x="8" y="10" width="24" height="5" rx="2.5" fill="url(#f)" opacity="0.85"/>${bar(8, 23, PAGE_W - 16)}${bar(8, 32, PAGE_W - 22)}${bar(8, 41, PAGE_W - 18)}${bar(8, 50, 22)}`;
  const m = PAGE_W / 2;
  return `${gradientDef("f")}${card}<circle cx="${m}" cy="28" r="13" fill="url(#f)" opacity="0.9"/><path d="M${m - 3.5} 22.5 L${m + 5.5} 28 L${m - 3.5} 33.5 Z" fill="#ffffff"/>${bar(8, 50, PAGE_W - 16)}${bar(14, 59, PAGE_W - 28)}`;
}

function FilesMotif({ c, live, themeKey }: { c: RnColors; live: boolean; themeKey: string }) {
  return (
    <>
      {PAGES.map((page) => (
        <box
          key={page.variant}
          absolute={{ left: CENTER - PAGE_W / 2, top: CENTER - PAGE_H / 2 }}
          w={PAGE_W}
          h={PAGE_H}
          // A loop's frames add to the element's own transform, so the resting pose is set only while still.
          x={live ? undefined : page.x}
          y={live ? undefined : page.y}
          rotate={live ? undefined : page.rotate * DEG}
          loop={live ? sampled(4, (p) => ({ x: page.x, y: page.y - 3.5 * Math.sin(p * TAU + page.phase), rotate: (page.rotate + 1.6 * Math.cos(p * TAU + page.phase)) * DEG })) : undefined}
        >
          <icon svg={pageBody(page.variant, c)} name={`rn-empty/page/${page.variant}/${themeKey}`} view={PAGE_W} size={PAGE_W} />
        </box>
      ))}
    </>
  );
}

const DIAL_R = 70;

function ScheduleMotif({ c, live, themeKey }: { c: RnColors; live: boolean; themeKey: string }) {
  const ticks = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * TAU;
    const major = i % 3 === 0;
    const r = DIAL_R - (major ? 10 : 9);
    return `<circle cx="${CENTER + r * Math.sin(a)}" cy="${CENTER - r * Math.cos(a)}" r="${major ? 2.2 : 1.3}" ${svgColor("fill", alpha(c.textMuted, major ? 0.55 : 0.32))}/>`;
  }).join("");
  const dial = `<circle cx="${CENTER}" cy="${CENTER}" r="${DIAL_R}" fill="none" ${svgColor("stroke", c.border)} stroke-width="1.25"/>${ticks}`;
  const s = -110 * DEG;
  const sx = CENTER + DIAL_R * Math.sin(s);
  const sy = CENTER - DIAL_R * Math.cos(s);
  const hand = `<defs><linearGradient id="trail" x1="${sx}" y1="${sy}" x2="${CENTER}" y2="${CENTER - DIAL_R}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${BRAND[0]}" stop-opacity="0"/><stop offset="0.6" stop-color="${BRAND[2]}" stop-opacity="0.5"/><stop offset="1" stop-color="${BRAND[4]}" stop-opacity="1"/></linearGradient><radialGradient id="glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${BRAND[4]}" stop-opacity="0.45"/><stop offset="1" stop-color="${BRAND[4]}" stop-opacity="0"/></radialGradient></defs><path d="M ${sx} ${sy} A ${DIAL_R} ${DIAL_R} 0 0 1 ${CENTER} ${CENTER - DIAL_R}" fill="none" stroke="url(#trail)" stroke-width="3" stroke-linecap="round"/><circle cx="${CENTER}" cy="${CENTER - DIAL_R}" r="13" fill="url(#glow)"/><circle cx="${CENTER}" cy="${CENTER - DIAL_R}" r="5" fill="${BRAND[4]}"/><circle cx="${CENTER}" cy="${CENTER - DIAL_R}" r="2" fill="#ffffff" opacity="0.9"/>`;
  return (
    <>
      <box absolute={{ left: 0, top: 0 }} w={ART} h={ART}>
        <icon svg={dial} name={`rn-empty/dial/${themeKey}`} view={ART} size={ART} />
      </box>
      <box absolute={{ left: 0, top: 0 }} w={ART} h={ART} loop={live ? spin(12, 1) : undefined}>
        <icon svg={hand} name="rn-empty/hand" view={ART} size={ART} />
      </box>
    </>
  );
}

const TILE = 32;
const TILE_R = 70;
const GLYPHS = ["circle", "square", "triangle", "circle", "square", "triangle"] as const;

function tileBody(i: number, c: RnColors): string {
  const color = BRAND[i % BRAND.length];
  const m = TILE / 2;
  const glyphSvg = GLYPHS[i] === "circle" ? `<circle cx="${m}" cy="${m}" r="6" fill="${color}"/>` : GLYPHS[i] === "square" ? `<rect x="${m - 5.5}" y="${m - 5.5}" width="11" height="11" rx="3" fill="${color}"/>` : `<path d="M${m} ${m - 6.5} L${m + 6.5} ${m + 5} L${m - 6.5} ${m + 5} Z" fill="${color}" stroke-linejoin="round"/>`;
  return `<rect x="0.5" y="0.5" width="${TILE - 1}" height="${TILE - 1}" rx="9" ${svgColor("fill", c.surface)} ${svgColor("stroke", c.border)} stroke-width="1"/>${glyphSvg}`;
}

function AppsMotif({ c, live, themeKey }: { c: RnColors; live: boolean; themeKey: string }) {
  // The ring turns once a minute; each tile turns back against it (staying upright) and swells as a
  // wave passes around the ring, fifteen times a minute.
  return (
    <box absolute={{ left: 0, top: 0 }} w={ART} h={ART} loop={live ? spin(60, 1) : undefined}>
      {GLYPHS.map((_, i) => {
        const a = (i / 6) * TAU;
        const x = TILE_R * Math.sin(a);
        const y = -TILE_R * Math.cos(a);
        const lift = (p: number) => {
          const wave = Math.sin(p * 15 * TAU - (i * TAU) / 6);
          return wave > 0 ? wave * wave : 0;
        };
        return (
          <box
            key={i}
            absolute={{ left: CENTER - TILE / 2 + x, top: CENTER - TILE / 2 + y }}
            w={TILE}
            h={TILE}
            opacity={0.62 + 0.38 * lift(0)}
            loop={live ? sampled(60, (p) => ({ rotate: -p * TAU, scale: 0.94 + 0.12 * lift(p), opacity: 0.62 + 0.38 * lift(p) }), 15 * 12) : undefined}
          >
            <icon svg={tileBody(i, c)} name={`rn-empty/tile/${i}/${themeKey}`} view={TILE} size={TILE} />
          </box>
        );
      })}
    </box>
  );
}

const ENVELOPE_W = 96;
const ENVELOPE_H = 66;

function MailMotif({ c, live, themeKey }: { c: RnColors; live: boolean; themeKey: string }) {
  const body = `${gradientDef("f")}<rect x="0.5" y="0.5" width="${ENVELOPE_W - 1}" height="${ENVELOPE_H - 1}" rx="12" ${svgColor("fill", c.surface)} ${svgColor("stroke", c.border)} stroke-width="1"/><path d="M10 12 L${ENVELOPE_W / 2} 36 L${ENVELOPE_W - 10} 12" fill="none" stroke="url(#f)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/><rect x="14" y="48" width="30" height="4" rx="2" ${svgColor("fill", alpha(c.textMuted, 0.28))}/>`;
  return (
    <box
      absolute={{ left: CENTER - ENVELOPE_W / 2, top: CENTER - ENVELOPE_H / 2 }}
      w={ENVELOPE_W}
      h={ENVELOPE_H}
      y={live ? undefined : -40}
      rotate={live ? undefined : -4 * DEG}
      loop={live ? sampled(4, (p) => ({ y: -40 - 3.5 * Math.sin(p * TAU), rotate: (-4 + 1.6 * Math.cos(p * TAU)) * DEG })) : undefined}
    >
      <icon svg={body} name={`rn-empty/mail/${themeKey}`} view={ENVELOPE_W} size={ENVELOPE_W} />
    </box>
  );
}

export function EmptyState({ id, motif, message, action, live = true }: { id: string; motif: EmptyStateMotif; message: string; action?: { label: string; onPress: () => void }; live?: boolean; /** Unused: like packages/mobile, the art centres over the whole page, the bar included. */ bottom?: number }) {
  const t = useTokens();
  const c = useRn();
  const themeKey = `${t.themeId}:${t.dark ? "d" : "l"}`;
  const low = motif === "files" || motif === "mail";
  const m = phoneGlass(t);
  const backdrop = useGlassBackdrop();
  return (
    <col id={id} role="status" grow={1} minH={0} align="center" justify="center" px={32} pb={56}>
      <box w={ART} h={ART} shrink={false} inert enter={{ opacity: 0, dur: 0.52 }}>
        <Halo dark={t.dark} live={live} />
        {motif === "files" ? <FilesMotif c={c} live={live} themeKey={themeKey} /> : null}
        {motif === "schedule" ? <ScheduleMotif c={c} live={live} themeKey={themeKey} /> : null}
        {motif === "apps" ? <AppsMotif c={c} live={live} themeKey={themeKey} /> : null}
        {motif === "mail" ? <MailMotif c={c} live={live} themeKey={themeKey} /> : null}
        <box absolute={{ left: CENTER - MARK / 2, top: CENTER - MARK / 2 + (low ? 26 : 0) }} w={MARK} h={MARK} center>
          <StellaCharacter size={MARK} state="idle" eyeColor={t.c.background} paused={!live} />
        </box>
      </box>
      <col align="center" gap={18} mt={22} enter={{ opacity: 0, y: 12, dur: 0.48 }}>
        <text {...TEXT.emptyMessage} color={c.text} textAlign="center" maxW={300} balance>
          {message}
        </text>
        {action ? (
          <AdaptiveGlass>
            <row id={`${id}-action`} role="button" label={action.label} focusable h={40} px={18} gap={7} align="center" radius={20} fx={m.fx} fill={m.fill} border={m.border} onBackdrop={backdrop} pressScale={0.97} onPress={action.onPress}>
              <GlassSheen radius={20} />
              <Icon icon={glyph("chat")} size={14} color={c.accent} />
              <text {...TEXT.emptyAction} color={c.text}>
                {action.label}
              </text>
            </row>
          </AdaptiveGlass>
        ) : (
          <box h={40} />
        )}
      </col>
    </col>
  );
}
