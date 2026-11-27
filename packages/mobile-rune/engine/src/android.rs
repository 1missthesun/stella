//! The Android app's JNI surface over the C API (`ffi.rs`): `com.stella.rune.Engine`'s native
//! methods, one per `sme_*` function, plus the `ANativeWindow` a `SurfaceView` hands over and
//! the engine's stderr routed to logcat (`adb logcat -s stella-engine`).
//!
//! Threads are as in `ffi.rs`: `nativePush` from the JS thread, everything else on the main
//! (UI) thread. The callbacks object's `event([B)`, `nativeMessage([B)` and `wake()` are called
//! on the main thread (`wake` from any thread).

#![allow(unsafe_code)]

use std::ffi::{CString, c_char, c_void};
use std::sync::OnceLock;

use jni::JNIEnv;
use jni::JavaVM;
use jni::objects::{GlobalRef, JByteArray, JByteBuffer, JClass, JDoubleArray, JObject, JValue};
use jni::sys::{jboolean, jdouble, jfloat, jint, jlong};

use crate::ffi::{self, Host};

#[link(name = "android")]
unsafe extern "C" {
    fn ANativeWindow_fromSurface(env: *mut jni::sys::JNIEnv, surface: jni::sys::jobject) -> *mut c_void;
    fn ANativeWindow_release(window: *mut c_void);
}

#[link(name = "log")]
unsafe extern "C" {
    fn __android_log_write(prio: i32, tag: *const c_char, text: *const c_char) -> i32;
}

/// Releases a window reference taken with `ANativeWindow_fromSurface`.
///
/// # Safety
/// `window` must be null or a reference the caller owns.
pub(crate) unsafe fn release_window(window: *mut c_void) {
    if !window.is_null() {
        // SAFETY: per the contract above.
        unsafe { ANativeWindow_release(window) };
    }
}

static JVM: OnceLock<JavaVM> = OnceLock::new();
static CALLBACKS: OnceLock<GlobalRef> = OnceLock::new();

fn call(method: &str, sig: &str, bytes: Option<&[u8]>) {
    let (Some(vm), Some(cb)) = (JVM.get(), CALLBACKS.get()) else { return };
    let Ok(mut env) = vm.attach_current_thread_permanently() else { return };
    match bytes {
        Some(b) => {
            let Ok(arr) = env.byte_array_from_slice(b) else { return };
            let _ = env.call_method(cb.as_obj(), method, sig, &[JValue::Object(&arr)]);
            let _ = env.delete_local_ref(arr);
        }
        None => {
            let _ = env.call_method(cb.as_obj(), method, sig, &[]);
        }
    }
    if env.exception_check().unwrap_or(false) {
        let _ = env.exception_describe();
        let _ = env.exception_clear();
    }
}

extern "C" fn on_event(_ctx: *mut c_void, json: *const u8, len: usize) {
    // SAFETY: the engine passes `len` readable bytes.
    call("event", "([B)V", Some(unsafe { std::slice::from_raw_parts(json, len) }));
}

extern "C" fn on_native(_ctx: *mut c_void, json: *const u8, len: usize) {
    // SAFETY: the engine passes `len` readable bytes.
    call("nativeMessage", "([B)V", Some(unsafe { std::slice::from_raw_parts(json, len) }));
}

extern "C" fn on_wake(_ctx: *mut c_void) {
    call("wake", "()V", None);
}

/// The engine reports on stderr (`eprintln!`), which Android drops: a pipe carries it to logcat.
fn stderr_to_logcat() {
    static STARTED: OnceLock<()> = OnceLock::new();
    STARTED.get_or_init(|| {
        let mut fds = [0i32; 2];
        // SAFETY: plain POSIX calls on fds this process owns.
        unsafe {
            if libc::pipe(fds.as_mut_ptr()) != 0 {
                return;
            }
            libc::dup2(fds[1], 1);
            libc::dup2(fds[1], 2);
            libc::close(fds[1]);
        }
        let read_fd = fds[0];
        let _ = std::thread::Builder::new().name("stella-engine-log".into()).spawn(move || {
            use std::io::{BufRead, BufReader};
            use std::os::fd::FromRawFd;
            // SAFETY: the read end is ours alone from here on.
            let file = unsafe { std::fs::File::from_raw_fd(read_fd) };
            let tag = c"stella-engine";
            for line in BufReader::new(file).lines() {
                let Ok(line) = line else { break };
                if let Ok(text) = CString::new(line) {
                    // SAFETY: both strings are NUL-terminated and live for the call.
                    unsafe { __android_log_write(4, tag.as_ptr(), text.as_ptr()) };
                }
            }
        });
    });
}

