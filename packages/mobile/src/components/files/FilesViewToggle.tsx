import { useEffect, useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useT } from "../../i18n";
import {
  setFilesViewMode,
  useFilesViewMode,
  type FilesViewMode,
} from "../../lib/files-view-mode";
import { tapLight } from "../../lib/haptics";
import type { Colors } from "../../theme/colors";
import { fadeHex } from "../../theme/oklch";
import { useColors, useTheme } from "../../theme/theme-context";
import { Icon } from "../Icon";

const SEGMENT = 40;
const HEIGHT = 40;
const SPRING = { duration: 260, dampingRatio: 0.9 };

const MODES: readonly FilesViewMode[] = ["grid", "list"];
const LABEL_KEYS: Record<FilesViewMode, string> = {
  grid: "mobile.activityHub.files.viewGrid",
  list: "mobile.activityHub.files.viewList",
};

export function FilesViewToggle() {
  const colors = useColors();
  const { isDark } = useTheme();
  const t = useT();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const mode = useFilesViewMode();
  const at = useSharedValue(MODES.indexOf(mode));
  useEffect(() => {
    at.value = withSpring(MODES.indexOf(mode), SPRING);
  }, [at, mode]);
  const thumb = useAnimatedStyle(() => ({
    transform: [{ translateX: at.value * SEGMENT }],
  }));
  return (
    <View style={styles.track} accessibilityRole="radiogroup">
      <Animated.View style={[styles.thumb, thumb]} pointerEvents="none" />
      {MODES.map((entry) => {
        const selected = entry === mode;
        return (
          <Pressable
            key={entry}
            accessibilityRole="radio"
            accessibilityLabel={t(LABEL_KEYS[entry])}
            accessibilityState={{ selected }}
            hitSlop={{ top: 4, bottom: 4 }}
            onPress={() => {
              if (selected) return;
              tapLight();
              setFilesViewMode(entry);
            }}
            style={styles.segment}
            testID={`mobile-files-view-${entry}`}
          >
            <Icon
              name={entry}
              size={17}
              color={selected ? colors.text : colors.textMuted}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (colors: Colors, isDark: boolean) =>
  StyleSheet.create({
    track: {
      flexDirection: "row",
      height: HEIGHT,
      marginRight: 2,
      width: SEGMENT * 2,
    },
    thumb: {
      backgroundColor: fadeHex(colors.text, isDark ? 0.12 : 0.07),
      borderCurve: "continuous",
      borderRadius: 999,
      height: HEIGHT - 4,
      left: 1,
      position: "absolute",
      top: 2,
      width: SEGMENT - 2,
    },
    segment: {
      alignItems: "center",
      height: HEIGHT,
      justifyContent: "center",
      width: SEGMENT,
    },
  });
