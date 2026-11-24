import { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "../Text";
import {
  USER_ASK_URGENCY_LEVELS,
  USER_ASK_URGENCY_NAMES,
  normalizeMinuteOfDay,
  type UserAskUrgencyLevel,
} from "@stella/contracts/user-ask";
import { tapLight } from "../../lib/haptics";
import {
  useUserAskEscalationPolicy,
  type UserAskPolicyView,
} from "../../lib/user-ask-policy";
import { useLocale, useT } from "../../i18n";
import type { Colors } from "../../theme/colors";
import { fonts } from "../../theme/fonts";
import { useColors, useTheme } from "../../theme/theme-context";
import { GlassToggle } from "../glass";
import { Icon } from "../Icon";
import { SegmentedControl } from "../SegmentedControl";
import { settingsSurfaceFills, type SettingsStyles } from "./settings-styles";

const QUIET_HOURS_STEP_MINUTES = 30;

const formatMinute = (locale: string, minuteOfDay: number): string => {
  const minute = normalizeMinuteOfDay(minuteOfDay);
  const date = new Date(2000, 0, 1, Math.floor(minute / 60), minute % 60);
  try {
    return date.toLocaleTimeString(locale, {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(
      minute % 60,
    ).padStart(2, "0")}`;
  }
};

export function UserAskEscalationSection({
  enabled,
  active,
  styles,
  embedded = false,
  view,
}: {
  enabled: boolean;
  active: boolean;
  styles: SettingsStyles;
  embedded?: boolean;
  view?: UserAskPolicyView;
}) {
  const colors = useColors();
  const { isDark } = useTheme();
  const locale = useLocale();
  const t = useT();
  const local = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const owned = useUserAskEscalationPolicy(enabled && !view, active);
  const { policy, loaded, available, failed, update } = view ?? owned;

  const levelOptions = useMemo(
    () =>
      USER_ASK_URGENCY_LEVELS.map((level) => ({
        value: String(level),
        label: t(
          `mobile.settings.userAsk.level.${USER_ASK_URGENCY_NAMES[level - 1]}`,
        ),
      })),
    [t],
  );

  if (!enabled) return null;

  return (
    <View style={embedded ? styles.section : styles.section}>
      <Text style={styles.sectionLabel}>
        {t("mobile.settings.userAsk.section")}
      </Text>
      <View style={styles.group}>
        {!available && loaded ? (
          <Text style={styles.hint}>
            {t("mobile.settings.userAsk.unavailable")}
          </Text>
        ) : (
          <>
            <View style={[styles.row, local.stackedRow]}>
              <View style={styles.rowCopy}>
                <Text style={styles.rowLabel}>
                  {t("mobile.settings.userAsk.ceiling")}
                </Text>
                <Text style={styles.rowSub}>
                  {t("mobile.settings.userAsk.ceilingSub")}
                </Text>
              </View>
              <SegmentedControl
                accessibilityLabel={t("mobile.settings.userAsk.ceiling")}
                disabled={!available}
                onChange={(next) => {
                  tapLight();
                  update({
                    ...policy,
                    ceiling: Number(next) as UserAskUrgencyLevel,
                  });
                }}
                options={levelOptions}
                value={String(policy.ceiling)}
              />
            </View>

            <View style={[styles.row, styles.rowDivider]}>
              <View style={styles.rowCopy}>
                <Text style={styles.rowLabel}>
                  {t("mobile.settings.userAsk.sound")}
                </Text>
                <Text style={styles.rowSub}>
                  {t("mobile.settings.userAsk.soundSub")}
                </Text>
              </View>
              <GlassToggle
                accessibilityLabel={t("mobile.settings.userAsk.sound")}
                disabled={!available}
                onValueChange={(next) => {
                  tapLight();
                  update({ ...policy, soundEnabled: next });
                }}
                value={policy.soundEnabled}
              />
            </View>

            <View style={[styles.row, styles.rowDivider]}>
              <View style={styles.rowCopy}>
                <Text style={styles.rowLabel}>
                  {t("mobile.settings.userAsk.quietHours")}
                </Text>
                <Text style={styles.rowSub}>
                  {t("mobile.settings.userAsk.quietHoursSub", {
                    start: formatMinute(locale, policy.quietHours.startMinute),
                    end: formatMinute(locale, policy.quietHours.endMinute),
                  })}
                </Text>
              </View>
              <GlassToggle
                accessibilityLabel={t("mobile.settings.userAsk.quietHours")}
                disabled={!available}
                onValueChange={(next) => {
                  tapLight();
                  update({
                    ...policy,
                    quietHours: { ...policy.quietHours, enabled: next },
                  });
                }}
                value={policy.quietHours.enabled}
              />
            </View>

            {policy.quietHours.enabled ? (
              <>
                <StepperRow
                  colors={colors}
                  label={t("mobile.settings.userAsk.quietStart")}
                  local={local}
                  onStep={(delta) =>
                    update({
                      ...policy,
                      quietHours: {
                        ...policy.quietHours,
                        startMinute: normalizeMinuteOfDay(
                          policy.quietHours.startMinute +
                            delta * QUIET_HOURS_STEP_MINUTES,
                        ),
                      },
                    })
                  }
                  styles={styles}
                  t={t}
                  value={formatMinute(locale, policy.quietHours.startMinute)}
                />
                <StepperRow
                  colors={colors}
                  label={t("mobile.settings.userAsk.quietEnd")}
                  local={local}
                  onStep={(delta) =>
                    update({
                      ...policy,
                      quietHours: {
                        ...policy.quietHours,
                        endMinute: normalizeMinuteOfDay(
                          policy.quietHours.endMinute +
                            delta * QUIET_HOURS_STEP_MINUTES,
                        ),
                      },
                    })
                  }
                  styles={styles}
                  t={t}
                  value={formatMinute(locale, policy.quietHours.endMinute)}
                />
                <View style={[styles.row, local.stackedRow, styles.rowDivider]}>
                  <View style={styles.rowCopy}>
                    <Text style={styles.rowLabel}>
                      {t("mobile.settings.userAsk.quietCeiling")}
                    </Text>
                  </View>
                  <SegmentedControl
                    accessibilityLabel={t(
                      "mobile.settings.userAsk.quietCeiling",
                    )}
                    disabled={!available}
                    onChange={(next) => {
                      tapLight();
                      update({
                        ...policy,
                        quietHoursCeiling: Number(next) as UserAskUrgencyLevel,
                      });
                    }}
                    options={levelOptions}
                    value={String(policy.quietHoursCeiling)}
                  />
                </View>
              </>
            ) : null}

            <StepperRow
              colors={colors}
              label={t("mobile.settings.userAsk.rateLimit")}
              local={local}
              onStep={(delta) =>
                update({ ...policy, maxPerHour: policy.maxPerHour + delta })
              }
              styles={styles}
              sub={t("mobile.settings.userAsk.rateLimitSub")}
              t={t}
              value={t("mobile.settings.userAsk.rateLimitValue", {
                count: policy.maxPerHour,
              })}
            />

            {failed ? (
              <Text style={styles.hint}>
                {t("mobile.settings.userAsk.saveFailed")}
              </Text>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

function StepperRow({
  colors,
  label,
  local,
  onStep,
  styles,
  sub,
  t,
  value,
}: {
  colors: Colors;
  label: string;
  local: ReturnType<typeof makeStyles>;
  onStep: (delta: number) => void;
  styles: SettingsStyles;
  sub?: string;
  t: (key: string, params?: Record<string, string | number>) => string;
  value: string;
}) {
  return (
    <View style={[styles.row, styles.rowDivider]}>
      <View style={styles.rowCopy}>
        <Text style={styles.rowLabel}>{label}</Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
      <View style={local.stepper}>
        <Pressable
          accessibilityLabel={t("mobile.settings.userAsk.stepDown", { label })}
          accessibilityRole="button"
          onPress={() => {
            tapLight();
            onStep(-1);
          }}
          style={({ pressed }) => [local.stepButton, pressed && local.pressed]}
        >
          <Icon color={colors.textMuted} name="chevron-left" size={14} />
        </Pressable>
        <Text style={local.stepperValue}>{value}</Text>
        <Pressable
          accessibilityLabel={t("mobile.settings.userAsk.stepUp", { label })}
          accessibilityRole="button"
          onPress={() => {
            tapLight();
            onStep(1);
          }}
          style={({ pressed }) => [local.stepButton, pressed && local.pressed]}
        >
          <Icon color={colors.textMuted} name="chevron-right" size={14} />
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors, isDark: boolean) => {
  const { tonalFill } = settingsSurfaceFills(isDark);
  return StyleSheet.create({
    pressed: {
      opacity: 0.55,
    },
    stackedRow: {
      alignItems: "stretch",
      flexDirection: "column",
      gap: 10,
      paddingVertical: 13,
    },
    stepButton: {
      alignItems: "center",
      height: 32,
      justifyContent: "center",
      width: 28,
    },
    stepper: {
      alignItems: "center",
      backgroundColor: tonalFill,
      borderRadius: 9,
      flexDirection: "row",
      paddingHorizontal: 2,
    },
    stepperValue: {
      color: colors.textStrong,
      fontFamily: fonts.sans.medium,
      fontSize: 13,
      fontVariant: ["tabular-nums"],
      minWidth: 58,
      textAlign: "center",
    },
  });
};
