import {
  LegendList,
  type LegendListRenderItemProps,
} from "@legendapp/list/react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useT } from "../i18n";
import {
  scheduleCadence,
  scheduleRowBadge,
  useMobileSchedules,
  useScheduleAction,
  type MobileSchedule,
  type MobileScheduleAction,
} from "../lib/schedules";
import { tapLight } from "../lib/haptics";
import { timeOfDay, upcomingSection } from "../lib/list-sections";
import { CONTENT_MAX_FONT_SCALE } from "../lib/setup-text-defaults";
import { authClient } from "../lib/auth-client";
import { startChatWith } from "../lib/ask-stella";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "../theme/theme-context";
import { EmptyState } from "./EmptyState";
import { ScheduleRow, makeScheduleRowStyles } from "./schedule-rows";

export function SchedulePage() {
  const colors = useColors();
  const t = useT();
  const styles = useMemo(() => makeStyles(), []);
  const router = useRouter();
  const rowStyles = useMemo(() => makeScheduleRowStyles(colors), [colors]);
  const bottomInset = useSafeAreaInsets().bottom;
  const session = authClient.useSession();
  const signedIn = Boolean(session.data?.user);

  const loaded = useMobileSchedules(signedIn);
  const schedules = loaded ?? EMPTY;
  const loading = signedIn && loaded === undefined;
  const runAction = useScheduleAction();
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

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    setNowMs(Date.now());
  }, [schedules]);

  const items = useMemo<ListItem[]>(() => {
    const active = schedules
      .filter((schedule) => schedule.enabled)
      .sort((a, b) => a.nextRunAtMs - b.nextRunAtMs);
    const paused = schedules.filter((schedule) => !schedule.enabled);
    const out: ListItem[] = [];
    let previous: string | null = null;
    for (const schedule of active) {
      const section = upcomingSection(schedule.nextRunAtMs, nowMs, t);
      if (section.key !== previous) {
        out.push({
          kind: "section",
          key: `section:${section.key}`,
          label: section.label,
        });
        previous = section.key;
      }
      out.push({
        kind: "schedule",
        key: `${schedule.kind}:${schedule.id}`,
        schedule,
        trailing: timeOfDay(schedule.nextRunAtMs),
      });
    }
    if (paused.length > 0) {
      out.push({
        kind: "section",
        key: "section:paused",
        label: t("mobile.activityHub.schedule.paused"),
      });
      for (const schedule of paused) {
        out.push({
          kind: "schedule",
          key: `${schedule.kind}:${schedule.id}`,
          schedule,
          trailing: null,
        });
      }
    }
    return out;
  }, [nowMs, schedules, t]);

  const editSchedule = useCallback(
    (schedule: MobileSchedule) =>
      startChatWith(
        router,
        t("mobile.activityHub.schedule.editPrompt", { title: schedule.title }),
      ),
    [router, t],
  );

  const openActions = useCallback(
    (schedule: MobileSchedule) => {
      tapLight();
      const cadence =
        scheduleCadence(schedule) ||
        t("mobile.activityHub.schedule.customCadence");
      const badge = scheduleRowBadge(schedule, nowMs);
      const message = [
        [
          cadence,
          badge.kind === "paused"
            ? t("mobile.activityHub.schedule.paused")
            : t("mobile.activityHub.schedule.next", { when: badge.label }),
        ].join(" · "),
        schedule.enabled && schedule.lastError
          ? t("mobile.activityHub.schedule.lastRunFailed", {
              error: schedule.lastError,
            })
          : null,
      ]
        .filter(Boolean)
        .join("\n");
      if (schedule.kind !== "cron") {
        Alert.alert(schedule.title, message);
        return;
      }
      const toggle: MobileScheduleAction = schedule.enabled ? "pause" : "resume";
      const toggleLabel = schedule.enabled
        ? t("mobile.activityHub.schedule.pauseSchedule")
        : t("mobile.activityHub.schedule.resumeSchedule");
      const editLabel = t("schedule.edit.title");
      const deleteLabel = t("mobile.activityHub.schedule.deleteSchedule");
      if (Platform.OS === "ios") {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            title: schedule.title,
            message,
            options: [toggleLabel, editLabel, deleteLabel, t("mobile.common.cancel")],
            destructiveButtonIndex: 2,
            cancelButtonIndex: 3,
          },
          (index) => {
            if (index === 0) onAction(schedule, toggle);
            if (index === 1) editSchedule(schedule);
            if (index === 2) onAction(schedule, "remove");
          },
        );
        return;
      }
      Alert.alert(
        schedule.title,
        message,
        [
          { text: toggleLabel, onPress: () => onAction(schedule, toggle) },
          { text: editLabel, onPress: () => editSchedule(schedule) },
          {
            text: deleteLabel,
            style: "destructive",
            onPress: () => onAction(schedule, "remove"),
          },
        ],
        { cancelable: true },
      );
    },
    [editSchedule, nowMs, onAction, t],
  );

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
    return (
      <LegendList<ListItem>
        style={styles.list}
        contentContainerStyle={{ paddingBottom: bottomInset + 24 }}
        data={items}
        keyExtractor={(item) => item.key}
        getItemType={(item) => item.kind}
        renderItem={({ item }: LegendListRenderItemProps<ListItem>) =>
          item.kind === "section" ? (
            <Text
              style={rowStyles.section}
              numberOfLines={1}
              maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
              accessibilityRole="header"
            >
              {item.label}
            </Text>
          ) : (
            <ScheduleRow
              schedule={item.schedule}
              trailing={item.trailing}
              busy={busyKey === item.key}
              styles={rowStyles}
              colors={colors}
              onPress={() => openActions(item.schedule)}
            />
          )
        }
        extraData={busyKey}
        showsVerticalScrollIndicator={false}
        estimatedItemSize={48}
        recycleItems
      />
    );
  };

  return <View style={styles.root}>{renderBody()}</View>;
}

const EMPTY: MobileSchedule[] = [];

type ListItem =
  | { kind: "section"; key: string; label: string }
  | {
      kind: "schedule";
      key: string;
      schedule: MobileSchedule;
      trailing: string | null;
    };

const makeStyles = () =>
  StyleSheet.create({
    root: {
      flex: 1,
      minHeight: 0,
    },
    list: {
      flex: 1,
    },
    centered: {
      alignItems: "center",
      flex: 1,
      justifyContent: "center",
    },
  });
