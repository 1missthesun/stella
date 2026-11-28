import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_USER_ASK_ESCALATION_POLICY,
  USER_ASK_URGENCY_LEVELS,
  USER_ASK_URGENCY_NAMES,
  normalizeMinuteOfDay,
  normalizeUserAskEscalationPolicy,
  type UserAskEscalationPolicy,
  type UserAskUrgencyLevel,
} from "@stella/contracts/user-ask";
import { getAuthHeaders } from "@/global/auth/services/auth-token";
import { backendUrl } from "@/platform/backend/backend-url";
import { useLocale, useT } from "@/shared/i18n";
import { Icon } from "../../../../desktop-rune/ui/kit";
import { glyph } from "../icons";
import { Hairline, SectionLabel, TEXT, Toggle, useRn } from "../rn";
import { ACCOUNT_TEXT, SettingsRow, TNUM, tapLight, WordPicker } from "./kit";

// packages/mobile's UserAskEscalationSection (embedded in the Notifications page): how loud a
// question from Stella may get, its sound, quiet hours and how many per hour, kept on the account
// at /api/user-asks/policy (lib/user-ask-policy.ts).

const POLICY_PATH = "/api/user-asks/policy";
const QUIET_HOURS_STEP_MINUTES = 30;

export type UserAskPolicyView = {
  policy: UserAskEscalationPolicy;
  loaded: boolean;
  available: boolean;
  failed: boolean;
  update: (next: UserAskEscalationPolicy) => void;
};

class PolicyRequestError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

const isMissingRoute = (e: unknown) => e instanceof PolicyRequestError && (e.status === 404 || e.status === 501 || e.status === 405);

const unwrap = (payload: unknown): unknown => {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const policy = (payload as Record<string, unknown>).policy;
    if (policy && typeof policy === "object") return policy;
  }
  return payload;
};

