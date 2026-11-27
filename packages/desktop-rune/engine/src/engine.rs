//! The engine's shared UI-thread state: the mirrored tree, the window registry, the bridge's
//! receiving end and the event writer. Every window's view, poll and handlers run on the one UI
//! thread, so this lives in thread-locals; nothing here is touched from the bridge thread.

use std::cell::RefCell;
use std::collections::HashMap;
use std::io::Write;
use std::sync::{Arc, Mutex, mpsc};

use rune::{Tx, Waker, WindowHandle};

use crate::metrics::{METRICS, epoch_ms, epoch_of};
use crate::protocol::Msg;
use crate::tree::Tree;

/// A command for one window, run inside that window's poll with its `Tx`.
pub enum WinCmd {
    /// A request from TS: `(rid, cmd json)`.
    Req(Option<u64>, serde_json::Value),
}

#[derive(Default)]
pub struct WinSlot {
    pub handle: Option<WindowHandle>,
    pub waker: Option<Waker>,
    pub dirty: bool,
    pub committed: bool,
    pub cmds: Vec<WinCmd>,
    pub is_main: bool,
    /// The window props last applied natively: (title, size, visible, on top, position, dark).
    pub applied: Applied,
    pub fonts_applied: usize,
    pub families_applied: u64,
    pub size: Option<(f32, f32)>,
    pub focused: bool,
    /// What had focus at the window's last poll.
    pub focus: Option<crate::swap_view::Seen>,
    /// Fields the user typed into, with the text each last reported.
    pub typed: HashMap<u32, String>,
    pub swap_view: Option<crate::swap_view::View>,
    /// What a `<window>` replacing this one (same `id`, same options fixed at open) must share
    /// to take over its native window instead of opening another.
    pub baked: Option<String>,
}

/// A window's (min, max) inner size, logical points; `None` = no limit on that side.
pub type SizeLimits = (Option<[f32; 2]>, Option<[f32; 2]>);

#[derive(Default, PartialEq, Clone)]
pub struct Applied {
    pub title: Option<String>,
    pub size: Option<(f32, f32)>,
    pub visible: Option<bool>,
    pub on_top: Option<bool>,
    pub position: Option<[i32; 2]>,
    pub dark: Option<Option<bool>>,
    pub titlebar: Option<f32>,
    pub click_through: Option<bool>,
    pub content_protection: Option<bool>,
    pub font_smoothing: Option<Option<String>>,
    pub size_limits: Option<SizeLimits>,
}

pub struct Engine {
    pub tree: Tree,
    pub rx: Option<mpsc::Receiver<Msg>>,
    pub windows: HashMap<u32, WinSlot>,
    /// The `<window>` node shown in the window the engine opened at launch.
    pub main_node: Option<u32>,
    /// Windows a replacing `<window>` took over: each earlier node to the one holding the native
    /// window now (see [`Engine::window_now`]), until that window closes.
    pub rebound: HashMap<u32, u32>,
    pub main_handle: Option<WindowHandle>,
    pub main_waker: Arc<Mutex<Option<Waker>>>,
    pub blobs: HashMap<u32, Arc<[u8]>>,
    pub fonts: Vec<Arc<[u8]>>,
    /// The font files in `fonts`, by path, with the size and modified time they were read at:
    /// a UI generation sends its fonts again, and an unchanged file is not added twice.
    pub font_files: HashMap<String, (u64, Option<std::time::SystemTime>)>,
    pub families: Option<(String, String)>,
    pub families_gen: u64,
    pub color_motion: Option<f32>,
    pub ts_dead: bool,
    pub first_commit: bool,
    /// Until when (and while no user input arrives after `USER_INPUT` reads this count) commits
    /// finishing a hot swap land without motion, so the new tree appears as it settled.
    pub swap_settle: Option<(std::time::Instant, u64)>,
    pub child: Option<std::process::Child>,
    /// Each scroll viewport's last reported offset and range (`[x, y, max x, max y]`), by node.
    pub scrolled: HashMap<u32, [f32; 4]>,
}

impl Engine {
    /// The `<window>` node holding the native window opened for `node`: `node`, or the one that
    /// took it over on a remount. A window's state, compositor and move events follow it.
    pub fn window_now(&self, node: u32) -> u32 {
        self.rebound.get(&node).copied().unwrap_or(node)
    }

    fn new() -> Self {
        Engine {
            tree: Tree::new(),
            rx: None,
            windows: HashMap::new(),
            rebound: HashMap::new(),
            main_node: None,
            main_handle: None,
            main_waker: Arc::new(Mutex::new(None)),
            blobs: HashMap::new(),
            fonts: Vec::new(),
            font_files: HashMap::new(),
            families: None,
            families_gen: 0,
            color_motion: None,
            ts_dead: false,
            first_commit: false,
            swap_settle: None,
            child: None,
            scrolled: HashMap::new(),
        }
    }
}

