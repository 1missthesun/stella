import { useId, useState, type ReactNode } from "react";
import { Select as KitSelect, type SelectProps as KitSelectProps } from "../Menu";
import { derive, font, fontSize, look, mix, radius, useTokens, type Style } from "../../theme";
import { domEvent, useFormSubmit, type DomEvent } from "./press";
import { T, useInk } from "./text";
import { useTextBase } from "./scope";
import { TimeInput } from "./time-input";

export type SwitchProps = Omit<Style, "id"> & {
  id?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label?: string;
  hideLabel?: boolean;
  description?: string;
  disabled?: boolean;
  title?: string;
  "aria-label"?: string;
  className?: string;
  children?: ReactNode;
  /** The label's text style (desktop-ui's `.<class> [data-slot="switch-label"]` rules). */
  labelStyle?: Style;
  descriptionStyle?: Style;
};

/** desktop-ui's `Switch` (Radix, `[data-component="switch"]`): label, description and a 28×16 track with a sliding thumb in one row, controlled or not. */
export function Switch({ id, checked, defaultChecked = false, onCheckedChange, label, hideLabel, description, disabled = false, title, "aria-label": aria, className: _c, children, labelStyle, descriptionStyle, ...style }: SwitchProps) {
  const t = useTokens();
  const c = t.c;
  const auto = useId();
  const [own, setOwn] = useState(defaultChecked);
  const on = checked ?? own;
  const control = id ?? `switch${auto}`;
  const toggle = disabled
    ? undefined
    : () => {
        if (checked === undefined) setOwn(!on);
        onCheckedChange?.(!on);
      };
  const shownLabel = label ?? (typeof children === "string" ? children : undefined);
  return (
    <row id={`${control}-row`} gap={8} align="center" title={title} opacity={disabled ? 0.5 : undefined} {...style}>
      {(label || children) && !hideLabel ? (
        typeof (label ?? children) === "string" ? (
          <T family="Manrope" size={fontSize.sm} weight={500} em={-0.02} lh={1.67} color={c.foreground} onPress={toggle} {...labelStyle}>
            {label ?? children}
          </T>
        ) : (
          children
        )
      ) : null}
      {description ? (
        <T family="Manrope" size={fontSize.sm} weight={500} em={-0.02} lh={1.5} color={c.mutedForeground} {...descriptionStyle}>
          {description}
        </T>
      ) : null}
      <box
        id={control}
        role="switch"
        label={shownLabel ?? aria}
        checked={on}
        disabled={disabled}
        focusable={!disabled}
        keys={["Space", "Enter"]}
        onKey={toggle}
        focusRing={{ width: 2, offset: 2, color: c.ring }}
        w={28}
        h={16}
        radius={radius.sm}
        fill={on ? c.primary : c.muted}
        border={on ? c.primary : c.border}
        hoverBorder={disabled || on ? undefined : c.ring}
        motion={{ dur: 0.15 }}
        onPress={toggle}
      >
        <box
          id={`${control}-thumb`}
          absolute={on ? { left: 13, top: 1 } : { left: 0, top: 0 }}
          w={on ? 14 : 16}
          h={on ? 14 : 16}
          radius={radius.xs}
          fill={on ? c.primaryForeground : c.background}
          border={on ? undefined : c.border}
          shadows={t.shadow.subtle}
          layout={0.15}
          motion={{ dur: 0.15 }}
        />
      </box>
    </row>
  );
}

export type SelectOption<T extends string = string> = { value: T; label: ReactNode; disabled?: boolean };

export type SelectProps<V extends string = string> = Style & {
  value: V;
  onValueChange?: (value: V) => void;
  options: ReadonlyArray<SelectOption<V>>;
  disabled?: boolean;
  className?: string;
  placeholder?: ReactNode;
  "aria-label"?: string;
  label?: string;
  hideLabel?: boolean;
  id?: string;
  name?: string;
  trigger?: KitSelectProps["trigger"];
};

/** desktop-ui's `Select`; `settings-runtime-select` is the fit-width (120–240) round trigger Settings rows use. */
export function Select<V extends string = string>({ value, onValueChange, options, disabled, className = "", placeholder, label, hideLabel, id, "aria-label": aria, w, minW, maxW, radius: corner, trigger }: SelectProps<V>) {
  const auto = useId();
  const [open, setOpen] = useState(false);
  const runtime = className.includes("settings-runtime-select");
  return (
    <KitSelect
      id={id ?? `select${auto}`}
      value={value}
      onValueChange={onValueChange}
      options={options.map((o) => ({ value: o.value, label: typeof o.label === "string" ? o.label : String(o.label ?? o.value), disabled: o.disabled }))}
      open={open}
      onOpenChange={setOpen}
      disabled={disabled}
      placeholder={typeof placeholder === "string" ? placeholder : undefined}
      label={label ?? aria}
      hideLabel={hideLabel || !label}
      w={(w as number | "full" | "fit" | undefined) ?? (runtime ? "fit" : "full")}
      {...(runtime ? { minW: 120, maxW: 240, radius: radius.full } : {})}
      {...(minW !== undefined ? { minW: minW as number } : {})}
      {...(maxW !== undefined ? { maxW: maxW as number } : {})}
      {...(corner !== undefined ? { radius: corner } : {})}
      trigger={trigger}
    />
  );
}

