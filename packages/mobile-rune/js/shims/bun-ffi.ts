// `bun:ffi` and other `bun:` modules: desktop-only native helpers, absent on the phone.
const unavailable = () => { throw new Error("bun: modules are not available on the phone"); };
export const dlopen = unavailable;
export const ptr = unavailable;
export const toArrayBuffer = unavailable;
export const CString = class {};
export const JSCallback = class { constructor() { unavailable(); } };
export const FFIType = new Proxy({}, { get: () => 0 });
export const suffix = "dylib";
export const generateHeapSnapshotForDebugging = unavailable;
export default { dlopen, ptr, toArrayBuffer, CString, JSCallback, FFIType, suffix };
