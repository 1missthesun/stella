import { memo, useMemo, type ComponentType } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import { isEngineConnectionUsable } from "@stella/contracts/backend/engines";
import {
  WELCOME_CLOSING,
  WELCOME_GREETING,
  WELCOME_ITEMS,
  WELCOME_LEAD,
  type WelcomeItemId,
} from "@stella/contracts/welcome-message";
import { env } from "../../config/env";
import { useBackendView } from "../../lib/backend";
import { openChatSettingsAt } from "../../lib/connect-plan";
import { CONTENT_MAX_FONT_SCALE } from "../../lib/font-scale";
import { tapLight } from "../../lib/haptics";
import type { Colors } from "../../theme/colors";
import { fonts } from "../../theme/fonts";
import { fadeHex } from "../../theme/oklch";
import { Icon, type IconName } from "../Icon";
import { Text } from "../Text";

type WelcomeAction = { id: string; label: string; icon: IconName; onPress: () => void };

const NO_ARGS = {} as const;

const openSite = () => {
  void Linking.openURL(env.siteUrl).catch(() => undefined);
};

function usePlansActions(): WelcomeAction[] {
  const { value } = useBackendView("engines.get", NO_ARGS);
  return useMemo(() => {
    if (!value || value.connections.some(isEngineConnectionUsable)) return [];
    return [
      { id: "chatgpt", label: "Connect ChatGPT", icon: "plug", onPress: () => openChatSettingsAt("chatgpt") },
      { id: "claude", label: "Connect Claude", icon: "plug", onPress: () => openChatSettingsAt("anthropic") },
    ];
  }, [value]);
}

function useAnywhereActions(): WelcomeAction[] {
  const { value } = useBackendView("devices.list", NO_ARGS);
  return useMemo(
    () =>
      value && value.devices.length === 0
        ? [{ id: "computer", label: "Get Stella for your computer", icon: "laptop" as const, onPress: openSite }]
        : [],
    [value],
  );
}

// Stella's first message, drawn natively: points separated by space, each
// with neutral buttons under its text for what it describes. A button
// disappears once that thing is done.

function ActionRow({ actions, colors }: { actions: readonly WelcomeAction[]; colors: Colors }) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (actions.length === 0) return null;
  return (
    <View style={styles.actions}>
      {actions.map((action) => (
        <Pressable
          key={action.id}
          accessibilityRole="button"
          testID={`welcome-action-${action.id}`}
          hitSlop={4}
          onPress={() => {
            tapLight();
            action.onPress();
          }}
          style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
        >
          <Icon name={action.icon} size={14} color={colors.textMuted} />
          <Text style={styles.actionLabel} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
            {action.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function PlansActions({ colors }: { colors: Colors }) {
  return <ActionRow actions={usePlansActions()} colors={colors} />;
}

function AnywhereActions({ colors }: { colors: Colors }) {
  return <ActionRow actions={useAnywhereActions()} colors={colors} />;
}

const ITEM_ACTIONS: Partial<Record<WelcomeItemId, ComponentType<{ colors: Colors }>>> = {
  anywhere: AnywhereActions,
  plans: PlansActions,
};

export const WelcomeMessage = memo(function WelcomeMessage({ colors, fill }: { colors: Colors; fill: boolean }) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={[styles.root, fill && styles.fill]} testID="welcome-message">
      <Text style={[styles.text, styles.strong]} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
        {WELCOME_GREETING}
      </Text>
      <Text style={[styles.text, styles.lead]} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
        {WELCOME_LEAD}
      </Text>
      <View style={styles.points}>
        {WELCOME_ITEMS.map((item) => {
          const Actions = ITEM_ACTIONS[item.id];
          return (
            <View key={item.id} style={styles.point}>
              <Text style={styles.text} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
                <Text style={styles.strong}>{item.title}</Text> {item.body}
              </Text>
              {Actions ? <Actions colors={colors} /> : null}
            </View>
          );
        })}
      </View>
      <Text style={[styles.text, styles.closing]} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
        {WELCOME_CLOSING}
      </Text>
    </View>
  );
});

const makeStyles = (colors: Colors) => {
  const hairline = fadeHex(colors.assistantBubbleText, 0.11);
  return StyleSheet.create({
    root: { gap: 0 },
    fill: { alignSelf: "stretch" },
    text: { fontFamily: fonts.sans.regular, fontSize: 17, lineHeight: 24, color: colors.text },
    strong: { fontFamily: fonts.sans.semiBold, color: colors.textStrong },
    lead: { marginTop: 4 },
    points: { marginTop: 16, gap: 16 },
    point: { gap: 8 },
    closing: { marginTop: 16 },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    action: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      minHeight: 34,
      paddingHorizontal: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: hairline,
      backgroundColor: colors.card,
    },
    actionPressed: { backgroundColor: fadeHex(colors.muted, 0.8) },
    actionLabel: { fontFamily: fonts.sans.medium, fontSize: 14, color: colors.textStrong },
  });
};
