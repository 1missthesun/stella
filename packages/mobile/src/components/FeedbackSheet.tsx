import { useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { Text } from "./Text";
import { SafeAreaView } from "react-native-safe-area-context";
import Constants from "expo-constants";
import { FEEDBACK_MAX_CHARS } from "@stella/contracts/backend/preferences";
import { getBackendClient } from "../lib/backend";
import { userFacingError } from "../lib/user-facing-error";
import { PrimaryButton } from "./PrimaryButton";
import { type Colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { useColors } from "../theme/theme-context";
import { useT } from "../i18n";

type Status =
  | { kind: "editing" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "failed"; message: string };

export function FeedbackSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const colors = useColors();
  const t = useT();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "editing" });

  useEffect(() => {
    if (!visible) return;
    setText("");
    setStatus({ kind: "editing" });
  }, [visible]);

  const sending = status.kind === "sending";
  const trimmed = text.trim();

  const submit = async () => {
    if (!trimmed || sending) return;
    setStatus({ kind: "sending" });
    try {
      await getBackendClient().call("feedback.submit", {
        message: trimmed,
        platform: `${Platform.OS} ${String(Platform.Version)}`,
        ...(Constants.expoConfig?.version
          ? { appVersion: Constants.expoConfig.version }
          : {}),
      });
      setStatus({ kind: "sent" });
    } catch (error) {
      setStatus({ kind: "failed", message: userFacingError(error) });
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.sheet} testID="feedback-sheet">
        <View style={styles.header}>
          <Text style={styles.title}>{t("shell.sidebar.feedback.title")}</Text>
          <Pressable
            onPress={onClose}
            style={styles.close}
            accessibilityRole="button"
            testID="feedback-close"
          >
            <Text style={styles.closeText}>
              {status.kind === "sent" ? t("mobile.common.done") : t("common.cancel")}
            </Text>
          </Pressable>
        </View>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          {status.kind === "sent" ? (
            <View style={styles.content} testID="feedback-sent">
              <Text style={styles.sentTitle}>
                {t("shell.sidebar.feedback.toasts.sentTitle")}
              </Text>
              <Text style={styles.description}>
                {t("shell.sidebar.feedback.toasts.sentDescription")}
              </Text>
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.description}>
                {t("shell.sidebar.feedback.description")}
              </Text>
              <TextInput
                testID="feedback-input"
                accessibilityLabel={t("shell.sidebar.feedback.fieldLabel")}
                placeholder={t("shell.sidebar.feedback.placeholder")}
                placeholderTextColor={colors.textMuted}
                value={text}
                onChangeText={setText}
                maxLength={FEEDBACK_MAX_CHARS}
                editable={!sending}
                multiline
                autoFocus
                textAlignVertical="top"
                style={styles.input}
              />
              <Text style={styles.count}>
                {text.length.toLocaleString()} / {FEEDBACK_MAX_CHARS.toLocaleString()}
              </Text>
              {status.kind === "failed" ? (
                <Text style={styles.error} accessibilityLiveRegion="polite">
                  {t("shell.sidebar.feedback.toasts.failedTitle")}: {status.message}
                </Text>
              ) : null}
              <PrimaryButton
                label={
                  sending
                    ? t("shell.sidebar.feedback.sending")
                    : t("shell.sidebar.feedback.send")
                }
                onPress={() => void submit()}
                disabled={sending || !trimmed}
                style={styles.send}
              />
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    sheet: {
      flex: 1,
      backgroundColor: colors.background,
      borderTopColor: colors.border,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    flex: { flex: 1 },
    header: {
      alignItems: "center",
      borderBottomColor: colors.border,
      borderBottomWidth: 1,
      flexDirection: "row",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      paddingVertical: 14,
    },
    title: {
      color: colors.text,
      fontFamily: fonts.sans.semiBold,
      fontSize: 18,
      letterSpacing: -0.4,
    },
    close: { paddingHorizontal: 8, paddingVertical: 4 },
    closeText: {
      color: colors.accent,
      fontFamily: fonts.sans.semiBold,
      fontSize: 16,
    },
    content: { padding: 20, paddingBottom: 40, gap: 12 },
    description: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 14,
      lineHeight: 20,
    },
    input: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      color: colors.text,
      fontFamily: fonts.sans.regular,
      fontSize: 15,
      lineHeight: 21,
      minHeight: 160,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    count: {
      alignSelf: "flex-end",
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 12,
    },
    error: {
      color: colors.danger,
      fontFamily: fonts.sans.regular,
      fontSize: 13,
      lineHeight: 18,
    },
    send: { alignSelf: "stretch", marginTop: 4 },
    sentTitle: {
      color: colors.text,
      fontFamily: fonts.sans.semiBold,
      fontSize: 17,
    },
  });
