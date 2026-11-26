//! `control.input` events aimed at a shown native webview on Linux: Rune's injected input never
//! reaches an OS view, so pointer events on a view's shown area, and keys while an injected press
//! last landed in one, go to the view itself as the X server would deliver them, without moving
//! the real pointer or taking the system's focus. Everything else goes on to Rune.

use std::cell::Cell;

use serde_json::Value;

use crate::webview;

/// What one view gets, at `t` seconds from now, in its own points.
#[derive(Clone, Debug)]
enum Ev {
    Move(f32, f32),
    Down(f32, f32, u32),
    Up(f32, f32, u32),
    Wheel(f32, f32, f32, f32),
    Key { name: String, text: Option<String>, mods: Mods, press: bool },
}

#[derive(Clone, Copy, Debug, Default)]
struct Mods {
    shift: bool,
    ctrl: bool,
    alt: bool,
}

struct Step {
    t: f64,
    view: u32,
    ev: Ev,
}

thread_local! {
    /// The view an injected press last landed in, which then takes injected keys.
    static FOCUS: Cell<Option<u32>> = const { Cell::new(None) };
}

fn button(e: &Value) -> u32 {
    match e["button"].as_str() {
        Some("middle") => 2,
        Some("secondary") => 3,
        Some("back") => 8,
        Some("forward") => 9,
        _ => 1,
    }
}

fn mods(e: &Value) -> Mods {
    let flag = |k: &str| e[k].as_bool().unwrap_or(false);
    Mods { shift: flag("shift"), ctrl: flag("ctrl") || (flag("cmd") && !cfg!(target_os = "macos")), alt: flag("alt") }
}

