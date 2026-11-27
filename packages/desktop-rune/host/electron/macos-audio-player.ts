// Audio file playback on macOS through AVPlayer, which can play to a chosen CoreAudio output (by
// device UID). AVPlayer reports through the main run loop, which Bun does not run, so the loop is
// pumped while anything is playing.

import { dlopen, FFIType, ptr } from "bun:ffi";

const OBJC = "/usr/lib/libobjc.A.dylib";
const PUMP_MS = 30;
const START_TIMEOUT_MS = 10_000;
const STATUS_FAILED = 2;
const READ_PERMISSION = 1;
const ESTIMATED_DURATION = 0x65647572;

type Objc = ReturnType<typeof load>;
let objc: Objc | null | undefined;

function load() {
  const system = dlopen("/usr/lib/libSystem.B.dylib", { dlopen: { args: [FFIType.cstring, FFIType.i32], returns: FFIType.ptr } }).symbols;
  system.dlopen(cstr("/System/Library/Frameworks/AVFoundation.framework/AVFoundation"), 1);
  const runtime = dlopen(OBJC, {
    objc_getClass: { args: [FFIType.cstring], returns: FFIType.u64 },
    sel_registerName: { args: [FFIType.cstring], returns: FFIType.u64 },
  }).symbols;
  const send0 = dlopen(OBJC, { objc_msgSend: { args: [FFIType.u64, FFIType.u64], returns: FFIType.u64 } }).symbols.objc_msgSend;
  const send1 = dlopen(OBJC, { objc_msgSend: { args: [FFIType.u64, FFIType.u64, FFIType.u64], returns: FFIType.u64 } }).symbols.objc_msgSend;
  const sendFloat = dlopen(OBJC, { objc_msgSend: { args: [FFIType.u64, FFIType.u64, FFIType.f32], returns: FFIType.void } }).symbols.objc_msgSend;
  const readFloat = dlopen(OBJC, { objc_msgSend: { args: [FFIType.u64, FFIType.u64], returns: FFIType.f32 } }).symbols.objc_msgSend;
  const audioFile = dlopen("/System/Library/Frameworks/AudioToolbox.framework/AudioToolbox", {
    AudioFileOpenURL: { args: [FFIType.u64, FFIType.i8, FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
    AudioFileGetProperty: { args: [FFIType.u64, FFIType.u32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    AudioFileClose: { args: [FFIType.u64], returns: FFIType.i32 },
  }).symbols;
  const runLoop = dlopen("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation", {
    CFRunLoopRunInMode: { args: [FFIType.u64, FFIType.f64, FFIType.bool], returns: FFIType.i32 },
  }).symbols;
  const selectors = new Map<string, bigint>();
  const sel = (name: string) => {
    let s = selectors.get(name);
    if (s === undefined) selectors.set(name, (s = BigInt(runtime.sel_registerName(cstr(name)))));
    return s;
  };
  const cls = (name: string) => BigInt(runtime.objc_getClass(cstr(name)));
  const call0 = (target: bigint, name: string) => BigInt(send0(target, sel(name)));
  const call1 = (target: bigint, name: string, arg: bigint) => BigInt(send1(target, sel(name), arg));
  const string = (text: string) => call1(cls("NSString"), "stringWithUTF8String:", BigInt(cstr(text)));
  const defaultMode = string("kCFRunLoopDefaultMode");
  call0(defaultMode, "retain");
  return {
    cls, call0, call1, string,
    setFloat: (target: bigint, name: string, value: number) => sendFloat(target, sel(name), value),
    getFloat: (target: bigint, name: string) => readFloat(target, sel(name)),
    pump: () => runLoop.CFRunLoopRunInMode(defaultMode, 0, true),
    fileSeconds: (url: bigint) => {
      const id = new BigUint64Array(1);
      if (audioFile.AudioFileOpenURL(url, READ_PERMISSION, 0, ptr(id)) !== 0) return 0;
      try {
        const seconds = new Float64Array(1);
        const size = new Uint32Array([8]);
        return audioFile.AudioFileGetProperty(id[0]!, ESTIMATED_DURATION, ptr(size), ptr(seconds)) === 0 ? seconds[0]! : 0;
      } finally {
        audioFile.AudioFileClose(id[0]!);
      }
    },
  };
}

const cstr = (text: string) => ptr(Buffer.from(`${text}\0`, "utf8"));

function getObjc(): Objc | null {
  if (objc !== undefined) return objc;
  try { objc = process.platform === "darwin" ? load() : null; } catch { objc = null; }
  return objc;
}

const active = new Set<NativeAudioPlayback>();
let pumpTimer: ReturnType<typeof setInterval> | null = null;

function pumpWhilePlaying() {
  if (pumpTimer) return;
  pumpTimer = setInterval(() => {
    getObjc()?.pump();
    for (const playback of active) playback.poll();
    if (active.size === 0 && pumpTimer) { clearInterval(pumpTimer); pumpTimer = null; }
  }, PUMP_MS);
}

export type PlaybackEnd = "ended" | "failed" | "stopped";

export class NativeAudioPlayback {
  private started = false;
  private pausedByUser = false;
  private settledEnd: ((end: PlaybackEnd) => void) | null = null;
  private settledStart: ((ok: boolean) => void) | null = null;
  private readonly openedAt = performance.now();
  private playedMs = 0;
  private resumedAt = 0;
  private endSignalled = false;
  readonly finished: Promise<PlaybackEnd>;
  readonly playing: Promise<boolean>;

  constructor(private readonly o: Objc, private player: bigint | null, private readonly duration: number) {
    this.finished = new Promise((resolve) => { this.settledEnd = resolve; });
    this.playing = new Promise((resolve) => { this.settledStart = resolve; });
  }

  get elapsedSeconds() {
    return (this.playedMs + (this.resumedAt ? performance.now() - this.resumedAt : 0)) / 1000;
  }

  setVolume(volume: number) { if (this.player) this.o.setFloat(this.player, "setVolume:", Math.max(0, Math.min(1, volume))); }

  setOutput(deviceUid: string | null) {
    if (this.player) this.o.call1(this.player, "setAudioOutputDeviceUniqueID:", deviceUid ? this.o.string(deviceUid) : 0n);
  }

  pause() {
    if (!this.player || this.pausedByUser) return;
    this.pausedByUser = true;
    this.o.call0(this.player, "pause");
    if (this.resumedAt) this.playedMs += performance.now() - this.resumedAt;
    this.resumedAt = 0;
  }

  resume() {
    if (!this.player || !this.pausedByUser) return;
    this.pausedByUser = false;
    this.o.call0(this.player, "play");
    if (this.started) this.resumedAt = performance.now();
  }

  stop() { this.finish("stopped"); }

  poll() {
    const player = this.player;
    if (!player) return;
    const item = this.o.call0(player, "currentItem");
    if (item && Number(this.o.call0(item, "status")) === STATUS_FAILED) return this.finish("failed");
    const rate = this.o.getFloat(player, "rate");
    if (!this.started) {
      if (rate > 0) {
        this.started = true;
        this.resumedAt = performance.now();
        this.settledStart?.(true);
      } else if (performance.now() - this.openedAt > START_TIMEOUT_MS) {
        this.finish("failed");
      }
      return;
    }
    if (rate === 0 && !this.pausedByUser) return this.finish("ended");
    if (!this.endSignalled && this.duration > 0 && this.elapsedSeconds >= this.duration) {
      this.endSignalled = true;
      this.settledEnd?.("ended");
    }
  }

  private finish(end: PlaybackEnd) {
    const player = this.player;
    if (!player) return;
    this.player = null;
    active.delete(this);
    this.o.call0(player, "pause");
    this.o.call0(player, "release");
    if (this.resumedAt) this.playedMs += performance.now() - this.resumedAt;
    this.resumedAt = 0;
    this.settledStart?.(end !== "failed" && this.started);
    this.settledEnd?.(end);
  }
}

/** Starts `filePath` on the output with `deviceUid` (null: the system default), or null off macOS. */
export function playAudioFile(filePath: string, options: { volume: number; deviceUid: string | null }): NativeAudioPlayback | null {
  const o = getObjc();
  if (!o) return null;
  const url = o.call1(o.cls("NSURL"), "fileURLWithPath:", o.string(filePath));
  const player = o.call1(o.call0(o.cls("AVPlayer"), "alloc"), "initWithURL:", url);
  if (!player) return null;
  const playback = new NativeAudioPlayback(o, player, o.fileSeconds(url));
  playback.setOutput(options.deviceUid);
  playback.setVolume(options.volume);
  o.call0(player, "play");
  active.add(playback);
  pumpWhilePlaying();
  return playback;
}