thread_local! {
    pub static ENGINE: RefCell<Engine> = RefCell::new(Engine::new());
    static OUT: RefCell<Option<Box<dyn Write>>> = const { RefCell::new(None) };
}

pub fn with<R>(f: impl FnOnce(&mut Engine) -> R) -> R {
    ENGINE.with(|e| f(&mut e.borrow_mut()))
}

pub fn read<R>(f: impl FnOnce(&Engine) -> R) -> R {
    ENGINE.with(|e| f(&e.borrow()))
}

pub fn set_out(w: Box<dyn Write>) {
    OUT.with(|o| *o.borrow_mut() = Some(w));
}

/// Writes one JSON line to the TS host. A closed pipe means the host is gone.
pub fn send(v: serde_json::Value) {
    let line = v.to_string();
    let dead = OUT.with(|o| {
        let mut o = o.borrow_mut();
        let Some(w) = o.as_mut() else { return false };
        if w.write_all(line.as_bytes()).and_then(|_| w.write_all(b"\n")).and_then(|_| w.flush()).is_err() {
            *o = None;
            return true;
        }
        false
    });
    if dead {
        ENGINE.with(|e| {
            if let Ok(mut e) = e.try_borrow_mut() {
                e.ts_dead = true;
            }
        });
    }
}

/// An element event: `{t:"ev", n, e, seq, at, input, ...extra}`. `seq` lets the next commit
/// acknowledge it (input-to-photon metrics).
pub fn element_event(node: u32, name: &str, extra: serde_json::Value, tx: Option<&mut Tx>) {
    let input = tx.and_then(|t| t.input_time()).map(epoch_of);
    if input.is_some() {
        crate::swap_view::USER_INPUT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }
    let now = epoch_ms();
    let seq = {
        let mut m = METRICS.lock().unwrap_or_else(|e| e.into_inner());
        m.event_seq += 1;
        let seq = m.event_seq;
        m.pending_events.insert(seq, (input.unwrap_or(now), now, name.to_owned()));
        seq
    };
    let mut v = serde_json::json!({ "t": "ev", "n": node, "e": name, "seq": seq, "at": now, "input": input });
    if let (Some(o), serde_json::Value::Object(extra)) = (v.as_object_mut(), extra) {
        o.extend(extra);
    }
    send(v);
}

/// A reply to a request: `{t:"reply", rid, ok, value | error}`.
/// `reply` from a thread other than the UI thread: the next poll writes it.
pub fn reply_any_thread(rid: Option<u64>, result: Result<serde_json::Value, String>) {
    match (rid, result) {
        (Some(rid), Ok(value)) => crate::windows::send_any_thread(serde_json::json!({ "t": "reply", "rid": rid, "ok": true, "value": value })),
        (Some(rid), Err(error)) => crate::windows::send_any_thread(serde_json::json!({ "t": "reply", "rid": rid, "ok": false, "error": error })),
        (None, Err(e)) => eprintln!("stella-engine: command failed: {e}"),
        (None, Ok(_)) => {}
    }
}

pub fn reply(rid: Option<u64>, result: Result<serde_json::Value, String>) {
    let Some(rid) = rid else {
        if let Err(e) = result {
            eprintln!("stella-engine: command failed: {e}");
        }
        return;
    };
    send(match result {
        Ok(value) => serde_json::json!({ "t": "reply", "rid": rid, "ok": true, "value": value }),
        Err(error) => serde_json::json!({ "t": "reply", "rid": rid, "ok": false, "error": error }),
    });
}

/// A window lifecycle event keyed by the window's `id` prop (and node).
pub fn window_event(node: u32, kind: &str, extra: serde_json::Value) {
    let id = read(|e| e.tree.get(node).and_then(|n| n.props.id.clone()));
    let mut v = serde_json::json!({ "t": "window", "id": id, "n": node, "kind": kind });
    if let (Some(o), serde_json::Value::Object(extra)) = (v.as_object_mut(), extra) {
        o.extend(extra);
    }
    send(v);
}

pub fn wake(node: u32) {
    let w = read(|e| e.windows.get(&node).and_then(|s| s.waker.clone()));
    if let Some(w) = w {
        w();
    }
}

/// UTF-8 byte offset → UTF-16 code unit offset (what JS strings index by).
pub fn utf16_of(s: &str, byte: usize) -> usize {
    s[..byte.min(s.len())].encode_utf16().count()
}

/// UTF-16 code unit offset → UTF-8 byte offset on a char boundary.
pub fn byte_of(s: &str, u16: usize) -> usize {
    let mut n = 0;
    for (i, c) in s.char_indices() {
        if n >= u16 {
            return i;
        }
        n += c.len_utf16();
    }
    s.len()
}
