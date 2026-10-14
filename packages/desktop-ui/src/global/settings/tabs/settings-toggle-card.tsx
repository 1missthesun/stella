import { Button } from "@/ui/button";
import { SettingsCardTitle } from "@/global/settings/settings-card-targets";
import { useT } from "@/shared/i18n";
import { Switch } from "@/ui/switch";

export function SettingsToggleCard({
  titleKey,
  description,
  error,
  checked,
  disabled,
  onChange,
  retry,
  retryLabel,
}: {
  titleKey: string;
  description: string;
  error: string | null;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
  retry?: () => void;
  retryLabel?: string;
}) {
  const t = useT();
  return (
    <div className="settings-card">
      <div className="settings-card-header">
        <SettingsCardTitle titleKey={titleKey} />
        <Switch
          aria-label={t(titleKey)}
          checked={checked}
          disabled={disabled}
          onCheckedChange={(next) => onChange(Boolean(next))}
          hideLabel
        />
      </div>
      <p className="settings-card-desc">{description}</p>
      {error ? (
        <>
          <p
            className="settings-card-desc settings-card-desc--error"
            role="alert"
          >
            {error}
          </p>
          {retry && retryLabel ? (
            <Button
              type="button"
              variant="ghost"
              className="pill-btn"
              onClick={retry}
            >
              {retryLabel}
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
