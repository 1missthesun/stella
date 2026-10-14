import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useT } from "../i18n";
import { useColors } from "../theme/theme-context";
import type { Colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { Icon } from "./Icon";

export type ChatIssue = {
  message: string;
  retryable: boolean;
  retry: () => void;
};

export function ChatIssueNotice({ issue }: { issue: ChatIssue | null }) {
  const colors = useColors();
  const t = useT();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const message = issue?.message ?? null;

  useEffect(() => {
    if (message === null) setDismissed(null);
  }, [message]);

  if (!issue || dismissed === issue.message) return null;

  return (
    <View
      style={styles.card}
      accessibilityRole="alert"
      testID="chat-issue-notice"
    >
      <View style={styles.icon}>
        <Icon name="alert-circle" size={17} color={colors.text} />
      </View>
      <Text style={styles.message}>{issue.message}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("common.close")}
        hitSlop={8}
        onPress={() => setDismissed(issue.message)}
        style={styles.dismiss}
        testID="chat-issue-dismiss"
      >
        <Icon name="x" size={14} color={colors.textMuted} />
      </Pressable>
      {issue.retryable ? (
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={issue.retry}
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed && styles.secondaryButtonPressed,
            ]}
            testID="chat-issue-retry"
          >
            <Text style={styles.secondaryText}>
              {t("mobile.common.tryAgain")}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    card: {
      alignItems: "center",
      alignSelf: "stretch",
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 15,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
      padding: 11,
      paddingRight: 36,
    },
    icon: {
      alignItems: "center",
      backgroundColor: colors.muted,
      borderRadius: 10,
      height: 32,
      justifyContent: "center",
      width: 32,
    },
    message: {
      color: colors.text,
      flex: 1,
      fontFamily: fonts.sans.medium,
      fontSize: 14,
      lineHeight: 19,
      minWidth: 180,
    },
    dismiss: {
      alignItems: "center",
      height: 24,
      justifyContent: "center",
      position: "absolute",
      right: 8,
      top: 8,
      width: 24,
    },
    actions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      width: "100%",
    },
    secondaryButton: {
      alignItems: "center",
      backgroundColor: colors.muted,
      borderRadius: 999,
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    secondaryButtonPressed: {
      opacity: 0.7,
    },
    secondaryText: {
      color: colors.text,
      fontFamily: fonts.sans.semiBold,
      fontSize: 13,
    },
  });
