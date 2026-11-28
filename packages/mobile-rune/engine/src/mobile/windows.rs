//! The phone has one window: the app's Metal layer, driven by `rune::embed::LayerHost`. The
//! first `<window>` root child (or the one with `kind="main"`) shows in it; other `<window>`s
//! (detached viewers, the desktop's companion and overlays) have nowhere to open and draw
//! nothing. The shape follows the desktop's windows.rs so the shared modules (view, input,
//! swap_view, fx, markdown) find what they reach for.

use std::collections::HashMap;
use std::sync::Mutex;

use rune::{AppSpec, Cx, El, Spring, Tx, Waker, col};
use serde_json::json;

use crate::engine::{self, Applied, Engine, WinCmd, window_event};
use crate::input::InputState;
use crate::metrics::{METRICS, epoch_ms};
use crate::props::{Kind, Props};
use crate::protocol::{Msg, Op};
use crate::view::build;

pub use crate::stage::{note_stage_rider, stage_close_drag, stage_live, stage_open_drag};

#[derive(Default)]
pub struct Win {
    pub node: u32,
    pub main: bool,
    pub inputs: HashMap<u32, InputState>,
    /// Set by the `bg` command; wins over the `<window>`'s own `bg`.
    pub bg: Option<rune::Color>,
}

/// Every window's waker, for work that lands off the UI thread (images, decoded media).
pub static WAKERS: Mutex<Vec<Waker>> = Mutex::new(Vec::new());
/// Events produced off the UI thread, written by the next poll.
pub static OUTBOX: Mutex<Vec<serde_json::Value>> = Mutex::new(Vec::new());

pub fn wake_all() {
    for w in WAKERS.lock().unwrap_or_else(|e| e.into_inner()).iter() {
        w();
    }
}

