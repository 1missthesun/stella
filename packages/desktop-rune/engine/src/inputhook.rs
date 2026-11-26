//! Global input listening behind the host's `uiohook-napi` module (Show Stella's input timeline
//! and ink, the dictation Option-tap).
//!
//! - `inputhook.start`: starts listening; fails when the OS refuses (macOS without Input
//!   Monitoring / Accessibility, or a platform without a hook).
//! - `inputhook.stop`: stops it.
//!
//! Each event is `{t:"inputhook", type, x, y, button, clicks, keycode, rawcode, rotation,
//! direction, amount, shiftKey, ctrlKey, altKey, metaKey, time}` in uiohook's shape: global
//! top-left points, buttons 1 left / 2 right / 3 middle, libuiohook `VC_*` key codes, wheel
//! direction 3 vertical / 4 horizontal.

use serde_json::Value;

pub fn command(cmd: &str, rid: Option<u64>, v: &Value) {
    let _ = v;
    #[cfg(target_os = "macos")]
    match cmd {
        "inputhook.start" => mac::start(rid),
        "inputhook.stop" => mac::stop(rid),
        _ => crate::engine::reply(rid, Err(format!("{cmd}: unknown input hook command"))),
    }
    #[cfg(not(target_os = "macos"))]
    crate::engine::reply(rid, Err(format!("{cmd}: global input listening is not available on this platform")));
}

