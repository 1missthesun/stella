import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  BackHandler,
  Modal,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from "react-native";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
  type PanGesture,
} from "react-native-gesture-handler";
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import {
  TOP_SHEET_HEIGHT_FRACTION,
  topSheetMaxHeight,
} from "../lib/top-sheet-metrics";
import { useBottomObstruction } from "../lib/use-bottom-obstruction";
import { useColors } from "../theme/theme-context";
import { type Colors } from "../theme/colors";

import { GlassSurface } from "./glass";
import { OverlayPortal } from "./OverlayHost";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Extra hide distance so the drop shadow clears the top edge too. */
const SHADOW_CLEARANCE = 40;
const RADIUS = 26;
/** Starts the slide even if the modal never reports that it is showing. */
const SHOW_FALLBACK_MS = 250;
/** Room kept between an overlay sheet and the composer or keyboard under it. */
const EDGE_GAP = 8;
/** How much of the composer's transparent top padding the sheet may cover. */
const COMPOSER_TOP_SLACK = 12;
/** An upward drag on the handle this far, or this fast, closes the sheet. */
const DISMISS_DISTANCE = 56;
const DISMISS_VELOCITY = 600;
const DRAG_RETURN_SPRING = { duration: 300, dampingRatio: 1 };

const TopSheetDragContext = createContext<PanGesture | null>(null);

/**
 * Wraps the part of a sheet that drags it: pulling it up closes the sheet,
 * a short pull springs back. Outside a `TopSheet` it renders its children.
 */
export function TopSheetDragHandle({ children }: { children: ReactNode }) {
  const pan = useContext(TopSheetDragContext);
  if (!pan) return <>{children}</>;
  return <GestureDetector gesture={pan}>{children}</GestureDetector>;
}

type TopSheetProps = {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /**
   * Fraction of the screen height the sheet occupies — or caps at, when
   * `contentSized`. Defaults to 80%.
   */
  heightFraction?: number;
  /**
   * Hug the content's natural height (up to `heightFraction`) instead of
   * always filling the fixed fraction. Used by sheets whose content is often
   * sparse (e.g. the activity hub with one or two tasks).
   */
  contentSized?: boolean;
  glass?: boolean;
  /**
   * Controls that belong to the sheet but float just beneath its bottom edge,
   * in the open screen this top-anchored sheet leaves below itself.
   *
   * Anchored to the sheet rather than the screen: it rides the same slide
   * animation, keeps the same gap whatever the sheet's height, and never
   * strands itself halfway down the page or drifts onto whatever the page
   * behind is showing. Outside the scroll, so it never scrolls away.
   */
  floatingFooter?: React.ReactNode;
  /** Dim the screen behind the sheet. A tap outside still closes it either way. */
  dim?: boolean;
  /**
   * `"overlay"` draws the sheet in the app's overlay layer instead of a modal,
   * so the composer under it stays usable: the sheet then ends above the
   * composer (`bottomReserve` tall) and the keyboard, and shrinks with them
   * as they move.
   */
  presentation?: "modal" | "overlay";
  bottomReserve?: number;
};

const OPEN_TIMING = { duration: 300, easing: Easing.out(Easing.cubic) };
const CLOSE_TIMING = { duration: 220, easing: Easing.in(Easing.cubic) };

/**
 * A page-sheet that anchors to the top of the screen and slides down into view.
 * Covers ~80% of the height (or hugs content when `contentSized`), leaving the
 * rest as a tappable scrim, with rounded bottom corners and a soft hairline on
 * the leading (bottom) edge so the sheet reads against the page beneath it.
 * Used for the artifact viewer, the activity hub, and the device sheet.
 *
 * The slide runs on the UI thread and starts only once the sheet has mounted
 * and measured, so it is never spent on frames the sheet isn't on screen for.
 * Its shadow and corners are drawn from paths, so nothing in the sheet has to
 * be re-rendered offscreen on every frame of the slide.
 */
