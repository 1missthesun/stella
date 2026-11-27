import { SettingsCard, SettingsCardDesc, SettingsCardHeader, SettingsRow, SettingsSelect } from "../parts";
import { Switch, T, TextField } from "../../kit/compat";
import { useSettings } from "../settings.styles";
import { SettingsCardTitle } from "../settings-card-targets";
import { AiryWordPicker } from "../AiryControls";
import { useCallback, useEffect, useState } from "react";
import type {
  UserAskEscalationPolicy,
  UserAskUrgencyLevel,
} from "@stella/contracts/user-ask";
import {
  DEFAULT_USER_ASK_ESCALATION_POLICY,
  USER_ASK_MAX_PER_HOUR_LIMIT,
  USER_ASK_URGENCY_NAMES,
  isWithinQuietHours,
  normalizeUserAskEscalationPolicy,
} from "@stella/contracts/user-ask";
import { useT } from "@/shared/i18n";
import { getElectronApi } from "@/platform/electron/electron";
import { getSettingsErrorMessage } from "@/global/settings/tabs/shared";

const minuteToTimeValue = (minute: number): string => {
  const safe = ((Math.round(minute) % 1440) + 1440) % 1440;
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

const timeValueToMinute = (value: string, fallback: number): number => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return fallback;
  return (((hours * 60 + minutes) % 1440) + 1440) % 1440;
};

const TIME_TEXT = { size: 14.5, weight: 600 };

const RATE_LIMIT_CHOICES = [1, 2, 3, 4, 6, 8, 10, 12, 15, 20].filter(
  (value) => value <= USER_ASK_MAX_PER_HOUR_LIMIT,
);

const deviceTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

