import { useState } from "react";
import { derive, font, fontSize, look, mix, radius, useTokens } from "../theme";

export type TextFieldProps = {
  id: string;
  value?: string;
  placeholder?: string;
  label?: string;
  hideLabel?: boolean;
  description?: string;
  error?: string;
  variant?: "normal" | "ghost";
  multiline?: boolean;
  secure?: boolean;
  readOnly?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  onValueChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
};

/** desktop-ui's `TextField` (`[data-component="input"]`): label, a 32pt bordered field that trades its border for the focus ring, description, error. */
export function TextField({ id, value, placeholder, label, hideLabel, description, error, variant = "normal", multiline, secure, readOnly, autoFocus, disabled, onValueChange, onSubmit }: TextFieldProps) {
  const t = useTokens();
  const c = t.c;
  const [focused, setFocused] = useState(false);
  const errorFill = derive(t, "field-error", (t) => mix(t.c.destructive, 10, t.c.background));
  const meta = look(fontSize.sm, font.sansWeight, { lh: 1.5 });
  const input = (
    <input
      id={id}
      value={value}
      placeholder={placeholder}
      placeholderColor={c.mutedForeground}
      multiline={multiline}
      secure={secure}
      readOnly={readOnly || disabled}
      autoFocus={autoFocus}
      label={label}
      {...look(fontSize.md, font.sansWeight, { lh: 1.43 })}
      color={c.foreground}
      w="full"
      grow={1}
      minH={variant === "ghost" ? undefined : multiline ? 20 : undefined}
      onFocus={setFocused}
      onInput={onValueChange}
      onSubmit={onSubmit}
    />
  );
  if (variant === "ghost") return <col w="full">{input}</col>;
  return (
    <col w="full" gap={8} align="start" opacity={disabled ? 0.5 : undefined}>
      {label && !hideLabel ? (
        <text {...look(fontSize.sm, font.emphasisWeight, { lh: 1.5 })} color={c.mutedForeground}>
          {label}
        </text>
      ) : null}
      <row
        id={`${id}-wrapper`}
        w="full"
        minH={32 + 2}
        pl={12 + 1}
        pr={12 + 4 + 1}
        py={multiline ? 6 + 1 : 0}
        align={multiline ? "start" : "center"}
        radius={radius.md}
        fill={error ? errorFill : c.background}
        border={error ? c.destructive : focused ? undefined : c.border}
        shadows={focused && !error ? t.shadow.focusRing : undefined}
        motion={{ dur: 0.12 }}
      >
        {input}
      </row>
      {description ? (
        <text {...meta} color={c.mutedForeground}>
          {description}
        </text>
      ) : null}
      {error ? (
        <text {...look(fontSize.sm, font.emphasisWeight, { lh: 1.5 })} color={c.destructive}>
          {error}
        </text>
      ) : null}
    </col>
  );
}
