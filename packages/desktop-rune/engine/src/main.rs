//! stella-engine: a compiled Rune engine whose whole UI is driven from TypeScript.
//!
//! The binary knows nothing about Stella's screens. It spawns a Bun process (`ui/host.tsx`),
//! reads a binary command buffer of tree mutations from its stdout, keeps a retained mirror
//! tree, and turns that tree into Rune `El`s on each commit. Layout, text, scrolling, hover,
//! springs and painting stay native; only state changes cross the bridge. Input that the
//! TypeScript side handles (presses, submits, edits) goes back as JSON lines on Bun's stdin.

mod metrics;
mod props;
mod protocol;
#[cfg(feature = "webview")]
mod webview;

use std::collections::HashMap;
use std::io::Write;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex, mpsc};
use std::time::{Duration, Instant};

use rune::{App, AppSpec, Cx, El, Spring, TextEdit, Tx, Waker, col, el, rich, row, text, text_input};

use crate::metrics::{epoch_ms, epoch_of, METRICS};
use crate::props::{Kind, Props};
use crate::protocol::{Msg, Op};

/// A scripted window resize: start, from, to, duration in seconds.
type ResizeRun = (Instant, (f32, f32), (f32, f32), f32);

/// The engine's state: the mirrored tree and the bridge.
struct State {
    tree: Tree,
    rx: mpsc::Receiver<Msg>,
    to_ts: Option<ChildStdin>,
    child: Option<Child>,
    inputs: HashMap<String, TextEdit>,
    /// The window background before the first TS commit lands (Stella dark bg).
    bg: rune::Color,
    /// A scripted window resize in flight: (start, from, to, duration).
    resize: Option<ResizeRun>,
    /// Glide/scroll requests queued from TS commands, applied in the next poll.
    first_commit: bool,
    ts_dead: bool,
    /// A scripted continuous scroll (like a held trackpad swipe): key, start, speed pt/s, duration s.
    scroll_run: Option<(String, Instant, f32, f32)>,
}

#[derive(Default)]
struct Node {
    kind: Kind,
    props: Props,
    children: Vec<u32>,
    parent: u32,
    /// Bumped whenever this node or anything under it changes; the memo version.
    ver: u64,
}

#[derive(Default)]
struct Tree {
    nodes: HashMap<u32, Node>,
    clock: u64,
}

impl Tree {
    fn new() -> Self {
        let mut t = Tree::default();
        t.nodes.insert(0, Node { kind: Kind::Col, ..Default::default() });
        t
    }

    fn touch(&mut self, mut id: u32) {
        self.clock += 1;
        let v = self.clock;
        // Walk to the root, bumping every ancestor's version so memos above rebuild.
        for _ in 0..4096 {
            let Some(n) = self.nodes.get_mut(&id) else { return };
            if n.ver == v {
                return;
            }
            n.ver = v;
            if id == 0 {
                return;
            }
            id = n.parent;
        }
    }

    fn detach(&mut self, parent: u32, child: u32) {
        if let Some(p) = self.nodes.get_mut(&parent) {
            p.children.retain(|c| *c != child);
        }
    }

    fn destroy(&mut self, id: u32) {
        if let Some(n) = self.nodes.remove(&id) {
            for c in n.children {
                self.destroy(c);
            }
        }
    }

    fn apply(&mut self, op: Op) {
        match op {
            Op::Create { id, kind } => {
                self.nodes.insert(id, Node { kind, ..Default::default() });
            }
            Op::Props { id, props } => {
                if let Some(n) = self.nodes.get_mut(&id) {
                    n.props = *props;
                }
                self.touch(id);
            }
            Op::Append { parent, child } => {
                self.detach_from_old(child);
                if let Some(p) = self.nodes.get_mut(&parent) {
                    p.children.push(child);
                }
                if let Some(c) = self.nodes.get_mut(&child) {
                    c.parent = parent;
                }
                self.touch(parent);
            }
            Op::Insert { parent, child, before } => {
                self.detach_from_old(child);
                if let Some(p) = self.nodes.get_mut(&parent) {
                    let at = p.children.iter().position(|c| *c == before).unwrap_or(p.children.len());
                    p.children.insert(at, child);
                }
                if let Some(c) = self.nodes.get_mut(&child) {
                    c.parent = parent;
                }
                self.touch(parent);
            }
            Op::Remove { parent, child } => {
                self.detach(parent, child);
                self.destroy(child);
                self.touch(parent);
            }
            Op::Commit { .. } | Op::Cmd(_) => {}
        }
    }

