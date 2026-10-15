import { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "./Text";
import { useRouter } from "expo-router";
import {
  dismissComposerNotice,
  useComposerNotice,
  type ComposerNoticeKind,
} from "../lib/composer-notice";
import { useT } from "../i18n";
import { useServerFeatures } from "../lib/server-features";
import { isSelfHostedLaunch } from "../lib/server-registry";
import { useColors } from "../theme/theme-context";
import type { Colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { Icon, type IconName } from "./Icon";

const KIND_ICON: Record<ComposerNoticeKind, IconName> = {
  "sign-in": "user",
  upgrade: "arrow-up-circle",
  limit: "alert-circle",
  provider: "alert-circle",
  server: "refresh-cw",
};

export function ComposerNotice({
  conversationId,
}: {
  conversationId: string | null | undefined;
}) {
  const colors = useColors();
  const t = useT();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const notice = useComposerNotice(conversationId);
  const features = useServerFeatures();

  if (!notice) return null;

  const dismiss = () => dismissComposerNotice(notice.id);
  const title =
    notice.kind === "server" ? t("mobile.selfHost.behindTitle") : notice.title;
  const description =
    notice.kind === "server" ? t("mobile.selfHost.behindBody") : notice.description;
  const primary =
    notice.kind === "sign-in"
      ? {
          label: "Sign in",
          onPress: () => {
            dismiss();
            router.replace(
              isSelfHostedLaunch
                ? { pathname: "/connect-server", params: { reason: "signed-out" } }
                : "/login",
            );
          },
        }
      : notice.kind === "upgrade" && features.billing
        ? {
            label: "Upgrade",
            onPress: () => {
              dismiss();
              router.push("/settings");
            },
          }
        : notice.action
          ? {
              label: notice.action.label,
              onPress: () => {
                dismiss();
                notice.action!.onPress();
              },
            }
          : null;

  const inline = notice.kind === "limit";
  const button = (action: { label: string; onPress: () => void }, compact: boolean) => (
    <Pressable
      accessibilityRole="button"
      onPress={action.onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        compact && styles.primaryButtonCompact,
        pressed && styles.primaryButtonPressed,
      ]}
    >
      <Text style={styles.primaryText}>{action.label}</Text>
    </Pressable>
  );

  return (
    <View
      style={[styles.card, inline && styles.cardInline]}
      accessibilityRole="summary"
      testID="composer-notice"
    >
      <View style={styles.icon}>
        <Icon name={KIND_ICON[notice.kind]} size={17} color={colors.text} />
      </View>
      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        {inline ? (
          // Usage-limit card: reset text on the left, the button on the same row.
          <View style={styles.inlineRow}>
            <Text style={[styles.description, styles.inlineDescription]}>{description ?? ""}</Text>
            {primary ? button(primary, true) : null}
          </View>
        ) : description ? (
          <Text style={styles.description}>{description}</Text>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("common.close")}
        hitSlop={8}
        onPress={dismiss}
        style={styles.dismiss}
      >
        <Icon name="x" size={14} color={colors.textMuted} />
      </Pressable>
      {primary && !inline ? <View style={styles.actions}>{button(primary, false)}</View> : null}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    card: {
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
    cardInline: { paddingVertical: 8 },
    inlineRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 10,
      marginTop: 2,
    },
    inlineDescription: { flex: 1, marginTop: 0 },
    icon: {
      alignItems: "center",
      backgroundColor: colors.muted,
      borderRadius: 10,
      height: 32,
      justifyContent: "center",
      width: 32,
    },
    body: { flex: 1, minWidth: 180 },
    title: {
      color: colors.text,
      fontFamily: fonts.sans.semiBold,
      fontSize: 14,
      lineHeight: 19,
    },
    description: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 12,
      lineHeight: 17,
      marginTop: 2,
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
    primaryButton: {
      alignItems: "center",
      backgroundColor: colors.accent,
      borderRadius: 999,
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    primaryButtonCompact: { paddingHorizontal: 14, paddingVertical: 5 },
    primaryButtonPressed: {
      backgroundColor: colors.accentHover,
    },
    primaryText: {
      color: colors.accentForeground,
      fontFamily: fonts.sans.semiBold,
      fontSize: 13,
    },
  });
