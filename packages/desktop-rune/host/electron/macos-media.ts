// macOS media facts through CoreAudio and AVFoundation: audio devices in MediaDeviceInfo shape and
// TCC media access status. TCC answers for this process's responsible process (the engine).

import { dlopen, FFIType, ptr, CString } from "bun:ffi";
import { createHash } from "node:crypto";

export type AudioDevice = { deviceId: string; kind: "audioinput" | "audiooutput"; label: string; groupId: string };
export type MediaAccessStatus = "not-determined" | "granted" | "denied" | "restricted" | "unknown";

const fourcc = (code: string) => (code.charCodeAt(0) << 24 | code.charCodeAt(1) << 16 | code.charCodeAt(2) << 8 | code.charCodeAt(3)) >>> 0;
const SYSTEM_OBJECT = 1;
const UTF8 = 0x08000100;

type Native = ReturnType<typeof load>;
let native: Native | null | undefined;

function load() {
  const coreAudio = dlopen("/System/Library/Frameworks/CoreAudio.framework/CoreAudio", {
    AudioObjectGetPropertyDataSize: { args: [FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    AudioObjectGetPropertyData: { args: [FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  }).symbols;
  const coreFoundation = dlopen("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation", {
    CFStringGetCString: { args: [FFIType.u64, FFIType.ptr, FFIType.i64, FFIType.u32], returns: FFIType.bool },
    CFRelease: { args: [FFIType.u64], returns: FFIType.void },
  }).symbols;
  const system = dlopen("/usr/lib/libSystem.B.dylib", {
    dlopen: { args: [FFIType.cstring, FFIType.i32], returns: FFIType.ptr },
  }).symbols;
  system.dlopen(cstr("/System/Library/Frameworks/AVFoundation.framework/AVFoundation"), 1);
  system.dlopen(cstr("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics"), 1);
  const objc = dlopen("/usr/lib/libobjc.A.dylib", {
    objc_getClass: { args: [FFIType.cstring], returns: FFIType.u64 },
    sel_registerName: { args: [FFIType.cstring], returns: FFIType.u64 },
    objc_msgSend: { args: [FFIType.u64, FFIType.u64, FFIType.u64], returns: FFIType.u64 },
  }).symbols;
  const graphics = dlopen("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics", {
    CGPreflightScreenCaptureAccess: { args: [], returns: FFIType.bool },
  }).symbols;
  return { coreAudio, coreFoundation, objc, graphics };
}

const cstr = (text: string) => ptr(Buffer.from(`${text}\0`, "utf8"));

function getNative(): Native | null {
  if (native !== undefined) return native;
  try { native = process.platform === "darwin" ? load() : null; } catch { native = null; }
  return native;
}

function property(n: Native, object: number, selector: string, scope = "glob"): Uint8Array | null {
  const address = new Uint32Array([fourcc(selector), fourcc(scope), 0]);
  const size = new Uint32Array(1);
  if (n.coreAudio.AudioObjectGetPropertyDataSize(object, ptr(address), 0, null, ptr(size)) !== 0 || size[0] === 0) return null;
  const data = new Uint8Array(size[0]!);
  if (n.coreAudio.AudioObjectGetPropertyData(object, ptr(address), 0, null, ptr(size), ptr(data)) !== 0) return null;
  return data.subarray(0, size[0]!);
}

function stringProperty(n: Native, object: number, selector: string): string {
  const data = property(n, object, selector);
  if (!data || data.byteLength < 8) return "";
  const ref = new DataView(data.buffer, data.byteOffset).getBigUint64(0, true);
  if (!ref) return "";
  const out = new Uint8Array(1024);
  const ok = n.coreFoundation.CFStringGetCString(ref, ptr(out), out.byteLength, UTF8);
  n.coreFoundation.CFRelease(ref);
  return ok ? new CString(ptr(out)).toString() : "";
}

function deviceProperty(n: Native, selector: string): number {
  const data = property(n, SYSTEM_OBJECT, selector);
  return data && data.byteLength >= 4 ? new DataView(data.buffer, data.byteOffset).getUint32(0, true) : 0;
}

function channels(n: Native, device: number, scope: "inpt" | "outp"): number {
  const data = property(n, device, "slay", scope);
  if (!data || data.byteLength < 4) return 0;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let total = 0;
  for (let i = 0, count = view.getUint32(0, true); i < count && 8 + 16 * i + 4 <= data.byteLength; i++) total += view.getUint32(8 + 16 * i, true);
  return total;
}

const groupOf = (uid: string) => createHash("sha256").update(`stella-audio-group:${uid}`).digest("hex").slice(0, 32);

export function audioDevices(): AudioDevice[] {
  const n = getNative();
  if (!n) return [];
  const list = property(n, SYSTEM_OBJECT, "dev#");
  if (!list) return [];
  const ids = Array.from(new Uint32Array(list.buffer, list.byteOffset, list.byteLength / 4));
  const devices = ids.map((id) => ({
    id,
    uid: stringProperty(n, id, "uid "),
    name: stringProperty(n, id, "lnam"),
    inputs: channels(n, id, "inpt"),
    outputs: channels(n, id, "outp"),
  })).filter((d) => d.uid);
  const out: AudioDevice[] = [];
  for (const [kind, scope, defaultSelector] of [["audioinput", "inputs", "dIn "], ["audiooutput", "outputs", "dOut"]] as const) {
    const usable = devices.filter((d) => d[scope] > 0);
    const fallback = deviceProperty(n, defaultSelector);
    const preferred = usable.find((d) => d.id === fallback);
    if (preferred) out.push({ deviceId: "default", kind, label: `Default - ${preferred.name}`, groupId: groupOf(preferred.uid) });
    for (const d of usable) out.push({ deviceId: d.uid, kind, label: d.name, groupId: groupOf(d.uid) });
  }
  return out;
}

const AV_STATUS: Record<number, MediaAccessStatus> = { 0: "not-determined", 1: "restricted", 2: "denied", 3: "granted" };

export function mediaAccessStatus(type: string): MediaAccessStatus {
  const n = getNative();
  if (!n) return "granted";
  if (type === "screen") return n.graphics.CGPreflightScreenCaptureAccess() ? "granted" : "denied";
  const mediaType = type === "microphone" ? "soun" : type === "camera" ? "vide" : null;
  if (!mediaType) return "unknown";
  const NSString = n.objc.objc_getClass(cstr("NSString"));
  const device = n.objc.objc_getClass(cstr("AVCaptureDevice"));
  if (!NSString || !device) return "unknown";
  const name = BigInt(n.objc.objc_msgSend(NSString, n.objc.sel_registerName(cstr("stringWithUTF8String:")), BigInt(cstr(mediaType))));
  const status = Number(n.objc.objc_msgSend(device, n.objc.sel_registerName(cstr("authorizationStatusForMediaType:")), name));
  return AV_STATUS[status] ?? "unknown";
}