#[cfg(target_os = "macos")]
mod mac {
    use serde_json::json;
    use std::ffi::c_void;
    use std::ptr::null_mut;
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicPtr, Ordering};

    type CFRef = *mut c_void;
    type TapCallback = extern "C" fn(proxy: CFRef, kind: u32, event: CFRef, user: *mut c_void) -> CFRef;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGPoint {
        x: f64,
        y: f64,
    }

    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn CGEventTapCreate(tap: u32, place: u32, options: u32, mask: u64, callback: TapCallback, user: *mut c_void) -> CFRef;
        fn CGEventTapEnable(tap: CFRef, enable: bool);
        fn CGEventGetLocation(event: CFRef) -> CGPoint;
        fn CGEventGetIntegerValueField(event: CFRef, field: u32) -> i64;
        fn CGEventGetFlags(event: CFRef) -> u64;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        static kCFRunLoopCommonModes: CFRef;
        fn CFMachPortCreateRunLoopSource(allocator: CFRef, port: CFRef, order: isize) -> CFRef;
        fn CFMachPortInvalidate(port: CFRef);
        fn CFRunLoopGetCurrent() -> CFRef;
        fn CFRunLoopAddSource(rl: CFRef, source: CFRef, mode: CFRef);
        fn CFRunLoopRun();
        fn CFRunLoopStop(rl: CFRef);
        fn CFRelease(cf: CFRef);
    }

    const SESSION_TAP: u32 = 1;
    const HEAD_INSERT: u32 = 0;
    const LISTEN_ONLY: u32 = 1;

    const LEFT_DOWN: u32 = 1;
    const LEFT_UP: u32 = 2;
    const RIGHT_DOWN: u32 = 3;
    const RIGHT_UP: u32 = 4;
    const MOVED: u32 = 5;
    const LEFT_DRAGGED: u32 = 6;
    const RIGHT_DRAGGED: u32 = 7;
    const KEY_DOWN: u32 = 10;
    const KEY_UP: u32 = 11;
    const FLAGS_CHANGED: u32 = 12;
    const SCROLL: u32 = 22;
    const OTHER_DOWN: u32 = 25;
    const OTHER_UP: u32 = 26;
    const OTHER_DRAGGED: u32 = 27;
    const TAP_DISABLED_BY_TIMEOUT: u32 = 0xFFFF_FFFE;
    const TAP_DISABLED_BY_USER_INPUT: u32 = 0xFFFF_FFFF;

    const FIELD_CLICK_STATE: u32 = 1;
    const FIELD_BUTTON_NUMBER: u32 = 3;
    const FIELD_KEYCODE: u32 = 9;
    const FIELD_SCROLL_AXIS1: u32 = 11;
    const FIELD_SCROLL_AXIS2: u32 = 12;

    const FLAG_SHIFT: u64 = 0x0002_0000;
    const FLAG_CTRL: u64 = 0x0004_0000;
    const FLAG_ALT: u64 = 0x0008_0000;
    const FLAG_CMD: u64 = 0x0010_0000;

    struct Tap {
        run_loop: usize,
        port: usize,
    }

    static TAP: Mutex<Option<Tap>> = Mutex::new(None);
    static PORT: AtomicPtr<c_void> = AtomicPtr::new(null_mut());

    fn mask(kinds: &[u32]) -> u64 {
        kinds.iter().fold(0, |m, k| m | (1u64 << k))
    }

    pub fn start(rid: Option<u64>) {
        if TAP.lock().unwrap().is_some() {
            return crate::engine::reply(rid, Ok(json!({ "started": true })));
        }
        std::thread::Builder::new()
            .name("inputhook".into())
            .spawn(move || unsafe {
                let events = mask(&[
                    LEFT_DOWN, LEFT_UP, RIGHT_DOWN, RIGHT_UP, MOVED, LEFT_DRAGGED, RIGHT_DRAGGED, KEY_DOWN, KEY_UP,
                    FLAGS_CHANGED, SCROLL, OTHER_DOWN, OTHER_UP, OTHER_DRAGGED,
                ]);
                let port = CGEventTapCreate(SESSION_TAP, HEAD_INSERT, LISTEN_ONLY, events, callback, null_mut());
                if port.is_null() {
                    return crate::engine::reply_any_thread(
                        rid,
                        Err("the system refused to listen to input (Input Monitoring is not allowed)".into()),
                    );
                }
                let source = CFMachPortCreateRunLoopSource(null_mut(), port, 0);
                let run_loop = CFRunLoopGetCurrent();
                CFRunLoopAddSource(run_loop, source, kCFRunLoopCommonModes);
                CGEventTapEnable(port, true);
                PORT.store(port, Ordering::SeqCst);
                *TAP.lock().unwrap() = Some(Tap { run_loop: run_loop as usize, port: port as usize });
                crate::engine::reply_any_thread(rid, Ok(json!({ "started": true })));
                CFRunLoopRun();
                PORT.store(null_mut(), Ordering::SeqCst);
                CFMachPortInvalidate(port);
                CFRelease(source);
                CFRelease(port);
            })
            .map(|_| ())
            .unwrap_or_else(|e| crate::engine::reply(rid, Err(format!("inputhook thread: {e}"))));
    }

    pub fn stop(rid: Option<u64>) {
        if let Some(tap) = TAP.lock().unwrap().take() {
            unsafe {
                CGEventTapEnable(tap.port as CFRef, false);
                CFRunLoopStop(tap.run_loop as CFRef);
            }
        }
        crate::engine::reply(rid, Ok(json!({ "stopped": true })));
    }

    extern "C" fn callback(_proxy: CFRef, kind: u32, event: CFRef, _user: *mut c_void) -> CFRef {
        if kind == TAP_DISABLED_BY_TIMEOUT || kind == TAP_DISABLED_BY_USER_INPUT {
            let port = PORT.load(Ordering::SeqCst);
            if !port.is_null() {
                unsafe { CGEventTapEnable(port, true) };
            }
            return event;
        }
        if let Some(payload) = unsafe { describe(kind, event) } {
            crate::windows::send_any_thread(payload);
        }
        event
    }

    unsafe fn describe(kind: u32, event: CFRef) -> Option<serde_json::Value> {
        let at = unsafe { CGEventGetLocation(event) };
        let flags = unsafe { CGEventGetFlags(event) };
        let field = |f: u32| unsafe { CGEventGetIntegerValueField(event, f) };
        let time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let mut out = json!({
            "t": "inputhook",
            "x": at.x,
            "y": at.y,
            "time": time,
            "shiftKey": flags & FLAG_SHIFT != 0,
            "ctrlKey": flags & FLAG_CTRL != 0,
            "altKey": flags & FLAG_ALT != 0,
            "metaKey": flags & FLAG_CMD != 0,
        });
        let button = || match kind {
            LEFT_DOWN | LEFT_UP | LEFT_DRAGGED => 1,
            RIGHT_DOWN | RIGHT_UP | RIGHT_DRAGGED => 2,
            _ => field(FIELD_BUTTON_NUMBER) + 1,
        };
        let o = out.as_object_mut()?;
        match kind {
            MOVED | LEFT_DRAGGED | RIGHT_DRAGGED | OTHER_DRAGGED => {
                o.insert("type".into(), "mousemove".into());
                o.insert("button".into(), if kind == MOVED { 0 } else { button() }.into());
            }
            LEFT_DOWN | RIGHT_DOWN | OTHER_DOWN | LEFT_UP | RIGHT_UP | OTHER_UP => {
                let down = matches!(kind, LEFT_DOWN | RIGHT_DOWN | OTHER_DOWN);
                o.insert("type".into(), if down { "mousedown" } else { "mouseup" }.into());
                o.insert("button".into(), button().into());
                o.insert("clicks".into(), field(FIELD_CLICK_STATE).into());
            }
            SCROLL => {
                let vertical = field(FIELD_SCROLL_AXIS1);
                let horizontal = field(FIELD_SCROLL_AXIS2);
                let (direction, delta) = if vertical == 0 && horizontal != 0 { (4, horizontal) } else { (3, vertical) };
                if delta == 0 {
                    return None;
                }
                o.insert("type".into(), "wheel".into());
                o.insert("direction".into(), direction.into());
                o.insert("rotation".into(), (-delta).into());
                o.insert("amount".into(), 1.into());
            }
            KEY_DOWN | KEY_UP => {
                let raw = field(FIELD_KEYCODE);
                o.insert("type".into(), if kind == KEY_DOWN { "keydown" } else { "keyup" }.into());
                o.insert("rawcode".into(), raw.into());
                o.insert("keycode".into(), vc(raw).into());
            }
            FLAGS_CHANGED => {
                let raw = field(FIELD_KEYCODE);
                let down = modifier_down(raw, flags)?;
                o.insert("type".into(), if down { "keydown" } else { "keyup" }.into());
                o.insert("rawcode".into(), raw.into());
                o.insert("keycode".into(), vc(raw).into());
            }
            _ => return None,
        }
        Some(out)
    }

    /// Whether a modifier's flags-changed event pressed it, from the device-dependent bits
    /// (`NX_DEVICE*KEYMASK`), which tell left from right.
    fn modifier_down(raw: i64, flags: u64) -> Option<bool> {
        let bit: u64 = match raw {
            0x38 => 0x02,
            0x3C => 0x04,
            0x3B => 0x01,
            0x3E => 0x2000,
            0x3A => 0x20,
            0x3D => 0x40,
            0x37 => 0x08,
            0x36 => 0x10,
            0x39 => return Some(flags & 0x0001_0000 != 0),
            _ => return None,
        };
        Some(flags & bit != 0)
    }

    /// macOS virtual key codes (`kVK_*`) to libuiohook's `VC_*` codes.
    fn vc(raw: i64) -> i64 {
        match raw {
            0x00 => 30, 0x01 => 31, 0x02 => 32, 0x03 => 33, 0x04 => 35, 0x05 => 34, 0x06 => 44, 0x07 => 45,
            0x08 => 46, 0x09 => 47, 0x0B => 48, 0x0C => 16, 0x0D => 17, 0x0E => 18, 0x0F => 19, 0x10 => 21,
            0x11 => 20, 0x12 => 2, 0x13 => 3, 0x14 => 4, 0x15 => 5, 0x16 => 7, 0x17 => 6, 0x18 => 13,
            0x19 => 10, 0x1A => 8, 0x1B => 12, 0x1C => 9, 0x1D => 11, 0x1E => 27, 0x1F => 24, 0x20 => 22,
            0x21 => 26, 0x22 => 23, 0x23 => 25, 0x24 => 28, 0x25 => 38, 0x26 => 36, 0x27 => 40, 0x28 => 37,
            0x29 => 39, 0x2A => 43, 0x2B => 51, 0x2C => 53, 0x2D => 49, 0x2E => 50, 0x2F => 52, 0x30 => 15,
            0x31 => 57, 0x32 => 41, 0x33 => 14, 0x35 => 1, 0x36 => 3676, 0x37 => 3675, 0x38 => 42, 0x39 => 58,
            0x3A => 56, 0x3B => 29, 0x3C => 54, 0x3D => 3640, 0x3E => 3613, 0x4C => 3612,
            0x7A => 59, 0x78 => 60, 0x63 => 61, 0x76 => 62, 0x60 => 63, 0x61 => 64, 0x62 => 65, 0x64 => 66,
            0x65 => 67, 0x6D => 68, 0x67 => 87, 0x6F => 88,
            0x7B => 57419, 0x7C => 57421, 0x7D => 57424, 0x7E => 57416, 0x75 => 3667,
            0x73 => 3655, 0x77 => 3663, 0x74 => 3657, 0x79 => 3665,
            _ => 0,
        }
    }
}
