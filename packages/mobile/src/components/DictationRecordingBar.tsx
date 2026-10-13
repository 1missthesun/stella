/**
 * Mobile mirror of desktop's DictationRecordingBar
 * (`desktop/src/features/dictation/components/DictationRecordingBar.tsx`).
 * The composer's text area stays as it is while dictating; this row sits
 * under it, where the toolbar normally sits:
 *
 *   [X]  [waveform — flex 1]   [0:24]   [✓]   [↑]
 *
 * No words appear while recording; the transcript lands in the composer once
 * dictation stops. The trailing send (↑) is optional: when `onSend` is given
 * it stops dictation and, once the transcript lands, auto-submits the message
 * in one tap.
 *
 * Waveform and timer are separate leaves on external stores, so a waveform
 * tick never re-renders the rest of the composer.
 */

import { memo, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Icon } from "./Icon";
import { useColors } from "../theme/theme-context";
import { fonts } from "../theme/fonts";
import { fadeHex } from "../theme/oklch";
import {
  getDictationMeterSnapshot,
  useDictationMeterStartedAt,
  useDictationMeterTick,
} from "../lib/dictation-meter";

const BAR_WIDTH = 2;
const BAR_GAP = 2;
const WAVEFORM_HEIGHT = 32;
const CONTROL_SIZE = 38;
const CONTROL_HIT_SLOP = (44 - CONTROL_SIZE) / 2;
const MIN_BAR_HEIGHT = 1;
const LEVEL_BUFFER_LENGTH = 64;
const TIMER_TICK_MS = 250;

type Props = {
  onCancel: () => void;
  onConfirm: () => void;
  /** When provided, stop dictation and auto-send once the transcript lands. */
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

/**
 * One bar per meter tick (~12.5 Hz), newest on the right, older bars
 * scrolling off the left once the buffer is full — the same series desktop
 * draws on its canvas.
 */
const DictationWaveform = memo(function DictationWaveform({
  color,
}: {
  color: string;
}) {
  const tick = useDictationMeterTick();
  const [levels, setLevels] = useState<number[]>([]);

  useEffect(() => {
    const { active, level } = getDictationMeterSnapshot();
    if (!active) return;
    setLevels((previous) =>
      previous.length < LEVEL_BUFFER_LENGTH
        ? [...previous, level]
        : [...previous.slice(previous.length - LEVEL_BUFFER_LENGTH + 1), level],
    );
  }, [tick]);

  return (
    <View style={waveStyles.container}>
      <View style={waveStyles.row}>
        {levels.map((level, idx) => {
          const h = Math.max(
            MIN_BAR_HEIGHT,
            Math.min(WAVEFORM_HEIGHT, level * WAVEFORM_HEIGHT),
          );
          return (
            <View
              key={idx}
              style={{
                width: BAR_WIDTH,
                marginRight: BAR_GAP,
                height: h,
                borderRadius: 1,
                backgroundColor: color,
              }}
            />
          );
        })}
      </View>
    </View>
  );
});

const waveStyles = StyleSheet.create({
  container: {
    flex: 1,
    height: WAVEFORM_HEIGHT,
    minWidth: 0,
    justifyContent: "center",
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    height: WAVEFORM_HEIGHT,
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
