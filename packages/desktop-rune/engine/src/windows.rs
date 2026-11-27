//! Windows are `<window>` root children. The first one (or the one with `kind="main"`) shows in
//! the window the engine opened at launch; every other one opens with `rune::open_window` and
//! closes when its element unmounts. All windows share the mirrored tree; whichever window's
//! poll runs first drains the bridge and wakes the windows whose subtree changed.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use rune::{AppSpec, CloseResponse, Cx, El, Spring, Tx, Waker, WindowOptions, WindowSpec, col};
use serde_json::json;

use crate::engine::{self, Applied, Engine, WinCmd, window_event};
use crate::input::InputState;
use crate::metrics::{METRICS, epoch_ms};
use crate::props::{Kind, Props};
use crate::protocol::{Msg, Op};
use crate::view::build;

#[derive(Default)]
pub struct Win {
    pub node: u32,
    pub main: bool,
    pub inputs: HashMap<u32, InputState>,
    /// Set by the `bg` command; wins over the `<window>`'s own `bg`.
    pub bg: Option<rune::Color>,
}

/// Every window's waker, for work that lands off the UI thread (images, tray, notifications).
pub static WAKERS: Mutex<Vec<Waker>> = Mutex::new(Vec::new());
/// Events produced off the UI thread, written by the next poll.
pub static OUTBOX: Mutex<Vec<serde_json::Value>> = Mutex::new(Vec::new());

pub fn wake_all() {
    for w in WAKERS.lock().unwrap_or_else(|e| e.into_inner()).iter() {
        w();
    }
}

/// Queues an event from any thread and wakes the windows to write it.
pub fn send_any_thread(v: serde_json::Value) {
    OUTBOX.lock().unwrap_or_else(|e| e.into_inner()).push(v);
    wake_all();
}

fn bg(eng: &Engine, node: u32) -> rune::Color {
    eng.tree
        .get(node)
        .and_then(|n| n.props.bg.or(n.props.fill))
        .map(|c| c.0)
        .unwrap_or_else(|| rune::color::hex("#0b0b0d").unwrap_or(rune::Color::TRANSPARENT))
}

pub fn view(s: &Win, cx: &mut Cx<Win>) -> El {
    let dark = cx.system_dark();
    let accent = cx.accent().hex();
    let maximized = cx.is_maximized();
    let full = cx.is_full_screen();
    let node = s.node;
    #[cfg(feature = "webview")]
    crate::webview::begin_build(node);
    let root = engine::read(|eng| {
        let mut root = col().key("stella-root").w_full().h_full().fill(s.bg.unwrap_or_else(|| bg(eng, node)));
        if let Some(n) = eng.tree.get(node).filter(|_| node != 0) {
            if let Some(k) = n.props.zoom {
                cx.zoom(k);
            }
            if let Some(h) = n.props.titlebar {
                let mut t = titlebar(h);
                if let Some([x, y]) = n.props.traffic_lights {
                    t = t.traffic_lights(x, y);
                }
                cx.set_titlebar(t);
            }
            let p = &*n.props;
            let mut inner = Props { fill: None, bg: None, ..p.clone() };
            inner.w = None;
            inner.h = None;
            inner.id = None;
            root = crate::style::paint(root, &inner);
            root = crate::view::children(s, eng, n, root);
            for l in eng.tree.lifted_in(node) {
                #[cfg(feature = "webview")]
                let mut layer = if !eng.tree.web_above.is_empty() && !crate::webview::is_overlay(eng, l) { crate::view::build_over(s, eng, l) } else { build(s, eng, l) };
                #[cfg(not(feature = "webview"))]
                let mut layer = build(s, eng, l);
                if eng.tree.get(l).is_some_and(|n| n.props.dir.is_none()) {
                    match eng.tree.dir_of(l) {
                        Some("rtl") => layer = layer.dir(rune::Direction::Rtl),
                        Some("ltr") => layer = layer.dir(rune::Direction::Ltr),
                        _ => {}
                    }
                }
                #[cfg(feature = "webview")]
                let layer = crate::webview::overlay(layer, eng, l);
                root = root.child(layer);
            }
        }
        root
    });
    let root = match default_band(s, cx) {
        Some(band) => {
            let fill = s.bg.unwrap_or_else(|| engine::read(|eng| bg(eng, node)));
            col().key("stella-frame").w_full().h_full().fill(fill).child(rune::el().key("stella-band").w_full().h(band).window_drag()).child(root.grow(1.0).min_h(0.0))
        }
        None => root,
    };
    note_state(node, dark, maximized, full, accent);
    settle_rect(node, cx);
    // As in CSS, a change lands at once unless its element asks for motion (`motion`, `layout`).
    let root = root.motion(rune::Spring::NONE);
    root.on_window_focus(move |s: &mut Win, focused: bool, _tx: &mut Tx| {
        if s.node != 0 {
            engine::with(|e| e.windows.entry(s.node).or_default().focused = focused);
            window_event(s.node, if focused { "focus" } else { "blur" }, json!({}));
        }
    })
    .on_layout(move |s: &mut Win, r: [f32; 4]| {
        if s.node == 0 {
            return;
        }
        // The root lays out in the zoomed view's points; the window's size is in its own.
        let (w, h, changed) = engine::with(|e| {
            let k = e.tree.get(s.node).and_then(|n| n.props.zoom).unwrap_or(1.0);
            let (w, h) = (r[2] * k, r[3] * k);
            let slot = e.windows.entry(s.node).or_default();
            let size = Some((w, h));
            let changed = slot.size != size;
            slot.size = size;
            (w, h, changed)
        });
        if changed {
            window_event(s.node, "resize", json!({ "w": w, "h": h }));
        }
    })
}

