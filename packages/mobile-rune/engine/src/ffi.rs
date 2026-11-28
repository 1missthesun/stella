//! The C API the phone app links (`include/stella_mobile_engine.h`).
//!
//! Threads: `sme_push` from any thread (the JS thread); everything else on the main thread,
//! where the `LayerHost` and the engine's thread-local state live. Engine events (the JSON lines
//! the desktop host reads) and native messages (text fields, haptics, ...) come back through
//! the callbacks given to `sme_init`, on the main thread.

#![allow(unsafe_code)]
#![allow(clippy::missing_safety_doc)]

use std::ffi::c_void;
use std::io::Write;
use std::sync::{Arc, Mutex, OnceLock, mpsc};

use rune::embed::LayerHost;
use rune::{TouchPhase, Waker};
use serde_json::json;

use crate::engine;
use crate::protocol::Msg;
use crate::windows::{self, Win};

pub type EventCb = extern "C" fn(ctx: *mut c_void, json: *const u8, len: usize);
pub type WakeCb = extern "C" fn(ctx: *mut c_void);

/// The bridge's sending end and the main window's waker, shared with the JS thread.
struct Bridge {
    tx: Mutex<mpsc::Sender<Msg>>,
    waker: Arc<Mutex<Option<Waker>>>,
}

static BRIDGE: OnceLock<Bridge> = OnceLock::new();

/// Engine → TS lines, handed to the app's event callback one line at a time.
struct LineOut {
    cb: EventCb,
    ctx: usize,
    buf: Vec<u8>,
}

impl Write for LineOut {
    fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
        self.buf.extend_from_slice(b);
        Ok(b.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        while let Some(i) = self.buf.iter().position(|c| *c == b'\n') {
            let line: Vec<u8> = self.buf.drain(..=i).collect();
            (self.cb)(self.ctx as *mut c_void, line.as_ptr(), line.len() - 1);
        }
        Ok(())
    }
}

/// Sets up the engine on the main thread: `events` gets engine → TS JSON lines, `native` the
/// engine's messages for the app. Call once, before `sme_create`.
#[unsafe(no_mangle)]
pub extern "C" fn sme_init(events: EventCb, native: EventCb, ctx: *mut c_void) {
    let (tx, rx) = mpsc::channel();
    let waker: Arc<Mutex<Option<Waker>>> = Arc::new(Mutex::new(None));
    let _ = BRIDGE.set(Bridge { tx: Mutex::new(tx), waker: waker.clone() });
    engine::set_out(Box::new(LineOut { cb: events, ctx: ctx as usize, buf: Vec::new() }));
    crate::native::set_callback(native, ctx);
    engine::with(|e| {
        e.rx = Some(rx);
        e.main_waker = waker;
    });
    crate::metrics::mark_process_start();
}

/// Hands the engine frames from the TS side: one or more `[u32 LE length][ops…]` frames, as
/// the desktop host writes them to its pipe. Any thread; the bytes are copied.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sme_push(bytes: *const u8, len: usize) {
    let Some(b) = BRIDGE.get() else { return };
    if bytes.is_null() || len == 0 {
        return;
    }
    // SAFETY: the caller passes `len` readable bytes.
    let data = unsafe { std::slice::from_raw_parts(bytes, len) };
    let tx = b.tx.lock().unwrap_or_else(|e| e.into_inner()).clone();
    crate::protocol::read_loop(data, tx, b.waker.clone());
}

/// One Metal layer (iOS) or `ANativeWindow` (Android) showing the main window.
pub struct Host {
    host: LayerHost<Win>,
    /// The `ANativeWindow` the host draws into, held (acquired) until its surface is detached.
    #[cfg(target_os = "android")]
    window: *mut c_void,
}

#[repr(C)]
pub struct SmeFrame {
    pub drew: bool,
    pub animating: bool,
    /// Seconds until the engine wants another frame (negative: none scheduled).
    pub wake_after: f64,
    pub cpu_us: u64,
}

/// Attaches the engine to `layer` (a `CAMetalLayer *`) at `w`×`h` points and `scale`.
/// `wake` is called (any thread) whenever the engine wants a frame.
#[cfg(target_vendor = "apple")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sme_create(layer: *mut c_void, w: f32, h: f32, scale: f32, dark: bool, wake: WakeCb, ctx: *mut c_void) -> *mut Host {
    rune::text::set_fallback_base(Some("Helvetica Neue"));
    let ctx = ctx as usize;
    let waker: Waker = Arc::new(move || wake(ctx as *mut c_void));
    let spec = windows::app_spec((w, h));
    let state = Win { main: true, ..Win::default() };
    // SAFETY: the app passes its view's live CAMetalLayer and calls on the main thread.
    let host = unsafe { LayerHost::from_core_animation_layer(layer, &spec, state, (w, h), scale, dark, waker) };
    match host {
        Ok(host) => {
            let host = host.with_compositor(crate::fx::Comp::new(None));
            Box::into_raw(Box::new(Host { host }))
        }
        Err(e) => {
            eprintln!("stella-mobile-engine: no Metal layer host: {e}");
            std::ptr::null_mut()
        }
    }
}

