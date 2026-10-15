import { useMemo } from "react";
import { AI_DATA_SHARING } from "@stella/contracts/legal-text";
import {
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { Text } from "./Text";
import {
  SafeAreaProvider,
  SafeAreaView,
  initialWindowMetrics,
} from "react-native-safe-area-context";
import { env } from "../config/env";
import { isSelfHostedLaunch } from "../lib/server-registry";
import { type Colors } from "../theme/colors";
import { useColors } from "../theme/theme-context";
import { fonts } from "../theme/fonts";
import { fadeHex } from "../theme/oklch";

type Props = {
  visible: boolean;
  onAccept: () => void;
  onDecline: () => void;
};

export function AiConsentModal({ visible, onAccept, onDecline }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onDecline}
    >
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <SafeAreaView style={styles.container} accessibilityViewIsModal>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
          >
            <Text style={styles.title} accessibilityRole="header">Before you start</Text>
            <Text style={styles.subtitle}>{AI_DATA_SHARING.intro}</Text>

            <View style={styles.section}>
              <Text style={styles.sectionTitle} accessibilityRole="header">What data is sent</Text>
              <Text style={styles.body}>{AI_DATA_SHARING.data}</Text>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle} accessibilityRole="header">Who receives it</Text>
              <Text style={styles.body}>
                {isSelfHostedLaunch
                  ? AI_DATA_SHARING.selfHostedRecipients
                  : AI_DATA_SHARING.hostedRecipients}
              </Text>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle} accessibilityRole="header">How it's handled</Text>
              <Text style={styles.body}>{AI_DATA_SHARING.handling}</Text>
            </View>

            <Text style={styles.privacyLink}>
              Read our full{" "}
              <Text
                style={styles.link}
                accessibilityRole="link"
                onPress={() => void Linking.openURL(`${env.siteUrl}/privacy`)}
              >
                Privacy Policy
              </Text>
            </Text>
          </ScrollView>

          <View style={styles.actions}>
            <Pressable
              onPress={onAccept}
              accessibilityRole="button"
              accessibilityLabel="I Understand & Agree"
              accessibilityHint="Agrees to sharing data with the AI services described above"
              testID="ai-consent-accept"
              style={({ pressed }) => [
                styles.acceptButton,
                pressed && styles.acceptButtonPressed,
              ]}
            >
              <Text style={styles.acceptText}>I Understand & Agree</Text>
            </Pressable>
            <Pressable
              onPress={onDecline}
              accessibilityRole="button"
              accessibilityLabel="Don't Agree"
              accessibilityHint="Closes this screen without agreeing"
              testID="ai-consent-decline"
              style={styles.declineButton}
            >
              <Text style={styles.declineText}>Don't Agree</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scroll: {
      flex: 1,
    },
    content: {
      padding: 28,
      paddingTop: 36,
      paddingBottom: 20,
    },
    title: {
      color: colors.text,
      fontFamily: fonts.display.semiBold,
      fontSize: 27,
      letterSpacing: -1.5,
      lineHeight: 36,
    },
    subtitle: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 16,
      lineHeight: 23,
      marginTop: 14,
    },
    section: {
      marginTop: 24,
    },
    sectionTitle: {
      color: colors.text,
      fontFamily: fonts.sans.semiBold,
      fontSize: 15,
      letterSpacing: -0.2,
      marginBottom: 6,
    },
    body: {
      color: fadeHex(colors.text, 0.82),
      fontFamily: fonts.sans.regular,
      fontSize: 15,
      lineHeight: 22,
    },
    bold: {
      fontFamily: fonts.sans.semiBold,
      color: colors.text,
    },
    privacyLink: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 14,
      marginTop: 28,
    },
    link: {
      color: colors.accent,
      textDecorationLine: "underline",
    },
    actions: {
      borderTopColor: colors.border,
      borderTopWidth: StyleSheet.hairlineWidth,
      gap: 10,
      paddingHorizontal: 28,
      paddingTop: 16,
      paddingBottom: 12,
    },
    acceptButton: {
      alignItems: "center",
      backgroundColor: colors.accent,
      borderRadius: 14,
      paddingVertical: 17,
    },
    acceptButtonPressed: {
      backgroundColor: colors.accentHover,
    },
    acceptText: {
      color: colors.accentForeground,
      fontFamily: fonts.sans.semiBold,
      fontSize: 17,
      letterSpacing: -0.3,
    },
    declineButton: {
      alignItems: "center",
      paddingVertical: 12,
    },
    declineText: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 15,
    },
  } as const);
