import type { CarPlayRow, CarPlaySection } from "./native";

export type CarPlayPhase = "idle" | "listening" | "thinking" | "speaking";

export type CarPlayHomeState =
  | { kind: "signedOut" }
  | { kind: "connecting" }
  | { kind: "ready"; phase: CarPlayPhase; hasReply: boolean; notice: string | null };

export const TALK_ROW_ID = "talk";
export const REPLAY_ROW_ID = "replay";

const TALK_COPY: Record<CarPlayPhase, Pick<CarPlayRow, "title" | "detail" | "icon">> = {
  idle: { title: "Talk to Stella", detail: "Tap, speak, then tap again to send", icon: "mic" },
  listening: { title: "Listening…", detail: "Tap to send", icon: "waveform" },
  thinking: { title: "Stella is thinking…", detail: "Tap to talk", icon: "thinking" },
  speaking: { title: "Stella is speaking", detail: "Tap to interrupt and talk", icon: "speaker" },
};

export function buildHome(state: CarPlayHomeState): CarPlaySection[] {
  if (state.kind === "signedOut") {
    return [
      {
        rows: [
          {
            id: "signin",
            title: "Sign in to use Stella in the car",
            detail: "Stella needs an account before it can answer",
            icon: "person",
            enabled: false,
          },
        ],
      },
    ];
  }
  if (state.kind === "connecting") {
    return [
      {
        rows: [
          {
            id: TALK_ROW_ID,
            title: "Talk to Stella",
            detail: "Connecting…",
            icon: "mic",
            enabled: false,
          },
        ],
      },
    ];
  }
  const talk = TALK_COPY[state.phase];
  const rows: CarPlayRow[] = [
    {
      id: TALK_ROW_ID,
      ...talk,
      detail: state.notice ?? talk.detail,
      playing: state.phase === "listening" || state.phase === "speaking",
    },
  ];
  if (state.hasReply && state.phase !== "listening") {
    rows.push({ id: REPLAY_ROW_ID, title: "Hear the last reply", icon: "replay" });
  }
  return [{ rows }];
}
