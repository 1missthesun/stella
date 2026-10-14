import { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, { type AnimatedStyle } from "react-native-reanimated";
import { GlassSurface } from "./glass";
import { Icon, type IconName } from "./Icon";
import type { Colors } from "../theme/colors";
import { useColors } from "../theme/theme-context";
import { fadeHex } from "../theme/oklch";

const DEFAULT_SIZE = 40;

export type GlassIconButtonProps = {
  icon: IconName;
  onPress: () => void;
  accessibilityLabel: string;
  size?: number;
  iconSize?: number;
  muted?: boolean;
  dot?: string | null;
  loading?: boolean;
  disabled?: boolean;
  hitSlop?: number;
  style?: StyleProp<ViewStyle>;
  iconStyle?: StyleProp<AnimatedStyle<StyleProp<ViewStyle>>>;
  accessibilityHidden?: boolean;
  containPress?: boolean;
};

export function GlassIconButtonBase({
  icon,
  onPress,
  accessibilityLabel,
  size = DEFAULT_SIZE,
  iconSize = 20,
  muted = false,
  dot = null,
  loading = false,
  disabled = false,
  hitSlop = 6,
  style,
  iconStyle,
  accessibilityHidden = false,
  containPress = false,
}: GlassIconButtonProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const radius = size / 2;

  return (
    <Pressable
      accessible={!accessibilityHidden}
      accessibilityElementsHidden={accessibilityHidden}
      importantForAccessibility={
        accessibilityHidden ? "no-hide-descendants" : "auto"
      }
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={hitSlop}
      onPress={onPress}
      style={({ pressed }) => [
        { height: size, width: size },
        style,
        pressed && !containPress && styles.pressed,
      ]}
    >
      {({ pressed }) => (
        <GlassSurface
          glass="clear"
          interactive={!containPress}
          radius={radius}
          fallbackColor={colors.surface}
          style={[styles.glass, { borderRadius: radius }]}
        >
          <View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, styles.ring, { borderRadius: radius }]}
          />
          {containPress && pressed ? (
            <View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, styles.pressFill, { borderRadius: radius }]}
            />
          ) : null}
          <View style={styles.content}>
            {loading ? (
              <ActivityIndicator size="small" color={colors.textMuted} />
            ) : (
              <Animated.View style={iconStyle}>
                <Icon
                  name={icon}
                  size={iconSize}
                  color={muted ? colors.textMuted : colors.text}
                  weight={muted ? "regular" : "semibold"}
                />
              </Animated.View>
            )}
            {dot ? (
              <View style={[styles.dot, { backgroundColor: dot }]} />
            ) : null}
          </View>
        </GlassSurface>
      )}
    </Pressable>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    pressed: { opacity: 0.88 },
    pressFill: { backgroundColor: fadeHex(colors.text, 0.12) },
    glass: {
      alignItems: "center",
      flex: 1,
      justifyContent: "center",
      overflow: "hidden",
    },
    ring: {
      borderColor: fadeHex(colors.border, 0.6),
      borderWidth: StyleSheet.hairlineWidth,
    },
    content: {
      alignItems: "center",
      height: 28,
      justifyContent: "center",
      width: 28,
    },
    dot: {
      borderColor: colors.surface,
      borderRadius: 4,
      borderWidth: 1.5,
      bottom: 1,
      height: 8,
      position: "absolute",
      right: 1,
      width: 8,
    },
  });