thread_local! {
    static SEEN: std::cell::RefCell<HashMap<u32, (bool, bool, bool)>> = std::cell::RefCell::new(HashMap::new());
    static MINIMIZED: std::cell::RefCell<HashMap<u32, bool>> = std::cell::RefCell::new(HashMap::new());
    static SYSTEM_DARK: std::cell::Cell<Option<bool>> = const { std::cell::Cell::new(None) };
    static ACCENT: std::cell::RefCell<String> = const { std::cell::RefCell::new(String::new()) };
}

pub fn system_dark() -> Option<bool> {
    SYSTEM_DARK.with(|d| d.get())
}

/// What `appearance.get` answers and `appearance` events carry.
pub fn appearance() -> serde_json::Value {
    let accent = ACCENT.with(|a| a.borrow().clone());
    json!({ "dark": system_dark().unwrap_or(false), "accentColor": (!accent.is_empty()).then_some(accent) })
}

fn note_state(node: u32, dark: bool, maximized: bool, full: bool, accent: String) {
    let accent_changed = ACCENT.with(|a| {
        let changed = *a.borrow() != accent;
        if changed {
            *a.borrow_mut() = accent;
        }
        changed
    });
    if SYSTEM_DARK.with(|d| d.replace(Some(dark))) != Some(dark) || accent_changed {
        let mut ev = appearance();
        ev["t"] = json!("appearance");
        engine::send(ev);
    }
    if node == 0 {
        return;
    }
    let prev = SEEN.with(|m| m.borrow_mut().insert(node, (dark, maximized, full)));
    if let Some((_, m0, f0)) = prev {
        if m0 != maximized {
            window_event(node, if maximized { "maximize" } else { "unmaximize" }, json!({}));
        }
        if f0 != full {
            window_event(node, if full { "enter-full-screen" } else { "leave-full-screen" }, json!({}));
        }
    }
}

pub fn on_key(s: &mut Win, ev: &rune::KeyEvent, tx: &mut Tx) -> bool {
    if crate::look_up::is_shortcut(ev) && crate::look_up::show(s.node) {
        return true;
    }
    let keys = engine::read(|e| e.tree.get(s.node).map(|n| n.props.keys.clone()).unwrap_or_default());
    if keys.is_empty() {
        return false;
    }
    crate::keys::Chords::new(&keys).take(s.node, ev, tx)
}

fn close_request(s: &mut Win, _tx: &mut Tx) -> CloseResponse {
    if s.node == 0 {
        return CloseResponse::Close;
    }
    window_event(s.node, "close-requested", json!({}));
    CloseResponse::Defer
}

pub fn setup(s: &mut Win, waker: Waker) {
    crate::look_up::install();
    crate::text_services::install();
    WAKERS.lock().unwrap_or_else(|e| e.into_inner()).push(waker.clone());
    if s.main {
        let slot = engine::read(|e| e.main_waker.clone());
        *slot.lock().unwrap_or_else(|e| e.into_inner()) = Some(waker.clone());
        crate::media::init(std::sync::Arc::new(wake_all));
        waker();
    } else {
        engine::with(|e| e.windows.entry(s.node).or_default().waker = Some(waker.clone()));
        waker();
    }
}

fn leak(s: &str) -> &'static str {
    Box::leak(s.to_owned().into_boxed_str())
}

fn size_of(p: &Props) -> (f32, f32) {
    let (dw, dh) = if is_background(p) { (1.0, 1.0) } else { (800.0, 600.0) };
    let w = match &p.w {
        Some(crate::props::Size::Pt(v)) => *v,
        _ => dw,
    };
    let h = match &p.h {
        Some(crate::props::Size::Pt(v)) => *v,
        _ => dh,
    };
    (w, h)
}

