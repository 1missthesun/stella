import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import { setAppColorScheme } from "../carplay/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  defaultTheme,
  deriveTokens,
  getThemeById,
  getThemesSnapshot,
  isHiddenOverlay,
  LEGACY_THEME_IDS,
  resolveThemeColors,
  subscribeThemes,
  type GradientColor,
  type GradientMode,
  type Theme,
  type ThemeColors,
  type ThemeTokens,
} from "@stella/theme";
import { type Colors, lightColors, darkColors, makeColors } from "./colors";

export type ThemePreference = "light" | "dark" | "system";
export type { GradientColor, GradientMode, Theme };

type ThemeContextValue = {
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
  theme: Theme;
  selectedThemeId: string;
  setThemeId: (id: string) => void;
  themes: readonly Theme[];
  isDark: boolean;
  flat: boolean;
  palette: ThemeColors;
  tokens: ThemeTokens;
  colors: Colors;
  gradientPreference: GradientMode;
  setGradientPreference: (mode: GradientMode) => void;
  gradientMode: GradientMode;
  gradientColor: GradientColor;
  setGradientColor: (color: GradientColor) => void;
};

const MODE_KEY = "stella-color-mode";
const THEME_KEY = "stella-theme-id";
const CUSTOM_BASE_KEY = "stella-custom-base";
const GRADIENT_KEY = "stella-gradient-mode";
const GRADIENT_COLOR_KEY = "stella-gradient-color";

const visibleThemes = () =>
  getThemesSnapshot().filter((t) => !isHiddenOverlay(t));

const fallbackContext = (() => {
  const theme = getThemeById("default")!;
  const { colors, flat } = resolveThemeColors(theme, false);
  return {
    theme,
    palette: colors,
    tokens: deriveTokens(colors, false, { flat }),
  };
})();

