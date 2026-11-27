// desktop-ui's read-aloud player (WebAudio decode, MediaSource streaming of audio/mpeg) runs in the
// media page; a streamed response's body is pulled from here chunk by chunk as the page reads it.

import type { PlayOptions } from "@/features/voice/services/read-aloud/read-aloud-player";
import { mediaPage, useMediaPage } from "../../../../../host/media-client";

export * from "@/features/voice/services/read-aloud/read-aloud-player";

let publishedPlaying = false;
const holds = new Map<number, () => void>();
let nextPlayback = 0;
const endedCallbacks = new Map<number, () => void>();
const playingListeners = new Set<() => void>();
let listening = false;

const setPlaying = (playing: boolean) => {
  if (playing === publishedPlaying) return;
  publishedPlaying = playing;
  for (const listener of playingListeners) listener();
};

const listen = () => {
  const media = mediaPage();
  if (!media || listening) return;
  listening = true;
  media.onFunctionEvent((name, args) => {
    if (name === "readAloudPlaying") setPlaying(Boolean(args[0]));
    else if (name === "readAloudEnded") {
      const id = Number(args[0]);
      const onEnded = endedCallbacks.get(id);
      endedCallbacks.delete(id);
      releaseHold(id);
      onEnded?.();
    } else if (name === "pageClosed") {
      listening = false;
      releaseHolds();
      setPlaying(false);
      const callbacks = [...endedCallbacks.values()];
      endedCallbacks.clear();
      for (const onEnded of callbacks) onEnded();
    }
  });
};

const releaseHold = (id: number) => {
  holds.get(id)?.();
  holds.delete(id);
};

const releaseHolds = () => {
  for (const id of [...holds.keys()]) releaseHold(id);
};

/** The page, held for this playback; a new playback stops the one before, as in the page. */
const start = async (options: PlayOptions) => {
  const { media, release } = await useMediaPage();
  listen();
  releaseHolds();
  const id = ++nextPlayback;
  holds.set(id, release);
  if (options.onEnded) endedCallbacks.set(id, options.onEnded);
  return { media, id };
};

export async function playReadAloud(encoded: ArrayBuffer, options: PlayOptions = {}): Promise<void> {
  const { media, id } = await start(options);
  try {
    await media.invoke("playReadAloud", [Buffer.from(encoded).toString("base64"), id]);
  } catch (error) {
    endedCallbacks.delete(id);
    releaseHold(id);
    throw error;
  }
}

export function canStreamReadAloud(): boolean {
  const media = mediaPage();
  return Boolean(media) && (media!.caps?.mpegStream ?? true);
}

export async function playReadAloudStream(response: Response, options: PlayOptions = {}): Promise<void> {
  if (!canStreamReadAloud()) {
    throw new Error("read-aloud streaming is not supported");
  }
  const body = response.body;
  if (!body) {
    throw new Error("read-aloud stream response has no body");
  }
  const { media, id } = await start(options);
  try {
    await media.invoke("playReadAloudStream", [media.openStream(body), id]);
  } catch (error) {
    endedCallbacks.delete(id);
    releaseHold(id);
    throw error;
  }
}

export function stopReadAloud(): void {
  const media = mediaPage();
  if (media?.running && (holds.size > 0 || publishedPlaying)) void media.invoke("stopReadAloud").catch(() => undefined);
  releaseHolds();
  setPlaying(false);
}

export function isReadAloudPlaying(): boolean {
  return publishedPlaying;
}

export function subscribeReadAloudPlaying(listener: () => void): () => void {
  playingListeners.add(listener);
  return () => playingListeners.delete(listener);
}
