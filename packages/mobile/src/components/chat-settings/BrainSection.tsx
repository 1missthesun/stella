import { useEffect } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { tapLight } from "../../lib/haptics";
import { REASONING_OPTIONS } from "../../lib/stella-model-catalog";
import type { Brain, ModelSettings } from "../../lib/use-cloud-model-settings";
import type { Colors } from "../../theme/colors";
import { fonts } from "../../theme/fonts";
import { useColors } from "../../theme/theme-context";
import { NativeMenu } from "../NativeMenu";
import type { NativeMenuItem } from "../NativeMenu.types";
import { EngineAccountSection } from "../EngineAccountsSettings";
import { ProviderMark } from "./ProviderMark";
import {
  ChoiceRow,
  Dot,
  KIT,
  Note,
  SectionLabel,
  SwitcherFace,
  TextAction,
} from "./kit";

/** Models shown under the switcher before "All models" takes over. */
const SHORT_LIST = 5;

/**
 * Whether a brain can run now without setting anything up: Stella always;
 * Claude Code and ChatGPT once an account is signed in for the cloud; an
 * account provider once its key or sign-in works. The one in use counts too.
 * The Providers page sorts by this.
 */
export const brainReady = (brain: Brain, settings: ModelSettings) => {
  if (brain.id === settings.brainId) return true;
  if (brain.kind === "provider")
    return brain.provider.connection?.status === "ok";
  if (brain.engine === "stella") return true;
  return settings.connectedProviders?.includes(brain.engine) ?? false;
};

/**
 * Which brain runs the chat, shown as the one in use with its models under
 * it. The switcher's system menu always holds the same four entries: Stella,
 * Claude Code, ChatGPT, and Other, which opens the page of every provider, so
 * the page stays this size however many providers there are.
 */
export function BrainSection({
  settings,
  active,
  width,
  onOpenProviders,
  onOpenBrain,
}: {
  settings: ModelSettings;
  active: boolean;
  width: number;
  onOpenProviders: () => void;
  onOpenBrain: (brainId: string) => void;
}) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { refresh } = settings;

  useEffect(() => {
    if (active) void refresh();
  }, [active, refresh]);

  const ready = settings.execution !== null;
  const current =
    settings.brains.find((brain) => brain.id === settings.brainId) ??
    settings.brains[0];
  const models = settings.modelsFor(settings.brainId);
  const chosen = models.find((model) => model.selected);
  const shown = models.slice(0, SHORT_LIST);
  if (chosen && !shown.includes(chosen)) shown[shown.length - 1] = chosen;
  const loadingModels =
    current?.kind === "provider" &&
    settings.providerModelState(current.provider.id)?.status === "loading";
  const effort = settings.effort === "none" ? "default" : settings.effort;
  const moreLabel =
    models.length > SHORT_LIST
      ? `All ${models.length} models`
      : current?.kind === "provider"
        ? "Manage"
        : null;
  const accountsFor =
    current?.kind === "engine" && current.engine !== "stella"
      ? current.engine
      : null;

  const switchTo = (brain: Brain) => {
    if (brain.id === settings.brainId) return;
    tapLight();
    if (brain.kind === "engine") {
      settings.selectEngine(brain.engine);
      return;
    }
    void settings.loadProviderModels(brain.provider.id).then((list) => {
      const first = list?.[0];
      if (first) settings.selectProviderModel(brain.provider.id, first.id);
      else onOpenBrain(brain.id);
    });
  };

  const items: NativeMenuItem[] = [
    ...settings.brains
      .filter((brain) => brain.kind === "engine")
      .map((brain): NativeMenuItem => ({
        id: brain.id,
        title: brain.label,
        selected: brain.id === settings.brainId,
        onPress: () => switchTo(brain),
      })),
    {
      id: "other",
      title: "Other",
      selected: current?.kind === "provider",
      onPress: onOpenProviders,
    },
  ];

  return (
    <View>
      <SectionLabel
        trailing={
          settings.saving || !ready ? (
            <ActivityIndicator size="small" color={colors.textMuted} />
          ) : null
        }
      >
        Model
      </SectionLabel>

      <NativeMenu
        plain
        label={
          <SwitcherFace
            glyph={
              <ProviderMark provider={current?.mark ?? "stella"} size={26} />
            }
            title={current?.label ?? "Stella"}
          />
        }
        accessibilityLabel={`Model provider: ${current?.label ?? "Stella"}`}
        items={items}
        width={width}
        height={KIT.switcherHeight}
        disabled={!ready}
        onFallbackPress={onOpenProviders}
      />

      <View style={styles.models} accessibilityRole="radiogroup">
        {loadingModels ? (
          <ActivityIndicator
            style={styles.spinner}
            size="small"
            color={colors.textMuted}
          />
        ) : models.length === 0 ? (
          <Note>No models available.</Note>
        ) : (
          shown.map((model) => (
            <ChoiceRow
              key={model.id}
              label={model.label}
              selected={model.selected}
              disabled={!model.available}
              accessibilityLabel={
                model.description
                  ? `${model.label}, ${model.description}`
                  : model.label
              }
              onPress={() => {
                if (model.selected) return;
                tapLight();
                settings.selectModel(model.id);
              }}
            />
          ))
        )}
        {current && moreLabel ? (
          <TextAction
            label={moreLabel}
            onPress={() => onOpenBrain(current.id)}
          />
        ) : null}
      </View>

      {accountsFor ? (
        <View style={styles.accounts}>
          <EngineAccountSection provider={accountsFor} embedded="panel" />
        </View>
      ) : null}

      {settings.supportsEffortSelection ? (
        <View style={styles.thinking}>
          <SectionLabel>Thinking</SectionLabel>
          <View style={styles.efforts} accessibilityRole="radiogroup">
            {REASONING_OPTIONS.map((option) => {
              const picked = option.id === effort;
              return (
                <Pressable
                  key={option.id}
                  onPress={() => {
                    if (picked) return;
                    tapLight();
                    settings.selectEffort(option.id);
                  }}
                  hitSlop={{ top: 8, bottom: 8 }}
                  accessibilityRole="radio"
                  accessibilityLabel={`Thinking ${option.label}`}
                  accessibilityState={{ checked: picked }}
                  style={({ pressed }) => [
                    styles.effort,
                    pressed && !picked && styles.pressed,
                  ]}
                >
                  <Text
                    style={[styles.effortLabel, picked && styles.effortPicked]}
                    numberOfLines={1}
                    maxFontSizeMultiplier={1.3}
                  >
                    {option.label}
                  </Text>
                  <View style={styles.effortMark}>
                    {picked ? <Dot size={6} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    models: {
      marginLeft: 42,
      marginTop: 2,
    },
    spinner: {
      alignSelf: "flex-start",
      marginVertical: 12,
    },
    accounts: {
      marginLeft: 42,
    },
    thinking: {
      marginTop: 18,
    },
    efforts: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingRight: 6,
    },
    effort: {
      alignItems: "center",
      gap: 4,
      justifyContent: "center",
      minHeight: 40,
      minWidth: 34,
    },
    effortLabel: {
      color: colors.textMuted,
      fontFamily: fonts.sans.semiBold,
      fontSize: 16,
      letterSpacing: -0.3,
    },
    effortPicked: {
      color: colors.text,
    },
    effortMark: {
      height: 6,
      width: 6,
    },
    pressed: {
      opacity: 0.55,
    },
  });
