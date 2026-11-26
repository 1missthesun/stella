import { createContext, useContext, type ReactNode } from "react";
import { sampleWorkingDots, WORKING_DOTS_CYCLE_MS, WORKING_DOTS_STAGGER, workingDotsReducedOpacity } from "@stella/contracts/working-dots-bounce";
import { derive, font, fontSize, look, mix, mixOklch, radius, radiusUnset, useTokens } from "../theme";
import { Pill } from "./Button";
import { Icon, Icons, type IconData } from "./icons";
import type { Frame, Loop } from "../rune";
import { MotifArt, type EmptyStateMotif } from "./empty-state/MotifArt";

export type TabItem<T extends string = string> = { value: T; label: string; icon?: IconData; disabled?: boolean };

/** A tab row of desktop-ui pills (`.pill-btn` / `--active`), arrow keys moving between tabs. */
export function Tabs<T extends string = string>({ id, value, onValueChange, items, large = false, label }: { id: string; value: T; onValueChange: (v: T) => void; items: ReadonlyArray<TabItem<T>>; large?: boolean; label?: string }) {
  return (
    <row id={id} role="tablist" label={label} focusGroup gap={4} align="center" wrap>
      {items.map((it) => (
        <Pill key={it.value} id={`${id}-${it.value}`} large={large} active={it.value === value} disabled={it.disabled} icon={it.icon} onPress={() => onValueChange(it.value)}>
          {it.label}
        </Pill>
      ))}
    </row>
  );
}

const AVATAR = {
  small: { box: 20, size: 12, lh: 12 },
  normal: { box: 24, size: 18, lh: 24 },
  large: { box: 32, size: 20, lh: 32 },
} as const;

/** desktop-ui's `Avatar`: an image, or the fallback's first letter in mono caps on the primary colour. */
export function Avatar({ id, fallback, src, background, foreground, size = "normal" }: { id?: string; fallback: string; src?: string; background?: string; foreground?: string; size?: keyof typeof AVATAR }) {
  const t = useTokens();
  const s = AVATAR[size];
  if (src) return <image id={id} src={src} fit="cover" w={s.box} h={s.box} radius={radius.sm} />;
  return (
    <box id={id} w={s.box} h={s.box} center shrink={false} radius={radius.sm} border={t.c.border} fill={background ?? t.c.primary}>
      <text mono size={s.size} weight={500} lineHeight={s.lh} textCase="upper" color={foreground ?? t.c.primaryForeground}>
        {fallback.slice(0, 1)}
      </text>
    </box>
  );
}

/** desktop-ui's `Keybind`: each key in a small muted cap, joined by "+". */
export function Keybind({ keys }: { keys: string | string[] }) {
  const t = useTokens();
  const list = Array.isArray(keys) ? keys : [keys];
  return (
    <row gap={2} align="center">
      {list.map((k, i) => (
        <row key={i} gap={2} align="center">
          <box minW={18} h={18} px={4 + 1} center radius={radius.sm} fill={t.c.muted} border={t.c.border}>
            <text {...look(fontSize.xs, font.emphasisWeight)} lineHeight={fontSize.xs} color={t.c.mutedForeground}>
              {k}
            </text>
          </box>
          {i < list.length - 1 ? (
            <text size={fontSize["2xs"]} lineHeight={15} color={t.c.mutedForeground}>
              +
            </text>
          ) : null}
        </row>
      ))}
    </row>
  );
}

let bounce: Frame[] | null = null;
let fade: Frame[] | null = null;

function dotFrames(dot: number, reduced: boolean): Frame[] {
  if (reduced) {
    return (fade ??= Array.from({ length: 25 }, (_, i) => ({ at: i / 24, opacity: workingDotsReducedOpacity(i / 24) })));
  }
  bounce ??= sampleWorkingDots().map((f, i, all) => ({ at: i / (all.length - 1), y: -f.lift, scaleX: f.scaleX, scaleY: f.scaleY }));
  return bounce.map((f) => ({ ...f, y: (f.y ?? 0) * dot }));
}

/** desktop-ui's `WorkingDots`: three dots hopping in turn (squash and stretch from @stella/contracts), or fading under reduced motion. */
export function WorkingDots({ id, size = 6, gap = 4, color, label, reducedMotion = false }: { id?: string; size?: number; gap?: number; color?: string; label?: string; reducedMotion?: boolean }) {
  const t = useTokens();
  const period = WORKING_DOTS_CYCLE_MS / 1000;
  return (
    <row id={id} gap={gap} align="center" h={size * 2.4} label={label} role="status">
      {[0, 1, 2].map((slot) => (
        <box
          key={slot}
          w={size}
          h={size}
          radius={size / 2}
          fill={color ?? t.c.textWeak}
          loop={{ kind: "sequence", period, delay: slot * WORKING_DOTS_STAGGER * period, frames: dotFrames(size, reducedMotion), origin: [0.5, 1] }}
        />
      ))}
    </row>
  );
}

/** desktop-ui's `ManualCopyField`: a small read-only field, focused and selected, for when the clipboard is unavailable. */
export function ManualCopyField({ id, value, label }: { id: string; value: string; label: string }) {
  const t = useTokens();
  const f = derive(t, "manual-copy", (t) => ({ fill: mix(t.c.foreground, 7, "transparent"), focus: mix(t.c.foreground, 10, "transparent"), sel: mix(t.c.primary, 35, "transparent") }));
  return (
    <box w="full" maxW={352} h={22} px={6} radius={5} fill={f.fill} align="center" title={label}>
      <input
        id={id}
        value={value}
        readOnly
        selectOnFocus
        autoFocus
        spellcheck={false}
        label={label}
        w="full"
        size={fontSize.xs}
        color={t.c.foreground}
        selectionColor={f.sel}
      />
    </box>
  );
}