/// Whether the host's tree has a main window yet.
pub static MAIN_BOUND: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn options(p: &Props) -> WindowOptions {
    let overlay = p.kind.as_deref() == Some("overlay");
    let background = is_background(p);
    WindowOptions {
        transparent: p.transparent || overlay || background,
        borderless: p.frameless || overlay || background,
        click_through: p.click_through || background,
        always_on_top: p.always_on_top || overlay,
        visible: p.visible.unwrap_or(true),
        logical_position: p.position.map(|[x, y]| (f64::from(x), f64::from(y))),
        min_size: if background { Some((0.0, 0.0)) } else { p.min_size.map(|[w, h]| (w, h)) },
        max_size: p.max_size.map(|[w, h]| (w, h)),
        resizable: p.resizable.unwrap_or(true) && !background,
        ..Default::default()
    }
}

/// A window that is on screen for the system (so a webview inside runs as a visible page)
/// but shows nothing, takes no clicks or focus, and stays out of the Dock, task switchers,
/// screen captures and the accessibility tree.
fn is_background(p: &Props) -> bool {
    p.kind.as_deref() == Some("background")
}

fn background_window(app: rune::App<Win>) -> rune::App<Win> {
    const CAN_JOIN_ALL_SPACES: usize = 1 << 0;
    const STATIONARY: usize = 1 << 4;
    const IGNORES_CYCLE: usize = 1 << 6;
    const FULL_SCREEN_AUXILIARY: usize = 1 << 8;
    app.macos_window(
        rune::MacWindowOptions::default()
            .nonactivating_panel(true)
            .shadow(false)
            .accepts_first_mouse(false)
            .collection_behavior(CAN_JOIN_ALL_SPACES | STATIONARY | IGNORES_CYCLE | FULL_SCREEN_AUXILIARY),
    )
    .windows_window(rune::WindowsWindowOptions::default().no_activate(true).tool_window(true))
    .linux_window(rune::LinuxWindowOptions::default().unmanaged(true))
    .exclude_from_capture(true)
    .accessible(false)
}

pub fn app_spec(p: &Props) -> AppSpec<Win> {
    let mut spec = AppSpec::new(leak(p.title.as_deref().unwrap_or("Stella")), size_of(p), Win::default, view);
    spec.min_size = Some(p.min_size.filter(|_| !is_background(p)).map_or((0.0, 0.0), |[w, h]| (w, h)));
    spec.setup = Some(setup);
    spec.poll = Some(poll);
    spec.on_key = Some(on_key);
    spec
}

/// The band the main window opens with, before the tree says what titlebar it wants: a
/// titlebar fixed at open can only be changed later, never added.
const DEFAULT_BAND: f32 = if cfg!(target_os = "macos") { 28.0 } else { 32.0 };

pub fn decorate_main(app: rune::App<Win>, p: &Props) -> rune::App<Win> {
    let app = decorate(app, p);
    if p.titlebar.is_none() && !p.frameless && p.kind.as_deref() != Some("overlay") {
        app.titlebar(titlebar(DEFAULT_BAND))
    } else {
        app
    }
}

/// On Windows Stella's windows are frameless in Electron (`frame: false`) and draw their own
/// window controls, so the band keeps its drag, snap and resize edges but shows no caption buttons.
fn titlebar(height: f32) -> rune::Titlebar {
    rune::Titlebar::new(height).controls(!cfg!(windows))
}

/// Electron's `minimize` and `restore` events, for a minimize or restore the window's own
/// controls, the taskbar or a shortcut made.
fn visibility(s: &mut Win, shown: bool, _tx: &mut Tx) {
    let minimized = !shown && engine::read(|e| e.windows.get(&s.node).and_then(|w| w.handle.as_ref()).and_then(|h| h.placement())).is_some_and(|p| p.minimized);
    if MINIMIZED.with(|m| m.borrow_mut().insert(s.node, minimized)).unwrap_or(false) != minimized {
        window_event(s.node, if minimized { "minimize" } else { "restore" }, json!({}));
    }
}

/// The default band's height on a main window whose tree asks for no titlebar: its content
/// stays below the band and moves the window by it, as under a native title bar.
fn default_band(s: &Win, cx: &Cx<Win>) -> Option<f32> {
    if !s.main || engine::read(|e| e.tree.get(s.node).filter(|_| s.node != 0).and_then(|n| n.props.titlebar)).is_some() {
        return None;
    }
    Some(cx.chrome_insets().height).filter(|h| *h > 0.0)
}

