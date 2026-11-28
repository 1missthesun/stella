import type { ReactNode } from "react";
import { Icon } from "../../../../desktop-rune/ui/kit";
import { glyph } from "../icons";
import { phoneSheet } from "../ask";
import { rt, TEXT, useRn } from "../rn";

// The rest of packages/mobile's chat-settings/kit.tsx (rn.tsx has its rows, labels and switchers):
// the primary button, the underlined field, notes, and the drawer's staggered rise.

export const SWITCHER_HEIGHT = 62;

export const tapLight = (): void => __native.post(JSON.stringify({ cmd: "haptic", kind: "light" }));
export const notifySuccess = (): void => __native.post(JSON.stringify({ cmd: "haptic", kind: "success" }));
export const notifyError = (): void => __native.post(JSON.stringify({ cmd: "haptic", kind: "error" }));

export const errorText = (error: unknown, fallback = "Something went wrong."): string =>
  error instanceof Error && error.message ? error.message : typeof error === "string" && error ? error : fallback;

/** iOS's small UIActivityIndicatorView. */
export function Spinner({ color, size = 20 }: { color: string; size?: number }) {
  return <Icon icon={glyph("activity")} size={size} color={color} spin={1} />;
}

/**
 * packages/mobile's sidebar Rise: each block fades in and slides 14 + 7·i pt from the side as the
 * drawer opens, later blocks a little later, and leaves the same way as it closes. `fromClosed`:
 * the drawer's first opening mounts it already open, so it enters from the closed pose.
 */
export function Rise({ i, open, fromClosed, children }: { i: number; open: boolean; fromClosed: boolean; children: ReactNode }) {
  const dur = 0.42 + Math.min(i * 0.06, 0.3);
  const dx = 14 + i * 7;
  return (
    <col w="full" opacity={open ? 1 : 0} x={open ? 0 : dx} motion={{ dur, bounce: 0 }} enter={fromClosed ? { opacity: 0, x: dx, dur, bounce: 0 } : undefined}>
      {children}
    </col>
  );
}

export function Note({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "danger" }) {
  const c = useRn();
  return (
    <text {...TEXT.hint} color={tone === "danger" ? c.danger : c.textMuted}>
      {children}
    </text>
  );
}

const PRIMARY_LABEL = rt(17, 700, -0.2);

export function PrimaryButton({ id, label, onPress, busy = false, disabled = false }: { id?: string; label: string; onPress: () => void; busy?: boolean; disabled?: boolean }) {
  const c = useRn();
  const off = disabled || busy;
  return (
    <row id={id} role="button" label={label} focusable={!off} disabled={off} w="full" minH={50} px={22} py={10} radius={25} center fill={c.accent} opacity={disabled ? 0.4 : 1} pressScale={0.98} onPress={off ? undefined : onPress}>
      {busy ? (
        <Spinner color={c.accentForeground} />
      ) : (
        <text {...PRIMARY_LABEL} color={c.accentForeground} textAlign="center">
          {label}
        </text>
      )}
    </row>
  );
}

const FIELD_TEXT = rt(18, 600);

/** The underlined text field (LineField). */
export function LineField({
  id,
  value,
  onChange,
  placeholder,
  label,
  secure = false,
  onSubmit,
  trailing,
}: {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  label?: string;
  secure?: boolean;
  onSubmit?: () => void;
  trailing?: ReactNode;
}) {
  const c = useRn();
  return (
    <row w="full" minH={50} align="center" gap={10} border={c.borderStrong} borderSides={[0, 0, 1, 0]}>
      <input
        id={id}
        grow={1}
        minW={0}
        py={12}
        value={value}
        placeholder={placeholder}
        placeholderColor={c.textWeaker}
        label={label ?? placeholder}
        secure={secure}
        spellcheck={false}
        {...FIELD_TEXT}
        color={c.text}
        caretColor={c.accent}
        onInput={onChange}
        onSubmit={onSubmit ? () => onSubmit() : undefined}
      />
      {trailing ? <box center>{trailing}</box> : null}
    </row>
  );
}

/** A TextAction that can be turned off (dimmed and inert), as kit.tsx's `disabled`. */
export function Dimmed({ off, children }: { off: boolean; children: ReactNode }) {
  return (
    <box selfAlign="start" opacity={off ? 0.4 : 1} inert={off}>
      {children}
    </box>
  );
}

const SWITCHER_TITLE = TEXT.switcherTitle;

/**
 * chat-settings/kit's SwitcherFace as the button that opens its menu (NativeMenu `plain`): a glyph,
 * a big title, an optional status line, then ⌃⌄, or a spinner while busy.
 */
export function Switcher({
  id,
  mark,
  title,
  detail,
  detailTone = "muted",
  busy = false,
  disabled = false,
  label,
  onPress,
}: {
  id: string;
  mark: ReactNode;
  title: string;
  detail?: string;
  detailTone?: "muted" | "ok" | "warning";
  busy?: boolean;
  disabled?: boolean;
  label: string;
  onPress: () => void;
}) {
  const c = useRn();
  const off = disabled || busy;
  return (
    <row id={id} role="button" label={label} focusable={!off} minH={SWITCHER_HEIGHT} w="full" align="center" gap={12} pressScale={0.98} onPress={off ? undefined : onPress}>
      <box w={30} h={30} center shrink={false}>
        {mark}
      </box>
      <col grow={1} minW={0}>
        <text {...SWITCHER_TITLE} color={c.text} maxLines={1}>
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
      {busy ? <Spinner color={c.textMuted} /> : <Icon icon={glyph("chevrons-up-down")} size={15} color={c.textMuted} />}
    </row>
  );
}

/** NativeMenu's items as iOS's action sheet; the chosen one carries a check. */
export type MenuChoice = { id: string; label: string; selected?: boolean; run: () => void };

export async function openMenu(choices: MenuChoice[], cancel: string): Promise<void> {
  const picked = await phoneSheet({ actions: choices.map((choice) => ({ id: choice.id, label: choice.selected ? `${choice.label}  ✓` : choice.label })), cancel });
  if (picked) choices.find((choice) => choice.id === picked)?.run();
}
