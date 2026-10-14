import type { AudioPlayer } from "expo-audio";

const disposed = new WeakSet<AudioPlayer>();

export const disposeAudioPlayer = (player: AudioPlayer): void => {
  if (disposed.has(player)) return;
  disposed.add(player);
  try {
    player.remove();
    player.release();
  } catch (error) {
    console.warn("[audio] player disposal failed", error);
  }
};
