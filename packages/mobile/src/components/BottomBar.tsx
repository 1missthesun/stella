import { useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useT } from "../i18n";
import {
  BOTTOM_BAR_ROW_HEIGHT,
  BOTTOM_BAR_TABS,
  bottomBarPadding,
  type BottomBarTab,
} from "../lib/bottom-bar";
import type { Colors } from "../theme/colors";
import { fadeHex } from "../theme/oklch";
import { useColors, useTheme } from "../theme/theme-context";
import { AppBackdrop } from "./AppBackdrop";
import { BottomBarIcon } from "./BottomBarIcon";

const LABEL_KEYS: Record<BottomBarTab, string> = {
  chat: "mobile.nav.chat",
  schedule: "mobile.activityHub.tabs.schedule",
  apps: "mobile.nav.apps",
  files: "mobile.activityHub.tabs.files",
};

const ICON_SIZE = 21;
const TOP_EDGE_FADE = 10;
const KEYBOARD_SINK = 24;
const KEYBOARD_GONE_AT = 0.35;

export function BottomBar({
  active,
  onSelect,
}: {
  active: BottomBarTab | null;
  onSelect: (tab: BottomBarTab) => void;
}) {
  const colors = useColors();
  const { isDark } = useTheme();
  const t = useT();
  const { bottom } = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const { progress: keyboard } = useReanimatedKeyboardAnimation();
  const [selected, setSelected] = useState(active);
  if (active && active !== selected) setSelected(active);

  const presence = useAnimatedStyle(() => ({
    opacity: interpolate(
      keyboard.value,
      [0, KEYBOARD_GONE_AT],
      [1, 0],
      Extrapolation.CLAMP,
    ),
    transform: [
      {
        translateY: interpolate(
          keyboard.value,
          [0, 1],
          [0, KEYBOARD_SINK],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  const padding = bottomBarPadding(bottom);

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.dock, { paddingBottom: padding }, presence]}
    >
      <Backdrop height={BOTTOM_BAR_ROW_HEIGHT + padding} />
      <View style={styles.row} accessibilityRole="tablist">
        {BOTTOM_BAR_TABS.map((tab) => {
          const on = tab === selected;
          return (
            <Pressable
              key={tab}
              accessibilityRole="tab"
              accessibilityLabel={t(LABEL_KEYS[tab])}
              accessibilityState={{ selected: on }}
              onPress={() => onSelect(tab)}
              style={styles.item}
              testID={`mobile-bottom-bar-${tab}`}
            >
              {({ pressed }) => (
                <View style={[styles.pill, pressed && styles.pressed]}>
                  {on ? <View style={styles.pillFill} /> : null}
                  <BottomBarIcon
                    tab={tab}
                    selected={on}
                    size={ICON_SIZE}
                    color={
                      on
                        ? colors.text
                        : fadeHex(colors.textMuted, isDark ? 0.9 : 0.85)
                    }
                  />
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
    </Animated.View>
  );
}

function Backdrop({ height }: { height: number }) {
  const { height: screenHeight } = useWindowDimensions();
  return (
    <View
      pointerEvents="none"
      collapsable={false}
      style={StyleSheet.absoluteFill}
    >
      <MaskedView
        style={StyleSheet.absoluteFill}
        maskElement={
          <LinearGradient
            colors={["rgba(0,0,0,0)", "#000", "#000"]}
            locations={[0, TOP_EDGE_FADE / height, 1]}
            style={StyleSheet.absoluteFill}
          />
        }
      >
        <View style={[backdropStyles.fill, { height: screenHeight }]}>
          <AppBackdrop />
        </View>
      </MaskedView>
    </View>
  );
}

const backdropStyles = StyleSheet.create({
  fill: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
  },
});

const makeStyles = (colors: Colors, isDark: boolean) =>
  StyleSheet.create({
    dock: {
      bottom: 0,
      left: 0,
      position: "absolute",
      right: 0,
    },
    row: {
      alignSelf: "center",
      flexDirection: "row",
      height: BOTTOM_BAR_ROW_HEIGHT,
      maxWidth: 480,
      paddingHorizontal: 34,
      width: "100%",
    },
    item: {
      alignItems: "center",
      flex: 1,
      justifyContent: "center",
    },
    pill: {
      alignItems: "center",
      height: 38,
      justifyContent: "center",
      width: 62,
    },
    pillFill: {
      ...StyleSheet.absoluteFill,
      backgroundColor: fadeHex(colors.text, isDark ? 0.12 : 0.07),
      borderCurve: "continuous",
      borderRadius: 999,
    },
    pressed: { opacity: 0.55 },
  });
