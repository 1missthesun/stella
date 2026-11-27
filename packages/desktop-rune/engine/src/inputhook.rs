//! Global input listening behind the host's `uiohook-napi` module (Show Stella's input timeline
//! and ink, the dictation Option-tap).
//!
//! - `inputhook.start`: starts listening; fails when the OS refuses (macOS without Input
//!   Monitoring / Accessibility, or a platform without a hook). macOS listens with a CGEventTap,
//!   Windows with low-level mouse and keyboard hooks (`WH_MOUSE_LL`, `WH_KEYBOARD_LL`) on their own
//!   thread; neither consumes an event. Linux has none, as Electron Stella uses none there.
//! - `inputhook.stop`: stops it.
//!
//! Each event is `{t:"inputhook", type, x, y, button, clicks, keycode, rawcode, rotation,
//! direction, amount, shiftKey, ctrlKey, altKey, metaKey, time}` in uiohook's shape: global
//! top-left points (physical pixels on Windows, as libuiohook reports them), buttons 1 left /
//! 2 right / 3 middle / 4-5 extra, libuiohook `VC_*` key codes, wheel direction 3 vertical /
//! 4 horizontal.

use serde_json::Value;

pub fn command(cmd: &str, rid: Option<u64>, v: &Value) {
    let _ = v;
    #[cfg(target_os = "macos")]
    match cmd {
        "inputhook.start" => mac::start(rid),
        "inputhook.stop" => mac::stop(rid),
        _ => crate::engine::reply(rid, Err(format!("{cmd}: unknown input hook command"))),
    }
    #[cfg(windows)]
    match cmd {
        "inputhook.start" => win::start(rid),
        "inputhook.stop" => win::stop(rid),
        _ => crate::engine::reply(rid, Err(format!("{cmd}: unknown input hook command"))),
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    crate::engine::reply(rid, Err(format!("{cmd}: global input listening is not available on this platform")));
}

#[cfg(windows)]
mod win {
    use serde_json::{Value, json};
    use std::cell::RefCell;
    use std::sync::atomic::{AtomicU32, Ordering};
    use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::Input::KeyboardAndMouse::GetDoubleClickTime;
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, GetMessageW, GetSystemMetrics, HC_ACTION, HHOOK, KBDLLHOOKSTRUCT, MSG, MSLLHOOKSTRUCT, PostThreadMessageW,
        SM_CXDOUBLECLK, SM_CYDOUBLECLK, SetWindowsHookExW, UnhookWindowsHookEx, WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYDOWN, WM_KEYUP,
        WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MBUTTONDOWN, WM_MBUTTONUP, WM_MOUSEHWHEEL, WM_MOUSEMOVE, WM_MOUSEWHEEL, WM_QUIT,
        WM_RBUTTONDOWN, WM_RBUTTONUP, WM_SYSKEYDOWN, WM_SYSKEYUP, WM_XBUTTONDOWN, WM_XBUTTONUP,
    };

    const WHEEL_DELTA: f64 = 120.0;
    const LLKHF_EXTENDED: u32 = 0x01;

    static THREAD: AtomicU32 = AtomicU32::new(0);

    #[derive(Default)]
    struct State {
        shift: [bool; 2],
        ctrl: [bool; 2],
        alt: [bool; 2],
        meta: [bool; 2],
        held: [bool; 6],
        last_down: Option<(i64, u32, i32, i32)>,
        clicks: i64,
    }

    thread_local! {
        static STATE: RefCell<State> = RefCell::new(State::default());
    }

    pub fn start(rid: Option<u64>) {
        if THREAD.load(Ordering::SeqCst) != 0 {
            return crate::engine::reply(rid, Ok(json!({ "started": true })));
        }
        std::thread::Builder::new()
            .name("inputhook".into())
            .spawn(move || unsafe {
                let module = GetModuleHandleW(None).ok().map(|m| HINSTANCE(m.0));
                let mouse = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), module, 0);
                let keyboard = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), module, 0);
                let (mouse, keyboard) = match (mouse, keyboard) {
                    (Ok(m), Ok(k)) => (m, k),
                    (m, k) => {
                        let error = m.as_ref().err().or(k.as_ref().err()).map(|e| e.message()).unwrap_or_default();
                        for hook in [m.ok(), k.ok()].into_iter().flatten() {
                            let _ = UnhookWindowsHookEx(hook);
                        }
                        return crate::engine::reply_any_thread(rid, Err(format!("the system refused a low-level input hook: {error}")));
                    }
                };
                THREAD.store(GetCurrentThreadId(), Ordering::SeqCst);
                crate::engine::reply_any_thread(rid, Ok(json!({ "started": true })));
                let mut msg = MSG::default();
                while GetMessageW(&mut msg, None, 0, 0).0 > 0 {}
                let _ = UnhookWindowsHookEx(mouse);
                let _ = UnhookWindowsHookEx(keyboard);
            })
            .map(|_| ())
            .unwrap_or_else(|e| crate::engine::reply(rid, Err(format!("inputhook thread: {e}"))));
    }

    pub fn stop(rid: Option<u64>) {
        let thread = THREAD.swap(0, Ordering::SeqCst);
        if thread != 0 {
            let _ = unsafe { PostThreadMessageW(thread, WM_QUIT, WPARAM(0), LPARAM(0)) };
        }
        crate::engine::reply(rid, Ok(json!({ "stopped": true })));
    }

    unsafe extern "system" fn mouse_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 && lparam.0 != 0 {
            let info = unsafe { &*(lparam.0 as *const MSLLHOOKSTRUCT) };
            if let Some(event) = STATE.with_borrow_mut(|state| mouse_event(state, wparam.0 as u32, info)) {
                crate::windows::send_any_thread(event);
            }
        }
        unsafe { CallNextHookEx(None::<HHOOK>, code, wparam, lparam) }
    }

    unsafe extern "system" fn keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 && lparam.0 != 0 {
            let info = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
            if let Some(event) = STATE.with_borrow_mut(|state| key_event(state, wparam.0 as u32, info)) {
                crate::windows::send_any_thread(event);
            }
        }
        unsafe { CallNextHookEx(None::<HHOOK>, code, wparam, lparam) }
    }

    fn base(state: &State, kind: &str, x: i32, y: i32) -> Value {
        let either = |pair: [bool; 2]| pair[0] || pair[1];
        json!({
            "t": "inputhook",
            "type": kind,
            "x": x,
            "y": y,
            "time": crate::metrics::epoch_ms() as u64,
            "shiftKey": either(state.shift),
            "ctrlKey": either(state.ctrl),
            "altKey": either(state.alt),
            "metaKey": either(state.meta),
        })
    }

    fn mouse_event(state: &mut State, message: u32, info: &MSLLHOOKSTRUCT) -> Option<Value> {
        let (x, y) = (info.pt.x, info.pt.y);
        let extra = || if (info.mouseData >> 16) & 0xFFFF == 1 { 4 } else { 5 };
        let (down, button) = match message {
            WM_MOUSEMOVE => {
                let button = state.held.iter().position(|&h| h).unwrap_or(0);
                let mut out = base(state, "mousemove", x, y);
                out["button"] = button.into();
                return Some(out);
            }
            WM_LBUTTONDOWN => (true, 1),
            WM_LBUTTONUP => (false, 1),
            WM_RBUTTONDOWN => (true, 2),
            WM_RBUTTONUP => (false, 2),
            WM_MBUTTONDOWN => (true, 3),
            WM_MBUTTONUP => (false, 3),
            WM_XBUTTONDOWN => (true, extra()),
            WM_XBUTTONUP => (false, extra()),
            WM_MOUSEWHEEL | WM_MOUSEHWHEEL => {
                let delta = ((info.mouseData >> 16) & 0xFFFF) as u16 as i16;
                if delta == 0 {
                    return None;
                }
                let vertical = message == WM_MOUSEWHEEL;
                let mut out = base(state, "wheel", x, y);
                out["direction"] = if vertical { 3 } else { 4 }.into();
                let notches = f64::from(delta) / WHEEL_DELTA;
                out["rotation"] = json!(if vertical { -notches } else { notches });
                out["amount"] = 3.into();
                return Some(out);
            }
            _ => return None,
        };
        state.held[button as usize] = down;
        if down {
            let window = i64::from(unsafe { GetDoubleClickTime() });
            let (slop_x, slop_y) = unsafe { (GetSystemMetrics(SM_CXDOUBLECLK) / 2, GetSystemMetrics(SM_CYDOUBLECLK) / 2) };
            let now = i64::from(info.time);
            let repeat = state.last_down.is_some_and(|(at, b, px, py)| b == button as u32 && now - at <= window && (x - px).abs() <= slop_x && (y - py).abs() <= slop_y);
            state.clicks = if repeat { state.clicks + 1 } else { 1 };
            state.last_down = Some((now, button as u32, x, y));
        }
        let mut out = base(state, if down { "mousedown" } else { "mouseup" }, x, y);
        out["button"] = button.into();
        out["clicks"] = state.clicks.max(1).into();
        Some(out)
    }

    fn key_event(state: &mut State, message: u32, info: &KBDLLHOOKSTRUCT) -> Option<Value> {
        let down = match message {
            WM_KEYDOWN | WM_SYSKEYDOWN => true,
            WM_KEYUP | WM_SYSKEYUP => false,
            _ => return None,
        };
        match info.vkCode {
            0xA0 => state.shift[0] = down,
            0xA1 => state.shift[1] = down,
            0xA2 => state.ctrl[0] = down,
            0xA3 => state.ctrl[1] = down,
            0xA4 => state.alt[0] = down,
            0xA5 => state.alt[1] = down,
            0x5B => state.meta[0] = down,
            0x5C => state.meta[1] = down,
            _ => {}
        }
        let mut out = base(state, if down { "keydown" } else { "keyup" }, 0, 0);
        out["rawcode"] = info.vkCode.into();
        out["keycode"] = vc(info.vkCode, info.flags.0 & LLKHF_EXTENDED != 0).into();
        Some(out)
    }

    /// A key's libuiohook `VC_*` code, as uiohook-napi reports it: read from the virtual-key code
    /// (`keycode_to_scancode`), not the scan code, so injected keys and other layouts match.
    fn vc(vk: u32, extended: bool) -> u32 {
        let Some(&code) = VK_TO_VC.get(vk as usize) else { return 0 };
        let code = u32::from(code);
        match vk {
            0x21..=0x28 | 0x2D | 0x2E if !extended => code | 0xEE00,
            0x0D if extended => code | 0x0E00,
            _ => code,
        }
    }

    /// libuiohook's `keycode_scancode_table` (src/windows/input_helper.c), by virtual-key code.
    #[rustfmt::skip]
    const VK_TO_VC: [u16; 256] = [
        0x0000, 0x0001, 0x0002, 0x0000, 0x0003, 0x0004, 0x0005, 0x0000,
        0x000E, 0x000F, 0x0000, 0x0000, 0xE04C, 0x001C, 0x0000, 0x0000,
        0x002A, 0x001D, 0x0038, 0x0E45, 0x003A, 0x0070, 0x0000, 0x0000,
        0x0000, 0x0079, 0x0000, 0x0001, 0x0000, 0x0000, 0x0000, 0x0000,
        0x0039, 0x0E49, 0x0E51, 0x0E4F, 0x0E47, 0xE04B, 0xE048, 0xE04D,
        0xE050, 0x0000, 0x0000, 0x0000, 0x0E37, 0x0E52, 0x0E53, 0x0000,
        0x000B, 0x0002, 0x0003, 0x0004, 0x0005, 0x0006, 0x0007, 0x0008,
        0x0009, 0x000A, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000,
        0x0000, 0x001E, 0x0030, 0x002E, 0x0020, 0x0012, 0x0021, 0x0022,
        0x0023, 0x0017, 0x0024, 0x0025, 0x0026, 0x0032, 0x0031, 0x0018,
        0x0019, 0x0010, 0x0013, 0x001F, 0x0014, 0x0016, 0x002F, 0x0011,
        0x002D, 0x0015, 0x002C, 0x0E5B, 0x0E5C, 0x0E5D, 0x0000, 0xE05F,
        0x0052, 0x004F, 0x0050, 0x0051, 0x004B, 0x004C, 0x004D, 0x0047,
        0x0048, 0x0049, 0x0037, 0x004E, 0x0000, 0x004A, 0x0053, 0x0E35,
        0x003B, 0x003C, 0x003D, 0x003E, 0x003F, 0x0040, 0x0041, 0x0042,
        0x0043, 0x0044, 0x0057, 0x0058, 0x005B, 0x005C, 0x005D, 0x0063,
        0x0064, 0x0065, 0x0066, 0x0067, 0x0068, 0x0069, 0x006A, 0x006B,
        0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000,
        0x0045, 0x0046, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000,
        0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000,
        0x002A, 0x0036, 0x001D, 0x0E1D, 0x0038, 0x0E38, 0xE06A, 0xE069,
        0xE067, 0xE068, 0xE065, 0xE066, 0xE032, 0xE020, 0xE02E, 0xE030,
        0xE019, 0xE010, 0xE024, 0xE022, 0x0000, 0xE06D, 0xE06C, 0xE021,
        0x0000, 0x0000, 0x0027, 0x000D, 0x0033, 0x000C, 0x0034, 0x0035,
        0x0029, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000,
        0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000,
        0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000,
        0x0000, 0x0000, 0x0000, 0x001A, 0x002B, 0x001B, 0x0028, 0x007D,
        0x0000, 0x0000, 0x0E46, 0x0000, 0x0000, 0xE064, 0xE03C, 0x0000,
        0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000,
        0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000,
        0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0xE04C, 0x0000,
    ];
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
