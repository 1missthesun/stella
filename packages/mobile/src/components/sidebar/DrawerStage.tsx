import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import {
  BackHandler,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type ScrollViewProps,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedStyle,
  useAnimatedRef,
  measure,
  runOnUI,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import {
  closeDrawer,
  drawerBlur,
  drawerProgress,
  drawerSign,
  drawerVeil,
  diag,
  drawerDiagState,
  openDrawer,
  useDrawerLive,
  useDrawerMetrics,
  useDrawerClosePan,
  useDrawerOpen,
  useDrawerOpenPan,
  useDrawerSide,
  useDrawerTravel,
  type DrawerSide,
} from "../../lib/drawer";
import { tapLight } from "../../lib/haptics";
import { BlurView } from "expo-blur";
import { useColors, useTheme } from "../../theme/theme-context";
import { GlassIconButton } from "../GlassIconButton";
import { Icon, type IconName } from "../Icon";

const CLAMP = Extrapolation.CLAMP;
const AnimatedBlur = Animated.createAnimatedComponent(BlurView);
const BLUR = Platform.OS === "ios";
const PAGE_BLUR = 30;
const PANEL_BLUR = 34;
const STRIP_VEIL = 0.9;

export const DRAWER_CHEVRON_SIZE = 44;

type ChevronSpec = {
  left: number;
  top: number;
  openCenterY: number;
  openLabel: string;
  closeLabel: string;
};

type EndSpec = {
  panel: ReactNode;
  enabled: boolean;
  chevron: ChevronSpec & { restIcon: IconName };
};

export function DrawerStage({
  children,
  panel,
  enabled,
  chevron,
  end,
}: {
  children: ReactNode;
  panel: ReactNode;
  enabled: boolean;
  chevron: ChevronSpec;
  end?: EndSpec;
}) {
  const colors = useColors();
  const { isDark } = useTheme();
  const live = useDrawerLive();
  const open = useDrawerOpen();
  const side = useDrawerSide();
  const p = drawerProgress;
  const floor = colors.background;
  const endEnabled = Boolean(end?.enabled);
  const { travel, endTravel, scale, radius } = useDrawerMetrics();
  const reduce = useReducedMotion();

  const rest = useSharedValue(0);
  useAnimatedReaction(
    () => p.value,
    (v) => {
      if (rest.value === 0 && v >= 0.985) {
        rest.value = 1;
        runOnJS(tapLight)();
      } else if (rest.value === 1 && v <= 0.003) {
        rest.value = 0;
        runOnJS(tapLight)();
      }
    },
  );

  const stageRef = useAnimatedRef<Animated.View>();
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      const st = drawerDiagState();
      runOnUI(() => {
        "worklet";
        const m = measure(stageRef);
        runOnJS(diag)(
          "tick",
          "progress",
          drawerProgress.value,
          "sign",
          drawerSign.value,
          "stageX",
          m ? Math.round(m.pageX) : null,
          "expectX",
          Math.round(drawerSign.value * drawerProgress.value * (drawerSign.value > 0 ? travel : endTravel) + (m ? (m.width * (1 - (1 - (1 - scale) * Math.min(drawerProgress.value, 1.2)))) / 2 : 0)),
          "open",
          st.open,
          "live",
          st.live,
          "side",
          st.side,
        );
      })();
    }, 250);
    return () => clearInterval(timer);
  }, [live, travel, endTravel, scale, stageRef]);

  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      closeDrawer();
      return true;
    });
    return () => sub.remove();
  }, [open]);

  const stage = useAnimatedStyle(() => {
    const v = p.value;
    const s = reduce ? 1 : 1 - (1 - scale) * Math.min(v, 1.2);
    return {
      transform: [
        {
          translateX:
            drawerSign.value * v * (drawerSign.value > 0 ? travel : endTravel),
        },
        { scale: s },
      ],
      borderRadius: interpolate(v, [0, 0.12], [0, radius], CLAMP),
    };
  });
  const clip = useAnimatedStyle(() => ({
    borderRadius: interpolate(p.value, [0, 0.12], [0, radius], CLAMP),
  }));
  const fade = useAnimatedStyle(() => ({
    opacity: drawerVeil(p.value) * STRIP_VEIL,
  }));
  const edge = useAnimatedStyle(() => ({
    borderRadius: interpolate(p.value, [0, 0.12], [0, radius], CLAMP),
    opacity: interpolate(p.value, [0.3, 0.9], [0, 1], CLAMP),
  }));
  const pageBlur = useAnimatedProps(() => ({
    intensity: reduce ? 0 : drawerBlur(p.value) * PAGE_BLUR,
  }));

  const openPan = useDrawerOpenPan({ start: enabled, end: endEnabled, open });
  const closePan = useDrawerClosePan(side);
  const catcher = useMemo(
    () =>
      Gesture.Exclusive(
        closePan,
        Gesture.Tap().onEnd(() => {
          runOnJS(closeDrawer)();
        }),
      ),
    [closePan],
  );

  return (
    <View style={[styles.root, { backgroundColor: floor }]}>
      <DrawerPanel side="start" open={open && side === "start"} live={live}>
        {panel}
      </DrawerPanel>
      {end ? (
        <DrawerPanel side="end" open={open && side === "end"} live={live}>
          {end.panel}
        </DrawerPanel>
      ) : null}

      <GestureDetector gesture={openPan}>
        <Animated.View
          ref={stageRef}
          style={[styles.stage, { backgroundColor: floor }, stage]}
          accessibilityElementsHidden={open}
          importantForAccessibility={open ? "no-hide-descendants" : "auto"}
        >
          <Animated.View style={[styles.clip, clip]}>
            {children}
            {live ? (
              <>
                {BLUR ? (
                  <AnimatedBlur
                    pointerEvents="none"
                    tint={isDark ? "dark" : "light"}
                    animatedProps={pageBlur}
                    style={StyleSheet.absoluteFill}
                  />
                ) : null}
                <Animated.View
                  pointerEvents="none"
                  style={[
                    StyleSheet.absoluteFill,
                    { backgroundColor: floor },
                    fade,
                  ]}
                />
              </>
            ) : null}
          </Animated.View>
          {live ? (
            <Animated.View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                styles.edge,
                { borderColor: colors.border },
                edge,
              ]}
            />
          ) : null}
          {open ? (
            <GestureDetector gesture={catcher}>
              <View
                style={StyleSheet.absoluteFill}
                accessible={false}
                importantForAccessibility="no"
                testID="mobile-nav-close"
              />
            </GestureDetector>
          ) : null}
        </Animated.View>
      </GestureDetector>

      {live && side === "start" && enabled ? (
        <FloatingChevron {...chevron} side="start" open={open} />
      ) : null}
      {live && side === "end" && end && endEnabled ? (
        <FloatingChevron {...end.chevron} side="end" open={open} />
      ) : null}
    </View>
  );
}

