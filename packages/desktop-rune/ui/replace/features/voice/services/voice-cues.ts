// desktop-ui's voice cues (WebAudio oscillators) play in the media page.

import type { VoiceCue } from "@/features/voice/services/voice-cues";
import { useMediaPage } from "../../../../host/media-client";

export * from "@/features/voice/services/voice-cues";

const CUE_HOLD_MS = 1_000;

export const playVoiceCue = (cue: VoiceCue): void => {
  void useMediaPage()
    .then(({ media, release }) =>
      media.invoke("playVoiceCue", [cue]).finally(() => setTimeout(release, CUE_HOLD_MS)),
    )
    .catch(() => undefined);
};
