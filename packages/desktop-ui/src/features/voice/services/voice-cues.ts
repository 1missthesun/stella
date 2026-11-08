import { uiState } from "@/platform/ui-state";

export type VoiceCue = "start" | "end";

const CUE_NOTES: Record<VoiceCue, readonly number[]> = {
  start: [660, 880],
  end: [880, 587],
};
const NOTE_SECONDS = 0.09;
const CUE_GAIN = 0.06;

let cueContext: AudioContext | null = null;

const contextForCue = (): AudioContext | null => {
  if (cueContext && cueContext.state !== "closed") return cueContext;
  if (typeof AudioContext === "undefined") return null;
  const context = new AudioContext();
  const speakerId = uiState.getItem("stella-preferred-speaker-id");
  const withSink = context as AudioContext & {
    setSinkId?: (sinkId: string) => Promise<void>;
  };
  if (speakerId && typeof withSink.setSinkId === "function") {
    withSink.setSinkId(speakerId).catch(() => undefined);
  }
  cueContext = context;
  return context;
};

export const playVoiceCue = (cue: VoiceCue): void => {
  const context = contextForCue();
  if (!context) return;
  void context.resume().catch(() => undefined);
  const startAt = context.currentTime + 0.01;
  CUE_NOTES[cue].forEach((frequency, index) => {
    const noteStart = startAt + index * NOTE_SECONDS;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, noteStart);
    gain.gain.linearRampToValueAtTime(CUE_GAIN, noteStart + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + NOTE_SECONDS);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(noteStart);
    oscillator.stop(noteStart + NOTE_SECONDS + 0.02);
  });
};