    fn detach_from_old(&mut self, child: u32) {
        if let Some(old) = self.nodes.get(&child).map(|c| c.parent)
            && self.nodes.get(&old).is_some_and(|p| p.children.contains(&child))
        {
            self.detach(old, child);
            self.touch(old);
        }
    }
}

fn send(s: &mut State, line: String) {
    if let Some(w) = s.to_ts.as_mut()
        && w.write_all(line.as_bytes()).and_then(|_| w.write_all(b"\n")).and_then(|_| w.flush()).is_err()
    {
        s.to_ts = None;
        s.ts_dead = true;
    }
}

fn event(s: &mut State, kind: &str, key: &str, extra: serde_json::Value, tx: &mut Tx) {
    let input = tx.input_time().map(epoch_of);
    let now = epoch_ms();
    let seq = {
        let mut m = METRICS.lock().unwrap_or_else(|e| e.into_inner());
        m.event_seq += 1;
        let seq = m.event_seq;
        m.pending_events.insert(seq, (input.unwrap_or(now), now, kind.to_owned()));
        seq
    };
    let mut v = serde_json::json!({ "t": kind, "key": key, "seq": seq, "at": now, "input": input });
    if let (Some(o), serde_json::Value::Object(extra)) = (v.as_object_mut(), extra) {
        o.extend(extra);
    }
    send(s, v.to_string());
}

// ----------------------------------------------------------------------------------------------
// The view: mirror tree → El
// ----------------------------------------------------------------------------------------------

fn view(s: &State, _cx: &mut Cx<State>) -> El {
    let root = &s.tree.nodes[&0];
    let mut c = col().key("stella-root").w_full().h_full().fill(s.bg);
    for id in &root.children {
        c = c.child(build(s, *id));
    }
    c
}

fn build(s: &State, id: u32) -> El {
    let Some(n) = s.tree.nodes.get(&id) else { return el() };
    // Keyed nodes memoize on their subtree version: an unchanged message never rebuilds.
    // Inputs never memoize: their text lives in State, not in the tree.
    match &n.props.id {
        Some(key) if !matches!(n.kind, Kind::Input) => rune::memo::memo_with_hash(key.clone(), n.ver, || build_node(s, n)),
        _ => build_node(s, n),
    }
}

fn build_node(s: &State, n: &Node) -> El {
    let p = &n.props;
    let mut e = match n.kind {
        Kind::Row => row(),
        Kind::Col => col(),
        Kind::Box => el(),
        Kind::Text => match &p.spans {
            Some(runs) => {
                let (content, spans) = props::spans(runs);
                rich(content, spans)
            }
            None => text(p.content.clone().unwrap_or_default()),
        },
        Kind::Input => {
            let key = p.id.clone().unwrap_or_else(|| "input".into());
            return build_input(s, key, p);
        }
    };
    if matches!(n.kind, Kind::Text) {
        e = props::text_style(e, p);
    }
    e = props::apply(e, p);
    for c in &n.children {
        e = e.child(build(s, *c));
    }
    #[cfg(feature = "webview")]
    if let Some(url) = p.webview.clone() {
        e = e.on_drawn_layout(move |_s: &mut State, r: [f32; 4]| webview::place(&url, r));
    }
    if p.on_press {
        let key = p.id.clone().unwrap_or_default();
        e = e.on_press_tx(move |s: &mut State, tx: &mut Tx| event(s, "press", &key, serde_json::json!({}), tx));
    }
    e
}

