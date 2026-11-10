import { useSyncExternalStore } from "react";
import {
  DEFAULT_MESSAGE_SOUND,
  messageSoundUrl,
  type MessageSound,
  type MessageSoundPreferences,
} from "@stella/contracts/message-sound";

const MESSAGE_SOUND_VOLUME = 0.8;

let preferences: MessageSoundPreferences = { enabled: true, sound: DEFAULT_MESSAGE_SOUND };
let loaded = false;
const listeners = new Set<() => void>();
const players = new Map<MessageSound, HTMLAudioElement>();

const systemApi = () => (typeof window === "undefined" ? undefined : window.electronAPI?.system);

const publish = (next: MessageSoundPreferences) => {
  preferences = next;
  for (const listener of listeners) listener();
};

const ensureLoaded = () => {
  if (loaded) return;
  loaded = true;
  void systemApi()
    ?.getMessageSound?.()
    .then((stored) => {
      if (stored) publish(stored);
    })
    .catch(() => undefined);
};

const subscribe = (listener: () => void) => {
  ensureLoaded();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const messageSoundPreferences = (): MessageSoundPreferences => {
  ensureLoaded();
  return preferences;
};

export const useMessageSoundPreferences = (): MessageSoundPreferences =>
  useSyncExternalStore(subscribe, messageSoundPreferences);

export const saveMessageSoundPreferences = async (
  patch: Partial<MessageSoundPreferences>,
): Promise<MessageSoundPreferences> => {
  const api = systemApi();
  if (!api?.setMessageSound) throw new Error("Message sound settings are unavailable in this window.");
  const previous = preferences;
  publish({ ...preferences, ...patch });
  try {
    const saved = await api.setMessageSound(patch);
    publish(saved);
    return saved;
  } catch (error) {
    publish(previous);
    throw error;
  }
};

export type MessageSoundPlayback = { sound: MessageSound; played: boolean; durationMs: number };

export const playMessageSound = (sound: MessageSound): Promise<MessageSoundPlayback> => {
  let player = players.get(sound);
  if (!player) {
    player = new Audio(messageSoundUrl(sound));
    player.preload = "auto";
    player.volume = MESSAGE_SOUND_VOLUME;
    players.set(sound, player);
  }
  const audio = player;
  audio.currentTime = 0;
  const startedAt = performance.now();
  return new Promise((resolve) => {
    const done = (played: boolean) => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      resolve({ sound, played, durationMs: Math.round(performance.now() - startedAt) });
    };
    const onEnded = () => done(true);
    const onError = () => done(false);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    audio.play().catch(() => done(false));
  });
};
