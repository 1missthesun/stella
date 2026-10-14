import { BREATHE_AMPLITUDE, BREATHE_MS, clamp01 } from "./motion";

export type VoiceCharacterPhase =
  | "connecting"
  | "listening"
  | "hearing"
  | "talking"
  | "error";

export type VoiceBodyMotion = {
  translateX: number;
  translateY: number;
  rotationDeg: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
};

export const TALK_SYLLABLE_MS = 260;
export const TALK_PHRASE_MS = 1900;
export const TALK_STRETCH = 0.075;
export const HEARING_LEAN = 0.06;

const TAU = Math.PI * 2;

export function voiceBodyMotion(
  phase: VoiceCharacterPhase,
  timeMs: number,
  energy: number,
): VoiceBodyMotion {
  "worklet";
  const gain = 0.6 + 0.4 * clamp01(energy);
  const breathe = BREATHE_AMPLITUDE * Math.sin((timeMs / BREATHE_MS) * TAU);
  if (phase === "connecting") {
    const slow = 0.5 + 0.5 * Math.sin((timeMs / 2600) * TAU);
    return {
      translateX: 0,
      translateY: 0,
      rotationDeg: 0,
      scaleX: 0.97 + breathe,
      scaleY: 0.97 + breathe,
      opacity: 0.72 + 0.18 * slow,
    };
  }
  if (phase === "error") {
    return {
      translateX: 0,
      translateY: 0.01,
      rotationDeg: -5,
      scaleX: 0.94,
      scaleY: 0.92,
      opacity: 0.9,
    };
  }
  if (phase === "listening") {
    const sway = Math.sin((timeMs / 2400) * TAU);
    return {
      translateX: sway * 0.012,
      translateY: -0.004 + breathe * 0.4,
      rotationDeg: sway * 3.2,
      scaleX: 1.02 + breathe,
      scaleY: 1.02 + breathe,
      opacity: 1,
    };
  }
  if (phase === "hearing") {
    const tremor = Math.sin((timeMs / 140) * TAU) * 0.008 * gain;
    const lean = 1 + HEARING_LEAN * gain;
    return {
      translateX: 0,
      translateY: -0.02 * gain,
      rotationDeg: -2.5 * gain,
      scaleX: lean - tremor,
      scaleY: lean + tremor,
      opacity: 1,
    };
  }
  const syllable = 0.5 + 0.5 * Math.sin((timeMs / TALK_SYLLABLE_MS) * TAU);
  const phrase = 0.55 + 0.45 * Math.sin((timeMs / TALK_PHRASE_MS) * TAU);
  const jitter = 0.85 + 0.15 * Math.sin(timeMs * 0.0071);
  const pulse = clamp01(syllable * phrase * jitter) * gain;
  const sway = Math.sin((timeMs / 900) * TAU);
  return {
    translateX: sway * 0.01,
    translateY: -pulse * 0.03,
    rotationDeg: sway * 2.2,
    scaleX: 1 + breathe - TALK_STRETCH * 0.6 * pulse,
    scaleY: 1 + breathe + TALK_STRETCH * pulse,
    opacity: 1,
  };
}
