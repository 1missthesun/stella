/// <reference path="../../../js/natives.d.ts" />
import type { ReactNode } from "react";
import type { Loop } from "../../../../desktop-rune/host/rune-jsx/props";
import { Icon } from "../../../../desktop-rune/ui/kit";
import { glyph } from "../icons";
import { useTokens } from "../../../../desktop-rune/ui/theme";
import { BRAND_TOP, Dot, GUTTER, rt, TEXT, useRn } from "../rn";
import { OPEN_SETTLE_S } from "../stage";
import type { PhoneInsets } from "../insets";

// The Account drawer's own pieces of packages/mobile's kit: SettingsScroll's page, StartRise,
// settings-styles' rows, the kit's PrimaryButton and Note, and the word and stepper pickers.

export const tapLight = (): void => __native.post(JSON.stringify({ cmd: "haptic", kind: "light" }));

export const TNUM = "'tnum' 1";

export const ACCOUNT_TEXT = {
  note: rt(14, 500, 0, 20),
  rowLabel: TEXT.toggleLabel,
  primaryLabel: rt(17, 700, -0.2),
  wordLabel: rt(18, 600, -0.35),
  swatchName: rt(12, 600, -0.1),
  levelLabel: rt(15.5, 600, -0.3),
  stepperValue: rt(15.5, 600),
  stateTitle: rt(19, 600, -0.4),
} as const;

/** SettingsScroll inDrawer: one scrolling column under the status bar, in from the gutters. */
export function DrawerPage({ id, insets, enter, children }: { id: string; insets: PhoneInsets; enter?: "left" | "right"; children: ReactNode }) {
  return (
    <col
      id={id}
      absolute={{ left: 0, top: 0, right: 0, bottom: 0 }}
      scrollY
      pt={insets.top + BRAND_TOP}
      px={GUTTER}
      pb={32 + insets.bottom}
      enter={enter ? { opacity: 0, x: enter === "right" ? 25 : -25, dur: 0.24, bounce: 0 } : undefined}
      exit={{ opacity: 0, dur: 0.12, bounce: 0 }}
    >
      {children}
    </col>
  );
}

const RISE_SAMPLES = 12;
const riseLoops = new Map<string, { slide: Loop; veil: Loop }>();

/**
 * StartRise's look over the drawer's opening, played as a one-shot sequence when it opens: the
 * section slides in from `-14 - 7i` over the whole spring and fades in over half of it, starting
 * `0.08 i` in. `odd` alternates the spec between openings so the sequence plays again. The fade
 * is the drawer's background over the section fading out (`veil`), the same picture on the
 * drawer's solid background, so the section never draws into a layer of its own each frame.
 */
function riseLoop(i: number, odd: boolean): { slide: Loop; veil: Loop } {
  const key = `${i}:${odd ? 1 : 0}`;
  const hit = riseLoops.get(key);
  if (hit) return hit;
  const from = Math.min(0.08 * i, 0.5);
  const dx = -14 - i * 7;
  const at = (k: number) => k / RISE_SAMPLES;
  const v = (k: number) => 1 - (1 - at(k)) ** 3;
  const steps = Array.from({ length: RISE_SAMPLES + 1 }, (_, k) => k);
  const period = OPEN_SETTLE_S + (odd ? 0.001 : 0);
  const loops = {
    slide: { kind: "sequence", period, times: 1, ease: "linear", frames: steps.map((k) => ({ at: at(k), x: dx * (1 - v(k)) })) },
    veil: { kind: "sequence", period, times: 1, ease: "linear", frames: steps.map((k) => ({ at: at(k), opacity: 1 - Math.max(0, Math.min(1, (v(k) - from) / 0.5)) })) },
  } satisfies { slide: Loop; veil: Loop };
  riseLoops.set(key, loops);
  return loops;
}

export function Rise({ i, play, odd, children }: { i: number; play: boolean; odd: boolean; children: ReactNode }) {
  const bg = useTokens().c.background;
  const loops = play ? riseLoop(i, odd) : undefined;
  return (
    <col loop={loops?.slide}>
      {children}
      {loops ? <box absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} fill={bg} loop={loops.veil} inert /> : null}
    </col>
  );
}