pub fn decorate(app: rune::App<Win>, p: &Props) -> rune::App<Win> {
    let mut app = app.on_close_request(close_request).on_visibility(visibility);
    if let Some(h) = p.titlebar {
        app = app.titlebar(titlebar(h));
    }
    if let Some([x, y]) = p.traffic_lights {
        app = app.chrome(rune::Chrome { traffic_lights: Some((x, y)), ..rune::Chrome::DEFAULT });
    }
    if is_background(p) {
        app = background_window(app);
    } else if p.content_protection {
        app = app.exclude_from_capture(true);
    }
    app
}

fn open(node: u32, p: &Props) {
    let props = p.clone();
    let spec = WindowSpec::new(format!("w{node}"), app_spec(p))
        .options(options(p))
        .state(Win { node, main: false, inputs: HashMap::new(), bg: None })
        .map_app(move |a| decorate(a, &props));
    let handle = rune::open_window(spec);
    engine::with(|e| {
        let slot = e.windows.entry(node).or_default();
        slot.handle = Some(handle);
        slot.dirty = true;
        slot.applied = applied_at_open(p);
        slot.baked = baked(p);
    });
}

/// The `<window>` props a native window keeps from its open, with the window's `id`; `None` for
/// a window without an `id`, which is never taken over.
fn baked(p: &Props) -> Option<String> {
    let id = p.id.as_deref()?;
    Some(format!("{id}|{:?}|{}|{}|{}|{:?}|{:?}|{:?}", p.kind, p.transparent, p.frameless, p.content_protection, p.visible == Some(false), p.titlebar, p.traffic_lights))
}

fn applied_at_open(p: &Props) -> Applied {
    Applied {
        title: p.title.clone(),
        size: Some(size_of(p)),
        visible: Some(p.visible.unwrap_or(true)),
        on_top: Some(p.always_on_top),
        position: p.position,
        dark: Some(p.dark),
        titlebar: p.titlebar,
        click_through: Some(p.click_through || is_background(p)),
        content_protection: Some(p.content_protection || is_background(p)),
    }
}

/// Root children that appeared or left in this batch: bind the main window, open or close others.
/// A `<window>` that replaces one with the same `id` and open-time props in the same batch (a
/// remount, as a hot swap does), or a main window replacing the main window, takes over its native
/// window and its webviews, so the window is never unmapped and mapped again and its pages keep
/// running.
fn windows_changed(added: Vec<u32>, removed: Vec<u32>) {
    let mut freed: Vec<(u32, engine::WinSlot)> = Vec::new();
    for node in removed {
        let slot = engine::with(|e| {
            if e.main_node == Some(node) {
                e.main_node = None;
            }
            e.windows.remove(&node)
        });
        if let Some(slot) = slot {
            window_event(node, "closed", json!({}));
            freed.push((node, slot));
        }
    }
    for node in added {
        let (props, bind_main) = engine::read(|e| {
            let p = e.tree.get(node).map(|n| (*n.props).clone()).unwrap_or_default();
            let main = e.main_node.is_none() && matches!(p.kind.as_deref(), None | Some("main"));
            (p, main)
        });
        let key = baked(&props);
        let same = |s: &engine::WinSlot| s.handle.is_some() && if bind_main { s.is_main } else { !s.is_main && key.is_some() && s.baked == key };
        if let Some(i) = freed.iter().position(|(_, s)| same(s)) {
            let (old, mut slot) = freed.swap_remove(i);
            slot.dirty = true;
            slot.committed = false;
            slot.size = None;
            slot.cmds.clear();
            let (focused, waker) = (slot.focused, slot.waker.clone());
            engine::with(|e| {
                if slot.is_main {
                    e.main_node = Some(node);
                } else {
                    e.rebound.insert(old, node);
                }
                e.windows.insert(node, slot);
            });
            if focused {
                window_event(node, "focus", json!({}));
            }
            #[cfg(feature = "webview")]
            crate::webview::take_over(old, node);
            if let Some(w) = waker {
                w();
            }
            continue;
        }
        if bind_main {
            let swap_view = freed.iter_mut().find(|(_, s)| s.is_main).and_then(|(_, s)| s.swap_view.take());
            MAIN_BOUND.store(true, std::sync::atomic::Ordering::Release);
            engine::with(|e| {
                e.main_node = Some(node);
                let handle = e.main_handle.clone();
                let waker = e.main_waker.lock().unwrap_or_else(|x| x.into_inner()).clone();
                let slot = e.windows.entry(node).or_default();
                slot.handle = handle;
                slot.waker = waker;
                slot.is_main = true;
                slot.dirty = true;
                slot.applied = Applied { dark: Some(None), ..Applied::default() };
                slot.swap_view = swap_view;
            });
        } else {
            open(node, &props);
        }
    }
    for (node, slot) in freed {
        #[cfg(feature = "webview")]
        crate::webview::close_window(node);
        if let Some(h) = slot.handle {
            if slot.is_main {
                h.hide();
            } else {
                h.close();
            }
        }
    }
}