/// Takes from `events` (a `control.input` script) those aimed at `window`'s webviews, sends them
/// to the views, and returns the rest for Rune.
pub fn route(window: u32, events: Vec<Value>) -> Vec<Value> {
    let mut rest = Vec::new();
    let mut steps: Vec<Step> = Vec::new();
    let mut pressed: Option<(u32, [f32; 4], f32, f32)> = None;
    let mut last: Option<(f32, f32)> = None;
    for e in events {
        let t = e["t"].as_f64().unwrap_or(0.0);
        let ty = e["type"].as_str().unwrap_or("tap");
        let xy = match (e["x"].as_f64(), e["y"].as_f64()) {
            (Some(x), Some(y)) if e["key"].is_null() => Some((x as f32, y as f32)),
            _ => None,
        };
        if let Some(p) = xy {
            last = Some(p);
        }
        let hit = xy.and_then(|(x, y)| webview::at(window, x, y));
        let local = |r: [f32; 4], (x, y): (f32, f32)| (x - r[0], y - r[1]);
        let mut push = |t: f64, view: u32, ev: Ev| steps.push(Step { t, view, ev });
        match ty {
            "tap" | "click" | "down" | "double-click" | "double-tap" | "triple-click" | "secondary-click" | "drag" if hit.is_some() => {
                let Some(((n, r), p)) = hit.zip(xy) else { continue };
                let (x, y) = local(r, p);
                let b = if ty == "secondary-click" { 3 } else { button(&e) };
                FOCUS.set(Some(n));
                push(t, n, Ev::Move(x, y));
                match ty {
                    "down" => pressed = Some((n, r, x, y)),
                    "drag" => {
                        let (dx, dy) = (e["dx"].as_f64().unwrap_or(0.0) as f32, e["dy"].as_f64().unwrap_or(0.0) as f32);
                        let dur = e["dur"].as_f64().unwrap_or(0.3).max(0.01);
                        push(t, n, Ev::Down(x, y, b));
                        let steps_n = (dur * 120.0).ceil() as usize;
                        for s in 1..=steps_n {
                            let f = s as f32 / steps_n as f32;
                            let f = f * f * (3.0 - 2.0 * f);
                            push(t + dur * s as f64 / steps_n as f64, n, Ev::Move(x + dx * f, y + dy * f));
                        }
                        push(t + dur + 0.02, n, Ev::Up(x + dx, y + dy, b));
                    }
                    _ => {
                        let presses = match ty {
                            "double-click" | "double-tap" => 2,
                            "triple-click" => 3,
                            _ => 1,
                        };
                        let hold = e["hold"].as_f64().unwrap_or(if presses > 1 { 0.06 } else { 0.08 });
                        let gap = e["gap"].as_f64().unwrap_or(0.15).max(hold + 0.01);
                        for k in 0..presses {
                            let start = t + gap * f64::from(k);
                            push(start, n, Ev::Down(x, y, b));
                            push(start + hold, n, Ev::Up(x, y, b));
                        }
                    }
                }
            }
            "up" if pressed.is_some() => {
                let Some((n, r, px, py)) = pressed.take() else { continue };
                let (x, y) = xy.map(|p| local(r, p)).unwrap_or((px, py));
                push(t, n, Ev::Up(x, y, button(&e)));
            }
            "move" if hit.is_some() || pressed.is_some() => {
                let (n, r) = match (pressed, hit) {
                    (Some((n, r, ..)), _) => (n, r),
                    (None, Some(h)) => h,
                    (None, None) => continue,
                };
                let Some(p) = xy else { continue };
                let (x, y) = local(r, p);
                push(t, n, Ev::Move(x, y));
            }
            "wheel" | "scroll" if hit.is_some() || (xy.is_none() && last.and_then(|(x, y)| webview::at(window, x, y)).is_some()) => {
                let Some(((n, r), p)) = hit.zip(xy).or_else(|| last.and_then(|p| webview::at(window, p.0, p.1).map(|h| (h, p)))) else { continue };
                let (x, y) = local(r, p);
                let (dx, dy) = (e["dx"].as_f64().unwrap_or(0.0) as f32, e["dy"].as_f64().unwrap_or(0.0) as f32);
                push(t, n, Ev::Move(x, y));
                if ty == "wheel" {
                    push(t, n, Ev::Wheel(x, y, dx, dy));
                } else {
                    let dur = e["dur"].as_f64().unwrap_or(0.2).max(0.01);
                    let steps_n = (dur * 120.0).ceil() as usize;
                    let mut prev = (0.0, 0.0);
                    for s in 1..=steps_n {
                        let f = s as f32 / steps_n as f32;
                        let f = f * (2.0 - f);
                        push(t + dur * s as f64 / steps_n as f64, n, Ev::Wheel(x, y, dx * f - prev.0, dy * f - prev.1));
                        prev = (dx * f, dy * f);
                    }
                }
            }
            "type" | "key" | "key-up" if FOCUS.get().is_some() && e["key"].is_null() => {
                let Some(n) = FOCUS.get() else { continue };
                if ty == "type" {
                    let every = e["every"].as_f64().unwrap_or(0.035);
                    for (k, c) in e["text"].as_str().unwrap_or("").chars().enumerate() {
                        let at = t + every * k as f64;
                        let name = c.to_string();
                        push(at, n, Ev::Key { name: name.clone(), text: Some(name.clone()), mods: Mods::default(), press: true });
                        push(at, n, Ev::Key { name, text: None, mods: Mods::default(), press: false });
                    }
                } else {
                    let name = e["name"].as_str().unwrap_or("").to_owned();
                    let m = mods(&e);
                    let text = (name.chars().count() == 1 && !m.ctrl && !m.alt).then(|| name.clone());
                    if ty == "key" {
                        push(t, n, Ev::Key { name: name.clone(), text, mods: m, press: true });
                    }
                    push(t, n, Ev::Key { name, text: None, mods: m, press: false });
                }
            }
            _ => {
                let press = matches!(ty, "tap" | "click" | "down" | "double-click" | "double-tap" | "triple-click" | "secondary-click" | "secondary-down" | "drag");
                if press && xy.is_some() || !e["key"].is_null() && press {
                    FOCUS.set(None);
                }
                rest.push(e);
            }
        }
    }
    if !steps.is_empty() {
        platform::send(steps);
    }
    rest
}

/// Forgets a closed view.
pub fn forget(n: u32) {
    if FOCUS.get() == Some(n) {
        FOCUS.set(None);
    }
}