export type InputProps = Style & {
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
  readOnly?: boolean;
  autoFocus?: boolean;
  multiline?: boolean;
  rows?: number;
  maxLength?: number;
  spellCheck?: boolean;
  autoComplete?: string;
  autoCorrect?: string;
  autoCapitalize?: string;
  inputMode?: string;
  name?: string;
  id?: string;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  onChange?: (e: DomEvent) => void;
  onInput?: (e: DomEvent) => void;
  onKeyDown?: (e: DomEvent) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onPaste?: (e: DomEvent) => void;
  placeholderColor?: string;
  className?: string;
  /** desktop-ui's `TextField` input (Manrope, its own size); otherwise a bare `<input>`, which inherits the surrounding text (Tailwind preflight). */
  field?: boolean;
};

const KEYS = ["Escape", "ArrowUp", "ArrowDown", "Tab"];

/** An `<input>` / `<textarea>` with the DOM handler shapes desktop-ui passes (`onChange(e)`, `onKeyDown(e)`); Enter submits the enclosing form. */
export function Input({ field = false, value, defaultValue, type, disabled, readOnly, autoFocus, multiline, onChange, onInput, onKeyDown, onFocus, onBlur, placeholder, placeholderColor, spellCheck, id, "aria-label": aria, className: _c, rows, maxLength, name: _n, autoComplete: _a, autoCorrect: _ac, autoCapitalize: _ap, inputMode: _im, min: _min, max: _max, step: _s, "aria-invalid": _ai, onPaste: _p, ...style }: InputProps) {
  const t = useTokens();
  const base = useTextBase();
  const ink = useInk();
  const submit = useFormSubmit();
  const [own, setOwn] = useState(defaultValue ?? "");
  const current = value ?? own;
  const [focused, setFocused] = useState(false);
  const { lh, em, size, weight, family, focusBorder, focusFill, ...rest } = style;
  const box = focused ? { ...rest, border: focusBorder ?? rest.border, fill: focusFill ?? rest.fill } : rest;
  const text = field
    ? look(size ?? fontSize.md, weight ?? font.sansWeight, { lh: lh ?? 1.43, em: em ?? font.sansTrackingEm, family: family ?? "sans" })
    : look(size ?? base.size, weight ?? base.weight, { lh: lh ?? base.lh, em: em ?? base.em, family: family ?? base.family ?? font.sans });
  const edge = (side: number | undefined) => (typeof side === "number" ? side : 0);
  const rowsHeight = multiline && rows && box.h === undefined ? rows * text.lineHeight + edge(box.pt ?? box.py ?? box.pad) + edge(box.pb ?? box.py ?? box.pad) : undefined;
  if (type === "time")
    return (
      <TimeInput
        {...box}
        textSize={size}
        textWeight={weight}
        id={id}
        value={current}
        disabled={disabled}
        label={aria ?? placeholder}
        onValue={(next) => {
          if (value === undefined) setOwn(next);
          const e = domEvent(next);
          onChange?.(e);
          onInput?.(e);
        }}
      />
    );
  return (
    <input
      id={id}
      value={current}
      placeholder={placeholder}
      placeholderColor={placeholderColor ?? t.c.mutedForeground}
      secure={type === "password"}
      multiline={multiline}
      readOnly={readOnly || disabled}
      autoFocus={autoFocus}
      spellcheck={spellCheck}
      label={aria ?? placeholder}
      color={field ? t.c.foreground : (ink ?? t.c.foreground)}
      {...text}
      {...box}
      {...(rowsHeight === undefined ? null : { h: rowsHeight })}
      opacity={disabled ? 0.5 : style.opacity}
      keys={onKeyDown ? KEYS : undefined}
      onKey={(k) => onKeyDown?.(domEvent(current, { key: k.key, metaKey: k.mods?.meta, ctrlKey: k.mods?.ctrl, shiftKey: k.mods?.shift, altKey: k.mods?.alt }))}
      onFocus={(next) => {
        setFocused(next);
        if (next) onFocus?.();
        else onBlur?.();
      }}
      onInput={(next) => {
        const capped = maxLength ? next.slice(0, maxLength) : next;
        if (value === undefined) setOwn(capped);
        const e = domEvent(capped);
        onChange?.(e);
        onInput?.(e);
      }}
      onSubmit={(v) => {
        const e = domEvent(v, { key: "Enter" });
        onKeyDown?.(e);
        if (!e.defaultPrevented && !multiline) submit?.();
      }}
    />
  );
}