const RetainedActive = createContext(true);

export const useRetainedSurfaceActive = () => useContext(RetainedActive);

/** desktop-ui's `RetainedSurface`: stays mounted while hidden (not drawn, not hit, not announced), so returning to it is instant. `layered` stacks it over its siblings instead of beside them. */
export function RetainedSurface({ id, active, children, grow, layered }: { id?: string; active: boolean; children: ReactNode; grow?: number; layered?: boolean }) {
  const shown = useRetainedSurfaceActive() && active;
  return (
    <col id={id} hidden={!active} grow={grow} w="full" minH={0} absolute={layered ? { left: 0, top: 0, right: 0, bottom: 0 } : undefined}>
      <RetainedActive.Provider value={shown}>{children}</RetainedActive.Provider>
    </col>
  );
}

/** Stella's star mark: the small cut at 20pt and under, the full one with its core light above. */
export function StellaMark({ id, size = 16, label }: { id?: string; size?: number; label?: string }) {
  return <Icon id={id} icon={size <= 20 ? Icons.mark.stellaSmall : Icons.mark.stella} size={size} title={label} />;
}

/** Manrope's `ch` (the width of "0") per pixel of font size, for desktop-ui's `ch` max-widths. */
export const MANROPE_CH = 0.61;

const MARK_SPOT: Partial<Record<EmptyStateMotif, [number, number]>> = {
  files: [0, 15],
  mail: [0, 15],
  unavailable: [17, 16],
  preview: [17, 16],
  blank: [17, 16],
  changes: [17, 16],
  trash: [0, 6],
};

const MARK_SWEEP: Loop = {
  kind: "sequence",
  period: 7,
  frames: Array.from({ length: 25 }, (_, i) => {
    const p = (1 - Math.cos((2 * Math.PI * i) / 24)) / 2;
    return { at: i / 24, x: 148 * (-0.04 + 0.08 * p), y: -148 * 0.02 * p };
  }),
};

export type EmptyStateAction = { label: string; onClick: () => void; icon?: IconData };

/** desktop-ui's `EmptyState`: the motif's art around Stella's mark, then the copy and actions. */
export function EmptyState({ id = "empty-state", motif, title, body, detail, action, secondaryAction, size = "regular", live = true }: { id?: string; motif: EmptyStateMotif; title: string; body?: string; detail?: string; action?: EmptyStateAction; secondaryAction?: EmptyStateAction; size?: "regular" | "compact"; live?: boolean }) {
  const t = useTokens();
  const compact = size === "compact";
  const art = compact ? 104 : 148;
  const mark = (compact ? 40 : 58) * (motif === "search" ? 0.8 : 1);
  const spot = MARK_SPOT[motif] ?? [0, 0];
  const detailFill = derive(t, "empty-detail", (t) => mixOklch(t.c.foreground, 5, "transparent"));
  return (
    <col id={id} role="status" grow={1} minH={0} align="center" justify="center" pt={compact ? 20 : 32} px={compact ? 16 : 24} pb={compact ? 24 : 40} enter={{ opacity: 0, y: 6, dur: 0.42 }}>
      <box w={art} h={art} shrink={false}>
        <MotifArt id={`${id}-back`} motif={motif} layer="back" art={art} live={live} />
        <box
          absolute={{ left: (art * spot[0]) / 100, top: (art * spot[1]) / 100 }}
          w={art}
          h={art}
          center
          loop={live && motif === "search" ? MARK_SWEEP : undefined}
        >
          <StellaMark size={mark} />
        </box>
        <MotifArt id={`${id}-front`} motif={motif} layer="front" art={art} live={live} />
      </box>
      <col align="center" gap={compact ? 4 : 6} maxW="100%" mt={compact ? 12 : 18}>
        <text {...look(compact ? fontSize.lg : fontSize.xl, 600, { lh: 1.25, em: -0.015 })} color={t.c.textStrong} textAlign="center" balance>
          {title}
        </text>
        {detail ? (
          <box px={10} py={2} radius={radiusUnset} fill={detailFill} maxW={240}>
            <text {...look(fontSize.xs, 500, { lh: 1.6 })} color={t.c.textBase} truncate title={detail}>
              {detail}
            </text>
          </box>
        ) : null}
        {body ? (
          <text {...look(compact ? fontSize.sm : fontSize.base, font.sansWeight, { lh: 1.45 })} color={t.c.textWeak} maxW={34 * MANROPE_CH * (compact ? fontSize.sm : fontSize.base)} textAlign="center" balance>
            {body}
          </text>
        ) : null}
      </col>
      {action || secondaryAction ? (
        <row gap={8} mt={18} wrap justify="center">
          {[action, secondaryAction].filter(Boolean).map((a, i) => (
            <Pill key={i} large gap={6} textColor={t.c.textBase} iconColor={t.c.textWeak} icon={a!.icon} onPress={a!.onClick}>
              {a!.label}
            </Pill>
          ))}
        </row>
      ) : null}
    </col>
  );
}
