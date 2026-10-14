import { useMemo } from "react";
import {
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Image } from "expo-image";
import { renderGradientImage } from "@stella/theme";
import { useColors, useTheme } from "../theme/theme-context";

export const TOP_BAR_BAR_HEIGHT = 42;

const MOBILE_RENDER_SCALE = 0.5;

const imageCache = new Map<string, string>();

export function AppBackdrop({ style }: { style?: StyleProp<ViewStyle> }) {
  const colors = useColors();
  const { theme, palette, isDark, flat, gradientMode, gradientColor } =
    useTheme();
  const { width, height } = useWindowDimensions();

  const uri = useMemo(() => {
    if (flat) return null;
    const w = Math.round(width);
    const h = Math.round(height);
    const key = `${theme.id}|${isDark ? "d" : "l"}|${gradientMode}|${gradientColor}|${palette.background}|${palette.primary}|${palette.interactive}|${w}x${h}`;
    const cached = imageCache.get(key);
    if (cached) return cached;
    const image = renderGradientImage(
      {
        colors: palette,
        isDark,
        mode: gradientMode,
        colorMode: gradientColor,
        flat,
        seedKey: theme.id,
      },
      w,
      h,
      MOBILE_RENDER_SCALE,
    );
    imageCache.set(key, image.uri);
    return image.uri;
  }, [
    flat,
    width,
    height,
    theme.id,
    isDark,
    gradientMode,
    gradientColor,
    palette,
  ]);

  if (!uri) {
    return (
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: colors.background },
          style,
        ]}
      />
    );
  }

  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: colors.background, overflow: "hidden" },
        style,
      ]}
    >
      {/* Sized to the window so every mount shows the same canvas. */}
      <Image
        source={{ uri }}
        style={{ position: "absolute", top: 0, left: 0, width, height }}
        contentFit="fill"
        cachePolicy="none"
        transition={0}
      />
    </View>
  );
}