function DrawerPanel({
  side,
  open,
  live,
  children,
}: {
  side: DrawerSide;
  open: boolean;
  live: boolean;
  children: ReactNode;
}) {
  const { isDark } = useTheme();
  const travel = useDrawerTravel(side);
  const reduce = useReducedMotion();
  const sign = side === "start" ? 1 : -1;
  const p = drawerProgress;
  const ours = useDrawerSide() === side;

  const panelStyle = useAnimatedStyle(() => {
    if (drawerSign.value !== sign) return { opacity: 0 };
    const v = Math.min(p.value, 1);
    return {
      opacity: interpolate(v, [0, 0.4], [0, 1], CLAMP),
      transform: reduce
        ? []
        : [
            {
              translateX: interpolate(
                v,
                [0, 1],
                [-sign * travel * 0.18, 0],
                CLAMP,
              ),
            },
            { scale: interpolate(v, [0, 1], [0.95, 1], CLAMP) },
          ],
    };
  });
  const panelFocus = useAnimatedProps(() => ({
    intensity: reduce
      ? 0
      : interpolate(p.value, [0, 0.9], [PANEL_BLUR, 0], CLAMP),
  }));
  const panelFocusStyle = useAnimatedStyle(() => ({
    opacity: p.value > 0.97 ? 0 : 1,
  }));
  const scroll = useMemo(() => Gesture.Native(), []);
  const panelPan = useDrawerClosePan(side, scroll);

  return (
    <PanelScroll.Provider value={scroll}>
      <GestureDetector gesture={panelPan}>
        <Animated.View
          style={[
            styles.panel,
            side === "start" ? styles.panelStart : styles.panelEnd,
            { width: travel },
            panelStyle,
          ]}
          pointerEvents={open ? "auto" : "none"}
          accessibilityElementsHidden={!open}
          importantForAccessibility={open ? "auto" : "no-hide-descendants"}
          onAccessibilityEscape={closeDrawer}
        >
          {children}
          {live && ours && BLUR ? (
            <AnimatedBlur
              pointerEvents="none"
              tint={isDark ? "dark" : "light"}
              animatedProps={panelFocus}
              style={[StyleSheet.absoluteFill, panelFocusStyle]}
            />
          ) : null}
        </Animated.View>
      </GestureDetector>
    </PanelScroll.Provider>
  );
}

const PanelScroll = createContext<ReturnType<typeof Gesture.Native> | null>(
  null,
);

