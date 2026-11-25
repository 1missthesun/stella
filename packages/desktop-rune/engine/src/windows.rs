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
    let root = engine::read(|eng| {
        let mut root = col().key("stella-root").w_full().h_full().fill(s.bg.unwrap_or_else(|| bg(eng, node)));
        if let Some(n) = eng.tree.get(node).filter(|_| node != 0) {
            if let Some(h) = n.props.titlebar {
                cx.titlebar_height(h);
            }
            let p = &*n.props;
            let mut inner = Props { fill: None, bg: None, ..p.clone() };
            inner.w = None;
            inner.h = None;
            inner.id = None;
            root = crate::style::paint(root, &inner);
            root = crate::view::children(s, eng, n, root);
            for l in eng.tree.lifted_in(node) {
                root = root.child(build(s, eng, l));
            }
        }
        root
    });
    note_state(node, dark, maximized, full, accent);
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
        let changed = engine::with(|e| {
            let slot = e.windows.entry(s.node).or_default();
            let size = Some((r[2], r[3]));
            let changed = slot.size != size;
            slot.size = size;
            changed
        });
        if changed {
            window_event(s.node, "resize", json!({ "w": r[2], "h": r[3] }));
        }
    })
}

thread_local! {
    static SEEN: std::cell::RefCell<HashMap<u32, (bool, bool, bool)>> = std::cell::RefCell::new(HashMap::new());
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
    let w = match &p.w {
        Some(crate::props::Size::Pt(v)) => *v,
        _ => 800.0,
    };
    let h = match &p.h {
        Some(crate::props::Size::Pt(v)) => *v,
        _ => 600.0,
    };
    (w, h)
}

pub fn options(p: &Props) -> WindowOptions {
    let overlay = p.kind.as_deref() == Some("overlay");
    WindowOptions {
        transparent: p.transparent || overlay,
        borderless: p.frameless || overlay,
        click_through: p.click_through,
        always_on_top: p.always_on_top || overlay,
        visible: p.visible.unwrap_or(true),
        position: p.position.map(|[x, y]| (x, y)),
        min_size: p.min_size.map(|[w, h]| (w, h)),
        max_size: p.max_size.map(|[w, h]| (w, h)),
        resizable: p.resizable.unwrap_or(true),
        ..Default::default()
    }
}

pub fn app_spec(p: &Props) -> AppSpec<Win> {
    let mut spec = AppSpec::new(leak(p.title.as_deref().unwrap_or("Stella")), size_of(p), Win::default, view);
    spec.min_size = p.min_size.map(|[w, h]| (w, h)).or(Some((240.0, 160.0)));
    spec.setup = Some(setup);
    spec.poll = Some(poll);
    spec.on_key = Some(on_key);
    spec
}

pub fn decorate(app: rune::App<Win>, p: &Props) -> rune::App<Win> {
    let mut app = app.on_close_request(close_request);
    if let Some(h) = p.titlebar {
        app = app.titlebar(rune::Titlebar::new(h));
    }
    if let Some([x, y]) = p.traffic_lights {
        app = app.chrome(rune::Chrome { traffic_lights: Some((x, y)), ..rune::Chrome::DEFAULT });
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
    });
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
        click_through: Some(p.click_through),
    }
}

/// Root children that appeared or left in this batch: bind the main window, open or close others.
fn windows_changed(added: Vec<u32>, removed: Vec<u32>) {
    for node in removed {
        let slot = engine::with(|e| {
            if e.main_node == Some(node) {
                e.main_node = None;
            }
            e.windows.remove(&node)
        });
        if let Some(slot) = slot {
            #[cfg(feature = "webview")]
            crate::webview::close_window(node);
            if let Some(h) = slot.handle {
                if slot.is_main {
                    h.hide();
                } else {
                    h.close();
                }
            }
            window_event(node, "closed", json!({}));
        }
    }
    for node in added {
        let (props, bind_main) = engine::read(|e| {
            let p = e.tree.get(node).map(|n| (*n.props).clone()).unwrap_or_default();
            let main = e.main_node.is_none() && matches!(p.kind.as_deref(), None | Some("main"));
            (p, main)
        });
        if bind_main {
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
            });
        } else {
            open(node, &props);
        }
    }
}

/// Drains the bridge: applies ops, runs global commands, queues window commands, wakes windows.
fn drain() {
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
        crate::media::forget(*n);
    }
    for v in cmds {
        crate::commands::route(v);
    }
    let dirty: Vec<u32> = engine::with(|e| {
        let d: Vec<u32> = e.tree.dirty.drain().collect();
        for w in &d {
            if let Some(slot) = e.windows.get_mut(w) {
                slot.dirty = true;
            }
        }
        d
    });
    for w in dirty {
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
            if visible == Some(true) && applied.visible.is_some() {
                h.focus();
            }
            next.visible = visible;
        }
        if Some(p.always_on_top) != applied.on_top {
            h.set_always_on_top(p.always_on_top);
            next.on_top = Some(p.always_on_top);
        }
        if p.position.is_some() && p.position != applied.position {
            if let Some([x, y]) = p.position {
                h.set_position((x, y));
            }
            next.position = p.position;
        }
        if Some(p.click_through) != applied.click_through {
            if let Err(e) = h.set_click_through(p.click_through) {
                eprintln!("stella-engine: click-through: {e}");
            }
            next.click_through = Some(p.click_through);
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
    drain();
    if s.main && s.node == 0
        && let Some(m) = engine::read(|e| e.main_node)
    {
        s.node = m;
    }
    if s.main && let Some(m) = engine::read(|e| e.main_node) && s.node != m {
        s.node = m;
    }
    let node = s.node;
    if engine::read(|e| e.ts_dead && e.windows.is_empty()) {
        return false;
    }
    let taken = engine::with(|e| {
        let first = !e.first_commit;
        let slot = e.windows.get_mut(&node)?;
        let dirty = std::mem::take(&mut slot.dirty);
        let cmds = std::mem::take(&mut slot.cmds);
        let first_commit = dirty && !slot.committed;
        if dirty {
            slot.committed = true;
            e.first_commit = true;
        }
        Some((dirty, cmds, first_commit, first))
    });
    let mut changed = false;
    if let Some((dirty, cmds, first_commit, _)) = taken {
        if dirty {
            apply_window_props(node, tx);
            sync_inputs(s);
            #[cfg(feature = "webview")]
            sync_webviews(node);
            if first_commit {
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
        for WinCmd::Req(rid, v) in cmds {
            crate::commands::run(s, tx, rid, v);
            changed = true;
        }
    }
    crate::control::tick(s, tx);
    #[cfg(feature = "webview")]
    if crate::webview::active() {
        crate::webview::pump();
        tx.wake_after(Duration::from_millis(8));
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
    for (id, p) in views {
        crate::webview::sync(id, &p);
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

pub fn first_window() -> Option<u32> {
    engine::read(|e| e.main_node.or_else(|| e.windows.keys().min().copied()))
}