const ThemeContext = createContext<ThemeContextValue>({
  preference: "dark",
  setPreference: () => {},
  theme: fallbackContext.theme,
  selectedThemeId: "default",
  setThemeId: () => {},
  themes: visibleThemes(),
  isDark: false,
  flat: true,
  palette: fallbackContext.palette,
  tokens: fallbackContext.tokens,
  colors: lightColors,
  gradientPreference: "soft",
  setGradientPreference: () => {},
  gradientMode: "flat",
  gradientColor: "relative",
  setGradientColor: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>("dark");
  const [themeId, setThemeIdState] = useState(defaultTheme.id);
  const [customBase, setCustomBaseState] = useState<string | null>(null);
  const [gradientPreference, setGradientPreferenceState] =
    useState<GradientMode>("soft");
  const [gradientColor, setGradientColorState] =
    useState<GradientColor>("relative");
  const [loaded, setLoaded] = useState(false);
  const [catalogVersion, setCatalogVersion] = useState(0);

  useEffect(() => subscribeThemes(() => setCatalogVersion((v) => v + 1)), []);

  useEffect(() => {
    void Promise.all([
      AsyncStorage.getItem(MODE_KEY),
      AsyncStorage.getItem(THEME_KEY),
      AsyncStorage.getItem(CUSTOM_BASE_KEY),
      AsyncStorage.getItem(GRADIENT_KEY),
      AsyncStorage.getItem(GRADIENT_COLOR_KEY),
    ]).then(
      ([storedMode, storedTheme, storedBase, storedGradient, storedColor]) => {
        let mode: ThemePreference | null =
          storedMode === "light" ||
          storedMode === "dark" ||
          storedMode === "system"
            ? storedMode
            : null;

        const legacy =
          (storedTheme && LEGACY_THEME_IDS[storedTheme]) ||
          (storedBase && LEGACY_THEME_IDS[storedBase]) ||
          null;
        if (legacy) {
          mode = legacy.mode;
          void AsyncStorage.setItem(MODE_KEY, legacy.mode);
          void AsyncStorage.setItem(THEME_KEY, defaultTheme.id);
          void AsyncStorage.setItem(CUSTOM_BASE_KEY, legacy.id);
        }

        if (mode) setPreferenceState(mode);

        const nextTheme = legacy ? defaultTheme.id : storedTheme;
        if (nextTheme && getThemeById(nextTheme)) setThemeIdState(nextTheme);

        const nextBase = legacy ? legacy.id : storedBase;
        if (nextBase && getThemeById(nextBase)) setCustomBaseState(nextBase);

        if (storedGradient === "soft" || storedGradient === "flat") {
          setGradientPreferenceState(storedGradient);
        }
        if (storedColor === "relative" || storedColor === "strong") {
          setGradientColorState(storedColor);
        }
        setLoaded(true);
      },
    );
  }, []);

  const setPreference = (p: ThemePreference) => {
    setPreferenceState(p);
    void AsyncStorage.setItem(MODE_KEY, p);
  };

  const setGradientPreference = (mode: GradientMode) => {
    setGradientPreferenceState(mode);
    void AsyncStorage.setItem(GRADIENT_KEY, mode);
  };

  const setGradientColor = (color: GradientColor) => {
    setGradientColorState(color);
    void AsyncStorage.setItem(GRADIENT_COLOR_KEY, color);
  };

  const customTheme = getThemeById("custom");
  const customPopulated = customTheme?.populated === true;

  const customBaseId =
    customBase && getThemeById(customBase)
      ? customBase
      : themeId !== "custom" && getThemeById(themeId)
        ? themeId
        : (customTheme?.base ?? "default");

  const effectiveActiveId = customPopulated ? themeId : "custom";
  const selectedThemeId = customPopulated ? themeId : customBaseId;

  const setThemeId = (id: string) => {
    if (!getThemeById(id)) return;
    if (customPopulated) {
      setThemeIdState(id);
      void AsyncStorage.setItem(THEME_KEY, id);
    } else {
      setCustomBaseState(id);
      void AsyncStorage.setItem(CUSTOM_BASE_KEY, id);
      if (themeId !== "custom") {
        setThemeIdState("custom");
        void AsyncStorage.setItem(THEME_KEY, "custom");
      }
    }
  };

  const prefersDark =
    preference === "system" ? systemScheme === "dark" : preference === "dark";

  const theme = getThemeById(effectiveActiveId) ?? defaultTheme;
  const resolved = resolveThemeColors(
    theme,
    prefersDark,
    theme.id === "custom" ? customBaseId : undefined,
  );
  const isDark = resolved.forcedMode
    ? resolved.forcedMode === "dark"
    : prefersDark;
  const flat = resolved.flat;

  const forcedMode = resolved.forcedMode;
  useEffect(() => {
    if (!loaded) return;
    setAppColorScheme(
      forcedMode
        ? forcedMode
        : preference === "system"
          ? "unspecified"
          : preference,
    );
  }, [loaded, preference, forcedMode]);

  const palette = resolved.colors;
  const tokens = useMemo(
    () => deriveTokens(palette, isDark, { flat }),
    [palette, isDark, flat],
  );
  const colors = useMemo(
    () =>
      loaded
        ? makeColors(palette, tokens, isDark)
        : isDark
          ? darkColors
          : lightColors,
    [loaded, palette, tokens, isDark],
  );
  const gradientMode: GradientMode = flat ? "flat" : gradientPreference;

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      setPreference,
      theme,
      selectedThemeId,
      setThemeId,
      themes: visibleThemes(),
      isDark,
      flat,
      palette,
      tokens,
      colors,
      gradientPreference,
      setGradientPreference,
      gradientMode,
      gradientColor,
      setGradientColor,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      preference,
      theme,
      themeId,
      selectedThemeId,
      customPopulated,
      isDark,
      flat,
      palette,
      tokens,
      colors,
      gradientPreference,
      gradientMode,
      gradientColor,
      catalogVersion,
    ],
  );

  if (!loaded) return null;

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

export function useColors() {
  return useContext(ThemeContext).colors;
}