/**
 * A sidebar's scroll view. It scrolls alongside the sidebar's swipe-to-close
 * instead of swallowing it, so a sideways swipe anywhere on the panel closes.
 */
export const DrawerScrollView = forwardRef<ScrollView, ScrollViewProps>(
  function DrawerScrollView(props, ref) {
    const scroll = useContext(PanelScroll);
    const view = <ScrollView ref={ref} {...props} />;
    return scroll ? (
      <GestureDetector gesture={scroll}>{view}</GestureDetector>
    ) : (
      view
    );
  },
);

function FloatingChevron({
  left,
  top,
  openCenterY,
  open,
  openLabel,
  closeLabel,
  side,
  restIcon,
}: ChevronSpec & {
  open: boolean;
  side: DrawerSide;
  restIcon?: IconName;
}) {
  const colors = useColors();
  const { width, height } = useWindowDimensions();
  const { scale } = useDrawerMetrics();
  const travel = useDrawerTravel(side);
  const reduce = useReducedMotion();
  const sign = side === "start" ? 1 : -1;
  const cx = left + DRAWER_CHEVRON_SIZE / 2;
  const cy = top + DRAWER_CHEVRON_SIZE / 2;
  const openScale = reduce ? 1 : scale;
  const settle = openCenterY - cy - (cy - height / 2) * (openScale - 1);
  const follow = useAnimatedStyle(() => {
    const v = drawerProgress.value;
    const s = reduce ? 1 : 1 - (1 - scale) * Math.min(v, 1.2);
    const toRow = Math.min(Math.max(v, 0), 1) * settle;
    return {
      transform: [
        { translateX: (cx - width / 2) * (s - 1) + sign * v * travel },
        { translateY: (cy - height / 2) * (s - 1) + toRow },
      ],
    };
  });
  const turn = useAnimatedStyle(() => {
    const v = drawerProgress.value;
    if (!restIcon) {
      return {
        transform: [
          { rotate: `${interpolate(v, [0, 1], [0, 180], CLAMP)}deg` },
        ],
      };
    }
    return {
      opacity: interpolate(v, [0.05, 0.4], [0, 1], CLAMP),
      transform: [{ rotate: `${interpolate(v, [0, 1], [-90, 0], CLAMP)}deg` }],
    };
  });
  const restTurn = useAnimatedStyle(() => {
    const v = drawerProgress.value;
    return {
      opacity: interpolate(v, [0, 0.3], [1, 0], CLAMP),
      transform: [{ rotate: `${interpolate(v, [0, 1], [0, 90], CLAMP)}deg` }],
    };
  });
  const press = open ? closeDrawer : () => openDrawer(side);
  const label = open ? closeLabel : openLabel;
  const pressRef = useRef(press);
  pressRef.current = press;
  const pressed = useSharedValue(0);
  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * 0.08 }],
  }));
  const tap = useMemo(
    () =>
      Gesture.Tap()
        .runOnJS(true)
        .maxDistance(32)
        .hitSlop(8)
        .onBegin(() => {
          pressed.value = withTiming(1, { duration: 90 });
        })
        .onEnd((_e, success) => {
          if (success) pressRef.current();
        })
        .onFinalize(() => {
          pressed.value = withTiming(0, { duration: 180 });
        }),
    [pressed],
  );
  return (
    <GestureDetector gesture={tap}>
      <Animated.View
        style={[styles.chevron, { left, top }, follow]}
        pointerEvents="box-only"
        accessible
        accessibilityRole="button"
        accessibilityLabel={label}
        onAccessibilityTap={press}
        accessibilityActions={[{ name: "activate" }]}
        onAccessibilityAction={press}
      >
        <Animated.View style={pressStyle}>
          <GlassIconButton
            icon="chevron-right"
            size={DRAWER_CHEVRON_SIZE}
            iconSize={20}
            iconStyle={turn}
            accessibilityLabel={label}
            accessibilityHidden
            onPress={press}
          />
          {restIcon ? (
            <Animated.View
              pointerEvents="none"
              style={[styles.restIcon, restTurn]}
            >
              <Icon
                name={restIcon}
                size={19}
                color={colors.text}
                weight="semibold"
              />
            </Animated.View>
          ) : null}
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  panel: {
    bottom: 0,
    position: "absolute",
    top: 0,
  },
  panelStart: { left: 0 },
  panelEnd: { right: 0 },
  stage: { flex: 1 },
  clip: { flex: 1, overflow: "hidden" },
  chevron: { position: "absolute" },
  edge: {
    borderWidth: 1,
  },
  restIcon: {
    alignItems: "center",
    height: DRAWER_CHEVRON_SIZE,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    top: 0,
    width: DRAWER_CHEVRON_SIZE,
  },
});