mod platform {
    //! GDK events handed to GTK's own dispatch (`gtk_main_do_event`), so WebKitGTK takes them as
    //! the X server's: trusted DOM events, click counts, focus and the input method.
    use std::time::Duration;

    use gtk::gdk;
    use gtk::glib;
    use gtk::prelude::*;
    use wry::WebViewExtUnix;

    use super::{Ev, Mods, Step};

    pub fn send(steps: Vec<Step>) {
        for (k, step) in steps.into_iter().enumerate() {
            // Steps due together keep their order.
            let due = Duration::from_secs_f64(step.t.max(0.0) + k as f64 * 1e-6);
            glib::timeout_add_local_once(due, move || deliver(step.view, &step.ev));
        }
    }

    fn time() -> u32 {
        (glib::monotonic_time() / 1000) as u32
    }

    fn state(m: Mods, buttons: u32) -> gdk::ffi::GdkModifierType {
        let mut s = 0;
        if m.shift {
            s |= gdk::ffi::GDK_SHIFT_MASK;
        }
        if m.ctrl {
            s |= gdk::ffi::GDK_CONTROL_MASK;
        }
        if m.alt {
            s |= gdk::ffi::GDK_MOD1_MASK;
        }
        if buttons & 1 != 0 {
            s |= gdk::ffi::GDK_BUTTON1_MASK;
        }
        s
    }

    thread_local! {
        static HELD: std::cell::Cell<u32> = const { std::cell::Cell::new(0) };
    }

    fn deliver(n: u32, ev: &Ev) {
        let target = crate::webview::with_native(n, |view, k| {
            let web = view.webview();
            let gdk_scale = web.scale_factor().max(1) as f32;
            (web, k / gdk_scale)
        });
        let Some((web, to_gdk)) = target else { return };
        let Some(window) = web.window() else { return };
        let (ox, oy) = if web.has_window() { (0.0, 0.0) } else { (f64::from(web.allocation().x()), f64::from(web.allocation().y())) };
        let at = |x: f32, y: f32| (f64::from(x * to_gdk) + ox, f64::from(y * to_gdk) + oy);
        let display = window.display();
        let seat = display.default_seat();
        let pointer = seat.as_ref().and_then(|s| s.pointer());
        let keyboard = seat.as_ref().and_then(|s| s.keyboard());
        // SAFETY: each event is made here, filled with live GDK objects (the window is referenced
        // for the event, which unrefs it when freed), dispatched synchronously on GTK's thread
        // and freed after.
        unsafe {
            use glib::translate::ToGlibPtr;
            let win: *mut gdk::ffi::GdkWindow = window.to_glib_full();
            let ev_ptr = match ev {
                Ev::Move(x, y) => {
                    let e = gdk::ffi::gdk_event_new(gdk::ffi::GDK_MOTION_NOTIFY);
                    let m = &mut (*e).motion;
                    let (x, y) = at(*x, *y);
                    m.window = win;
                    m.time = time();
                    (m.x, m.y, m.x_root, m.y_root) = (x, y, x, y);
                    m.state = state(Mods::default(), HELD.get());
                    e
                }
                Ev::Down(x, y, b) | Ev::Up(x, y, b) => {
                    let down = matches!(ev, Ev::Down(..));
                    let e = gdk::ffi::gdk_event_new(if down { gdk::ffi::GDK_BUTTON_PRESS } else { gdk::ffi::GDK_BUTTON_RELEASE });
                    let m = &mut (*e).button;
                    let (x, y) = at(*x, *y);
                    m.window = win;
                    m.time = time();
                    (m.x, m.y, m.x_root, m.y_root) = (x, y, x, y);
                    m.button = *b;
                    m.state = state(Mods::default(), HELD.get());
                    HELD.set(if down { HELD.get() | (1 << (b - 1)) } else { HELD.get() & !(1 << (b - 1)) });
                    if down {
                        focus_in(&web);
                    }
                    e
                }
                Ev::Wheel(x, y, dx, dy) => {
                    let e = gdk::ffi::gdk_event_new(gdk::ffi::GDK_SCROLL);
                    let m = &mut (*e).scroll;
                    let (x, y) = at(*x, *y);
                    m.window = win;
                    m.time = time();
                    (m.x, m.y, m.x_root, m.y_root) = (x, y, x, y);
                    m.direction = gdk::ffi::GDK_SCROLL_SMOOTH;
                    // WebKitGTK scrolls 50 CSS px per smooth delta of 1; a script's positive
                    // delta scrolls toward the start, as Rune's wheel does.
                    m.delta_x = f64::from(-*dx / 50.0);
                    m.delta_y = f64::from(-*dy / 50.0);
                    e
                }
                Ev::Key { name, text, mods, press } => {
                    let Some(keyval) = keyval(name) else {
                        glib::gobject_ffi::g_object_unref(win.cast());
                        return;
                    };
                    let e = gdk::ffi::gdk_event_new(if *press { gdk::ffi::GDK_KEY_PRESS } else { gdk::ffi::GDK_KEY_RELEASE });
                    let m = &mut (*e).key;
                    m.window = win;
                    m.time = time();
                    m.state = state(*mods, HELD.get());
                    m.keyval = keyval;
                    let s = text.clone().unwrap_or_default();
                    m.length = s.len() as i32;
                    m.string = glib::ffi::g_strndup(s.as_ptr().cast(), s.len());
                    if let Some(entry) = gdk::Keymap::for_display(&display).and_then(|km| km.entries_for_keyval(keyval).into_iter().next()) {
                        m.hardware_keycode = entry.keycode() as u16;
                        m.group = entry.group() as u8;
                    }
                    if *press {
                        focus_in(&web);
                    }
                    e
                }
            };
            let device = if matches!(ev, Ev::Key { .. }) { keyboard.as_ref() } else { pointer.as_ref() };
            if let Some(d) = device {
                gdk::ffi::gdk_event_set_device(ev_ptr, d.to_glib_none().0);
                gdk::ffi::gdk_event_set_source_device(ev_ptr, d.to_glib_none().0);
            }
            gtk::ffi::gtk_main_do_event(ev_ptr);
            gdk::ffi::gdk_event_free(ev_ptr);
        }
    }