export function TopSheet({
  visible,
  onClose,
  children,
  heightFraction = TOP_SHEET_HEIGHT_FRACTION,
  contentSized = false,
  glass = false,
  floatingFooter,
  dim = true,
  presentation = "modal",
  bottomReserve = 0,
}: TopSheetProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { height } = useWindowDimensions();
  const maxSheetHeight = topSheetMaxHeight(height, heightFraction);
  const overlay = presentation === "overlay";
  const obstruction = useBottomObstruction(bottomReserve, COMPOSER_TOP_SLACK);
  const dragY = useSharedValue(0);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const requestClose = useCallback(() => closeRef.current(), []);
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY([-8, 8])
        .failOffsetX([-24, 24])
        .onUpdate((e) => {
          dragY.value =
            e.translationY < 0 ? e.translationY : e.translationY * 0.15;
        })
        .onEnd((e) => {
          if (
            e.translationY < -DISMISS_DISTANCE ||
            e.velocityY < -DISMISS_VELOCITY
          ) {
            runOnJS(requestClose)();
            return;
          }
          dragY.value = withSpring(0, DRAG_RETURN_SPRING);
        }),
    [dragY, requestClose],
  );

  const progress = useSharedValue(0);
  const hideDistance = useSharedValue(maxSheetHeight + SHADOW_CLEARANCE);
  const [rendered, setRendered] = useState(visible);
  const sheetHeight = useRef<number | null>(null);
  const awaitingOpen = useRef(visible);
  const shown = useRef(false);

  const startOpen = () => {
    awaitingOpen.current = false;
    progress.value = withTiming(1, OPEN_TIMING);
  };
  const maybeStartOpen = () => {
    if (awaitingOpen.current && shown.current && sheetHeight.current !== null) {
      hideDistance.value = sheetHeight.current + SHADOW_CLEARANCE;
      startOpen();
    }
  };

  useEffect(() => {
    if (!overlay || !visible) return;
    const handler = BackHandler.addEventListener("hardwareBackPress", () => {
      closeRef.current();
      return true;
    });
    return () => handler.remove();
  }, [overlay, visible]);

  useEffect(() => {
    if (visible) {
      dragY.value = 0;
      awaitingOpen.current = true;
      if (overlay) shown.current = true;
      if (rendered) {
        maybeStartOpen();
        return;
      }
      setRendered(true);
      if (overlay) return;
      const fallback = setTimeout(() => {
        shown.current = true;
        maybeStartOpen();
      }, SHOW_FALLBACK_MS);
      return () => clearTimeout(fallback);
    }
    awaitingOpen.current = false;
    if (!rendered) return;
    if (sheetHeight.current !== null) {
      hideDistance.value = Math.max(
        hideDistance.value,
        sheetHeight.current + SHADOW_CLEARANCE,
      );
    }
    cancelAnimation(progress);
    progress.value = withTiming(0, CLOSE_TIMING, (finished) => {
      if (finished) runOnJS(setRendered)(false);
    });
    // Only visibility drives the slide; the shared values are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!rendered) {
      sheetHeight.current = null;
      shown.current = false;
      dragY.value = 0;
    }
  }, [dragY, rendered]);

  const onShow = () => {
    shown.current = true;
    maybeStartOpen();
  };

  const onSheetLayout = (e: LayoutChangeEvent) => {
    const laidOut = contentSized
      ? e.nativeEvent.layout.height
      : maxSheetHeight;
    sheetHeight.current = laidOut;
    maybeStartOpen();
  };

  const slide = useAnimatedStyle(() => ({
    transform: [
      { translateY: -hideDistance.value * (1 - progress.value) + dragY.value },
    ],
  }));
  const keepsComposer = bottomReserve > 0;
  const overlayBackdrop = useAnimatedStyle(() => ({
    bottom: overlay && keepsComposer ? obstruction.value : 0,
  }));
  const fitsAboveObstruction = overlay && !contentSized;
  const sheetFit = useAnimatedStyle(() =>
    fitsAboveObstruction
      ? {
          height:
            Math.min(maxSheetHeight, height - obstruction.value - EDGE_GAP) +
            RADIUS,
        }
      : {},
  );
  const scrim = useAnimatedStyle(() => ({
    opacity: progress.value * 0.4,
  }));

  const layer = (
    <>
      <AnimatedPressable
        style={[
          dim ? [styles.backdrop, scrim] : styles.clearBackdrop,
          overlayBackdrop,
        ]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
      />
      {/* Auto-height: the sheet takes its own height and the floating
          footer sits under it, so the pair slide together and the footer
          always hugs the sheet's bottom edge. */}
      <Animated.View
        style={[styles.slide, slide]}
        pointerEvents="box-none"
        onLayout={onSheetLayout}
      >
        <Animated.View
          style={[
            styles.shadow,
            glass && styles.glassShadow,
            contentSized
              ? { maxHeight: maxSheetHeight + RADIUS }
              : { height: maxSheetHeight + RADIUS },
            sheetFit,
          ]}
        >
          <View
            style={[
              styles.sheet,
              contentSized ? styles.sheetHug : styles.sheetFill,
              glass && { backgroundColor: "transparent" },
            ]}
          >
            {glass ? (
              <GlassSurface
                radius={RADIUS}
                legible
                fallbackColor={colors.background}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />
            ) : null}
            <TopSheetDragContext.Provider value={pan}>
              {children}
            </TopSheetDragContext.Provider>
          </View>
        </Animated.View>
        {floatingFooter ? (
          <View style={styles.floatingFooter} pointerEvents="box-none">
            {floatingFooter}
          </View>
        ) : null}
      </Animated.View>
    </>
  );

  if (overlay) {
    return rendered ? (
      <OverlayPortal>
        <View style={styles.overlayRoot} pointerEvents="box-none">
          {layer}
        </View>
      </OverlayPortal>
    ) : null;
  }

  return (
    <Modal
      visible={rendered}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
      onShow={onShow}
    >
      {/* A Modal is its own native root, so gestures inside it (the image
          viewer's pinch and swipe) need their own gesture-handler root. */}
      <GestureHandlerRootView style={styles.fill}>{layer}</GestureHandlerRootView>
    </Modal>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    fill: {
      flex: 1,
    },
    overlayRoot: {
      ...StyleSheet.absoluteFill,
      zIndex: 40,
    },
    backdrop: {
      ...StyleSheet.absoluteFill,
      backgroundColor: "#000000",
    },
    clearBackdrop: {
      ...StyleSheet.absoluteFill,
      backgroundColor: "transparent",
    },
    // The sheet starts one corner radius above the screen, so all four
    // corners can share a radius and only the bottom two are ever seen. With
    // uniform corners iOS clips the sheet with its own corner radius instead
    // of a mask layer, which would re-render the whole sheet offscreen on
    // every frame of the slide.
    slide: {
      left: 0,
      position: "absolute",
      right: 0,
      top: -RADIUS,
    },
    // An opaque, uniformly rounded shadow caster lets iOS draw the shadow
    // from the outline's path. A glass sheet has no opaque fill, so it takes
    // a box shadow, also drawn from a path.
    shadow: {
      backgroundColor: colors.background,
      borderRadius: RADIUS,
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.18,
      shadowRadius: 24,
    },
    glassShadow: {
      backgroundColor: "transparent",
      boxShadow: "0px 10px 48px rgba(0, 0, 0, 0.18)",
      shadowOpacity: 0,
    },
    sheet: {
      backgroundColor: colors.background,
      borderRadius: RADIUS,
      // Soft hairline on the leading (bottom) edge and down the sides, where
      // the sheet meets the page, so its boundary reads against a
      // same-colour background. The top edge is offscreen.
      borderColor: colors.border,
      borderWidth: StyleSheet.hairlineWidth,
      overflow: "hidden",
      paddingTop: RADIUS,
    },
    sheetHug: {
      flexShrink: 1,
    },
    sheetFill: {
      flex: 1,
    },
    floatingFooter: {
      alignItems: "center",
      paddingTop: 14,
    },
  });