fn host(h: jlong) -> *mut Host {
    h as usize as *mut Host
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_stella_rune_Engine_nativeInit(env: JNIEnv, _class: JClass, callbacks: JObject) {
    stderr_to_logcat();
    if let Ok(vm) = env.get_java_vm() {
        let _ = JVM.set(vm);
    }
    if let Ok(g) = env.new_global_ref(callbacks) {
        let _ = CALLBACKS.set(g);
    }
    ffi::sme_init(on_event, on_native, std::ptr::null_mut());
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_stella_rune_Engine_nativePush(env: JNIEnv, _class: JClass, frame: JByteArray, len: jint) {
    // Copied out first: pushing wakes the view through JNI, which a critical array section forbids.
    let Ok(mut bytes) = env.convert_byte_array(&frame) else { return };
    bytes.truncate(len.max(0) as usize);
    if bytes.is_empty() {
        return;
    }
    // SAFETY: `bytes` is a live buffer of its length.
    unsafe { ffi::sme_push(bytes.as_ptr(), bytes.len()) };
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_stella_rune_Engine_nativePushDirect(env: JNIEnv, _class: JClass, buffer: JByteBuffer, offset: jint, len: jint) {
    let (Ok(ptr), Ok(cap)) = (env.get_direct_buffer_address(&buffer), env.get_direct_buffer_capacity(&buffer)) else { return };
    let (off, len) = (offset.max(0) as usize, len.max(0) as usize);
    if ptr.is_null() || len == 0 || off.saturating_add(len) > cap {
        return;
    }
    // SAFETY: `off + len` lies within the live direct buffer; sme_push copies before returning.
    unsafe { ffi::sme_push(ptr.add(off), len) };
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_stella_rune_Engine_nativeCreate(
    env: JNIEnv,
    _class: JClass,
    surface: JObject,
    w: jfloat,
    h: jfloat,
    scale: jfloat,
    dark: jboolean,
) -> jlong {
    // SAFETY: `surface` is a live android.view.Surface; the reference returned is ours.
    let window = unsafe { ANativeWindow_fromSurface(env.get_raw(), surface.as_raw()) };
    if window.is_null() {
        eprintln!("stella-mobile-engine: the Surface has no ANativeWindow");
        return 0;
    }
    // SAFETY: the window reference passes to the host.
    let h = unsafe { ffi::sme_create_android(window, w, h, scale, dark != 0, on_wake, std::ptr::null_mut()) };
    h as usize as jlong
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_stella_rune_Engine_nativeSurfaceCreated(
    env: JNIEnv,
    _class: JClass,
    h: jlong,
    surface: JObject,
    w: jfloat,
    ht: jfloat,
    scale: jfloat,
) -> jboolean {
    // SAFETY: as in nativeCreate.
    let window = unsafe { ANativeWindow_fromSurface(env.get_raw(), surface.as_raw()) };
    if window.is_null() {
        return 0;
    }
    // SAFETY: the window reference passes to the host.
    unsafe { ffi::sme_surface_created(host(h), window, w, ht, scale) as jboolean }
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_stella_rune_Engine_nativeSurfaceDestroyed(_env: JNIEnv, _class: JClass, h: jlong) {
    ffi::sme_surface_destroyed(host(h));
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_stella_rune_Engine_nativeDestroy(_env: JNIEnv, _class: JClass, h: jlong) {
    // SAFETY: made by nativeCreate.
    unsafe { ffi::sme_destroy(host(h)) };
}

/// One frame; `out` gets `[drew, animating, wake_after (s, negative: none), cpu_us]`.
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_stella_rune_Engine_nativeFrame(env: JNIEnv, _class: JClass, h: jlong, out: JDoubleArray) {
    let f = ffi::sme_frame(host(h));
    let v = [f.drew as u8 as f64, f.animating as u8 as f64, f.wake_after, f.cpu_us as f64];
    let _ = env.set_double_array_region(&out, 0, &v);
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_stella_rune_Engine_nativeResize(_env: JNIEnv, _class: JClass, h: jlong, w: jfloat, ht: jfloat, scale: jfloat) {
    ffi::sme_resize(host(h), w, ht, scale);
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_stella_rune_Engine_nativeSafeArea(
    _env: JNIEnv,
    _class: JClass,
    h: jlong,
    top: jfloat,
    right: jfloat,
    bottom: jfloat,
    left: jfloat,
) {
    ffi::sme_safe_area(host(h), top, right, bottom, left);
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_stella_rune_Engine_nativeSetDark(_env: JNIEnv, _class: JClass, h: jlong, dark: jboolean) {
    ffi::sme_set_dark(host(h), dark != 0);
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_stella_rune_Engine_nativeKeyboard(_env: JNIEnv, _class: JClass, h: jlong, height: jfloat) {
    ffi::sme_keyboard(host(h), height);
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_stella_rune_Engine_nativeAccessibility(
    _env: JNIEnv,
    _class: JClass,
    h: jlong,
    reduce_transparency: jboolean,
    increase_contrast: jboolean,
    reduce_motion: jboolean,
) {
    ffi::sme_accessibility(host(h), reduce_transparency != 0, increase_contrast != 0, reduce_motion != 0);
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_stella_rune_Engine_nativeTouch(
    _env: JNIEnv,
    _class: JClass,
    h: jlong,
    id: jlong,
    phase: jint,
    x: jfloat,
    y: jfloat,
    time: jdouble,
) {
    ffi::sme_touch(host(h), id as u64, phase as u32, x, y, time);
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_stella_rune_Engine_nativeFieldEvent(env: JNIEnv, _class: JClass, node: jint, json: JByteArray) {
    let Ok(bytes) = env.convert_byte_array(&json) else { return };
    // SAFETY: `bytes` is a live buffer of its length.
    unsafe { ffi::sme_field_event(node as u32, bytes.as_ptr(), bytes.len()) };
}

/// winit's NativeActivity glue (linked in through Rune) names this entry; the app has its own
/// Activity, so it never runs.
#[unsafe(no_mangle)]
pub extern "Rust" fn android_main(_app: winit::platform::android::activity::AndroidApp) {}
