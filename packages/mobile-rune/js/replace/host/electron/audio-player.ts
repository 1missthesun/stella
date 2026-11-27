// The phone plays sounds through the app (AVAudioPlayer), not the desktop's helpers.
export type PlaybackEnd = "ended" | "stopped" | "error";
export type AudioDevice = { deviceId: string; label: string; kind: "audiooutput" | "audioinput"; groupId: string };
export type AudioPlayback = { done: Promise<PlaybackEnd>; stop(): void; setVolume(v: number): void; pause(): void; resume(): void; position(): number };

export function playAudioFile(file: string, options: { volume: number; deviceId: string | null }): AudioPlayback | null {
  __native.post(JSON.stringify({ cmd: "audio.play", path: file, volume: options.volume }));
  let resolve: (e: PlaybackEnd) => void = () => {};
  const done = new Promise<PlaybackEnd>((r) => (resolve = r));
  return { done, stop: () => resolve("stopped"), setVolume() {}, pause() {}, resume() {}, position: () => 0 };
}

export async function audioDevices(): Promise<AudioDevice[]> {
  return [{ deviceId: "default", label: "iPhone", kind: "audiooutput", groupId: "default" }];
}