export function NativeAskEscalationSettings() {
  const s = useSettings();
  const t = useT();
  const [policy, setPolicy] = useState<UserAskEscalationPolicy>(() =>
    normalizeUserAskEscalationPolicy(DEFAULT_USER_ASK_ESCALATION_POLICY),
  );
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const bridge = getElectronApi()?.userAsk;
      if (!bridge?.policyGet) {
        if (!cancelled) setLoaded(true);
        return;
      }
      try {
        const loadedPolicy = await bridge.policyGet();
        if (!cancelled) {
          setPolicy(normalizeUserAskEscalationPolicy(loadedPolicy));
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            getSettingsErrorMessage(
              loadError,
              t("settings.escalation.errors.load"),
            ),
          );
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const commit = useCallback(
    async (patch: Partial<UserAskEscalationPolicy>) => {
      const bridge = getElectronApi()?.userAsk;
      const previous = policy;
      const next = normalizeUserAskEscalationPolicy({ ...policy, ...patch });
      setPolicy(next);
      setError(null);
      if (!bridge?.policySet) {
        setError(t("settings.escalation.errors.unavailable"));
        setPolicy(previous);
        return;
      }
      setSaving(true);
      try {
        const saved = await bridge.policySet(next);
        setPolicy(normalizeUserAskEscalationPolicy(saved ?? next));
      } catch (saveError) {
        setPolicy(previous);
        setError(
          getSettingsErrorMessage(
            saveError,
            t("settings.escalation.errors.save"),
          ),
        );
      } finally {
        setSaving(false);
      }
    },
    [policy, t],
  );

  const disabled = !loaded || saving;
  const levelOptions = USER_ASK_URGENCY_NAMES.map((name, index) => ({
    value: String(index + 1),
    label: t(`mobile.settings.userAsk.level.${name}`),
  }));
  const now = new Date();
  const quietNow = isWithinQuietHours(
    policy.quietHours,
    now.getHours() * 60 + now.getMinutes(),
  );
  const zone = policy.timeZone ?? deviceTimeZone();

  return (
    <SettingsCard>
      <SettingsCardHeader>
        <SettingsCardTitle titleKey="settings.escalation.title" />
      </SettingsCardHeader>
      <SettingsCardDesc>
        {t("settings.escalation.description")}
      </SettingsCardDesc>

      <SettingsRow stacked>
        <col {...s.settingsRowInfo}>
          <T w="full" {...s.settingsRowLabel}>
            {t("mobile.settings.userAsk.ceiling")}
          </T>
        </col>
        <AiryWordPicker value={String(policy.ceiling)} ariaLabel={t("mobile.settings.userAsk.ceiling")} disabled={disabled} options={levelOptions} onChange={(value) =>
            void commit({ ceiling: Number(value) as UserAskUrgencyLevel })
          } />
      </SettingsRow>

      <SettingsRow>
        <col {...s.settingsRowInfo}>
          <T w="full" {...s.settingsRowLabel}>
            {t("settings.escalation.sound.label")}
          </T>
        </col>
        <row {...s.settingsRowControl}>
          <Switch aria-label={t("settings.escalation.sound.label")} checked={policy.soundEnabled} disabled={disabled} onCheckedChange={(checked) =>
              void commit({ soundEnabled: Boolean(checked) })
            } hideLabel />
        </row>
      </SettingsRow>

      <SettingsRow>
        <col {...s.settingsRowInfo}>
          <T w="full" {...s.settingsRowLabel}>
            {t("settings.escalation.rateLimit.label")}
          </T>
        </col>
        <row {...s.settingsRowControl}>
          <SettingsSelect value={String(policy.maxPerHour)} aria-label={t("settings.escalation.rateLimit.label")} disabled={disabled} options={RATE_LIMIT_CHOICES.map((value) => ({
              value: String(value),
              label: t("settings.escalation.rateLimit.value", {
                count: String(value),
              }),
            }))} onValueChange={(value) =>
              void commit({ maxPerHour: Number(value) })
            } />
        </row>
      </SettingsRow>

      <SettingsRow>
        <col {...s.settingsRowInfo}>
          <T w="full" {...s.settingsRowLabel}>
            {t("settings.escalation.quietHours.label")}
          </T>
          <T w="full" {...s.settingsRowSublabel}>
            {quietNow
              ? t("settings.escalation.quietHours.activeNow")
              : t("settings.escalation.quietHours.sublabel")}
          </T>
        </col>
        <row {...s.settingsRowControl}>
          <Switch aria-label={t("settings.escalation.quietHours.label")} checked={policy.quietHours.enabled} disabled={disabled} onCheckedChange={(checked) =>
              void commit({
                quietHours: {
                  ...policy.quietHours,
                  enabled: Boolean(checked),
                },
              })
            } hideLabel />
        </row>
      </SettingsRow>

      {policy.quietHours.enabled ? (
        <>
          <SettingsRow>
            <col {...s.settingsRowInfo}>
              <T w="full" {...s.settingsRowLabel}>
                {t("settings.escalation.quietHours.window")}
              </T>
              <T w="full" {...s.settingsRowSublabel}>
                {t("settings.escalation.quietHours.windowSublabel", { zone })}
              </T>
            </col>
            <row {...s.settingsRowControl} {...s.settingsEscalationWindow}>
              <TextField wrapperStyle={s.settingsEscalationTime} inputStyle={TIME_TEXT} type="time" label={t("settings.escalation.quietHours.start")} hideLabel aria-label={t("settings.escalation.quietHours.start")} disabled={disabled} value={minuteToTimeValue(policy.quietHours.startMinute)} onChange={(event) =>
                  void commit({
                    quietHours: {
                      ...policy.quietHours,
                      startMinute: timeValueToMinute(
                        event.target.value,
                        policy.quietHours.startMinute,
                      ),
                    },
                  })
                } />
              <TextField wrapperStyle={s.settingsEscalationTime} inputStyle={TIME_TEXT} type="time" label={t("settings.escalation.quietHours.end")} hideLabel aria-label={t("settings.escalation.quietHours.end")} disabled={disabled} value={minuteToTimeValue(policy.quietHours.endMinute)} onChange={(event) =>
                  void commit({
                    quietHours: {
                      ...policy.quietHours,
                      endMinute: timeValueToMinute(
                        event.target.value,
                        policy.quietHours.endMinute,
                      ),
                    },
                  })
                } />
            </row>
          </SettingsRow>

          <SettingsRow stacked>
            <col {...s.settingsRowInfo}>
              <T w="full" {...s.settingsRowLabel}>
                {t("mobile.settings.userAsk.quietCeiling")}
              </T>
            </col>
            <AiryWordPicker value={String(policy.quietHoursCeiling)} ariaLabel={t("mobile.settings.userAsk.quietCeiling")} disabled={disabled} options={levelOptions} onChange={(value) =>
                void commit({
                  quietHoursCeiling: Number(value) as UserAskUrgencyLevel,
                })
              } />
          </SettingsRow>
        </>
      ) : null}

      {error ? (
        <SettingsCardDesc error role="alert">
          {error}
        </SettingsCardDesc>
      ) : null}
    </SettingsCard>
  );
}