/** settings-styles' row: a label with a quiet line under it and a control at the end. */
export function SettingsRow({ label, sub, subLines, labelLines, children }: { label: string; sub?: string; subLines?: number; labelLines?: number; children?: ReactNode }) {
  const c = useRn();
  return (
    <row minH={50} py={7} align="center" gap={12}>
      <col grow={1} minW={0} gap={3}>
        <text {...ACCOUNT_TEXT.rowLabel} color={c.text} maxLines={labelLines}>
          {label}
        </text>
        {sub ? (
          <text {...TEXT.rowSub} color={c.textMuted} maxLines={subLines}>
            {sub}
          </text>
        ) : null}
      </col>
      {children}
    </row>
  );
}

/** The kit's Note: a quiet paragraph, red for a problem. */
export function Note({ children, danger = false }: { children: string; danger?: boolean }) {
  const c = useRn();
  return (
    <text {...ACCOUNT_TEXT.note} color={danger ? c.danger : c.textMuted}>
      {children}
    </text>
  );
}

/** The kit's PrimaryButton: a full-width accent pill, 50 tall. */
export function PrimaryButton({ id, label, onPress, busy = false, disabled = false }: { id?: string; label: string; onPress: () => void; busy?: boolean; disabled?: boolean }) {
  const c = useRn();
  const off = disabled || busy;
  return (
    <row
      id={id}
      role="button"
      label={label}
      focusable={!off}
      disabled={off}
      minH={50}
      px={22}
      py={10}
      radius={25}
      fill={c.accent}
      center
      opacity={disabled ? 0.4 : 1}
      pressScale={0.98}
      onPress={off ? undefined : onPress}
    >
      {busy ? (
        <Spinner color={c.accentForeground} />
      ) : (
        <text {...ACCOUNT_TEXT.primaryLabel} color={c.accentForeground} textAlign="center">
          {label}
        </text>
      )}
    </row>
  );
}

/** ActivityIndicator size="small". */
export const Spinner = ({ color, size = 20 }: { color: string; size?: number }) => <Icon icon={glyph("activity")} size={size} color={color} spin={1} />;

/** The kit's TextAction with its disabled state. */
export function LinkAction({ label, onPress, tone = "interactive", disabled = false }: { label: string; onPress: () => void; tone?: "interactive" | "muted" | "danger"; disabled?: boolean }) {
  const c = useRn();
  const color = tone === "danger" ? c.danger : tone === "muted" ? c.textMuted : c.textInteractive;
  return (
    <row role="button" label={label} focusable={!disabled} disabled={disabled} selfAlign="start" minH={32} align="center" gap={5} opacity={disabled ? 0.4 : 1} onPress={disabled ? undefined : onPress}>
      <text {...TEXT.textAction} color={color}>
        {label}
      </text>
    </row>
  );
}

/** AppearanceSubView's InlineWordPicker and the ask settings' LevelPicker: words with a dot under the picked one. */
export function WordPicker<T extends string | number>({
  label,
  options,
  value,
  onChange,
  disabled = false,
  variant,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  disabled?: boolean;
  variant: "words" | "levels";
}) {
  const c = useRn();
  const words = variant === "words";
  return (
    <row role="radiogroup" label={label} align="center" justify={words ? "start" : "between"} gap={words ? 24 : 0} pr={words ? 0 : 4} opacity={disabled ? (words ? 0.36 : 0.4) : 1}>
      {options.map((o) => {
        const picked = o.value === value;
        return (
          <col
            key={String(o.value)}
            role="radio"
            label={o.label}
            selected={picked}
            focusable={!disabled}
            disabled={disabled}
            align="center"
            justify="center"
            gap={words ? 5 : 4}
            minH={words ? 42 : 40}
            minW={words ? 44 : 38}
            pressScale={words ? 0.97 : undefined}
            onPress={disabled || picked ? undefined : () => onChange(o.value)}
          >
            <text {...(words ? ACCOUNT_TEXT.wordLabel : ACCOUNT_TEXT.levelLabel)} color={picked ? c.text : c.textMuted} maxLines={1}>
              {o.label}
            </text>
            <box w={6} h={6} center>
              {picked ? <Dot size={6} /> : null}
            </box>
          </col>
        );
      })}
    </row>
  );
}
