//! Verification hooks: real input injected through Rune's input paths (`control.input`), the
//! element tree as Rune sees it (`control.elements`), and the PoC's scripted bench motions.

use std::cell::RefCell;
use std::time::{Duration, Instant};

use rune::Tx;
use serde_json::{Value, json};

use crate::engine::{self, reply};
use crate::windows::Win;

/// A scripted window resize: start, from, to, duration in seconds.
type ResizeRun = (Instant, (f32, f32), (f32, f32), f32);

thread_local! {
    static RESIZE: RefCell<Option<ResizeRun>> = const { RefCell::new(None) };
    static SCROLL: RefCell<Option<(String, Instant, f32, f32)>> = const { RefCell::new(None) };
    static SCROLL_POS: RefCell<std::collections::HashMap<String, f32>> = RefCell::new(std::collections::HashMap::new());
}

pub fn resize_anim(v: &Value) {
    let f = |k: &str, d: f32| v.get(k).and_then(|x| x.as_f64()).map(|x| x as f32).unwrap_or(d);
    RESIZE.with(|r| *r.borrow_mut() = Some((Instant::now(), (f("w", 1280.0), f("h", 820.0)), (f("w2", 900.0), f("h2", 640.0)), f("dur", 1.5))));
}

pub fn scroll_run(key: String, speed: f32, dur: f32, at: Instant) {
    SCROLL.with(|r| *r.borrow_mut() = Some((key, at, speed, dur)));
}

/// The last reported vertical scroll extent of a keyed viewport (for scripted scrolling).
pub fn note_scroll_max(key: &str, max: f32) {
    SCROLL_POS.with(|m| m.borrow_mut().insert(key.to_owned(), max));
}

pub fn tick(s: &mut Win, tx: &mut Tx) {
    if !s.main {
        return;
    }
    let run = RESIZE.with(|r| *r.borrow());
    if let Some((start, from, to, dur)) = run {
        let t = (start.elapsed().as_secs_f32() / dur).min(1.0);
        let k = 0.5 - 0.5 * (std::f32::consts::PI * 2.0 * t).cos();
        tx.resize_window((from.0 + (to.0 - from.0) * k, from.1 + (to.1 - from.1) * k));
        if t >= 1.0 {
            RESIZE.with(|r| *r.borrow_mut() = None);
            tx.resize_window(from);
        } else {
            tx.wake_after(Duration::ZERO);
        }
    }
    let run = SCROLL.with(|r| r.borrow().clone());
    if let Some((key, start, speed, dur)) = run {
        let t = start.elapsed().as_secs_f32();
        let max = SCROLL_POS.with(|m| m.borrow().get(&key).copied().unwrap_or(0.0));
        if max > 0.0 {
            let travel = (speed * t) % (2.0 * max);
            let y = if travel < max { max - travel } else { travel - max };
            tx.scroll_to_instant(key.clone(), 0.0, y);
        }
        if t >= dur {
            SCROLL.with(|r| *r.borrow_mut() = None);
        } else {
            tx.wake_after(Duration::ZERO);
        }
    }
}

fn color(c: rune::Color) -> String {
    c.hex()
}

fn element_json(e: &rune::ElementInfo) -> Value {
    json!({
        "key": e.key, "path": e.path, "role": e.role, "label": e.label, "text": e.text,
        "rect": e.rect, "opacity": e.opacity, "focused": e.focused, "focusable": e.focusable,
        "inert": e.inert, "exiting": e.exiting, "fill": color(e.fill),
        "textColor": e.text_color.map(color),
    })
}

pub fn command(s: &mut Win, tx: &mut Tx, rid: Option<u64>, cmd: &str, v: &Value) -> Result<Value, String> {
    match cmd {
        "control.elements" => {
            let filter = v.get("key").and_then(|k| k.as_str()).map(str::to_owned);
            tx.read_elements(move |_s: &mut Win, els: &[rune::ElementInfo], _tx: &mut Tx| {
                let list: Vec<Value> = els
                    .iter()
                    .filter(|e| filter.as_deref().is_none_or(|f| e.key.as_deref() == Some(f) || e.path.contains(f)))
                    .map(element_json)
                    .collect();
                reply(rid, Ok(json!(list)));
            });
            Err(String::from("\u{0}pending"))
        }
        "control.input" => {
            let events = v.get("events").cloned().unwrap_or(Value::Array(Vec::new()));
            let handle = engine::read(|e| e.windows.get(&s.node).and_then(|w| w.handle.clone())).ok_or("window not open")?;
            handle.inject_script(events).map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "control.tree" => Ok(engine::read(|e| tree_json(e, s.node))),
        other => Err(format!("unknown command {other}")),
    }
}

/// The engine's mirrored tree under a window (what TS committed), for debugging.
fn tree_json(e: &engine::Engine, n: u32) -> Value {
    let Some(node) = e.tree.get(n) else { return Value::Null };
    let children: Vec<Value> = node.children.iter().map(|c| tree_json(e, *c)).collect();
    json!({ "n": n, "kind": format!("{:?}", node.kind), "id": node.props.id, "content": node.props.content, "children": children })
}