    /// Makes the view's GTK toplevel the active window inside GTK (as a focus-in from the X
    /// server would) and focuses the page, so it takes keys; the system's focus doesn't move.
    fn focus_in(web: &webkit2gtk::WebView) {
        if let Some(top) = web.toplevel().and_then(|t| t.downcast::<gtk::Window>().ok())
            && !top.is_active()
            && let Some(win) = top.window()
        {
            // SAFETY: as in `deliver`; a focus-change event on the toplevel's own window.
            unsafe {
                use glib::translate::ToGlibPtr;
                let e = gdk::ffi::gdk_event_new(gdk::ffi::GDK_FOCUS_CHANGE);
                let f = &mut (*e).focus_change;
                f.window = win.to_glib_full();
                f.in_ = 1;
                gtk::ffi::gtk_main_do_event(e);
                gdk::ffi::gdk_event_free(e);
            }
        }
        if !web.has_focus() {
            web.grab_focus();
        }
    }

    /// The GDK keyval for a script key name (DOM names, or one character).
    fn keyval(name: &str) -> Option<u32> {
        use gdk::keys::constants as k;
        let named = match name {
            "Enter" | "Return" => k::Return,
            "Tab" => k::Tab,
            "Escape" => k::Escape,
            "Backspace" => k::BackSpace,
            "Delete" => k::Delete,
            "ArrowLeft" | "Left" => k::Left,
            "ArrowRight" | "Right" => k::Right,
            "ArrowUp" | "Up" => k::Up,
            "ArrowDown" | "Down" => k::Down,
            "Home" => k::Home,
            "End" => k::End,
            "PageUp" => k::Page_Up,
            "PageDown" => k::Page_Down,
            "Space" | " " => k::space,
            _ => {
                let mut chars = name.chars();
                let c = chars.next()?;
                if chars.next().is_some() {
                    return None;
                }
                // SAFETY: a pure table lookup.
                return Some(unsafe { gdk::ffi::gdk_unicode_to_keyval(c as u32) });
            }
        };
        Some(*named)
    }
}