/// How long after a hot swap lands its follow-up commits (layout-driven reveals) skip motion.
const SWAP_SETTLE: std::time::Duration = std::time::Duration::from_millis(600);

/// Drains the bridge: applies ops, runs global commands, queues window commands, and wakes the
/// windows it dirtied.
fn drain(polling: u32) {
    let mut batches = Vec::new();
    let disconnected = engine::with(|e| {
        let Some(rx) = e.rx.as_ref() else { return false };
        loop {
            match rx.try_recv() {
                Ok(m) => batches.push(m),
                Err(std::sync::mpsc::TryRecvError::Empty) => return false,
                Err(std::sync::mpsc::TryRecvError::Disconnected) => return true,
            }
        }
    });
    if disconnected && !engine::read(|e| e.ts_dead) {
        engine::with(|e| e.ts_dead = true);
        eprintln!("stella-engine: TS host disconnected; keeping the last tree on screen");
    }
    if batches.is_empty() {
        return;
    }
    let mut cmds: Vec<serde_json::Value> = Vec::new();
    let mut added = Vec::new();
    let mut gone = Vec::new();
    for Msg::Batch(ops, received_at) in batches {
        engine::with(|e| {
            if ops.iter().any(|op| matches!(op, Op::Commit { kind: 1, .. })) {
                crate::swap_view::remember(e);
                e.swap_settle = Some((std::time::Instant::now() + SWAP_SETTLE, crate::swap_view::USER_INPUT.load(std::sync::atomic::Ordering::Relaxed)));
            }
            for op in ops {
                match op {
                    Op::Commit { generation, ack, t0, kind } => {
                        METRICS.lock().unwrap_or_else(|x| x.into_inner()).on_commit(generation, ack, t0, kind, received_at, epoch_ms());
                    }
                    Op::Cmd(v) => cmds.push(v),
                    Op::Blob { id, bytes } => {
                        e.blobs.insert(id, bytes);
                    }
                    Op::FreeBlob { id } => {
                        e.blobs.remove(&id);
                    }
                    op => {
                        let root_child = match &op {
                            Op::Append { parent: 0, child } | Op::Insert { parent: 0, child, .. } => Some(*child),
                            _ => None,
                        };
                        if let Op::Remove { parent: 0, child } = &op {
                            gone.push(*child);
                            added.retain(|a| a != child);
                        }
                        e.tree.apply(op);
                        if let Some(c) = root_child
                            && e.tree.get(c).is_some_and(|n| n.kind == Kind::Window)
                            && !e.windows.contains_key(&c)
                            && !added.contains(&c)
                        {
                            added.push(c);
                        }
                    }
                }
            }
        });
    }
    engine::with(|e| e.tree.settle());
    windows_changed(added, gone);
    let removed = engine::with(|e| std::mem::take(&mut e.tree.removed));
    for n in &removed {
        #[cfg(feature = "webview")]
        crate::webview::close(*n);
        #[cfg(feature = "webview")]
        crate::webview::forget_overlay(*n);
        #[cfg(feature = "webview")]
        crate::webview::forget_over(*n);
        crate::media::forget(*n);
        crate::surface::forget(*n);
        forget_selection(*n);
    }
    for v in cmds {
        crate::commands::route(v);
    }
    wake_dirty(polling);
}

/// Marks the windows holding changed nodes dirty and wakes them, except `polling`, which reads
/// its own dirty flag in the same poll.
fn wake_dirty(polling: u32) {
    let dirty: Vec<u32> = engine::with(|e| {
        let d: Vec<u32> = e.tree.dirty.drain().collect();
        for w in &d {
            if let Some(slot) = e.windows.get_mut(w) {
                slot.dirty = true;
            }
        }
        d
    });
    for w in dirty.into_iter().filter(|w| *w != polling) {
        engine::wake(w);
    }
}

fn flush_outbox() {
    let out = std::mem::take(&mut *OUTBOX.lock().unwrap_or_else(|e| e.into_inner()));
    for v in out {
        engine::send(v);
    }
}

