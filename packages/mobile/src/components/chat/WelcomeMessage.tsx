import { memo, useCallback, useMemo, type ComponentType } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import { isEngineConnectionUsable } from "@stella/contracts/backend/engines";
import { WELCOME_ITEMS, WELCOME_TEXT, type WelcomeItemId } from "@stella/contracts/welcome-message";
import { env } from "../../config/env";
import { useBackendView } from "../../lib/backend";
import { openChatSettingsAt } from "../../lib/connect-plan";
import { CONTENT_MAX_FONT_SCALE } from "../../lib/font-scale";
import { tapLight } from "../../lib/haptics";
import type { Colors } from "../../theme/colors";
import { AssistantMarkdown } from "../AssistantMarkdown";
import { Text } from "../Text";
import { makeChatCardButtonStyles } from "./ScheduleCardShell";

type WelcomeAction = { id: string; label: string; onPress: () => void };

const NO_ARGS = {} as const;

const openSite = () => {
  void Linking.openURL(env.siteUrl).catch(() => undefined);
};

function usePlansActions(): WelcomeAction[] {
  const { value } = useBackendView("engines.get", NO_ARGS);
  return useMemo(() => {
    if (!value || value.connections.some(isEngineConnectionUsable)) return [];
    return [
      { id: "chatgpt", label: "Connect ChatGPT", onPress: () => openChatSettingsAt("chatgpt") },
      { id: "claude", label: "Connect Claude", onPress: () => openChatSettingsAt("anthropic") },
    ];
  }, [value]);
}

function useAnywhereActions(): WelcomeAction[] {
  const { value } = useBackendView("devices.list", NO_ARGS);
  return useMemo(
    () =>
      value && value.devices.length === 0
        ? [{ id: "computer", label: "Get Stella for your computer", onPress: openSite }]
        : [],
    [value],
  );
}

function ActionRow({ actions, colors }: { actions: readonly WelcomeAction[]; colors: Colors }) {
  const buttons = useMemo(() => makeChatCardButtonStyles(colors), [colors]);
  if (actions.length === 0) return null;
  return (
    <View style={styles.row}>
      {actions.map((action) => (
        <Pressable
          key={action.id}
          accessibilityRole="button"
          testID={`welcome-action-${action.id}`}
          onPress={() => {
            tapLight();
            action.onPress();
          }}
          style={({ pressed }) => [buttons.primary, styles.pill, pressed && buttons.dimmed]}
        >
          <Text style={[buttons.label, buttons.primaryLabel]} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
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

export const WelcomeMessage = memo(function WelcomeMessage({
  colors,
  fill,
  onStellaFileLink,
}: {
  colors: Colors;
  fill: boolean;
  onStellaFileLink?: (path: string) => void;
}) {
  const footer = useCallback(
    (index: number) => {
      const id = WELCOME_ITEMS[index]?.id;
      const Actions = id ? ITEM_ACTIONS[id] : undefined;
      return Actions ? <Actions colors={colors} /> : null;
    },
    [colors],
  );
  return (
    <AssistantMarkdown
      text={WELCOME_TEXT}
      colors={colors}
      fill={fill}
      onStellaFileLink={onStellaFileLink}
      listItemFooter={footer}
    />
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 6, marginTop: 8 },
  pill: { marginVertical: 0, paddingVertical: 6 },
});
