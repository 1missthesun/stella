import { useMemo } from "react";
import { isHiddenOverlay, resolveThemeColors } from "../../../../theme";
import { useTheme, useThemeControl } from "@/context/theme-context";
import { useT } from "@/shared/i18n";
import { Hairline, useRn } from "../rn";
import { ACCOUNT_TEXT, tapLight, WordPicker } from "./kit";

// packages/mobile's AppearanceSubView: System / Light / Dark as words, the themes as swatches four
// to a row, then the background's Soft / Flat and Relative / Strong.

type ColorMode = "system" | "light" | "dark";
type GradientMode = "soft" | "flat";
type GradientColor = "relative" | "strong";

const COLUMNS = 4;

export function AppearancePage() {
  const c = useRn();
  const t = useT();
  const theme = useTheme();
  const control = useThemeControl();
  const isDark = theme.resolvedColorMode === "dark";
  const surfaceColorDisabled = theme.flat || theme.gradientMode === "flat";

  const rows = useMemo(() => {
    const visible = theme.themes.filter((th) => !isHiddenOverlay(th));
    const out: (typeof visible)[] = [];
    for (let i = 0; i < visible.length; i += COLUMNS) out.push(visible.slice(i, i + COLUMNS));
    return out;
  }, [theme.themes]);

  const modes: { value: ColorMode; label: string }[] = [
    { value: "system", label: t("mobile.settings.appearance.system") },
    { value: "light", label: t("mobile.settings.appearance.light") },
    { value: "dark", label: t("mobile.settings.appearance.dark") },
  ];
  const gradients: { value: GradientMode; label: string }[] = [
    { value: "soft", label: t("mobile.settings.background.soft") },
    { value: "flat", label: t("mobile.settings.background.flat") },
  ];
  const gradientColors: { value: GradientColor; label: string }[] = [
    { value: "relative", label: t("mobile.settings.backgroundColor.relative") },
    { value: "strong", label: t("mobile.settings.backgroundColor.strong") },
  ];

  return (
    <col pt={2}>
      <WordPicker
        variant="words"
        label={t("mobile.settings.appearanceSection")}
        options={modes}
        value={theme.colorMode}
        onChange={(next) => {
          tapLight();
          control.setColorMode(next);
        }}
      />

      <Hairline space={20} />

      <col gap={14}>
        {rows.map((row, rowIndex) => (
          <row key={rowIndex} gap={6}>
            {row.map((th) => {
              const preview = resolveThemeColors(th, isDark).colors;
              const active = th.id === theme.selectedThemeId;
              return (
                <col
                  key={th.id}
                  id={`phone-appearance-theme-${th.id}`}
                  role="button"
                  label={t("mobile.settings.useThemeLabel", { name: th.name })}
                  selected={active}
                  focusable
                  grow={1}
                  minW={0}
                  align="center"
                  gap={6}
                  py={4}
                  pressScale={0.97}
                  onPress={() => {
                    tapLight();
                    control.setTheme(th.id);
                  }}
                >
                  <box w={42} h={42} radius={21} borderWidth={2} border={active ? c.text : "transparent"} center>
                    <box w={34} h={34} radius={17} fill={preview.background} border={preview.border} borderWidth={0.5} center>
                      <box w={15} h={15} radius={7.5} fill={preview.primary} />
                    </box>
                  </box>
                  <text {...ACCOUNT_TEXT.swatchName} color={active ? c.text : c.textMuted} textAlign="center" maxLines={1}>
                    {th.name}
                  </text>
                </col>
              );
            })}
            {Array.from({ length: COLUMNS - row.length }, (_, i) => (
              <box key={`pad-${i}`} grow={1} />
            ))}
          </row>
        ))}
      </col>

      <Hairline space={20} />

      <col gap={12}>
        <WordPicker
          variant="words"
          label={t("mobile.settings.useBackgroundLabel", { name: t(theme.gradientMode === "soft" ? "mobile.settings.background.soft" : "mobile.settings.background.flat") })}
          options={gradients}
          disabled={theme.flat}
          value={theme.flat ? "flat" : theme.gradientMode}
          onChange={(next) => {
            tapLight();
            control.setGradientMode(next);
          }}
        />
        <WordPicker
          variant="words"
          label={t("mobile.settings.useBackgroundColorLabel", { name: t(theme.gradientColor === "relative" ? "mobile.settings.backgroundColor.relative" : "mobile.settings.backgroundColor.strong") })}
          options={gradientColors}
          disabled={surfaceColorDisabled}
          value={theme.gradientColor}
          onChange={(next) => {
            tapLight();
            control.setGradientColor(next);
          }}
        />
      </col>
    </col>
  );
}