/// Attaches the engine to `window` (an `ANativeWindow *` the caller acquired, e.g. with
/// `ANativeWindow_fromSurface`; the host owns that reference from here on) at `w`×`h` dp and
/// `scale` (the display density). `wake` is called (any thread) whenever the engine wants a frame.
#[cfg(target_os = "android")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sme_create_android(window: *mut c_void, w: f32, h: f32, scale: f32, dark: bool, wake: WakeCb, ctx: *mut c_void) -> *mut Host {
    rune::text::set_fallback_base(Some("Roboto"));
    let ctx = ctx as usize;
    let waker: Waker = Arc::new(move || wake(ctx as *mut c_void));
    let spec = windows::app_spec((w, h));
    let state = Win { main: true, ..Win::default() };
    // SAFETY: the app passes a live, acquired ANativeWindow and calls on the main thread.
    let host = unsafe { LayerHost::from_android_native_window(window, &spec, state, (w, h), scale, dark, waker) };
    match host {
        Ok(host) => {
            let host = host.with_compositor(crate::fx::Comp::new(None));
            Box::into_raw(Box::new(Host { host, window }))
        }
        Err(e) => {
            eprintln!("stella-mobile-engine: no Vulkan surface host: {e}");
            // SAFETY: the reference handed over above.
            unsafe { crate::android::release_window(window) };
            std::ptr::null_mut()
        }
    }
}

/// The view's surface is going away (`surfaceDestroyed`): drops the GPU surface and releases
/// the window before the app returns from that callback. The engine keeps its state.
#[cfg(target_os = "android")]
#[unsafe(no_mangle)]
pub extern "C" fn sme_surface_destroyed(h: *mut Host) {
    if let Some(h) = host(h) {
        h.host.detach_surface();
        if !h.window.is_null() {
            // SAFETY: the reference the host held.
            unsafe { crate::android::release_window(h.window) };
            h.window = std::ptr::null_mut();
        }
    }
}

