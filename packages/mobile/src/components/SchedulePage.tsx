import {
  LegendList,
  type LegendListRenderItemProps,
} from "@legendapp/list/react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useT } from "../i18n";
import {
  useMobileSchedules,
  useScheduleAction,
  type MobileSchedule,
  type MobileScheduleAction,
} from "../lib/schedules";
import { authClient } from "../lib/auth-client";
import { isGuest } from "../lib/guest-mode";
import { startChatWith } from "../lib/ask-stella";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "../theme/theme-context";
import { EmptyState } from "./EmptyState";
import { ScheduleRow, makeScheduleRowStyles } from "./schedule-rows";
import {
  answerScheduleZone,
  useScheduleZoneCopy,
  useScheduleZoneNotice,
} from "../lib/schedule-zone";
import type { Colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { tapLight } from "../lib/haptics";

/**
 * The Schedule tab: every schedule the owner has, whichever computer or the
 * cloud runs it, read live from the backend. Pause / resume / delete write back
 * the same way, so the list updates on every device at once.
 */
export function SchedulePage() {
  const colors = useColors();
  const t = useT();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const rowStyles = useMemo(() => makeScheduleRowStyles(colors), [colors]);
  const bottomInset = useSafeAreaInsets().bottom;
  const session = authClient.useSession();
  const signedIn = Boolean(session.data?.user) && !isGuest();

  const loaded = useMobileSchedules(signedIn);
  const schedules = loaded ?? EMPTY;
  const loading = signedIn && loaded === undefined;
  const runAction = useScheduleAction();
  const zoneNotice = useScheduleZoneNotice(signedIn);
  const zoneCopy = useScheduleZoneCopy();
  const [zoneBusy, setZoneBusy] = useState(false);
  const answerZone = useCallback(
    async (move: boolean) => {
      if (!zoneNotice) return;
      tapLight();
      setZoneBusy(true);
      try {
        await answerScheduleZone(zoneNotice.to, move);
      } catch {
        Alert.alert(
          t("mobile.activityHub.schedule.alertTitle"),
          t("schedule.zone.failed"),
        );
      } finally {
        setZoneBusy(false);
      }
    },
    [zoneNotice, t],
  );
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const applyAction = useCallback(
    async (schedule: MobileSchedule, action: MobileScheduleAction) => {
      setBusyKey(`${schedule.kind}:${schedule.id}`);
      try {
        await runAction(action, schedule);
      } catch (e) {
        Alert.alert(
          t("mobile.activityHub.schedule.alertTitle"),
          e instanceof Error
            ? e.message
            : t("mobile.activityHub.schedule.actionFailed"),
        );
      } finally {
        setBusyKey(null);
      }
    },
    [runAction, t],
  );

  const onAction = useCallback(
    (schedule: MobileSchedule, action: MobileScheduleAction) => {
      if (busyKey) return;
      if (action === "remove") {
        // Destructive actions confirm first — deleting stops future runs.
        Alert.alert(
          t("mobile.activityHub.schedule.deleteSchedule"),
          t("mobile.activityHub.schedule.deleteConfirm", {
            title: schedule.title,
          }),
          [
            { text: t("mobile.common.cancel"), style: "cancel" },
            {
              text: t("mobile.common.delete"),
              style: "destructive",
              onPress: () => {
                void applyAction(schedule, action);
              },
            },
          ],
        );
        return;
      }
      void applyAction(schedule, action);
    },
    [busyKey, applyAction, t],
  );

  // Frozen per load so relative badges ("in 5m") don't flicker as the list
  // re-renders; refreshed each time the schedule list reloads.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    setNowMs(Date.now());
  }, [schedules]);

  const renderBody = () => {
    if (!signedIn) {
      return (
        <EmptyState motif="schedule" message={t("mobile.sidebar.signedOutHint")} />
      );
    }
    if (loading) {
      return (
        <View style={[styles.centered, { paddingBottom: bottomInset }]}>
          <ActivityIndicator color={colors.textMuted} />
        </View>
      );
    }
    if (schedules.length === 0) {
      return (
        <EmptyState
          motif="schedule"
          message={t("mobile.activityHub.schedule.empty")}
          action={{
            label: t("mobile.activityHub.schedule.emptyAction"),
            onPress: () =>
              startChatWith(
                router,
                t("mobile.activityHub.schedule.emptyActionPrompt"),
              ),
          }}
        />
      );
    }
    const zoneText = zoneNotice ? zoneCopy(zoneNotice) : null;
    const zoneBanner = zoneText ? (
      <View style={styles.zone} accessibilityRole="summary">
        <Text style={styles.zoneTitle}>{zoneText.title}</Text>
        <Text style={styles.zoneBody}>{zoneText.body}</Text>
        <View style={styles.zoneActions}>
          <Pressable
            accessibilityRole="button"
            disabled={zoneBusy}
            onPress={() => void answerZone(false)}
            style={({ pressed }) => [styles.zoneButton, pressed && styles.zoneButtonPressed]}
          >
            <Text style={styles.zoneButtonText}>{zoneText.keep}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={zoneBusy}
            onPress={() => void answerZone(true)}
            style={({ pressed }) => [
              styles.zoneButton,
              styles.zoneButtonPrimary,
              pressed && styles.zoneButtonPressed,
            ]}
          >
            <Text style={[styles.zoneButtonText, styles.zoneButtonTextPrimary]}>
              {zoneText.move}
            </Text>
          </Pressable>
        </View>
      </View>
    ) : null;
    return (
      <LegendList<MobileSchedule>
        ListHeaderComponent={zoneBanner}
        style={styles.list}
        contentContainerStyle={{ paddingBottom: bottomInset + 24 }}
        data={schedules}
        keyExtractor={(row) => `${row.kind}:${row.id}`}
        renderItem={({ item }: LegendListRenderItemProps<MobileSchedule>) => (
          <ScheduleRow
            schedule={item}
            nowMs={nowMs}
            busy={busyKey === `${item.kind}:${item.id}`}
            styles={rowStyles}
            colors={colors}
            onAction={(action) => onAction(item, action)}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        showsVerticalScrollIndicator={false}
        estimatedItemSize={60}
        recycleItems
      />
    );
  };

  return <View style={styles.root}>{renderBody()}</View>;
}

const EMPTY: MobileSchedule[] = [];

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    zone: {
      borderColor: colors.border,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      gap: 4,
      marginBottom: 8,
      padding: 12,
    },
    zoneTitle: {
      color: colors.text,
      fontFamily: fonts.sans.medium,
      fontSize: 14.5,
    },
    zoneBody: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 13,
    },
    zoneActions: {
      flexDirection: "row",
      gap: 8,
      justifyContent: "flex-end",
      marginTop: 8,
    },
    zoneButton: {
      borderColor: colors.border,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 14,
      paddingVertical: 7,
    },
    zoneButtonPrimary: {
      backgroundColor: colors.text,
      borderColor: colors.text,
    },
    zoneButtonPressed: {
      opacity: 0.7,
    },
    zoneButtonText: {
      color: colors.text,
      fontFamily: fonts.sans.medium,
      fontSize: 13,
    },
    zoneButtonTextPrimary: {
      color: colors.background,
    },
    root: {
      flex: 1,
      minHeight: 0,
    },
    list: {
      flex: 1,
      marginTop: 8,
    },
    centered: {
      alignItems: "center",
      flex: 1,
      justifyContent: "center",
    },
    separator: {
      height: 2,
    },
  });