/// Applies window props that can change after opening.
fn apply_window_props(node: u32, tx: &mut Tx) {
    let Some((p, applied, handle)) = engine::read(|e| {
        let n = e.tree.get(node)?;
        let slot = e.windows.get(&node)?;
        Some(((*n.props).clone(), slot.applied.clone(), slot.handle.clone()))
    }) else {
        return;
    };
    let mut next = applied.clone();
    if p.title != applied.title {
        tx.set_title(p.title.clone().unwrap_or_default());
        next.title = p.title.clone();
    }
    let size = matches!((&p.w, &p.h), (Some(crate::props::Size::Pt(_)), Some(crate::props::Size::Pt(_)))).then(|| size_of(&p));
    if size.is_some() && size != applied.size {
        if let Some(sz) = size {
            tx.resize_window(sz);
        }
        next.size = size;
    }
    if let Some(h) = &handle {
        let visible = Some(p.visible.unwrap_or(true));
        if visible != applied.visible {
            h.set_visible(visible == Some(true));
            if visible == Some(true) && applied.visible.is_some() && !is_background(&p) {
                h.focus();
            }
            next.visible = visible;
        }
        if Some(p.always_on_top) != applied.on_top {
            h.set_always_on_top(p.always_on_top);
            next.on_top = Some(p.always_on_top);
        }
        if p.position.is_some() && p.position != applied.position {
            if let Some([x, y]) = p.position
                && let Some(k) = h.scale()
            {
                h.set_position(((f64::from(x) * k).round() as i32, (f64::from(y) * k).round() as i32));
            }
            next.position = p.position;
        }
        let click_through = p.click_through || is_background(&p);
        if Some(click_through) != applied.click_through {
            if let Err(e) = h.set_click_through(click_through) {
                eprintln!("stella-engine: click-through: {e}");
            }
            next.click_through = Some(click_through);
        }
        let protect = p.content_protection || is_background(&p);
        if Some(protect) != applied.content_protection {
            if applied.content_protection.is_some() || protect {
                h.set_exclude_from_capture(protect);
            }
            next.content_protection = Some(protect);
        }
    }
    if Some(p.dark) != applied.dark {
        tx.set_color_scheme(match p.dark {
            Some(true) => rune::ColorScheme::Dark,
            Some(false) => rune::ColorScheme::Light,
            None => rune::ColorScheme::System,
        });
        next.dark = Some(p.dark);
    }
    if next != applied {
        engine::with(|e| {
            if let Some(slot) = e.windows.get_mut(&node) {
                slot.applied = next;
            }
        });
    }
}

fn apply_fonts(node: u32, tx: &mut Tx) {
    let (fonts, families, families_gen) = engine::read(|e| {
        let slot = e.windows.get(&node);
        let from = slot.map(|s| s.fonts_applied).unwrap_or(0);
        let gen_applied = slot.map(|s| s.families_applied).unwrap_or(0);
        let fonts: Vec<_> = e.fonts.iter().skip(from).cloned().collect();
        let fam = (e.families_gen != gen_applied).then(|| e.families.clone()).flatten();
        (fonts, fam, e.families_gen)
    });
    if fonts.is_empty() && families.is_none() {
        return;
    }
    for f in &fonts {
        tx.add_font(f.clone());
    }
    if let Some((sans, mono)) = families {
        tx.set_font_families(sans, mono);
    }
    engine::with(|e| {
        let total = e.fonts.len();
        if let Some(slot) = e.windows.get_mut(&node) {
            slot.fonts_applied = total;
            slot.families_applied = families_gen;
        }
    });
}

fn sync_inputs(s: &mut Win) {
    let node = s.node;
    let fields: Vec<(u32, Option<String>)> = engine::read(|e| {
        e.tree
            .nodes
            .iter()
            .filter(|(_, n)| n.kind == Kind::Input)
            .filter(|(id, _)| e.tree.window_of(**id) == Some(node))
            .map(|(id, n)| (*id, n.props.value.clone()))
            .collect()
    });
    let live: std::collections::HashSet<u32> = fields.iter().map(|(id, _)| *id).collect();
    s.inputs.retain(|id, _| live.contains(id));
    for (id, value) in fields {
        match s.inputs.get_mut(&id) {
            Some(st) => st.control(value.as_deref()),
            None => {
                s.inputs.insert(id, InputState::new(value.as_deref().unwrap_or("")));
            }
        }
    }
}

