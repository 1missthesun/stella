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
import { useColors } from "../../theme/theme-context";
import { GlassToggle } from "../glass";
import { Icon } from "../Icon";
import { Dot, Hairline, SectionLabel } from "../chat-settings/kit";
import type { SettingsStyles } from "./settings-styles";

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
  const locale = useLocale();
  const t = useT();
  const local = useMemo(() => makeStyles(colors), [colors]);
  const owned = useUserAskEscalationPolicy(enabled && !view, active);
  const { policy, loaded, available, failed, update } = view ?? owned;

  const levelOptions = useMemo(
    () =>
      USER_ASK_URGENCY_LEVELS.map((level) => ({
        value: level,
        label: t(
          `mobile.settings.userAsk.level.${USER_ASK_URGENCY_NAMES[level - 1]}`,
        ),
      })),
    [t],
  );

  if (!enabled) return null;

  return (
    <View style={embedded ? local.embeddedSection : styles.section}>
      {embedded ? <Hairline space={20} /> : null}
      <SectionLabel>{t("mobile.settings.userAsk.section")}</SectionLabel>
      <View style={local.stack}>
        {!available && loaded ? (
          <Text style={styles.hint}>
            {t("mobile.settings.userAsk.unavailable")}
          </Text>
        ) : (
          <>
            <View style={local.stackedRow}>
              <View style={styles.rowCopy}>
                <Text style={styles.rowLabel}>
                  {t("mobile.settings.userAsk.ceiling")}
                </Text>
                <Text style={styles.rowSub}>
                  {t("mobile.settings.userAsk.ceilingSub")}
                </Text>
              </View>
              <LevelPicker
                accessibilityLabel={t("mobile.settings.userAsk.ceiling")}
                disabled={!available}
                local={local}
                options={levelOptions}
                value={policy.ceiling}
                onChange={(next) => {
                  tapLight();
                  update({ ...policy, ceiling: next });
                }}
              />
            </View>

            <View style={styles.row}>
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

            <View style={styles.row}>
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
              <View style={local.quietBlock}>
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
                <View style={local.stackedRow}>
                  <Text style={styles.rowLabel}>
                    {t("mobile.settings.userAsk.quietCeiling")}
                  </Text>
                  <LevelPicker
                    accessibilityLabel={t(
                      "mobile.settings.userAsk.quietCeiling",
                    )}
                    disabled={!available}
                    local={local}
                    options={levelOptions}
                    value={policy.quietHoursCeiling}
                    onChange={(next) => {
                      tapLight();
                      update({ ...policy, quietHoursCeiling: next });
                    }}
                  />
                </View>
              </View>
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

function LevelPicker({
  accessibilityLabel,
  disabled,
  local,
  options,
  value,
  onChange,
}: {
  accessibilityLabel: string;
  disabled: boolean;
  local: ReturnType<typeof makeStyles>;
  options: ReadonlyArray<{ value: UserAskUrgencyLevel; label: string }>;
  value: UserAskUrgencyLevel;
  onChange: (next: UserAskUrgencyLevel) => void;
}) {
  return (
    <View
      style={[local.levels, disabled && local.disabled]}
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
    >
      {options.map((option) => {
        const picked = option.value === value;
        return (
          <Pressable
            key={option.value}
            disabled={disabled}
            onPress={() => {
              if (!picked) onChange(option.value);
            }}
            hitSlop={{ top: 8, bottom: 8 }}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: picked, disabled }}
            style={({ pressed }) => [
              local.levelItem,
              pressed && !picked && local.pressed,
            ]}
          >
            <Text
              style={[local.levelLabel, picked && local.levelPicked]}
              numberOfLines={1}
              maxFontSizeMultiplier={1.2}
            >
              {option.label}
            </Text>
            <View style={local.levelMark}>
              {picked ? <Dot size={6} /> : null}
            </View>
          </Pressable>
        );
      })}
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
    <View style={styles.row}>
      <View style={styles.rowCopy}>
        <Text style={styles.rowLabel}>{label}</Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
      <View style={local.stepper}>
        <Pressable
          accessibilityLabel={t("mobile.settings.userAsk.stepDown", { label })}
          accessibilityRole="button"
          hitSlop={6}
          onPress={() => {
            tapLight();
            onStep(-1);
          }}
          style={({ pressed }) => [local.stepButton, pressed && local.pressed]}
        >
          <Icon
            color={colors.textMuted}
            name="chevron-left"
            size={15}
            weight="semibold"
          />
        </Pressable>
        <Text style={local.stepperValue}>{value}</Text>
        <Pressable
          accessibilityLabel={t("mobile.settings.userAsk.stepUp", { label })}
          accessibilityRole="button"
          hitSlop={6}
          onPress={() => {
            tapLight();
            onStep(1);
          }}
          style={({ pressed }) => [local.stepButton, pressed && local.pressed]}
        >
          <Icon
            color={colors.textMuted}
            name="chevron-right"
            size={15}
            weight="semibold"
          />
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    embeddedSection: {
      marginTop: 0,
    },
    stack: {
      gap: 14,
      marginTop: 8,
    },
    quietBlock: {
      gap: 12,
      paddingTop: 2,
    },
    stackedRow: {
      gap: 10,
      paddingVertical: 4,
    },
    levels: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingRight: 4,
    },
    levelItem: {
      alignItems: "center",
      gap: 4,
      justifyContent: "center",
      minHeight: 40,
      minWidth: 38,
    },
    levelLabel: {
      color: colors.textMuted,
      fontFamily: fonts.sans.semiBold,
      fontSize: 15.5,
      letterSpacing: -0.3,
    },
    levelPicked: {
      color: colors.text,
    },
    levelMark: {
      height: 6,
      width: 6,
    },
    stepButton: {
      alignItems: "center",
      height: 36,
      justifyContent: "center",
      width: 28,
    },
    stepper: {
      alignItems: "center",
      flexDirection: "row",
      gap: 2,
    },
    stepperValue: {
      color: colors.text,
      fontFamily: fonts.sans.semiBold,
      fontSize: 15.5,
      fontVariant: ["tabular-nums"],
      minWidth: 64,
      textAlign: "center",
    },
    disabled: {
      opacity: 0.4,
    },
    pressed: {
      opacity: 0.55,
    },
  });