/// Queues an event from any thread and wakes the window to write it.
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
    let node = s.node;
    let safe = cx.safe_area();
    let root = engine::read(|eng| {
        let mut root = col().key("stella-root").w_full().h_full().fill(s.bg.unwrap_or_else(|| bg(eng, node)));
        if let Some(n) = eng.tree.get(node).filter(|_| node != 0) {
            if let Some(k) = n.props.zoom {
                cx.zoom(k);
            }
            let p = &*n.props;
            let mut inner = Props { fill: None, bg: None, ..p.clone() };
            inner.w = None;
            inner.h = None;
            inner.id = None;
            root = crate::style::paint(root, &inner);
            root = crate::view::children(s, eng, n, root);
            for l in eng.tree.lifted_in(node) {
                let mut layer = build(s, eng, l);
                if eng.tree.get(l).is_some_and(|n| n.props.dir.is_none()) {
                    match eng.tree.dir_of(l) {
                        Some("rtl") => layer = layer.dir(rune::Direction::Rtl),
                        Some("ltr") => layer = layer.dir(rune::Direction::Ltr),
                        _ => {}
                    }
                }
                root = root.child(layer);
            }
        }
        root
    });
    note_state(node, dark, safe, [cx.system_reduced_transparency(), cx.system_increased_contrast(), cx.system_contrast().is_some()]);
    // As in CSS, a change lands at once unless its element asks for motion (`motion`, `layout`).
    let root = root.motion(rune::Spring::NONE);
    root.on_layout(move |s: &mut Win, r: [f32; 4]| {
        if s.node == 0 {
            return;
        }
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
    static SYSTEM_DARK: std::cell::Cell<Option<bool>> = const { std::cell::Cell::new(None) };
    static SAFE: std::cell::Cell<[f32; 4]> = const { std::cell::Cell::new([0.0; 4]) };
    static KEYBOARD: std::cell::Cell<f32> = const { std::cell::Cell::new(0.0) };
    /// Where the keyboard is on the frame being built (KEYBOARD is where it is headed, for TS).
    static KEYBOARD_LIVE: std::cell::Cell<f32> = const { std::cell::Cell::new(0.0) };
    /// Elements with a `keyboard` prop, rebuilt whenever the live keyboard moves.
    static RIDERS: std::cell::RefCell<std::collections::HashSet<u32>> = std::cell::RefCell::new(std::collections::HashSet::new());
    static A11Y: std::cell::Cell<[bool; 3]> = const { std::cell::Cell::new([false; 3]) };
}

pub fn system_dark() -> Option<bool> {
    SYSTEM_DARK.with(|d| d.get())
}

/// What `appearance.get` answers and `appearance` events carry, plus the phone's insets.
pub fn appearance() -> serde_json::Value {
    let [t, r, b, l] = SAFE.with(|s| s.get());
    let [reduce_transparency, increase_contrast, forced_colors] = A11Y.with(|a| a.get());
    json!({
        "dark": system_dark().unwrap_or(false),
        "accentColor": null,
        "reduceTransparency": reduce_transparency,
        "increaseContrast": increase_contrast,
        "forcedColors": forced_colors,
        "safeArea": { "top": t, "right": r, "bottom": b, "left": l },
        "keyboard": KEYBOARD.with(|k| k.get()),
    })
}

fn note_state(_node: u32, dark: bool, safe: [f32; 4], a11y: [bool; 3]) {
    let safe_changed = SAFE.with(|s| s.replace(safe)) != safe;
    let a11y_changed = A11Y.with(|a| a.replace(a11y)) != a11y;
    if SYSTEM_DARK.with(|d| d.replace(Some(dark))) != Some(dark) || safe_changed || a11y_changed {
        let mut ev = appearance();
        ev["t"] = json!("appearance");
        engine::send(ev);
    }
}

/// Where the keyboard is headed: its overlap with the window (points) once its animation ends,
/// from the app's keyboard notifications. TS hears it once per move, as it starts.
pub fn set_keyboard(h: f32) {
    if KEYBOARD.with(|k| k.replace(h)) != h {
        let mut ev = appearance();
        ev["t"] = json!("appearance");
        engine::send(ev);
    }
}

/// Where the keyboard is on the frame about to be drawn, set by the app's display link just
/// before `sme_frame`: elements with a `keyboard` prop follow it in that same frame.
pub fn set_keyboard_live(h: f32) {
    if KEYBOARD_LIVE.with(|k| k.replace(h)) == h {
        return;
    }
    let riders: Vec<u32> = RIDERS.with(|r| r.borrow().iter().copied().collect());
    if riders.is_empty() {
        return;
    }
    let gone: Vec<u32> = engine::with(|e| {
        let mut gone = Vec::new();
        for id in riders {
            if e.tree.get(id).is_some_and(|n| n.props.keyboard.is_some()) {
                e.tree.touch(id);
            } else {
                gone.push(id);
            }
        }
        gone
    });
    RIDERS.with(|r| gone.iter().for_each(|id| {
        r.borrow_mut().remove(id);
    }));
    mark_dirty();
}

pub fn keyboard_live() -> f32 {
    KEYBOARD_LIVE.with(|k| k.get())
}

/// Limits an effect slot's backdrop copy to its rect grown by `pt` points: a lens reads only
/// its neighbourhood, and a full 3× copy per glass element is most of a frame's GPU time.
pub fn backdrop_reach(e: rune::El, pt: f32) -> rune::El {
    e.effect_backdrop_reach(pt)
}

pub fn note_keyboard_rider(id: u32) {
    RIDERS.with(|r| {
        r.borrow_mut().insert(id);
    });
}

pub fn on_key(s: &mut Win, ev: &rune::KeyEvent, tx: &mut Tx) -> bool {
    let keys = engine::read(|e| e.tree.get(s.node).map(|n| n.props.keys.clone()).unwrap_or_default());
    if keys.is_empty() {
        return false;
    }
    crate::keys::Chords::new(&keys).take(s.node, ev, tx)
}

pub fn setup(s: &mut Win, waker: Waker) {
    WAKERS.lock().unwrap_or_else(|e| e.into_inner()).push(waker.clone());
    s.main = true;
    let slot = engine::read(|e| e.main_waker.clone());
    *slot.lock().unwrap_or_else(|e| e.into_inner()) = Some(waker.clone());
    crate::media::init(std::sync::Arc::new(wake_all));
    waker();
}

fn leak(s: &str) -> &'static str {
    Box::leak(s.to_owned().into_boxed_str())
}

