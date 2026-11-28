import { useEffect, useId, useRef, useState } from "react";
import { useT } from "@/shared/i18n";
import { mixOklch, useTokens } from "../theme";
import { Press, T, tx } from "../kit/compat";
import { forgetCardPlace, noteCardPlace, usePulsingCard } from "./settings-card-targets";
import { useSettings } from "./settings.styles";
import { SearchTargetGlow } from "./parts";

export interface AiryWordOption<T extends string> {
  value: T;
  label: string;
}

/** desktop-ui's `AiryWordPicker`: words in a row, the chosen one strong with a dot under it. */
export function AiryWordPicker<V extends string>({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
  theme = false,
}: {
  value: V;
  options: readonly AiryWordOption<V>[];
  onChange: (next: V) => void;
  disabled?: boolean;
  ariaLabel: string;
  theme?: boolean;
}) {
  const s = useSettings();
  return (
    <row {...s.airyWordPicker} {...(theme ? s.themePickerWordPicker : null)} {...(disabled ? s.airyWordPickerDisabled : null)} role="radiogroup" label={ariaLabel}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <AiryDotItem
            key={option.value}
            label={option.label}
            active={active}
            disabled={disabled}
            role="radio"
            theme={theme}
            onPress={() => {
              if (!disabled && option.value !== value) onChange(option.value);
            }}
          />
        );
      })}
    </row>
  );
}

/** A word with the active dot under it (`.airy-word-picker__option`, `.settings-bar-item`). */
export function AiryDotItem({
  label,
  active,
  disabled,
  role,
  onPress,
  bar = false,
  theme = false,
  id,
  tabProps,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  role: string;
  onPress: () => void;
  bar?: boolean;
  theme?: boolean;
  id?: string;
  tabProps?: Record<string, unknown>;
}) {
  const s = useSettings();
  const look = bar ? s.settingsBarItem : theme ? { ...s.airyWordPickerOption, ...s.themePickerWordPickerOption } : s.airyWordPickerOption;
  const activeLook = bar ? s.settingsBarItemActive : s.airyWordPickerOptionActive;
  return (
    <Press
      id={id}
      vertical
      role={role}
      checked={role === "radio" ? active : undefined}
      selected={role === "tab" ? active : undefined}
      label={label}
      disabled={disabled}
      {...look}
      {...(active ? activeLook : null)}
      pb={0}
      align="center"
      gap={0}
      onPress={onPress}
      {...tabProps}
    >
      <T {...tx(look, active ? activeLook : null)}>{label}</T>
      <box {...s.airyWordPickerDot} absolute={undefined} mt={(look.pb ?? 10) - 5} opacity={active ? 1 : 0} scale={active ? 1 : 0} motion={{ dur: 0.14 }} />
    </Press>
  );
}

/** desktop-ui's `SettingsTabHeader`: the tab's page title; with `cardKey` it is where a search jump to that card lands. */
export function SettingsTabHeader({ titleKey, cardKey }: { titleKey: string; cardKey?: string }) {
  const t = useT();
  const s = useSettings();
  const tokens = useTokens();
  const id = `settings-page-title-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const y = useRef<number | null>(null);
  const pulse = usePulsingCard();
  const [lit, setLit] = useState(false);
  useEffect(() => {
    if (!cardKey) return;
    if (y.current !== null) noteCardPlace(cardKey, id, y.current);
    return () => forgetCardPlace(cardKey, id);
  }, [cardKey, id]);
  useEffect(() => {
    if (!cardKey || !pulse || pulse.key !== cardKey) return;
    setLit(true);
    const off = setTimeout(() => setLit(false), 320);
    return () => clearTimeout(off);
  }, [pulse, cardKey]);
  return (
    <col
      id={id}
      w="full"
      mb={s.settingsPageTitle.mb}
      onLayout={(r) => {
        y.current = r.y;
        if (cardKey) noteCardPlace(cardKey, id, r.y);
      }}
    >
      {cardKey && pulse?.key === cardKey ? <SearchTargetGlow lit={lit} fill={mixOklch(tokens.c.interactive, 12, "transparent")} ring={mixOklch(tokens.c.interactive, 7, "transparent")} spread={8} /> : null}
      <T role="heading" w="full" {...s.settingsPageTitle} mb={0}>
        {t(titleKey)}
      </T>
    </col>
  );
}
