import { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { resolveThemeColors } from "@stella/theme";
import { Text } from "../Text";
import { SegmentedControl } from "../SegmentedControl";
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
import { settingsSurfaceFills, type SettingsStyles } from "./settings-styles";

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

export function AppearanceSubView({ styles }: { styles: SettingsStyles }) {
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
  const local = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
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
      <View style={local.block}>
        <SegmentedControl<ThemePreference>
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
        />
      </View>

      <View style={styles.section}>
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
                      local.swatchTile,
                      isActive && local.swatchTileActive,
                      pressed && local.pressed,
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
                    <Text
                      numberOfLines={1}
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
      </View>

      <View style={[styles.section, local.surfaceSection]}>
        <View style={local.surfaceStack}>
          <SegmentedControl<GradientMode>
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
          />
          <SegmentedControl<GradientColor>
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
          />
        </View>
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors, isDark: boolean) => {
  const { subtleFill, tonalFill } = settingsSurfaceFills(isDark);
  const activeBorder = isDark
    ? "rgba(255, 255, 255, 0.34)"
    : "rgba(0, 0, 0, 0.28)";
  return StyleSheet.create({
    container: {
      paddingTop: 4,
    },
    block: {
      marginTop: 12,
    },
    paletteGrid: {
      gap: 8,
    },
    paletteRow: {
      flexDirection: "row",
      gap: 8,
    },
    swatchTile: {
      alignItems: "center",
      backgroundColor: subtleFill,
      borderColor: colors.borderWeak,
      borderRadius: 11,
      borderWidth: StyleSheet.hairlineWidth,
      flex: 1,
      gap: 6,
      minWidth: 0,
      paddingHorizontal: 4,
      paddingVertical: 10,
    },
    swatchTileActive: {
      backgroundColor: tonalFill,
      borderColor: activeBorder,
      borderWidth: 1,
      paddingVertical: 9.5,
    },
    swatchSpacer: {
      flex: 1,
    },
    swatchDisc: {
      alignItems: "center",
      borderRadius: 13,
      borderWidth: StyleSheet.hairlineWidth,
      height: 26,
      justifyContent: "center",
      overflow: "hidden",
      width: 26,
    },
    swatchCore: {
      borderRadius: 6,
      height: 12,
      width: 12,
    },
    swatchName: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 11,
      letterSpacing: -0.1,
      textAlign: "center",
    },
    swatchNameActive: {
      color: colors.textStrong,
      fontFamily: fonts.sans.semiBold,
    },
    surfaceSection: {
      marginTop: 22,
    },
    surfaceStack: {
      gap: 10,
    },
    pressed: {
      opacity: 0.68,
    },
  });
};