pub fn app_spec(size: (f32, f32)) -> AppSpec<Win> {
    let mut spec = AppSpec::new(leak("Stella"), size, || Win { main: true, ..Win::default() }, view);
    spec.min_size = Some((0.0, 0.0));
    spec.setup = Some(setup);
    spec.poll = Some(poll);
    spec.on_key = Some(on_key);
    spec
}

/// Whether the host's tree has a main window yet.
pub static MAIN_BOUND: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn windows_changed(added: Vec<u32>, removed: Vec<u32>) {
    for node in removed {
        let slot = engine::with(|e| {
            if e.main_node == Some(node) {
                e.main_node = None;
            }
            e.windows.remove(&node)
        });
        if slot.is_some() {
            window_event(node, "closed", json!({}));
        }
    }
    for node in added {
        let bind_main = engine::read(|e| {
            let p = e.tree.get(node).map(|n| (*n.props).clone()).unwrap_or_default();
            e.main_node.is_none() && matches!(p.kind.as_deref(), None | Some("main"))
        });
        if !bind_main {
            continue;
        }
        MAIN_BOUND.store(true, std::sync::atomic::Ordering::Release);
        engine::with(|e| {
            e.main_node = Some(node);
            let waker = e.main_waker.lock().unwrap_or_else(|x| x.into_inner()).clone();
            let slot = e.windows.entry(node).or_default();
            slot.waker = waker;
            slot.is_main = true;
            slot.dirty = true;
            slot.focused = true;
            slot.applied = Applied { dark: Some(None), ..Applied::default() };
        });
        window_event(node, "focus", json!({}));
    }
}

const SWAP_SETTLE: std::time::Duration = std::time::Duration::from_millis(600);

/// Drains the bridge: applies ops, runs global commands, queues window commands.
fn drain() {
    let mut batches = Vec::new();
    engine::with(|e| {
        let Some(rx) = e.rx.as_ref() else { return };
        while let Ok(m) = rx.try_recv() {
            batches.push(m);
        }
    });
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
        crate::media::forget(*n);
        crate::surface::forget(*n);
        crate::native::forget(*n);
        forget_selection(*n);
    }
    for v in cmds {
        crate::commands::route(v);
    }
    mark_dirty();
}

pub(crate) fn mark_dirty() {
    engine::with(|e| {
        let d: Vec<u32> = e.tree.dirty.drain().collect();
        for w in &d {
            if let Some(slot) = e.windows.get_mut(w) {
                slot.dirty = true;
            }
        }
    });
}

fn flush_outbox() {
    let out = std::mem::take(&mut *OUTBOX.lock().unwrap_or_else(|e| e.into_inner()));
    for v in out {
        engine::send(v);
    }
}

