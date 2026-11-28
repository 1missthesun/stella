import { useCallback, useEffect, useState } from "react";
import { backendClient } from "@/platform/backend/backend-client";
import { useBackendView } from "@/platform/backend/use-backend-view";
import { useCloudMemoryPreference } from "@/features/cloud/use-cloud-memory-preference";
import { useCloudConversationSession } from "@/global/auth/hooks/use-cloud-conversation-session";
import { useT } from "@/shared/i18n";
import { Toggle, useRn } from "../rn";
import { ACCOUNT_TEXT, LinkAction, Note, PrimaryButton, SettingsRow, Spinner } from "./kit";

// packages/mobile's CloudHomeSettings (the drawer's Memory row): whether Stella uses saved
// memories, and whether this account shares anonymous usage metrics.

/** use-telemetry-preference: the account's telemetry setting, flipped back if saving fails. */
function useTelemetryPreference(ready: boolean) {
  const live = useBackendView("preferences.get", ready ? {} : "skip");
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const accountEnabled = live.value?.telemetryEnabled;

  useEffect(() => {
    if (typeof accountEnabled === "boolean") setEnabled(accountEnabled);
  }, [accountEnabled]);

  const setTelemetryEnabled = useCallback((next: boolean) => {
    setEnabled(next);
    setSaving(true);
    void backendClient
      .call("preferences.set", { telemetryEnabled: next })
      .then((result) => setEnabled(result.telemetryEnabled))
      .catch(() => setEnabled((previous) => !previous))
      .finally(() => setSaving(false));
  }, []);

  return { enabled, saving, loading: live.value === undefined && live.error === undefined, setTelemetryEnabled };
}

export function MemoryPage({ signedIn, onSignIn }: { signedIn: boolean; onSignIn: () => void }) {
  const c = useRn();
  const t = useT();
  const { isCloudConversationReady } = useCloudConversationSession();
  const memory = useCloudMemoryPreference();
  const telemetry = useTelemetryPreference(signedIn && isCloudConversationReady);

  if (!signedIn) {
    return (
      <col gap={8}>
        <text {...ACCOUNT_TEXT.stateTitle} color={c.text}>
          {t("mobile.cloudHome.signInTitle")}
        </text>
        <Note>{t("mobile.cloudHome.signInBody")}</Note>
        <col mt={12}>
          <PrimaryButton label={t("mobile.cloudHome.signIn")} onPress={onSignIn} />
        </col>
      </col>
    );
  }

  return (
    <col>
      <col gap={20}>
        <SettingsRow label={t("settings.memory.title")} sub={t("settings.memory.description")}>
          <row align="center" gap={8}>
            {memory.status === "loading" || memory.status === "saving" ? <Spinner color={c.accent} /> : null}
            <Toggle id="phone-account-memory-toggle" label={t("settings.memory.title")} value={memory.memoryEnabled} disabled={memory.disabled} onChange={(next) => void memory.setMemoryEnabled(next)} />
          </row>
        </SettingsRow>
        <SettingsRow label={t("settings.telemetry.title")} sub={t("settings.telemetry.description")}>
          <row align="center" gap={8}>
            {telemetry.loading || telemetry.saving ? <Spinner color={c.accent} /> : null}
            <Toggle id="phone-account-telemetry-toggle" label={t("settings.telemetry.title")} value={telemetry.enabled} disabled={telemetry.loading || telemetry.saving} onChange={telemetry.setTelemetryEnabled} />
          </row>
        </SettingsRow>
      </col>
      {memory.issue ? (
        <col gap={8} mt={20}>
          <Note danger>{t(memory.issue === "load" ? "settings.errors.loadMemory" : "settings.errors.saveMemory")}</Note>
          <LinkAction label={t("common.tryAgain")} onPress={() => void memory.retry()} />
        </col>
      ) : null}
    </col>
  );
}