fn build_input(s: &State, key: String, p: &Props) -> El {
    // The TextEdit lives natively in State (keyed by the TS `id`), so typing, selection, IME and
    // undo never cross the bridge; TS hears the value afterwards.
    let k1 = key.clone();
    let k2 = key.clone();
    let k3 = key.clone();
    let style = props::text_style_of(p);
    let placeholder_color = p.placeholder_color.map(|c| c.0).unwrap_or(rune::Color::TRANSPARENT);
    let blank = TextEdit::new("");
    let mut e = text_input(s.inputs.get(&key).unwrap_or(&blank), style);
    e = e
        .key(key.clone())
        .on_edit(move |s: &mut State| s.inputs.entry(k1.clone()).or_insert_with(|| TextEdit::new("")))
        .on_input_change(move |s: &mut State, tx: &mut Tx| {
            let value = s.inputs.get(&k2).map(|e| e.text.clone()).unwrap_or_default();
            METRICS.lock().unwrap_or_else(|e| e.into_inner()).typing_input = tx.input_time().map(epoch_of);
            event(s, "input", &k2, serde_json::json!({ "value": value }), tx);
        })
        .on_submit(move |s: &mut State, tx: &mut Tx| {
            let value = s.inputs.get(&k3).map(|e| e.text.clone()).unwrap_or_default();
            if let Some(ed) = s.inputs.get_mut(&k3) {
                ed.clear();
            }
            event(s, "submit", &k3, serde_json::json!({ "value": value }), tx);
        });
    if let Some(ph) = &p.placeholder {
        e = e.placeholder(ph.clone(), placeholder_color);
    }
    if let Some(c) = p.color {
        e = e.color(c.0);
    }
    props::apply(e, p)
}

/// Keeps the native edit in sync with the tree: the first time an input appears we seed it.
fn sync_inputs(s: &mut State) {
    for n in s.tree.nodes.values() {
        if matches!(n.kind, Kind::Input)
            && let Some(key) = &n.props.id
            && !s.inputs.contains_key(key)
        {
            let mut ed = TextEdit::new(n.props.value.as_deref().unwrap_or(""));
            if n.props.auto_focus {
                ed.focused = true;
            }
            s.inputs.insert(key.clone(), ed);
        }
    }
}

// ----------------------------------------------------------------------------------------------
// Poll: drain the bridge
// ----------------------------------------------------------------------------------------------

fn poll(s: &mut State, _now: f64, tx: &mut Tx) -> bool {
    let mut changed = false;
    if let Some((start, from, to, dur)) = s.resize {
        let t = (start.elapsed().as_secs_f32() / dur).min(1.0);
        // Ease in-out like a hand dragging the corner and back.
        let k = 0.5 - 0.5 * (std::f32::consts::PI * 2.0 * t).cos();
        tx.resize_window((from.0 + (to.0 - from.0) * k, from.1 + (to.1 - from.1) * k));
        if t >= 1.0 {
            s.resize = None;
            tx.resize_window(from);
        } else {
            tx.wake_after(Duration::ZERO);
        }
        changed = true;
    }
    if let Some((key, start, speed, dur)) = s.scroll_run.clone() {
        let t = start.elapsed().as_secs_f32();
        let (_, max) = props::scroll_of(&key);
        if max > 0.0 {
            // Triangle wave: down to the top, back to the end, at a constant hand speed.
            let travel = (speed * t) % (2.0 * max);
            let y = if travel < max { max - travel } else { travel - max };
            tx.scroll_to(key.clone(), 0.0, y);
        }
        if t >= dur {
            s.scroll_run = None;
        } else {
            tx.wake_after(Duration::ZERO);
        }
        changed = true;
    }
    loop {
        let msg = match s.rx.try_recv() {
            Ok(m) => m,
            Err(mpsc::TryRecvError::Empty) => break,
            Err(mpsc::TryRecvError::Disconnected) => {
                if !s.ts_dead {
                    s.ts_dead = true;
                    eprintln!("stella-engine: TS host disconnected; keeping the last tree on screen");
                }
                break;
            }
        };
        match msg {
            Msg::Batch(ops, received_at) => {
                for op in ops {
                    match op {
                        Op::Commit { generation, ack, t0, kind } => {
                            let mut m = METRICS.lock().unwrap_or_else(|e| e.into_inner());
                            m.on_commit(generation, ack, t0, kind, received_at, epoch_ms());
                            if !s.first_commit {
                                s.first_commit = true;
                                tx.instant();
                            } else {
                                // A TS commit has a cause (an event, a timer, a live edit) even
                                // though it arrives through poll: let it move on its springs.
                                tx.animated();
                            }
                        }
                        Op::Cmd(v) => command(s, v, tx),
                        op => s.tree.apply(op),
                    }
                }
                changed = true;
            }
        }
    }
    if changed {
        sync_inputs(s);
    }
    #[cfg(feature = "webview")]
    {
        if changed && webview::active() && !s.tree.nodes.values().any(|n| n.props.webview.is_some()) {
            webview::close();
        }
        if webview::active() {
            webview::pump();
            tx.wake_after(Duration::from_millis(8));
        }
    }
    changed
}

