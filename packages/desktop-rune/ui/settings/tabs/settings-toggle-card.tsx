import { SettingsCard, SettingsCardDesc, SettingsCardHeader } from "../parts";
import { Button, Switch } from "../../kit/compat";
import { usePill } from "../../global/shared/pill.styles";
import { SettingsCardTitle } from "../settings-card-targets";
import { useT } from "@/shared/i18n";

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
    <SettingsCard>
      <SettingsCardHeader>
        <SettingsCardTitle titleKey={titleKey} variant="row" />
        <Switch aria-label={t(titleKey)} checked={checked} disabled={disabled} onCheckedChange={(next) => onChange(Boolean(next))} hideLabel />
      </SettingsCardHeader>
      <SettingsCardDesc>{description}</SettingsCardDesc>
      {error ? (
        <>
          <SettingsCardDesc error role="alert">
            {error}
          </SettingsCardDesc>
          {retry && retryLabel ? (
            <Button variant="ghost" className="pill-btn" onClick={retry}>
              {retryLabel}
            </Button>
          ) : null}
        </>
      ) : null}
    </SettingsCard>
  );
}
