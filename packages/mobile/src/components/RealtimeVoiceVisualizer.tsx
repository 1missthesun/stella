import { useEffect, useId, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { STELLA_STAR_PATH } from "./stella-mark/geometry";
import { MarkLayer } from "./stella-mark/MarkLayer";
import { StellaFace } from "./stella-mark/StellaFace";
import { CLOCK_SPAN_MS, clamp01 } from "./stella-mark/motion";
import {
  voiceBodyMotion,
  type VoiceCharacterPhase,
} from "./stella-mark/voice-motion";
import { useAppVisible } from "../lib/use-app-visible";
import type { RealtimeVoicePhase } from "../lib/realtime-voice-protocol";

type Props = {
  size: number;
  phase: RealtimeVoicePhase;
  isConnected: boolean;
  isUserSpeaking: boolean;
  isAssistantSpeaking: boolean;
  micLevel: number;
  outputLevel: number;
  faceColor: string;
};

const ENERGY_RAMP_MS = 90;
const PHASE_BLEND_MS = 320;
const BODY_FRACTION = 0.62;

export const voiceCharacterPhase = ({
  phase,
  isConnected,
  isUserSpeaking,
  isAssistantSpeaking,
}: Pick<
  Props,
  "phase" | "isConnected" | "isUserSpeaking" | "isAssistantSpeaking"
>): VoiceCharacterPhase => {
  if (phase === "error") return "error";
  if (!isConnected || phase === "connecting") return "connecting";
  if (isAssistantSpeaking || phase === "assistant-speaking") return "talking";
  if (isUserSpeaking || phase === "user-speaking") return "hearing";
  return "listening";
};

export const realtimeVoiceEnergy = ({
  characterPhase,
  micLevel,
  outputLevel,
}: {
  characterPhase: VoiceCharacterPhase;
  micLevel: number;
  outputLevel: number;
}): number => {
  if (characterPhase === "talking") return clamp01(outputLevel);
  if (characterPhase === "hearing") return clamp01(micLevel);
  return 0;
};

const PHASE_ORDER: VoiceCharacterPhase[] = [
  "connecting",
  "listening",
  "hearing",
  "talking",
  "error",
];

export function RealtimeVoiceVisualizer({
  size,
  phase,
  isConnected,
  isUserSpeaking,
  isAssistantSpeaking,
  micLevel,
  outputLevel,
  faceColor,
}: Props) {
  const reduceMotion = useReducedMotion();
  const appVisible = useAppVisible();
  const uid = useId().replace(/[^a-zA-Z0-9-]/g, "");
  const bodySize = Math.round(size * BODY_FRACTION);

  const characterPhase = voiceCharacterPhase({
    phase,
    isConnected,
    isUserSpeaking,
    isAssistantSpeaking,
  });
  const targetEnergy = realtimeVoiceEnergy({
    characterPhase,
    micLevel,
    outputLevel,
  });

  const clock = useSharedValue(0);
  const energy = useSharedValue(0);
  const phaseIndex = useSharedValue(PHASE_ORDER.indexOf(characterPhase));
  const blend = useSharedValue(1);

  useEffect(() => {
    cancelAnimation(clock);
    if (reduceMotion || !appVisible) {
      clock.value = 0;
      return;
    }
    clock.value = 0;
    clock.value = withRepeat(
      withTiming(CLOCK_SPAN_MS, {
        duration: CLOCK_SPAN_MS,
        easing: Easing.linear,
      }),
      -1,
      false,
    );
    return () => cancelAnimation(clock);
  }, [appVisible, clock, reduceMotion]);

  useEffect(() => {
    cancelAnimation(energy);
    energy.value = withTiming(reduceMotion ? 0 : targetEnergy, {
      duration: ENERGY_RAMP_MS,
      easing: Easing.out(Easing.quad),
    });
    return () => cancelAnimation(energy);
  }, [energy, reduceMotion, targetEnergy]);

  useEffect(() => {
    const next = PHASE_ORDER.indexOf(characterPhase);
    if (phaseIndex.value === next) return;
    phaseIndex.value = next;
    cancelAnimation(blend);
    blend.value = 0;
    blend.value = withTiming(1, {
      duration: PHASE_BLEND_MS,
      easing: Easing.out(Easing.cubic),
    });
    return () => cancelAnimation(blend);
  }, [blend, characterPhase, phaseIndex]);

  const bodyStyle = useAnimatedStyle(() => {
    if (reduceMotion) {
      return { opacity: 1, transform: [{ scale: 1 }] };
    }
    const current = PHASE_ORDER[Math.round(phaseIndex.value)] ?? "listening";
    const frame = voiceBodyMotion(current, clock.value, energy.value);
    const k = blend.value;
    const mix = (value: number, rest: number) => rest + (value - rest) * k;
    return {
      opacity: mix(frame.opacity, 1),
      transform: [
        { translateX: mix(frame.translateX, 0) * bodySize },
        { translateY: mix(frame.translateY, 0) * bodySize },
        { rotate: `${mix(frame.rotationDeg, 0)}deg` },
        { scaleX: mix(frame.scaleX, 1) },
        { scaleY: mix(frame.scaleY, 1) },
      ],
    };
  });

  const stage = useMemo(
    () => [styles.stage, { height: size, width: size }],
    [size],
  );
  const bodyBox = useMemo(
    () => ({
      height: bodySize,
      left: (size - bodySize) / 2,
      position: "absolute" as const,
      top: (size - bodySize) / 2,
      width: bodySize,
    }),
    [bodySize, size],
  );

  return (
    <View style={stage} pointerEvents="none">
      <Animated.View style={[bodyBox, bodyStyle]}>
        <MarkLayer
          d={STELLA_STAR_PATH}
          size={bodySize}
          gradientId={`${uid}-voice`}
        />
        <StellaFace
          size={bodySize}
          color={faceColor}
          state={characterPhase}
          active={appVisible && !reduceMotion}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
});
