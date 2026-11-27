// Audio file playback for the host's HTMLMediaElement: AVPlayer on macOS
// (macos-audio-player.ts), the engine's player elsewhere (engine/src/audio.rs).

import { audioDevices as macAudioDevices, type AudioDevice } from "./macos-media";
import { playAudioFile as playOnMac, type PlaybackEnd } from "./macos-audio-player";
import { engine, onEngine } from "./engine";

export type { PlaybackEnd };

export type AudioPlayback = {
  readonly elapsedSeconds: number;
  readonly finished: Promise<PlaybackEnd>;
  readonly playing: Promise<boolean>;
  setVolume(volume: number): void;
  setOutput(deviceId: string | null): void;
  pause(): void;
  resume(): void;
  stop(): void;
};

let nextId = 0;
const engineEnds = new Map<string, (end: PlaybackEnd) => void>();
let listening = false;

function listen() {
  if (listening) return;
  listening = true;
  onEngine("audio", (event) => {
    const settle = engineEnds.get(event.id);
    if (!settle) return;
    if (event.kind === "error") console.warn(`[audio] ${event.message ?? "playback failed"}`);
    settle(event.kind === "ended" ? "ended" : "failed");
  });
}

class EnginePlayback implements AudioPlayback {
  readonly id = `audio-${process.pid}-${++nextId}`;
  readonly finished: Promise<PlaybackEnd>;
  readonly playing: Promise<boolean>;
  private settle: ((end: PlaybackEnd) => void) | null = null;
  private playedMs = 0;
  private resumedAt = 0;
  private paused = false;

  constructor(private readonly api: NonNullable<ReturnType<typeof engine>>, file: string, options: { volume: number; deviceId: string | null }) {
    this.finished = new Promise((resolve) => {
      this.settle = (end) => {
        if (!this.settle) return;
        this.settle = null;
        engineEnds.delete(this.id);
        if (this.resumedAt) this.playedMs += performance.now() - this.resumedAt;
        this.resumedAt = 0;
        resolve(end);
      };
    });
    engineEnds.set(this.id, (end) => this.settle?.(end));
    this.playing = api.audio.play({ id: this.id, path: file, volume: options.volume, device: options.deviceId }).then(
      () => {
        if (!this.settle) return false;
        if (!this.paused) this.resumedAt = performance.now();
        return true;
      },
      (error: Error) => {
        console.warn(`[audio] ${error.message}`);
        this.settle?.("failed");
        return false;
      },
    );
  }

  get elapsedSeconds() {
    return (this.playedMs + (this.resumedAt ? performance.now() - this.resumedAt : 0)) / 1000;
  }

  private control(op: string, value?: unknown) {
    void this.api.audio.control({ id: this.id, op, value }).catch(() => {});
  }

  setVolume(volume: number) { this.control("volume", Math.max(0, Math.min(1, volume))); }
  setOutput(deviceId: string | null) { this.control("output", deviceId); }

  pause() {
    if (this.paused || !this.settle) return;
    this.paused = true;
    if (this.resumedAt) this.playedMs += performance.now() - this.resumedAt;
    this.resumedAt = 0;
    this.control("pause");
  }

  resume() {
    if (!this.paused || !this.settle) return;
    this.paused = false;
    this.resumedAt = performance.now();
    this.control("resume");
  }

  stop() {
    if (!this.settle) return;
    this.control("stop");
    this.settle("stopped");
  }
}

/** Starts `file` on the output `deviceId` (null: the system default); null when nothing can play. */
export function playAudioFile(file: string, options: { volume: number; deviceId: string | null }): AudioPlayback | null {
  if (process.platform === "darwin") return playOnMac(file, { volume: options.volume, deviceUid: options.deviceId });
  const api = engine();
  if (!api) return null;
  listen();
  return new EnginePlayback(api, file, options);
}

/** Audio inputs and outputs as `MediaDeviceInfo`s, with `default` entries. */
export async function audioDevices(): Promise<AudioDevice[]> {
  if (process.platform === "darwin") return macAudioDevices();
  return (await engine()?.audio.devices().catch(() => null)) ?? [];
}