export type TextFieldProps = InputProps & {
  label?: string;
  hideLabel?: boolean;
  description?: string;
  error?: string;
  variant?: "normal" | "ghost";
  /** desktop-ui's `.<class> [data-slot="input-wrapper"]` and `[data-slot="input-input"]` rules. */
  wrapperStyle?: Style;
  inputStyle?: Style;
};

/** desktop-ui's `TextField`: label, a 32pt bordered field that trades its border for the focus ring, description, error. */
export function TextField({ label, hideLabel, description, error, variant = "normal", multiline, disabled, wrapperStyle, inputStyle, ...input }: TextFieldProps) {
  const t = useTokens();
  const c = t.c;
  const [focused, setFocused] = useState(false);
  const errorFill = derive(t, "compat-field-error", (t) => mix(t.c.destructive, 10, t.c.background));
  if (variant === "ghost") return <Input field {...input} multiline={multiline} disabled={disabled} w="full" />;
  if (input.type === "time") return <Input {...input} {...wrapperStyle} size={inputStyle?.size} weight={inputStyle?.weight} disabled={disabled} aria-label={input["aria-label"] ?? label} />;
  return (
    <col w="full" gap={8} align="start">
      {label && !hideLabel ? (
        <T size={fontSize.sm} weight={font.emphasisWeight} lh={1.5} em={-0.01} family="sans" color={c.mutedForeground}>
          {label}
        </T>
      ) : null}
      <row
        w="full"
        pr={4 + 1}
        pl={1}
        py={1}
        align="start"
        radius={radius.md}
        fill={error ? errorFill : c.background}
        border={error ? c.destructive : focused ? undefined : c.border}
        shadows={focused && !error ? t.shadow.focusRing : undefined}
        opacity={disabled ? 0.5 : undefined}
        {...wrapperStyle}
        {...(focused && !error ? { border: undefined } : null)}
      >
        <Input field
          {...input}
          multiline={multiline}
          disabled={disabled}
          aria-label={input["aria-label"] ?? label}
          grow={1}
          shrink
          minW={0}
          minH={32}
          px={12}
          py={multiline ? 6 : (32 - Math.round((inputStyle?.size ?? fontSize.md) * 1.43)) / 2}
          {...inputStyle}
          onFocus={() => {
            setFocused(true);
            input.onFocus?.();
          }}
          onBlur={() => {
            setFocused(false);
            input.onBlur?.();
          }}
        />
      </row>
      {description ? (
        <T size={fontSize.sm} weight={font.sansWeight} lh={1.5} em={-0.01} color={c.mutedForeground}>
          {description}
        </T>
      ) : null}
      {error ? (
        <T size={fontSize.sm} weight={font.emphasisWeight} lh={1.5} em={-0.01} color={c.destructive}>
          {error}
        </T>
      ) : null}
    </col>
  );
}

/** A native `<input type="checkbox">` as Chromium draws it: 13pt, tinted with `accent` (CSS `accent-color`) when checked. */
export function NativeCheckbox({ checked, onChange, disabled, accent, label, ...style }: Style & { checked: boolean; onChange?: (checked: boolean) => void; disabled?: boolean; accent?: string; label?: string }) {
  const t = useTokens();
  const c = t.c;
  const fill = accent ?? c.primary;
  return (
    <box
      role="checkbox"
      label={label}
      checked={checked}
      disabled={disabled}
      focusable={!disabled}
      keys={["Space"]}
      onKey={disabled ? undefined : () => onChange?.(!checked)}
      onPress={disabled ? undefined : () => onChange?.(!checked)}
      focusRing={{ width: 2, offset: 1, color: c.ring }}
      w={13}
      h={13}
      radius={2.5}
      center
      fill={checked ? fill : c.background}
      border={checked ? fill : mix(c.foreground, 55, c.background)}
      hoverBorder={checked ? undefined : mix(c.foreground, 75, c.background)}
      opacity={disabled ? 0.5 : undefined}
      {...style}
    >
      {checked ? <icon svg='<path d="M2.5 6.5l2.5 2.5 5-5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' name="compat/native-check" view={13} size={13} color={c.primaryForeground} /> : null}
    </box>
  );
}