fn apply_window_props(node: u32, tx: &mut Tx) {
    let Some((p, applied)) = engine::read(|e| {
        let n = e.tree.get(node)?;
        let slot = e.windows.get(&node)?;
        Some(((*n.props).clone(), slot.applied.clone()))
    }) else {
        return;
    };
    let mut next = applied.clone();
    if Some(p.dark) != applied.dark {
        tx.set_color_scheme(match p.dark {
            Some(true) => rune::ColorScheme::Dark,
            Some(false) => rune::ColorScheme::Light,
            None => rune::ColorScheme::System,
        });
        next.dark = Some(p.dark);
        crate::native::send(json!({ "t": "colorScheme", "dark": p.dark }));
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
    push_inputs(s);
}

/// Sends the native views the text that changed on this side.
pub fn push_inputs(s: &mut Win) {
    for (id, st) in s.inputs.iter_mut().filter(|(_, st)| st.push) {
        st.push = false;
        crate::native::set_text(*id, &st.edit.text);
    }
}

/// Work the app hands the UI thread between frames (native field events), run in the next poll.
pub type Job = Box<dyn FnOnce(&mut Win, &mut Tx) + Send>;
pub static JOBS: Mutex<Vec<Job>> = Mutex::new(Vec::new());

pub fn post(job: Job) {
    JOBS.lock().unwrap_or_else(|e| e.into_inner()).push(job);
    wake_all();
}

pub fn poll(s: &mut Win, _now: f64, tx: &mut Tx) -> bool {
    flush_outbox();
    drain();
    let jobs = std::mem::take(&mut *JOBS.lock().unwrap_or_else(|e| e.into_inner()));
    let mut changed = !jobs.is_empty();
    for job in jobs {
        job(s, tx);
    }
    let closed = crate::fx::take_closed();
    if engine::with(|e| {
        let held = !e.tree.closing.is_empty();
        if held {
            e.tree.finish_closing(&closed);
        }
        held
    }) {
        mark_dirty();
    }
    let decoded = crate::media::decoded_since_built();
    let sized = !decoded.is_empty();
    if sized {
        engine::with(|e| decoded.into_iter().for_each(|n| e.tree.touch(n)));
        mark_dirty();
    }
    if let Some(m) = engine::read(|e| e.main_node)
        && s.node != m
    {
        s.node = m;
    }
    let node = s.node;
    let focus = crate::swap_view::seen(s, tx);
    engine::with(|e| {
        if let Some(slot) = e.windows.get_mut(&node)
            && slot.focus != focus
        {
            slot.focus = focus;
        }
    });
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
    if let Some((dirty, cmds, first_commit, settling)) = taken {
        if dirty {
            crate::native::note_commit();
            apply_window_props(node, tx);
            sync_inputs(s);
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
            crate::commands::run(s, tx, rid, v);
            changed = true;
        }
        if crate::swap_view::waiting(node) {
            crate::swap_view::place(s, tx, dirty);
        }
        push_inputs(s);
    }
    crate::native::check_covers::<Win>(tx);
    crate::view_frames::poll(tx);
    changed
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
    /// The text selected in the window, by the selectable element or group holding it.
    static SELECTIONS: std::cell::RefCell<HashMap<u32, HashMap<u32, String>>> = std::cell::RefCell::new(HashMap::new());
}

/// Text selection in a reply: tell TS (which may show its own copy bar) and the app (whose
/// edit menu copies it).
pub fn note_selection_change(window: u32, element: u32, change: &rune::SelectionChange, _tx: &mut Tx) {
    note_selection(window, element, change.selection().map(|t| t.text().to_owned()));
    if !change.dragging() {
        match selected_text(window) {
            Some(text) => {
                engine::send(json!({ "t": "selection", "window": window_id(window), "n": window, "text": text }));
                crate::native::send(json!({ "t": "selection", "text": text }));
            }
            None => engine::send(json!({ "t": "selection", "window": window_id(window), "n": window, "cleared": true })),
        }
    }
}

fn window_id(window: u32) -> Option<String> {
    engine::read(|e| e.tree.get(window).and_then(|n| n.props.id.clone()))
}

pub fn selection_rect(_window: u32) -> Option<serde_json::Value> {
    None
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
    SELECTIONS.with(|m| {
        m.borrow_mut().values_mut().for_each(|w| {
            w.remove(&element);
        })
    });
}

pub fn selected_text(window: u32) -> Option<String> {
    SELECTIONS.with(|m| m.borrow().get(&window).and_then(|w| w.values().max_by_key(|t| t.len()).cloned()))
}

pub fn first_window() -> Option<u32> {
    engine::read(|e| e.main_node.or_else(|| e.windows.keys().min().copied()))
}
