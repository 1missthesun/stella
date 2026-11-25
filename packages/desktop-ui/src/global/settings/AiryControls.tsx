import { useCallback } from "react";
import { useT } from "@/shared/i18n";
import { registerSettingsCardHeading } from "@/global/settings/settings-card-targets";

export interface AiryWordOption<T extends string> {
  value: T;
  label: string;
}

export function AiryWordPicker<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
  className,
}: {
  value: T;
  options: readonly AiryWordOption<T>[];
  onChange: (next: T) => void;
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      className={className ? `airy-word-picker ${className}` : "airy-word-picker"}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      data-disabled={disabled || undefined}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            data-active={active || undefined}
            className="airy-word-picker__option"
            onClick={() => {
              if (!disabled && option.value !== value) onChange(option.value);
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function SettingsTabHeader({
  titleKey,
  cardKey,
}: {
  titleKey: string;
  cardKey?: string;
}) {
  const t = useT();
  const ref = useCallback(
    (heading: HTMLHeadingElement | null) => {
      if (!cardKey) return;
      return registerSettingsCardHeading(cardKey, heading);
    },
    [cardKey],
  );
  return (
    <h2 ref={cardKey ? ref : undefined} className="settings-page-title">
      {t(titleKey)}
    </h2>
  );
}