fn command(s: &mut State, v: serde_json::Value, tx: &mut Tx) {
    tx.animated();
    let cmd = v.get("cmd").and_then(|c| c.as_str()).unwrap_or("");
    let f = |k: &str| v.get(k).and_then(|x| x.as_f64()).map(|x| x as f32);
    match cmd {
        "scrollTo" => {
            let key = v.get("key").and_then(|k| k.as_str()).unwrap_or("").to_owned();
            let y = if v.get("y").and_then(|y| y.as_str()) == Some("end") { props::scroll_of(&key).1 } else { f("y").unwrap_or(0.0) };
            match f("spring") {
                Some(d) if d > 0.0 => tx.scroll_to_with(key, 0.0, y, Spring::new(d, 0.0)),
                _ => tx.scroll_to(key, 0.0, y),
            }
        }
        "scrollRun" => {
            let key = v.get("key").and_then(|k| k.as_str()).unwrap_or("").to_owned();
            s.scroll_run = Some((key, Instant::now(), f("speed").unwrap_or(4000.0), f("dur").unwrap_or(5.0)));
            tx.wake_after(Duration::ZERO);
        }
        "resizeAnim" => {
            let w = f("w").unwrap_or(1280.0);
            let h = f("h").unwrap_or(820.0);
            let w2 = f("w2").unwrap_or(900.0);
            let h2 = f("h2").unwrap_or(640.0);
            s.resize = Some((Instant::now(), (w, h), (w2, h2), f("dur").unwrap_or(1.5)));
            tx.wake_after(Duration::ZERO);
        }
        "resize" => tx.resize_window((f("w").unwrap_or(1280.0), f("h").unwrap_or(820.0))),
        "bg" => {
            if let Some(c) = v.get("color").and_then(|c| c.as_str()).and_then(rune::color::hex) {
                s.bg = c;
            }
        }
        "recStart" => METRICS.lock().unwrap_or_else(|e| e.into_inner()).rec_start(v.get("label").and_then(|l| l.as_str()).unwrap_or("run")),
        "recStop" => {
            let out = METRICS.lock().unwrap_or_else(|e| e.into_inner()).rec_stop();
            send(s, serde_json::json!({ "t": "rec", "result": out }).to_string());
        }
        "mark" => {
            let m = METRICS.lock().unwrap_or_else(|e| e.into_inner());
            m.log(serde_json::json!({ "mark": v.get("name"), "at": epoch_ms() }));
        }
        "quit" => {
            if let Some(mut c) = s.child.take() {
                let _ = c.kill();
                let _ = c.wait();
            }
            std::process::exit(0);
        }
        other => eprintln!("stella-engine: unknown command {other}"),
    }
}

/// Window shortcuts (Ctrl/Cmd + letter) go to TS; everything else stays native.
fn on_key(s: &mut State, ev: &rune::KeyEvent, tx: &mut Tx) -> bool {
    if let rune::Key::Command(c) = &ev.key {
        let name = format!("mod+{c}");
        event(s, "key", &name, serde_json::json!({}), tx);
        return true;
    }
    false
}

