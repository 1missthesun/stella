import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import {
  DICTATION_WAVEFORM_BAR_WIDTH,
  createDictationWaveformState,
  dictationWaveformBarCount,
  dictationWaveformBarLook,
  dictationWaveformLevel,
  dictationWaveformOffset,
  stepDictationWaveform,
  type DictationWaveformState,
} from "@stella/contracts/dictation-waveform";
import { Text } from "./Text";
import { Icon } from "./Icon";
import { useColors } from "../theme/theme-context";
import { fonts } from "../theme/fonts";
import { fadeHex } from "../theme/oklch";
import {
  subscribeDictationLevel,
  useDictationMeterStartedAt,
} from "../lib/dictation-meter";

const WAVEFORM_HEIGHT = 32;
const WAVEFORM_FILL = 0.94;
const CONTROL_SIZE = 38;
const CONTROL_HIT_SLOP = (44 - CONTROL_SIZE) / 2;
const TIMER_TICK_MS = 250;

type Props = {
  onCancel: () => void;
  onConfirm: () => void;
  onSend?: () => void;
};

export const DictationRecordingBar = memo(function DictationRecordingBar({
  onCancel,
  onConfirm,
  onSend,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.recordingBar}>
      <View style={styles.recordingRow}>
        {/* Cancel takes the slot the composer's + occupies at rest, so the
            leading control is one place with one meaning: add something when
            idle, back out when dictating. Every control in the row shares one
            size, large enough to hit without aiming. */}
        <Pressable
          onPress={onCancel}
          accessibilityLabel="Cancel dictation"
          hitSlop={CONTROL_HIT_SLOP}
          style={styles.control}
        >
          <Icon
            name="x"
            size={17}
            color={fadeHex(colors.text, 0.75)}
            weight="semibold"
          />
        </Pressable>
        <DictationWaveform color={fadeHex(colors.text, 0.7)} />
        <ElapsedTimer style={styles.timer} />
        <Pressable
          onPress={onConfirm}
          accessibilityLabel="Stop dictation and transcribe"
          hitSlop={CONTROL_HIT_SLOP}
          style={styles.control}
        >
          <Icon name="check" size={18} color={colors.text} weight="semibold" />
        </Pressable>
        {onSend ? (
          <Pressable
            onPress={onSend}
            accessibilityLabel="Stop dictation and send"
            hitSlop={CONTROL_HIT_SLOP}
            style={styles.sendControl}
          >
            <Icon
              name="arrow-up"
              size={17}
              color={colors.accentForeground}
              weight="heavy"
            />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
});

const ElapsedTimer = memo(function ElapsedTimer({
  style,
}: {
  style: StyleProp<ViewStyle>;
}) {
  const startedAt = useDictationMeterStartedAt();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!startedAt) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TIMER_TICK_MS);
    return () => clearInterval(timer);
  }, [startedAt]);

  const durationMs = startedAt ? Math.max(0, now - startedAt) : 0;
  return (
    <Text style={style} accessibilityLiveRegion="polite">
      {formatElapsed(durationMs)}
    </Text>
  );
});

const DictationWaveform = memo(function DictationWaveform({
  color,
}: {
  color: string;
}) {
  const target = useSharedValue(0);
  const width = useSharedValue(0);
  const wave = useSharedValue<DictationWaveformState>(
    createDictationWaveformState(),
  );
  const [barCount, setBarCount] = useState(0);

  useEffect(
    () =>
      subscribeDictationLevel((level) => {
        target.value = level;
      }),
    [target],
  );

  useFrameCallback((frame) => {
    "worklet";
    wave.modify((state) => {
      "worklet";
      stepDictationWaveform(state, frame.timestamp, target.value);
      return state;
    });
  });

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const next = event.nativeEvent.layout.width;
      width.value = next;
      setBarCount(dictationWaveformBarCount(next));
    },
    [width],
  );

  const ages = useMemo(
    () => Array.from({ length: barCount }, (_, age) => age),
    [barCount],
  );

  return (
    <View style={waveStyles.container} onLayout={onLayout}>
      {ages.map((age) => (
        <WaveformBar
          key={age}
          age={age}
          wave={wave}
          width={width}
          color={color}
        />
      ))}
    </View>
  );
});

const WaveformBar = memo(function WaveformBar({
  age,
  wave,
  width,
  color,
}: {
  age: number;
  wave: SharedValue<DictationWaveformState>;
  width: SharedValue<number>;
  color: string;
}) {
  const animatedStyle = useAnimatedStyle(() => {
    const state = wave.value;
    const offset = dictationWaveformOffset(state, age);
    const look = dictationWaveformBarLook(
      dictationWaveformLevel(state, age) ?? 0,
      offset,
      width.value,
      WAVEFORM_HEIGHT * WAVEFORM_FILL,
    );
    return {
      height: look.height,
      opacity: offset > width.value ? 0 : look.opacity,
      transform: [{ translateX: -offset }],
    };
  });
  return (
    <Animated.View
      style={[waveStyles.bar, { backgroundColor: color }, animatedStyle]}
    />
  );
});

const waveStyles = StyleSheet.create({
  container: {
    flex: 1,
    height: WAVEFORM_HEIGHT,
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  bar: {
    position: "absolute",
    right: 0,
    width: DICTATION_WAVEFORM_BAR_WIDTH,
    borderRadius: DICTATION_WAVEFORM_BAR_WIDTH / 2,
    borderCurve: "continuous",
  },
});

const formatElapsed = (ms: number): string => {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

type ColorMap = ReturnType<typeof useColors>;

const makeStyles = (colors: ColorMap) =>
  StyleSheet.create({
    recordingBar: {
      flex: 1,
      gap: 7,
      minWidth: 0,
      paddingVertical: 1,
    },
    recordingRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 8,
      minHeight: CONTROL_SIZE + 6,
      minWidth: 0,
    },
    timer: {
      flexShrink: 0,
      color: fadeHex(colors.text, 0.7),
      fontFamily: fonts.sans.regular,
      fontSize: 12,
      fontVariant: ["tabular-nums"],
      paddingHorizontal: 4,
    },
    control: {
      flexShrink: 0,
      alignItems: "center",
      justifyContent: "center",
      width: CONTROL_SIZE,
      height: CONTROL_SIZE,
      borderRadius: CONTROL_SIZE / 2,
      backgroundColor: fadeHex(colors.text, 0.07),
    },
    sendControl: {
      flexShrink: 0,
      alignItems: "center",
      justifyContent: "center",
      width: CONTROL_SIZE,
      height: CONTROL_SIZE,
      borderRadius: CONTROL_SIZE / 2,
      backgroundColor: colors.accent,
    },
  });
