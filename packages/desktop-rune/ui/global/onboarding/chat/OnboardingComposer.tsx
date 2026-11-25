import { Form } from "../../../kit/compat";
import { useFullShellComposer } from "../../shared/full-shell.composer.styles";
import { useCallback } from "react";
import {
  ComposerAddButton,
  ComposerSubmitButton,
  ComposerTextarea,
} from "@/features/chat/ComposerPrimitives";
import { useT } from "@/shared/i18n";

type OnboardingComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
};

export function OnboardingComposer({
  value,
  onChange,
  onSend,
  disabled = false,
}: OnboardingComposerProps) {
  const s = useFullShellComposer();
  const t = useT();
  const canSubmit = value.trim().length > 0 && !disabled;

  const submit = useCallback(
    (event?: { preventDefault(): void }) => {
      event?.preventDefault();
      if (!canSubmit) return;
      onSend();
    },
    [canSubmit, onSend],
  );

  return (
    <col {...s.composer}>
      <col w="full" {...s.composerShell}>
        <col {...s.composerShellContent}>
          <Form {...s.composerForm} onSubmit={submit}>
            <ComposerAddButton className="composer-add-button" title={t("app.chat.composer.add")} disabled />
            <ComposerTextarea className="composer-input" value={value} placeholder={t("onboarding.chat.composerPlaceholder")} disabled={disabled} rows={1} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  submit();
                }
              }} />
            <ComposerSubmitButton className="composer-submit" disabled={!canSubmit} aria-label={t("onboarding.chat.send")} animated />
          </Form>
        </col>
      </col>
    </col>
  );
}