async function policyRequest(method: "GET" | "PUT", body?: UserAskEscalationPolicy): Promise<unknown> {
  if (!backendUrl) throw new PolicyRequestError(501);
  const response = await fetch(`${backendUrl.replace(/\/+$/, "")}${POLICY_PATH}`, {
    method,
    headers: await getAuthHeaders(body ? { "Content-Type": "application/json" } : {}),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new PolicyRequestError(response.status);
  return await response.json();
}

/** lib/user-ask-policy's useUserAskEscalationPolicy. */
export function useUserAskPolicy(enabled: boolean, active: boolean): UserAskPolicyView {
  const [policy, setPolicy] = useState<UserAskEscalationPolicy>(DEFAULT_USER_ASK_ESCALATION_POLICY);
  const [loaded, setLoaded] = useState(false);
  const [available, setAvailable] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled || !active) return;
    let cancelled = false;
    policyRequest("GET")
      .then((payload) => {
        if (cancelled) return;
        setPolicy(normalizeUserAskEscalationPolicy(unwrap(payload)));
        setAvailable(true);
        setLoaded(true);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (isMissingRoute(e)) setAvailable(false);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [active, enabled]);

  const update = useCallback((next: UserAskEscalationPolicy) => {
    const normalized = normalizeUserAskEscalationPolicy(next);
    setPolicy(normalized);
    setFailed(false);
    policyRequest("PUT", normalized)
      .then((payload) => setPolicy(normalizeUserAskEscalationPolicy(unwrap(payload) ?? normalized)))
      .catch((e: unknown) => {
        if (isMissingRoute(e)) setAvailable(false);
        else setFailed(true);
      });
  }, []);

  return { policy, loaded, available, failed, update };
}

export const urgencyLabelKey = (level: UserAskUrgencyLevel) => `mobile.settings.userAsk.level.${USER_ASK_URGENCY_NAMES[level - 1]}`;

const formatMinute = (locale: string, minuteOfDay: number): string => {
  const minute = normalizeMinuteOfDay(minuteOfDay);
  const date = new Date(2000, 0, 1, Math.floor(minute / 60), minute % 60);
  try {
    return date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  } catch {
    return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  }
};

function StepperRow({ label, sub, value, onStep }: { label: string; sub?: string; value: string; onStep: (delta: number) => void }) {
  const c = useRn();
  const t = useT();
  const step = (delta: number) => () => {
    tapLight();
    onStep(delta);
  };
  return (
    <SettingsRow label={label} sub={sub}>
      <row align="center" gap={2}>
        <box role="button" label={t("mobile.settings.userAsk.stepDown", { label })} focusable w={28} h={36} center onPress={step(-1)}>
          <Icon icon={glyph("chevron-left")} size={15} color={c.textMuted} />
        </box>
        <text {...ACCOUNT_TEXT.stepperValue} color={c.text} features={TNUM} minW={64} textAlign="center">
          {value}
        </text>
        <box role="button" label={t("mobile.settings.userAsk.stepUp", { label })} focusable w={28} h={36} center onPress={step(1)}>
          <Icon icon={glyph("chevron-right")} size={15} color={c.textMuted} />
        </box>
      </row>
    </SettingsRow>
  );
}

/** The Notifications page: what a question from Stella may do (UserAskEscalationSection, embedded). */
export function NotificationsPage({ view }: { view: UserAskPolicyView }) {
  const c = useRn();
  const t = useT();
  const locale = useLocale();
  const { policy, loaded, available, failed, update } = view;
  const levels = useMemo(() => USER_ASK_URGENCY_LEVELS.map((level) => ({ value: level, label: t(urgencyLabelKey(level)) })), [t]);
  const quiet = policy.quietHours;
  const shiftQuiet = (edge: "startMinute" | "endMinute") => (delta: number) =>
    update({ ...policy, quietHours: { ...quiet, [edge]: normalizeMinuteOfDay(quiet[edge] + delta * QUIET_HOURS_STEP_MINUTES) } });

  return (
    <col>
      <Hairline space={20} />
      <SectionLabel>{t("mobile.settings.userAsk.section")}</SectionLabel>
      <col gap={14} mt={8}>
        {!available && loaded ? (
          <text {...TEXT.hint} color={c.textMuted} py={10}>
            {t("mobile.settings.userAsk.unavailable")}
          </text>
        ) : (
          <>
            <col gap={10} py={4}>
              <col gap={3}>
                <text {...ACCOUNT_TEXT.rowLabel} color={c.text}>
                  {t("mobile.settings.userAsk.ceiling")}
                </text>
                <text {...TEXT.rowSub} color={c.textMuted}>
                  {t("mobile.settings.userAsk.ceilingSub")}
                </text>
              </col>
              <WordPicker
                variant="levels"
                label={t("mobile.settings.userAsk.ceiling")}
                disabled={!available}
                options={levels}
                value={policy.ceiling}
                onChange={(next) => {
                  tapLight();
                  update({ ...policy, ceiling: next });
                }}
              />
            </col>

            <SettingsRow label={t("mobile.settings.userAsk.sound")} sub={t("mobile.settings.userAsk.soundSub")}>
              <Toggle
                label={t("mobile.settings.userAsk.sound")}
                disabled={!available}
                value={policy.soundEnabled}
                onChange={(next) => {
                  tapLight();
                  update({ ...policy, soundEnabled: next });
                }}
              />
            </SettingsRow>

            <SettingsRow
              label={t("mobile.settings.userAsk.quietHours")}
              sub={t("mobile.settings.userAsk.quietHoursSub", { start: formatMinute(locale, quiet.startMinute), end: formatMinute(locale, quiet.endMinute) })}
            >
              <Toggle
                label={t("mobile.settings.userAsk.quietHours")}
                disabled={!available}
                value={quiet.enabled}
                onChange={(next) => {
                  tapLight();
                  update({ ...policy, quietHours: { ...quiet, enabled: next } });
                }}
              />
            </SettingsRow>

            {quiet.enabled ? (
              <col gap={12} pt={2}>
                <StepperRow label={t("mobile.settings.userAsk.quietStart")} value={formatMinute(locale, quiet.startMinute)} onStep={shiftQuiet("startMinute")} />
                <StepperRow label={t("mobile.settings.userAsk.quietEnd")} value={formatMinute(locale, quiet.endMinute)} onStep={shiftQuiet("endMinute")} />
                <col gap={10} py={4}>
                  <text {...ACCOUNT_TEXT.rowLabel} color={c.text}>
                    {t("mobile.settings.userAsk.quietCeiling")}
                  </text>
                  <WordPicker
                    variant="levels"
                    label={t("mobile.settings.userAsk.quietCeiling")}
                    disabled={!available}
                    options={levels}
                    value={policy.quietHoursCeiling}
                    onChange={(next) => {
                      tapLight();
                      update({ ...policy, quietHoursCeiling: next });
                    }}
                  />
                </col>
              </col>
            ) : null}

            <StepperRow
              label={t("mobile.settings.userAsk.rateLimit")}
              sub={t("mobile.settings.userAsk.rateLimitSub")}
              value={t("mobile.settings.userAsk.rateLimitValue", { count: policy.maxPerHour })}
              onStep={(delta) => update({ ...policy, maxPerHour: policy.maxPerHour + delta })}
            />

            {failed ? (
              <text {...TEXT.hint} color={c.textMuted} py={10}>
                {t("mobile.settings.userAsk.saveFailed")}
              </text>
            ) : null}
          </>
        )}
      </col>
    </col>
  );
}