pub fn poll(s: &mut Win, _now: f64, tx: &mut Tx) -> bool {
    flush_outbox();
    drain(s.node);
    let decoded = crate::media::decoded_since_built();
    let sized = !decoded.is_empty();
    if sized {
        engine::with(|e| decoded.into_iter().for_each(|n| e.tree.touch(n)));
        wake_dirty(s.node);
    }
    if s.main && s.node == 0
        && let Some(m) = engine::read(|e| e.main_node)
    {
        s.node = m;
    }
    if s.main && let Some(m) = engine::read(|e| e.main_node) && s.node != m {
        s.node = m;
    }
    while !s.main && let Some(n) = engine::with(|e| e.rebound.remove(&s.node)) {
        s.node = n;
    }
    let node = s.node;
    let focus = crate::swap_view::seen(s, tx);
    crate::text_services::note(s, tx);
    engine::with(|e| {
        if let Some(slot) = e.windows.get_mut(&node)
            && slot.focus != focus
        {
            slot.focus = focus;
        }
    });
    crate::control::refresh_recording(node);
    if engine::read(|e| e.ts_dead && e.windows.is_empty()) {
        return false;
    }
    let taken = engine::with(|e| {
        let settling = e.swap_settle.is_some_and(|(until, input)| std::time::Instant::now() < until && crate::swap_view::USER_INPUT.load(std::sync::atomic::Ordering::Relaxed) == input);
        let slot = e.windows.get_mut(&node)?;
        let dirty = std::mem::take(&mut slot.dirty);
        let cmds = std::mem::take(&mut slot.cmds);
        let first_commit = dirty && !slot.committed;
        if dirty {
            slot.committed = true;
            e.first_commit = true;
        }
        Some((dirty, cmds, first_commit, settling))
    });
    let mut changed = false;
    if let Some((dirty, cmds, first_commit, settling)) = taken {
        if dirty {
            apply_window_props(node, tx);
            sync_inputs(s);
            #[cfg(feature = "webview")]
            sync_webviews(node);
            if first_commit || sized || settling {
                tx.instant();
            } else {
                tx.animated();
                if let Some(d) = engine::read(|e| e.color_motion) {
                    tx.color_motion(Spring::new(d, 0.0));
                }
            }
            changed = true;
        }
        apply_fonts(node, tx);
        if !cmds.is_empty() && !first_commit && !settling {
            tx.animated();
        }
        for WinCmd::Req(rid, v) in cmds {
            let inspects = v.get("cmd").and_then(serde_json::Value::as_str).is_some_and(|c| c.starts_with("control."));
            crate::commands::run(s, tx, rid, v);
            changed |= !inspects;
        }
        if crate::swap_view::waiting(node) {
            crate::swap_view::place(s, tx, dirty);
        }
    }
    crate::control::tick(s, tx);
    #[cfg(feature = "webview")]
    if crate::webview::active() {
        crate::webview::retry_waiting();
        crate::webview::refresh_all();
        crate::webview::pump();
        if crate::webview::needs_ticks() {
            tx.wake_after(Duration::from_millis(8));
        }
    }
    changed
}

#[cfg(feature = "webview")]
fn sync_webviews(node: u32) {
    let views: Vec<(u32, Props)> = engine::read(|e| {
        e.tree
            .nodes
            .iter()
            .filter(|(_, n)| n.kind == Kind::Webview)
            .filter(|(id, _)| e.tree.window_of(**id) == Some(node))
            .map(|(id, n)| (*id, (*n.props).clone()))
            .collect()
    });
    for (id, p) in &views {
        crate::webview::sync(*id, p);
    }
    // A hidden window lays nothing out, yet its pages run as in Electron's `show: false` windows
    // (Turnstile solves there before the window ever shows): its views open at the window's size,
    // and its first shown frame places them.
    let hidden = engine::read(|e| e.tree.get(node).filter(|n| n.props.visible == Some(false)).map(|n| size_of(&n.props)));
    if let Some((w, h)) = hidden {
        for (id, _) in &views {
            crate::webview::place_hidden(*id, node, [0.0, 0.0, w, h]);
        }
    }
}

/// Queues a command for the window showing `node` and wakes it.
pub fn queue(window: u32, rid: Option<u64>, v: serde_json::Value) -> bool {
    let ok = engine::with(|e| match e.windows.get_mut(&window) {
        Some(slot) => {
            slot.cmds.push(WinCmd::Req(rid, v));
            true
        }
        None => false,
    });
    if ok {
        engine::wake(window);
    }
    ok
}

thread_local! {
    /// The text selected in each window, by the selectable element or group holding it.
    static SELECTIONS: std::cell::RefCell<HashMap<u32, HashMap<u32, String>>> = std::cell::RefCell::new(HashMap::new());
}

#[derive(Default)]
struct Settle {
    settled: bool,
    pending: bool,
    rect: Option<[f32; 4]>,
    rects: Vec<[f32; 4]>,
    /// For Look Up: the font of the text the selection starts in, and how far below its first
    /// line box's top the line's baseline sits.
    font: Option<rune::ResolvedTextStyle>,
    baseline: Option<f32>,
}

