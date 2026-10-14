import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { Text } from "./Text";
import Reanimated, {
  Easing as ReanimatedEasing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { TextShimmer } from "./TextShimmer";
import { CONTENT_MAX_FONT_SCALE } from "../lib/font-scale";
import { StellaMarkIndicator } from "./stella-mark/StellaMarkIndicator";
import { enterEase, exitEase } from "./stella-mark/rig-math";
import {
  computeStillStatus,
  computeWorkingIndicatorStatus,
  getWorkingIndicatorThinkingText,
  WORKING_INDICATOR_LONG_THINKING_MS,
  WORKING_INDICATOR_LONG_TOOL_MS,
  WORKING_INDICATOR_THINKING_LABEL_MS,
} from "./working-indicator-status";
import {
  getWorkingIndicatorCharacterState,
  pickWorkingIndicatorToolPose,
  WORKING_INDICATOR_POSE_ROTATE_MS,
  type WorkingIndicatorCharacterState,
} from "./working-indicator-character";
import { useMinimumVisibleValue } from "../lib/use-minimum-visible-value";
import { useAppVisible } from "../lib/use-app-visible";
import { useReplyHandoffController } from "./reply-handoff";
import { type Colors } from "../theme/colors";
import { useColors } from "../theme/theme-context";
import { fonts } from "../theme/fonts";

const ENTER_DURATION_MS = 320;
const ENTER_DELAY_MS = 300;
const EXIT_HOLD_MS = 300;
const EXIT_ANIMATION_MS = 220;
const EXIT_UNMOUNT_MS = 240;
const EXIT_HANDOFF_MS = 240;
const SHELL_ENTER = 0;
const SHELL_EXIT = 1;
const SHELL_HANDOFF = 2;
const SWAP_DURATION_MS = 240;
const STATUS_MIN_VISIBLE_MS = 2000;
const INDICATOR_PAD_TOP = 0;
const INDICATOR_PAD_BOTTOM = 0;
const INDICATOR_VIEWPORT_SIZE = 28;
const BUBBLE_PAD_VERTICAL = 4;

export const WORKING_INDICATOR_SLOT_HEIGHT =
  INDICATOR_VIEWPORT_SIZE + BUBBLE_PAD_VERTICAL * 2 + 2;

interface WorkingIndicatorProps {
  active: boolean;
  status?: string;
  toolName?: string;
  toolCallId?: string;
  exitImmediately?: boolean;
  onScreen?: boolean;
}

function SwapText({
  text,
  active,
  colors,
  styles,
}: {
  text: string;
  active: boolean;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const [current, setCurrent] = useState(text);
  const [previous, setPrevious] = useState<string | null>(null);
  const lastTextRef = useRef(text);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inValue = useRef(new Animated.Value(1)).current;
  const outValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (text === lastTextRef.current) return;

    const old = lastTextRef.current;
    setPrevious(old);
    setCurrent(text);
    lastTextRef.current = text;
    inValue.setValue(0);
    outValue.setValue(1);

    Animated.parallel([
      Animated.timing(inValue, {
        toValue: 1,
        duration: SWAP_DURATION_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(outValue, {
        toValue: 0,
        duration: SWAP_DURATION_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();

    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setPrevious(null);
      timeoutRef.current = null;
    }, SWAP_DURATION_MS);

    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [inValue, outValue, text]);

  const inStyle = useMemo(
    () => ({
      opacity: inValue,
      transform: [
        {
          translateY: inValue.interpolate({
            inputRange: [0, 1],
            outputRange: [4, 0],
          }),
        },
      ],
    }),
    [inValue],
  );
  const outStyle = useMemo(
    () => ({
      opacity: outValue,
      transform: [
        {
          translateY: outValue.interpolate({
            inputRange: [0, 1],
            outputRange: [-4, 0],
          }),
        },
      ],
    }),
    [outValue],
  );

  return (
    <View style={styles.swapText}>
      {
        // Invisible sizer: the animated layers are absolutely positioned, so
        // this gives the bubble its intrinsic width for the current label.
      }
      <Text
        style={[styles.statusText, styles.swapSizer]}
        numberOfLines={1}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {current}
      </Text>
      {previous ? (
        <Animated.View
          style={[styles.swapLayer, outStyle]}
          pointerEvents="none"
        >
          <View style={styles.shimmerWrap}>
            <Text
              style={styles.statusText}
              numberOfLines={1}
              maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
            >
              {previous}
            </Text>
          </View>
        </Animated.View>
      ) : null}
      <Animated.View style={[styles.swapLayer, inStyle]}>
        <View style={styles.shimmerWrap}>
          <TextShimmer
            text={current}
            active={active}
            color={colors.textStrong}
            sweepColor={colors.textWeaker}
            textStyle={styles.statusText}
          />
        </View>
      </Animated.View>
    </View>
  );
}

const STRETCH_MARKS_MS = [
  WORKING_INDICATOR_THINKING_LABEL_MS,
  WORKING_INDICATOR_LONG_THINKING_MS,
  WORKING_INDICATOR_LONG_TOOL_MS,
];

function useStretchElapsedMs(stretch: string | null): number {
  const [started, setStarted] = useState<{
    stretch: string;
    at: number;
  } | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (stretch === null) return;
    setStarted({ stretch, at: Date.now() });
    const timers = STRETCH_MARKS_MS.map((ms) =>
      setTimeout(() => setTick((tick) => tick + 1), ms),
    );
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, [stretch]);
  if (stretch === null || started?.stretch !== stretch) return 0;
  return Date.now() - started.at;
}

export const WorkingIndicator = memo(function WorkingIndicator({
  active,
  status,
  toolName,
  toolCallId,
  exitImmediately = false,
  onScreen = true,
}: WorkingIndicatorProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [reasoningSeed, setReasoningSeed] = useState(() => String(Date.now()));
  const wasActiveRef = useRef(false);
  const appVisible = useAppVisible();
  const [poseEpoch, setPoseEpoch] = useState(0);
  useEffect(() => {
    if (!active || !appVisible) return;
    const timer = setInterval(
      () => setPoseEpoch((epoch) => epoch + 1),
      WORKING_INDICATOR_POSE_ROTATE_MS,
    );
    return () => clearInterval(timer);
  }, [active, appVisible]);
  const previousPoseRef = useRef<WorkingIndicatorCharacterState | undefined>(
    undefined,
  );
  const toolStatus = computeWorkingIndicatorStatus({
    status,
    toolName,
    seed: toolCallId ?? reasoningSeed,
  });
  const stretchMs = useStretchElapsedMs(
    !active
      ? null
      : toolName
        ? `tool:${toolCallId ?? toolName}`
        : toolStatus
          ? null
          : "thinking",
  );
  const thinkingText = toolStatus
    ? ""
    : getWorkingIndicatorThinkingText(stretchMs);
  const shownToolStatus =
    toolName && stretchMs >= WORKING_INDICATOR_LONG_TOOL_MS
      ? computeStillStatus(toolName)
      : toolStatus;
  const liveDisplay = useMemo(() => {
    const seed = `${toolCallId ?? reasoningSeed}:${poseEpoch}`;
    const pose = getWorkingIndicatorCharacterState({
      toolName,
      isReasoning: !toolName,
      seed,
      avoid: previousPoseRef.current,
    });
    const label = shownToolStatus || thinkingText;
    return {
      status: label,
      thinking: !toolStatus,
      characterState:
        pose === "thinking" && label
          ? pickWorkingIndicatorToolPose(seed, previousPoseRef.current)
          : pose,
    };
  },
    [
      poseEpoch,
      reasoningSeed,
      shownToolStatus,
      thinkingText,
      toolCallId,
      toolName,
      toolStatus,
    ],
  );
  previousPoseRef.current = liveDisplay.characterState;
  const labelledDisplay = liveDisplay;
  const heldDisplay = useMinimumVisibleValue(
    labelledDisplay,
    labelledDisplay.thinking ? 0 : STATUS_MIN_VISIBLE_MS,
    (a, b) => a.status === b.status && a.characterState === b.characterState,
  );

  const frozenDisplayRef = useRef(heldDisplay);
  if (active) frozenDisplayRef.current = heldDisplay;
  const display = active ? heldDisplay : frozenDisplayRef.current;
  const displayStatus = display.status;
  const hasLabel = displayStatus.length > 0;
  const characterState: WorkingIndicatorCharacterState = hasLabel
    ? display.characterState
    : "thinking";
  const [renderShell, setRenderShell] = useState(false);
  const [shellMode, setShellMode] = useState(SHELL_ENTER);
  const shellT = useSharedValue(0);
  const shellModeSV = useSharedValue(SHELL_ENTER);
  const enteredRef = useRef(false);
  const leavingRef = useRef(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const renderShellRef = useRef(renderShell);
  renderShellRef.current = renderShell;
  const handoffController = useReplyHandoffController();

  useEffect(() => {
    if (!handoffController) return;
    return handoffController.attachIndicator({
      shown: () => renderShellRef.current,
      vacate: () => {
        if (holdTimerRef.current !== null) {
          clearTimeout(holdTimerRef.current);
          holdTimerRef.current = null;
        }
        if (leaveTimerRef.current !== null) {
          clearTimeout(leaveTimerRef.current);
          leaveTimerRef.current = null;
        }
        cancelAnimation(shellT);
        shellT.value = 0;
        enteredRef.current = false;
        leavingRef.current = false;
        setRenderShell(false);
      },
    });
  }, [handoffController, shellT]);

  useEffect(() => {
    const clearTimers = () => {
      if (holdTimerRef.current !== null) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      if (leaveTimerRef.current !== null) {
        clearTimeout(leaveTimerRef.current);
        leaveTimerRef.current = null;
      }
    };

    if (active) {
      clearTimers();
      if (!renderShell) {
        holdTimerRef.current = setTimeout(() => {
          holdTimerRef.current = null;
          setRenderShell(true);
        }, ENTER_DELAY_MS);
        return clearTimers;
      }
      if (!wasActiveRef.current) setReasoningSeed(String(Date.now()));
      wasActiveRef.current = true;
      setRenderShell(true);
      if (leavingRef.current) {
        leavingRef.current = false;
        cancelAnimation(shellT);
        shellModeSV.value = SHELL_ENTER;
        shellT.value = 1;
        setShellMode(SHELL_ENTER);
      } else if (!enteredRef.current) {
        enteredRef.current = true;
        shellModeSV.value = SHELL_ENTER;
        setShellMode(SHELL_ENTER);
        shellT.value = 0;
        shellT.value = withTiming(1, {
          duration: ENTER_DURATION_MS,
          easing: ReanimatedEasing.linear,
        });
      }
      return clearTimers;
    }

    wasActiveRef.current = false;
    if (!renderShell) return clearTimers;

    const mode = exitImmediately ? SHELL_HANDOFF : SHELL_EXIT;
    const exitMs = exitImmediately ? EXIT_HANDOFF_MS : EXIT_ANIMATION_MS;
    const unmountMs = exitImmediately ? EXIT_HANDOFF_MS : EXIT_UNMOUNT_MS;
    const startExit = () => {
      holdTimerRef.current = null;
      leavingRef.current = true;
      cancelAnimation(shellT);
      shellModeSV.value = mode;
      setShellMode(mode);
      shellT.value = 0;
      shellT.value = withTiming(1, {
        duration: exitMs,
        easing: ReanimatedEasing.linear,
      });
      leaveTimerRef.current = setTimeout(() => {
        leaveTimerRef.current = null;
        enteredRef.current = false;
        leavingRef.current = false;
        setRenderShell(false);
      }, unmountMs);
    };

    if (exitImmediately) {
      startExit();
    } else {
      holdTimerRef.current = setTimeout(startExit, EXIT_HOLD_MS);
    }

    return clearTimers;
  }, [active, exitImmediately, renderShell, shellModeSV, shellT]);

  const shellStyle = useAnimatedStyle(() => {
    const t = shellT.value;
    const mode = shellModeSV.value;
    if (mode === SHELL_ENTER) {
      const e = enterEase(t);
      return {
        opacity: e,
        transform: [{ translateY: 4 * (1 - e) }, { scale: 0.96 + 0.04 * e }],
      };
    }
    const e = exitEase(t);
    if (mode === SHELL_EXIT) {
      return {
        opacity: 1 - exitEase(Math.min(t / 0.6, 1)),
        transform: [{ translateY: -3 * e }, { scale: 1 - 0.06 * e }],
      };
    }
    return {
      opacity: 1 - e,
      transform: [{ translateY: -5 * e }, { scale: 1 - 0.03 * e }],
    };
  });
  const originStyle =
    shellMode === SHELL_EXIT
      ? styles.originLeftTop
      : shellMode === SHELL_HANDOFF
        ? styles.originLeftCenter
        : null;

  const showShell = renderShell && (active || !exitImmediately);

  return (
    <View
      style={[styles.slot, !showShell && styles.slotCollapsed]}
      pointerEvents="none"
    >
      {showShell ? (
        <Reanimated.View
          style={[styles.row, originStyle, shellStyle]}
          collapsable={false}
        >
          <View style={[styles.bubble, !hasLabel && styles.bubbleDots]}>
            <View style={styles.markBox}>
              <StellaMarkIndicator
                active={active && onScreen}
                size={INDICATOR_VIEWPORT_SIZE}
                state={characterState}
                faceColor={colors.card}
              />
            </View>
            {hasLabel ? (
              <SwapText
                text={displayStatus}
                active={active && onScreen}
                colors={colors}
                styles={styles}
              />
            ) : null}
          </View>
        </Reanimated.View>
      ) : null}
    </View>
  );
});

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    slot: {
      height: WORKING_INDICATOR_SLOT_HEIGHT,
      flexShrink: 0,
    },
    slotCollapsed: {
      height: 0,
    },
    row: {
      alignItems: "center",
      flexDirection: "row",
      height: WORKING_INDICATOR_SLOT_HEIGHT,
      justifyContent: "flex-start",
      paddingBottom: INDICATOR_PAD_BOTTOM,
      paddingLeft: 0,
      paddingRight: 18,
      paddingTop: INDICATOR_PAD_TOP,
    },
    bubble: {
      alignItems: "center",
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 18,
      borderCurve: "continuous",
      flexDirection: "row",
      flexShrink: 1,
      gap: 8,
      maxWidth: "100%",
      paddingHorizontal: 13,
      paddingVertical: BUBBLE_PAD_VERTICAL,
    },
    originLeftTop: {
      transformOrigin: "left top",
    },
    originLeftCenter: {
      transformOrigin: "left center",
    },
    bubbleDots: {
      paddingHorizontal: 8,
    },
    markBox: {
      alignItems: "center",
      height: INDICATOR_VIEWPORT_SIZE,
      justifyContent: "center",
      width: INDICATOR_VIEWPORT_SIZE,
    },
    swapText: {
      flexShrink: 1,
      height: 20,
      minWidth: 0,
      overflow: "hidden",
    },
    swapSizer: {
      opacity: 0,
    },
    swapLayer: {
      bottom: 0,
      justifyContent: "center",
      left: 0,
      position: "absolute",
      right: 0,
      top: 0,
    },
    shimmerWrap: {
      justifyContent: "center",
    },
    statusText: {
      color: colors.text,
      fontFamily: fonts.sans.medium,
      fontSize: 14,
      letterSpacing: -0.1,
      lineHeight: 20,
    },
  });
