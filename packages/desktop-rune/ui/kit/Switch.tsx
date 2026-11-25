import { font, fontSize, look, radius, useTokens } from "../theme";

export type SwitchProps = {
  id: string;
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label?: string;
  hideLabel?: boolean;
  description?: string;
  disabled?: boolean;
};

/** desktop-ui's `Switch` (`[data-component="switch"]`): a 28×16 square-ish track with a sliding thumb. */
export function Switch({ id, checked, onCheckedChange, label, hideLabel, description, disabled = false }: SwitchProps) {
  const t = useTokens();
  const c = t.c;
  const toggle = disabled ? undefined : () => onCheckedChange?.(!checked);
  return (
    <row id={`${id}-row`} gap={8} align="center" opacity={disabled ? 0.5 : undefined}>
      {label && !hideLabel ? (
        <col gap={0} shrink>
          <text {...look(fontSize.sm, font.sansWeight, { lh: 1.67 })} color={c.foreground} onPress={toggle}>
            {label}
          </text>
          {description ? (
            <text {...look(fontSize.sm, font.sansWeight, { lh: 1.5 })} color={c.mutedForeground}>
              {description}
            </text>
          ) : null}
        </col>
      ) : null}
      <box
        id={id}
        role="switch"
        label={label}
        checked={checked}
        disabled={disabled}
        focusable={!disabled}
        keys={["Space", "Enter"]}
        onKey={toggle}
        focusRing={{ width: 2, offset: 2, color: c.ring }}
        w={28}
        h={16}
        radius={radius.sm}
        fill={checked ? c.primary : c.muted}
        border={checked ? c.primary : c.border}
        hoverBorder={disabled || checked ? undefined : c.ring}
        motion={{ dur: 0.15 }}
        onPress={toggle}
      >
        <box
          id={`${id}-thumb`}
          absolute={checked ? { left: 13, top: 1 } : { left: 0, top: 0 }}
          w={checked ? 14 : 16}
          h={checked ? 14 : 16}
          radius={radius.xs}
          fill={checked ? c.primaryForeground : c.background}
          border={checked ? undefined : c.border}
          shadows={t.shadow.subtle}
          layout={0.15}
          motion={{ dur: 0.15 }}
        />
      </box>
    </row>
  );
}
