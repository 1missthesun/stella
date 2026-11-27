// The shared microphone lives in the media page, next to the WebRTC and capture code that reads it:
// a lease here holds the page's lease and a stand-in for its stream.

import type { SharedMicrophoneLease } from "@/features/voice/services/shared-microphone";
import { isMicrophoneEnabled } from "@/features/voice/services/shared-microphone";
import type { HandleRef } from "../../../../../host/media/protocol";
import { PageMediaStream, useMediaPage } from "../../../../host/media-client";

export * from "@/features/voice/services/shared-microphone";

let warmRelease: (() => void) | null = null;

export async function acquireSharedMicrophone(): Promise<SharedMicrophoneLease> {
  if (!isMicrophoneEnabled()) {
    throw new Error("Microphone access is disabled in settings.");
  }
  const { media, release } = await useMediaPage();
  let lease: { lease: HandleRef; stream: HandleRef };
  try {
    lease = await media.invoke<{ lease: HandleRef; stream: HandleRef }>("acquireSharedMicrophone");
  } catch (error) {
    release();
    throw error;
  }
  const stream = new PageMediaStream(lease.stream, media);
  let released = false;
  return {
    stream: stream as unknown as MediaStream,
    release(options) {
      if (released) return;
      released = true;
      void media.invoke("releaseMicrophone", [lease.lease, options ?? null]).catch(() => undefined).finally(release);
    },
  };
}

export async function setSharedMicrophoneKeepWarm(keepWarm: boolean): Promise<void> {
  if (keepWarm && !warmRelease) {
    const { media, release } = await useMediaPage();
    warmRelease = release;
    await media.invoke("setSharedMicrophoneKeepWarm", [true]);
    return;
  }
  if (!keepWarm && warmRelease) {
    const release = warmRelease;
    warmRelease = null;
    const media = globalThis.stella?.host?.media;
    await media?.invoke("setSharedMicrophoneKeepWarm", [false]).catch(() => undefined);
    release();
  }
}
