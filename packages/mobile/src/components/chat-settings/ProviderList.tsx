import { useEffect, useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { EngineAccountSection } from "../EngineAccountsSettings";
import { tapLight } from "../../lib/haptics";
import { CONTENT_MAX_FONT_SCALE } from "../../lib/setup-text-defaults";
import { REASONING_OPTIONS } from "../../lib/stella-model-catalog";
import {
  MODEL_ENGINE_OPTIONS,
  type ModelEngine,
  type ModelSettings,
} from "../../lib/use-cloud-model-settings";
import type { Colors } from "../../theme/colors";
import { fonts } from "../../theme/fonts";
import { useColors } from "../../theme/theme-context";

/**
 * The chat's brain, one large row per provider: Stella, Claude Code, ChatGPT.
 *
 * The chosen provider carries the sidebar's accent dot and opens in place to
 * its models, how hard it thinks, and the accounts that pay for it, so an
 * account sits under the provider it belongs to.
 *
 * Lists and the saved choice come from the server, so this never waits on a
 * paired computer; the computer mirrors the saved choice for its own turns.
 */
export function ProviderList({
  settings,
  active,
  label,
}: {
  settings: ModelSettings;
  active: boolean;
  label: string;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { refresh } = settings;

  useEffect(() => {
    if (active) void refresh();
  }, [active, refresh]);

  const ready = settings.execution !== null;
  const current = settings.engine;

  return (
    <View>
      <View style={styles.header}>
        <Text style={styles.sectionLabel}>{label}</Text>
        {settings.saving || !ready ? (
          <ActivityIndicator size="small" color={colors.textMuted} />
        ) : null}
      </View>

      {MODEL_ENGINE_OPTIONS.map((option) => {
        const engine = option.id;
        const selected = ready && engine === current;
        return (
          <View key={engine}>
            <Pressable
              onPress={() => {
                if (selected) return;
                tapLight();
                settings.selectEngine(engine);
              }}
              disabled={!ready}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ checked: selected, disabled: !ready }}
              style={({ pressed }) => [
                styles.engine,
                pressed && !selected && styles.pressed,
              ]}
            >
              <Text
                style={[styles.engineLabel, !selected && styles.engineIdle]}
                numberOfLines={1}
                maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
              >
                {option.label}
              </Text>
              {selected ? <View style={styles.current} /> : null}
            </Pressable>

            {selected ? (
              <EngineDetail
                engine={engine}
                settings={settings}
                styles={styles}
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function EngineDetail({
  engine,
  settings,
  styles,
}: {
  engine: ModelEngine;
  settings: ModelSettings;
  styles: ReturnType<typeof makeStyles>;
}) {
  const rows = settings.modelsFor(engine);
  const effort = settings.effort === "none" ? "default" : settings.effort;

  return (
    <View style={styles.detail}>
      {rows.length === 0 ? (
        <Text style={styles.empty}>No models available.</Text>
      ) : (
        <View accessibilityRole="radiogroup">
          {rows.map((model) => (
            <Pressable
              key={model.id}
              onPress={() => {
                if (model.selected) return;
                tapLight();
                settings.selectEngineModel(engine, model.id);
              }}
              disabled={!model.available}
              accessibilityRole="radio"
              accessibilityLabel={
                model.description
                  ? `${model.label}, ${model.description}`
                  : model.label
              }
              accessibilityState={{
                checked: model.selected,
                disabled: !model.available,
              }}
              style={({ pressed }) => [
                styles.model,
                !model.available && styles.unavailable,
                pressed && !model.selected && styles.pressed,
              ]}
            >
              <Text
                style={[
                  styles.modelLabel,
                  model.selected && styles.modelLabelChosen,
                ]}
                numberOfLines={1}
                maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
              >
                {model.label}
              </Text>
              {model.selected ? <View style={styles.currentSmall} /> : null}
            </Pressable>
          ))}
        </View>
      )}

      {settings.supportsEffortSelection ? (
        <View style={styles.thinking}>
          <Text style={styles.thinkingLabel}>Thinking</Text>
          <View style={styles.efforts} accessibilityRole="radiogroup">
            {REASONING_OPTIONS.map((option) => {
              const chosen = option.id === effort;
              return (
                <Pressable
                  key={option.id}
                  onPress={() => {
                    if (chosen) return;
                    tapLight();
                    settings.selectEffort(option.id);
                  }}
                  hitSlop={{ top: 8, bottom: 8 }}
                  accessibilityRole="radio"
                  accessibilityLabel={`Thinking ${option.label}`}
                  accessibilityState={{ checked: chosen }}
                  style={({ pressed }) => [
                    styles.effort,
                    pressed && !chosen && styles.pressed,
                  ]}
                >
                  <Text
                    style={[styles.effortLabel, chosen && styles.effortChosen]}
                    numberOfLines={1}
                    maxFontSizeMultiplier={1.3}
                  >
                    {option.label}
                  </Text>
                  <View
                    style={[styles.effortMark, chosen && styles.effortMarkOn]}
                  />
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {engine !== "stella" ? (
        <View style={styles.accounts}>
          <EngineAccountSection provider={engine} embedded="panel" />
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    header: {
      alignItems: "center",
      flexDirection: "row",
      gap: 10,
      marginBottom: 2,
      minHeight: 20,
    },
    sectionLabel: {
      color: colors.textMuted,
      fontFamily: fonts.sans.semiBold,
      fontSize: 15,
    },
    engine: {
      alignItems: "center",
      flexDirection: "row",
      gap: 10,
      minHeight: 50,
    },
    engineLabel: {
      color: colors.text,
      flexShrink: 1,
      fontFamily: fonts.sans.bold,
      fontSize: 26,
      letterSpacing: -0.9,
      lineHeight: 32,
    },
    engineIdle: {
      color: colors.textMuted,
    },
    current: {
      backgroundColor: colors.accent,
      borderRadius: 4,
      height: 8,
      marginTop: 3,
      width: 8,
    },
    currentSmall: {
      backgroundColor: colors.accent,
      borderRadius: 3,
      height: 6,
      marginTop: 2,
      width: 6,
    },
    pressed: {
      opacity: 0.55,
      transform: [{ scale: 0.98 }],
    },
    detail: {
      marginBottom: 10,
    },
    empty: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 15,
      paddingVertical: 8,
    },
    model: {
      alignItems: "center",
      flexDirection: "row",
      gap: 8,
      minHeight: 38,
    },
    modelLabel: {
      color: colors.textMuted,
      flexShrink: 1,
      fontFamily: fonts.sans.semiBold,
      fontSize: 18,
      letterSpacing: -0.4,
    },
    modelLabelChosen: {
      color: colors.text,
    },
    unavailable: {
      opacity: 0.4,
    },
    thinking: {
      marginTop: 14,
    },
    thinkingLabel: {
      color: colors.textMuted,
      fontFamily: fonts.sans.semiBold,
      fontSize: 15,
      marginBottom: 4,
    },
    efforts: {
      flexDirection: "row",
      justifyContent: "space-between",
    },
    effort: {
      alignItems: "center",
      gap: 4,
      minHeight: 40,
      justifyContent: "center",
    },
    effortLabel: {
      color: colors.textMuted,
      fontFamily: fonts.sans.semiBold,
      fontSize: 17,
      letterSpacing: -0.3,
    },
    effortChosen: {
      color: colors.text,
    },
    effortMark: {
      borderRadius: 3,
      height: 6,
      width: 6,
    },
    effortMarkOn: {
      backgroundColor: colors.accent,
    },
    accounts: {
      marginTop: 14,
    },
  });