/// A new surface for the view (`surfaceCreated`/`surfaceChanged` after a destroy): `window` is
/// acquired by the caller and owned by the host from here on.
#[cfg(target_os = "android")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sme_surface_created(h: *mut Host, window: *mut c_void, w: f32, ht: f32, scale: f32) -> bool {
    let Some(h) = host(h) else {
        // SAFETY: the reference handed over.
        unsafe { crate::android::release_window(window) };
        return false;
    };
    h.host.detach_surface();
    if !h.window.is_null() {
        // SAFETY: the reference the host held for its previous surface.
        unsafe { crate::android::release_window(h.window) };
        h.window = std::ptr::null_mut();
    }
    // SAFETY: the app passes a live, acquired ANativeWindow on the main thread.
    match unsafe { h.host.attach_android_native_window(window, (w, ht), scale) } {
        Ok(()) => {
            h.window = window;
            windows::wake_all();
            true
        }
        Err(e) => {
            eprintln!("stella-mobile-engine: new surface refused: {e}");
            // SAFETY: as above.
            unsafe { crate::android::release_window(window) };
            false
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn sme_destroy(h: *mut Host) {
    if !h.is_null() {
        #[cfg(target_os = "android")]
        sme_surface_destroyed(h);
        // SAFETY: made by sme_create.
        drop(unsafe { Box::from_raw(h) });
    }
}

fn host<'a>(h: *mut Host) -> Option<&'a mut Host> {
    // SAFETY: made by sme_create and used on the main thread only.
    unsafe { h.as_mut() }
}

/// Steps layout and motion and presents one frame (the app's display link).
#[unsafe(no_mangle)]
pub extern "C" fn sme_frame(h: *mut Host) -> SmeFrame {
    let Some(h) = host(h) else { return SmeFrame { drew: false, animating: false, wake_after: -1.0, cpu_us: 0 } };
    let f = h.host.frame();
    crate::native::sync();
    crate::view_frames::after_frame();
    let haptics = h.host.take_haptics();
    for hp in haptics {
        crate::native::send(json!({ "t": "haptic", "kind": format!("{hp:?}") }));
    }
    SmeFrame { drew: f.drew, animating: f.animating, wake_after: f.wake_after_secs.unwrap_or(-1.0), cpu_us: f.cpu_us }
}

#[unsafe(no_mangle)]
pub extern "C" fn sme_resize(h: *mut Host, w: f32, ht: f32, scale: f32) {
    if let Some(h) = host(h) {
        h.host.resize((w, ht), scale);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn sme_safe_area(h: *mut Host, top: f32, right: f32, bottom: f32, left: f32) {
    if let Some(h) = host(h) {
        h.host.runtime_mut().set_safe_area([top, right, bottom, left]);
        windows::wake_all();
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn sme_set_dark(h: *mut Host, dark: bool) {
    if let Some(h) = host(h) {
        h.host.runtime_mut().set_system_dark(dark);
        windows::wake_all();
    }
}

/// Where the keyboard is headed (its overlap with the window once it settles, in points; 0
/// hidden). Call as a keyboard move starts; TS hears it.
#[unsafe(no_mangle)]
pub extern "C" fn sme_keyboard(_h: *mut Host, height: f32) {
    windows::set_keyboard(height);
}

/// Where the keyboard is on the frame about to be drawn (points), from the display link right
/// before `sme_frame`; elements with a `keyboard` prop follow it within that frame.
#[unsafe(no_mangle)]
pub extern "C" fn sme_keyboard_frame(_h: *mut Host, height: f32) {
    windows::set_keyboard_live(height);
}

/// A touch: phase 0 began, 1 moved, 2 ended, 3 cancelled; `x`,`y` in points; `time` seconds.
#[unsafe(no_mangle)]
pub extern "C" fn sme_touch(h: *mut Host, id: u64, phase: u32, x: f32, y: f32, time: f64) {
    if let Some(h) = host(h) {
        let phase = match phase {
            0 => TouchPhase::Started,
            1 => TouchPhase::Moved,
            2 => TouchPhase::Ended,
            _ => TouchPhase::Cancelled,
        };
        h.host.runtime_mut().touch(id, phase, x, y, time);
    }
}

/// A native text field's event, as JSON: `{"e":"input","value":…,"start":…,"end":…}`,
/// `{"e":"focus","focused":bool}`, `{"e":"submit"}`, `{"e":"key","key":"Enter",…}`,
/// `{"e":"height","height":pt}`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sme_field_event(node: u32, json: *const u8, len: usize) {
    if json.is_null() {
        return;
    }
    // SAFETY: the caller passes `len` readable bytes.
    let data = unsafe { std::slice::from_raw_parts(json, len) };
    let Ok(v) = serde_json::from_slice::<serde_json::Value>(data) else { return };
    windows::post(Box::new(move |s: &mut Win, tx: &mut rune::Tx| field_event(s, tx, node, v)));
}

fn field_event(s: &mut Win, tx: &mut rune::Tx, n: u32, v: serde_json::Value) {
    let e = v.get("e").and_then(|x| x.as_str()).unwrap_or("");
    match e {
        "input" => {
            let value = v.get("value").and_then(|x| x.as_str()).unwrap_or("").to_owned();
            let sel = match (v.get("start").and_then(|x| x.as_u64()), v.get("end").and_then(|x| x.as_u64())) {
                (Some(a), Some(b)) => Some((a as usize, b as usize)),
                _ => None,
            };
            let st = s.inputs.entry(n).or_insert_with(|| crate::input::InputState::new(""));
            let reported = st.typed(&value, sel);
            crate::swap_view::typed(s.node, n, &reported);
            engine::element_event(n, "input", json!({ "value": reported }), Some(tx));
        }
        "selection" => {
            let (a, b) = (v.get("start").cloned().unwrap_or(json!(0)), v.get("end").cloned().unwrap_or(json!(0)));
            engine::element_event(n, "selection", json!({ "start": a, "end": b }), Some(tx));
        }
        "focus" => {
            let focused = v.get("focused").and_then(|x| x.as_bool()).unwrap_or(false);
            engine::element_event(n, "focus", json!({ "focused": focused, "visible": false }), Some(tx));
        }
        "submit" => {
            let value = s.inputs.get(&n).map(|st| st.edit.text.clone()).unwrap_or_default();
            engine::element_event(n, "submit", json!({ "value": value }), Some(tx));
        }
        "key" => {
            let mut extra = v.clone();
            if let Some(o) = extra.as_object_mut() {
                o.remove("e");
            }
            engine::element_event(n, "key", extra, Some(tx));
        }
        "height" => {
            let h = v.get("height").and_then(|x| x.as_f64()).unwrap_or(0.0) as f32;
            if crate::native::set_height(n, h) {
                engine::with(|e| e.tree.touch(n));
                engine::with(|e| {
                    let d: Vec<u32> = e.tree.dirty.drain().collect();
                    for w in d {
                        if let Some(slot) = e.windows.get_mut(&w) {
                            slot.dirty = true;
                        }
                    }
                });
            }
        }
        _ => {}
    }
}

/// The display accessibility settings that change materials and motion: Reduce Transparency
/// (glass turns solid), Increase Contrast (stronger edges), Reduce Motion.
#[unsafe(no_mangle)]
pub extern "C" fn sme_accessibility(h: *mut Host, reduce_transparency: bool, increase_contrast: bool, reduce_motion: bool) {
    if let Some(h) = host(h) {
        let rt = h.host.runtime_mut();
        rt.set_system_reduced_transparency(reduce_transparency);
        rt.set_system_increased_contrast(increase_contrast);
        rt.set_system_reduced_motion(reduce_motion);
        windows::wake_all();
    }
}
