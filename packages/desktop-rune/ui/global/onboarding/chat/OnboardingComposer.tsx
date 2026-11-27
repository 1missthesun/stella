import { ComposerShell } from "../../../chat/ComposerShell";
import { ComposerAddButton, ComposerSubmitButton } from "../../../chat/ComposerPrimitives";
import { useT } from "@/shared/i18n";

type OnboardingComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
};

export function OnboardingComposer({ value, onChange, onSend, disabled = false }: OnboardingComposerProps) {
  const t = useT();
  const canSubmit = value.trim().length > 0 && !disabled;
  const send = () => {
    if (canSubmit) onSend();
  };
  return (
    <ComposerShell
      value={value}
      onChange={onChange}
      onSubmit={send}
      placeholder={t("onboarding.chat.composerPlaceholder")}
      disabled={disabled}
      canSubmit={canSubmit}
      leading={<ComposerAddButton title={t("app.chat.composer.add")} disabled />}
      trailing={<ComposerSubmitButton label={t("onboarding.chat.send")} disabled={!canSubmit} animated onPress={send} />}
    />
  );
}
