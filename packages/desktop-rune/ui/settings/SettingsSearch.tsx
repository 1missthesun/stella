import { useCallback, useState } from "react";
import { useT } from "@/shared/i18n";
import { Input, Press, Search, X } from "../kit/compat";
import { useSettings } from "./settings.styles";

const INPUT_ID = "settings-search-input";

/** Focuses Settings search and selects its text (desktop-ui's "/" shortcut). */
export function focusSettingsSearch(value: string) {
  void stella.engine.focus(INPUT_ID);
  void stella.engine.input.select(INPUT_ID, 0, value.length);
}

interface SettingsSearchProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}

export function SettingsSearch({ value, onChange, placeholder }: SettingsSearchProps) {
  const s = useSettings();
  const t = useT();
  const [focused, setFocused] = useState(false);

  const handleClear = useCallback(() => {
    onChange("");
    void stella.engine.focus(INPUT_ID);
  }, [onChange]);

  return (
    <row {...s.settingsSearch} {...(focused ? { fill: s.settingsSearch.focusFill, border: s.settingsSearch.focusBorder, shadows: s.settingsSearchFocused.shadows, hover: undefined, hoverBorder: undefined } : null)} role="search">
      <Search size={15} strokeWidth={1.85} {...s.settingsSearchIcon} />
      <Input
        id={INPUT_ID}
        {...s.settingsSearchInput}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value.length > 0) {
            e.preventDefault();
            onChange("");
          }
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder ?? t("settings.search.placeholder")}
        placeholderColor={s.settingsSearchInputPlaceholder.color}
        aria-label={t("settings.search.placeholder")}
        spellCheck={false}
      />
      {value.length > 0 ? (
        <Press {...s.settingsSearchClear} onPress={handleClear} label={t("settings.search.clear")} title={t("settings.search.clear")}>
          <X size={12} strokeWidth={2} />
        </Press>
      ) : null}
    </row>
  );
}