thread_local! {
    static SETTLES: std::cell::RefCell<HashMap<u32, Settle>> = std::cell::RefCell::new(HashMap::new());
}

/// Tracks a window's selection between a press making it and its release, and reports the
/// settled selection with its box from the next view run, or that it cleared.
pub fn note_selection_change(window: u32, element: u32, change: &rune::SelectionChange, tx: &mut Tx) {
    note_selection(window, element, change.selection().map(|t| t.text().to_owned()));
    let any = selected_text(window).is_some();
    let was = SETTLES.with(|m| {
        let mut m = m.borrow_mut();
        let st = m.entry(window).or_default();
        let was = st.settled || st.rect.is_some();
        if !any || change.dragging() {
            *st = Settle::default();
        } else if change.selection().is_some() {
            st.settled = true;
            st.pending = true;
        }
        was
    });
    let start = change.selection().filter(|_| any && !change.dragging()).and_then(|t| t.texts().iter().find(|t| !t.range().is_empty()).map(|t| t.path().to_owned()));
    if let Some(path) = start {
        tx.read_elements(move |_: &mut Win, els, _| {
            let font = els.iter().find(|e| e.path == path).and_then(|e| e.text_style.clone());
            SETTLES.with(|m| m.borrow_mut().entry(window).or_default().font = font);
        });
        tx.selection_lines(move |_: &mut Win, lines, _| {
            let baseline = lines.first().map(|l| l.baseline - l.rect[1]);
            SETTLES.with(|m| m.borrow_mut().entry(window).or_default().baseline = baseline);
        });
    }
    if !any && was {
        engine::send(json!({ "t": "selection", "window": window_id(window), "n": window, "cleared": true }));
    }
}

fn window_id(window: u32) -> Option<String> {
    engine::read(|e| e.tree.get(window).and_then(|n| n.props.id.clone()))
}

fn settle_rect(window: u32, cx: &mut Cx<Win>) {
    if !SETTLES.with(|m| m.borrow().get(&window).is_some_and(|s| s.settled)) {
        return;
    }
    let rects = cx.selection_client_rects();
    let rect = rects.iter().copied().reduce(|a, b| {
        let (x, y) = (a[0].min(b[0]), a[1].min(b[1]));
        [x, y, (a[0] + a[2]).max(b[0] + b[2]) - x, (a[1] + a[3]).max(b[1] + b[3]) - y]
    });
    let emit = SETTLES.with(|m| {
        let mut m = m.borrow_mut();
        let st = m.entry(window).or_default();
        st.rect = rect;
        st.rects = rects;
        let emit = st.pending && rect.is_some();
        if emit {
            st.pending = false;
        }
        emit.then_some(rect).flatten()
    });
    if let (Some(r), Some(text)) = (emit, selected_text(window)) {
        engine::send(json!({ "t": "selection", "window": window_id(window), "n": window, "text": text, "rect": rect_json(r) }));
    }
}

fn rect_json(r: [f32; 4]) -> serde_json::Value {
    json!({ "x": r[0], "y": r[1], "w": r[2], "h": r[3] })
}

/// The union of `window`'s settled selection line boxes, in window points as scrolled.
pub fn selection_rect(window: u32) -> Option<serde_json::Value> {
    SETTLES.with(|m| m.borrow().get(&window).and_then(|s| s.rect)).map(rect_json)
}

/// `window`'s settled selection for Look Up.
pub fn look_up_target(window: u32) -> Option<crate::look_up::Target> {
    let text = selected_text(window)?;
    SETTLES.with(|m| m.borrow().get(&window).and_then(|s| crate::look_up::Target::new(text, s.font.clone()?, s.baseline?, s.rects.clone())))
}

pub fn note_selection(window: u32, element: u32, text: Option<String>) {
    SELECTIONS.with(|m| {
        let mut m = m.borrow_mut();
        let w = m.entry(window).or_default();
        match text.filter(|t| !t.is_empty()) {
            Some(t) => {
                w.insert(element, t);
            }
            None => {
                w.remove(&element);
            }
        }
    });
}

pub fn forget_selection(element: u32) {
    SELECTIONS.with(|m| m.borrow_mut().values_mut().for_each(|w| {
        w.remove(&element);
    }));
}

/// The selected text in `window`, as copying takes it.
pub fn selected_text(window: u32) -> Option<String> {
    SELECTIONS.with(|m| m.borrow().get(&window).and_then(|w| w.values().max_by_key(|t| t.len()).cloned()))
}

pub fn first_window() -> Option<u32> {
    engine::read(|e| e.main_node.or_else(|| e.windows.keys().min().copied()))
}