// ----------------------------------------------------------------------------------------------
// Startup
// ----------------------------------------------------------------------------------------------

struct Boot {
    rx: mpsc::Receiver<Msg>,
    stdin: ChildStdin,
    child: Child,
    waker: Arc<Mutex<Option<Waker>>>,
}

static BOOT: Mutex<Option<Boot>> = Mutex::new(None);
static WAKER: Mutex<Option<Arc<Mutex<Option<Waker>>>>> = Mutex::new(None);

fn spawn_ts() -> Boot {
    let root = std::env::var("STELLA_RUNE_ROOT").unwrap_or_else(|_| {
        let exe = std::env::current_exe().ok();
        exe.and_then(|p| p.ancestors().nth(4).map(|p| p.to_string_lossy().into_owned())).unwrap_or_else(|| ".".into())
    });
    let bun = std::env::var("STELLA_RUNE_BUN").unwrap_or_else(|_| "bun".into());
    let host = format!("{root}/host/main.tsx");
    let mut child = Command::new(&bun)
        .arg(&host)
        .current_dir(&root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .unwrap_or_else(|e| panic!("could not start the TS UI host ({bun} {host}): {e}"));
    let stdout = child.stdout.take().expect("piped stdout");
    let stdin = child.stdin.take().expect("piped stdin");
    let (tx, rx) = mpsc::channel();
    let waker: Arc<Mutex<Option<Waker>>> = Arc::new(Mutex::new(None));
    let w2 = waker.clone();
    std::thread::Builder::new()
        .name("ts-bridge".into())
        .spawn(move || protocol::read_loop(stdout, tx, w2))
        .expect("bridge thread");
    Boot { rx, stdin, child, waker }
}

fn init() -> State {
    let boot = BOOT.lock().unwrap_or_else(|e| e.into_inner()).take().expect("booted");
    *WAKER.lock().unwrap_or_else(|e| e.into_inner()) = Some(boot.waker.clone());
    State {
        tree: Tree::new(),
        rx: boot.rx,
        to_ts: Some(boot.stdin),
        child: Some(boot.child),
        inputs: HashMap::new(),
        bg: rune::color::hex("#0b0b0d").unwrap_or(rune::Color::TRANSPARENT),
        resize: None,
        first_commit: false,
        ts_dead: false,
        scroll_run: None,
    }
}

fn setup(_s: &mut State, waker: Waker) {
    if let Some(slot) = WAKER.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
        *slot.lock().unwrap_or_else(|e| e.into_inner()) = Some(waker.clone());
    }
    // Anything that arrived before the waker existed is drained on the next frame.
    waker();
}

fn main() {
    metrics::mark_process_start();
    // Start the TS host before the window and GPU: Bun boots while Rune prewarms the GPU.
    *BOOT.lock().unwrap_or_else(|e| e.into_inner()) = Some(spawn_ts());
    let w = std::env::var("STELLA_RUNE_W").ok().and_then(|v| v.parse().ok()).unwrap_or(1280.0);
    let h = std::env::var("STELLA_RUNE_H").ok().and_then(|v| v.parse().ok()).unwrap_or(820.0);
    let mut spec = AppSpec::new("Stella (Rune)", (w, h), init, view);
    spec.min_size = Some((640.0, 480.0));
    spec.setup = Some(setup);
    spec.poll = Some(poll);
    spec.on_key = Some(on_key);
    let app = App::new(spec);
    #[cfg(feature = "webview")]
    let app = app.on_ready(|h| webview::set_window(h));
    app
        .on_frame_encoded(|f| METRICS.lock().unwrap_or_else(|e| e.into_inner()).on_frame(f))
        .on_quit(|s: &mut State, _| {
            if let Some(mut c) = s.child.take() {
                let _ = c.kill();
                let _ = c.wait();
            }
        })
        .run();
}
