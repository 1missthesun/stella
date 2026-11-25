import { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { resolveThemeColors } from "@stella/theme";
import { Text } from "../Text";
import { Dot, Hairline } from "../chat-settings/kit";
import { CONTENT_MAX_FONT_SCALE } from "../../lib/font-scale";
import { tapLight } from "../../lib/haptics";
import { useT } from "../../i18n";
import type { Colors } from "../../theme/colors";
import { fonts } from "../../theme/fonts";
import {
  useColors,
  useTheme,
  type GradientColor,
  type GradientMode,
  type ThemePreference,
} from "../../theme/theme-context";
import type { SettingsStyles } from "./settings-styles";

const APPEARANCE_OPTIONS: { value: ThemePreference; labelKey: string }[] = [
  { value: "system", labelKey: "mobile.settings.appearance.system" },
  { value: "light", labelKey: "mobile.settings.appearance.light" },
  { value: "dark", labelKey: "mobile.settings.appearance.dark" },
];

const GRADIENT_OPTIONS: { value: GradientMode; labelKey: string }[] = [
  { value: "soft", labelKey: "mobile.settings.background.soft" },
  { value: "flat", labelKey: "mobile.settings.background.flat" },
];

const GRADIENT_COLOR_OPTIONS: { value: GradientColor; labelKey: string }[] = [
  { value: "relative", labelKey: "mobile.settings.backgroundColor.relative" },
  { value: "strong", labelKey: "mobile.settings.backgroundColor.strong" },
];

const COLUMNS = 4;

export function AppearanceSubView({ styles: _styles }: { styles: SettingsStyles }) {
  const colors = useColors();
  const t = useT();
  const {
    preference,
    setPreference,
    selectedThemeId,
    setThemeId,
    themes,
    isDark,
    flat,
    gradientPreference,
    setGradientPreference,
    gradientColor,
    setGradientColor,
  } = useTheme();
  const local = useMemo(() => makeStyles(colors), [colors]);
  const gradientLocked = flat;
  const surfaceColorDisabled = gradientLocked || gradientPreference === "flat";

  const themeRows = useMemo(() => {
    const rows: (typeof themes)[number][][] = [];
    for (let i = 0; i < themes.length; i += COLUMNS) {
      rows.push(themes.slice(i, i + COLUMNS));
    }
    return rows;
  }, [themes]);

  return (
    <View style={local.container}>
      <InlineWordPicker<ThemePreference>
        accessibilityLabel={t("mobile.settings.appearanceSection")}
        value={preference}
        onChange={(next) => {
          tapLight();
          setPreference(next);
        }}
        options={APPEARANCE_OPTIONS.map((opt) => ({
          value: opt.value,
          label: t(opt.labelKey),
        }))}
        local={local}
      />

      <Hairline space={20} />

      <View style={local.paletteGrid}>
        {themeRows.map((row, rowIndex) => (
          <View key={rowIndex} style={local.paletteRow}>
            {row.map((th) => {
              const preview = resolveThemeColors(th, isDark).colors;
              const isActive = th.id === selectedThemeId;
              return (
                <Pressable
                  key={th.id}
                  testID={`appearance-theme-${th.id}`}
                  onPress={() => {
                    tapLight();
                    setThemeId(th.id);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t("mobile.settings.useThemeLabel", {
                    name: th.name,
                  })}
                  accessibilityState={{ selected: isActive }}
                  style={({ pressed }) => [
                    local.swatchItem,
                    pressed && local.pressed,
                  ]}
                >
                  <View
                    style={[
                      local.swatchRing,
                      isActive && { borderColor: colors.text },
                    ]}
                  >
                    <View
                      style={[
                        local.swatchDisc,
                        {
                          backgroundColor: preview.background,
                          borderColor: preview.border,
                        },
                      ]}
                    >
                      <View
                        style={[
                          local.swatchCore,
                          { backgroundColor: preview.primary },
                        ]}
                      />
                    </View>
                  </View>
                  <Text
                    numberOfLines={1}
                    maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
                    style={[
                      local.swatchName,
                      isActive && local.swatchNameActive,
                    ]}
                  >
                    {th.name}
                  </Text>
                </Pressable>
              );
            })}
            {row.length < COLUMNS
              ? Array.from({ length: COLUMNS - row.length }).map((_, idx) => (
                  <View key={`pad-${idx}`} style={local.swatchSpacer} />
                ))
              : null}
          </View>
        ))}
      </View>

      <Hairline space={20} />

      <View style={local.surfaceStack}>
        <InlineWordPicker<GradientMode>
          accessibilityLabel={t("mobile.settings.useBackgroundLabel", {
            name: t(
              gradientPreference === "soft"
                ? "mobile.settings.background.soft"
                : "mobile.settings.background.flat",
            ),
          })}
          disabled={gradientLocked}
          value={gradientLocked ? "flat" : gradientPreference}
          onChange={(next) => {
            tapLight();
            setGradientPreference(next);
          }}
          options={GRADIENT_OPTIONS.map((opt) => ({
            value: opt.value,
            label: t(opt.labelKey),
          }))}
          local={local}
        />

        <InlineWordPicker<GradientColor>
          accessibilityLabel={t("mobile.settings.useBackgroundColorLabel", {
            name: t(
              gradientColor === "relative"
                ? "mobile.settings.backgroundColor.relative"
                : "mobile.settings.backgroundColor.strong",
            ),
          })}
          disabled={surfaceColorDisabled}
          value={gradientColor}
          onChange={(next) => {
            tapLight();
            setGradientColor(next);
          }}
          options={GRADIENT_COLOR_OPTIONS.map((opt) => ({
            value: opt.value,
            label: t(opt.labelKey),
          }))}
          local={local}
        />
      </View>
    </View>
  );
}

function InlineWordPicker<T extends string>({
  accessibilityLabel,
  disabled = false,
  options,
  value,
  onChange,
  local,
}: {
  accessibilityLabel: string;
  disabled?: boolean;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
  local: ReturnType<typeof makeStyles>;
}) {
  return (
    <View
      style={[local.wordRow, disabled && local.disabled]}
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
    >
      {options.map((option) => {
        const picked = option.value === value;
        return (
          <Pressable
            key={option.value}
            disabled={disabled}
            onPress={() => {
              if (!picked) onChange(option.value);
            }}
            hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: picked, disabled }}
            style={({ pressed }) => [
              local.wordChoice,
              pressed && !picked && local.pressed,
            ]}
          >
            <Text
              style={[local.wordLabel, picked && local.wordLabelPicked]}
              numberOfLines={1}
              maxFontSizeMultiplier={1.3}
            >
              {option.label}
            </Text>
            <View style={local.wordMark}>
              {picked ? <Dot size={6} /> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    container: {
      paddingTop: 2,
    },
    wordRow: {
      flexDirection: "row",
      gap: 24,
      alignItems: "center",
    },
    wordChoice: {
      alignItems: "center",
      gap: 5,
      justifyContent: "center",
      minHeight: 42,
      minWidth: 44,
    },
    wordLabel: {
      color: colors.textMuted,
      fontFamily: fonts.sans.semiBold,
      fontSize: 18,
      letterSpacing: -0.35,
    },
    wordLabelPicked: {
      color: colors.text,
    },
    wordMark: {
      height: 6,
      width: 6,
    },
    paletteGrid: {
      gap: 14,
    },
    paletteRow: {
      flexDirection: "row",
      gap: 6,
    },
    swatchItem: {
      alignItems: "center",
      flex: 1,
      gap: 6,
      minWidth: 0,
      paddingVertical: 4,
    },
    swatchSpacer: {
      flex: 1,
    },
    swatchRing: {
      alignItems: "center",
      borderColor: "transparent",
      borderRadius: 21,
      borderWidth: 2,
      height: 42,
      justifyContent: "center",
      width: 42,
    },
    swatchDisc: {
      alignItems: "center",
      borderRadius: 17,
      borderWidth: StyleSheet.hairlineWidth,
      height: 34,
      justifyContent: "center",
      overflow: "hidden",
      width: 34,
    },
    swatchCore: {
      borderRadius: 7.5,
      height: 15,
      width: 15,
    },
    swatchName: {
      color: colors.textMuted,
      fontFamily: fonts.sans.semiBold,
      fontSize: 12,
      letterSpacing: -0.1,
      textAlign: "center",
    },
    swatchNameActive: {
      color: colors.text,
    },
    surfaceStack: {
      gap: 12,
    },
    disabled: {
      opacity: 0.36,
    },
    pressed: {
      opacity: 0.55,
      transform: [{ scale: 0.97 }],
    },
  });
