//! `<surface>`: frames streamed as blobs (a page screencast), decoded off the UI thread into the
//! node's own pixels and replaced in place, with raw pointer, wheel and key events in its own
//! points.

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{Sender, channel};
use std::sync::{Arc, OnceLock};

use rune::{El, KeyEvent, PointerButton, Tx, el};
use serde_json::{Value, json};

use crate::engine::{Engine, element_event};
use crate::keys::{mods_json, name};
use crate::props::Props;
use crate::windows::Win;

struct Surface {
    src: String,
    pixels: rune::Pixels,
    latest: Arc<AtomicU64>,
}

struct Job {
    bytes: Arc<[u8]>,
    pixels: rune::Pixels,
    latest: Arc<AtomicU64>,
    frame: u64,
}

thread_local! {
    static SURFACES: RefCell<HashMap<u32, Surface>> = RefCell::new(HashMap::new());
}

/// One decode thread for every surface; a frame superseded before its turn is skipped.
fn decoder() -> &'static Sender<Job> {
    static TX: OnceLock<Sender<Job>> = OnceLock::new();
    TX.get_or_init(|| {
        let (tx, rx) = channel::<Job>();
        std::thread::Builder::new()
            .name("surface-decode".into())
            .spawn(move || {
                for job in rx {
                    if job.latest.load(Ordering::Acquire) != job.frame {
                        continue;
                    }
                    match image::load_from_memory(&job.bytes) {
                        Ok(img) => {
                            let rgba = img.into_rgba8();
                            let (w, h) = rgba.dimensions();
                            job.pixels.set(w, h, rgba.into_raw());
                        }
                        Err(e) => eprintln!("stella-engine: surface frame: {e}"),
                    }
                }
            })
            .expect("surface decode thread");
        tx
    })
}

pub fn forget(n: u32) {
    SURFACES.with(|m| m.borrow_mut().remove(&n));
}

fn pixels_for(eng: &Engine, n: u32, src: &str) -> rune::Pixels {
    SURFACES.with(|m| {
        let mut m = m.borrow_mut();
        let s = m.entry(n).or_insert_with(|| Surface { src: String::new(), pixels: rune::Pixels::new(), latest: Arc::new(AtomicU64::new(0)) });
        if s.src != src {
            s.src = src.to_owned();
            let bytes = src.strip_prefix("blob:").and_then(|id| id.parse().ok()).and_then(|id| eng.blobs.get(&id).cloned());
            if let Some(bytes) = bytes {
                let frame = s.latest.fetch_add(1, Ordering::AcqRel) + 1;
                let _ = decoder().send(Job { bytes, pixels: s.pixels.clone(), latest: s.latest.clone(), frame });
            }
        }
        s.pixels.clone()
    })
}

fn button_name(b: PointerButton) -> &'static str {
    match b {
        PointerButton::Primary => "left",
        PointerButton::Secondary => "right",
        PointerButton::Middle => "middle",
        PointerButton::Back => "back",
        PointerButton::Forward => "forward",
        _ => "other",
    }
}

struct Ptr {
    kind: &'static str,
    at: (f32, f32),
    button: Option<&'static str>,
    buttons: u8,
    clicks: u32,
}

fn pointer(n: u32, p: Ptr, tx: &mut Tx) {
    let ev: Value = json!({ "kind": p.kind, "x": p.at.0, "y": p.at.1, "button": p.button, "buttons": p.buttons, "clicks": p.clicks, "mods": mods_json(tx.mods()) });
    element_event(n, "pointer", ev, Some(tx));
}

fn key(n: u32, kind: &str, ev: &KeyEvent, tx: &mut Tx) {
    let text = match &ev.key {
        rune::Key::Text(t) if !ev.is_command_chord() => Some(t.clone()),
        _ => None,
    };
    let payload = json!({ "type": kind, "key": name(&ev.key).unwrap_or_default(), "text": text, "mods": mods_json(ev.mods) });
    element_event(n, "keyRaw", payload, Some(tx));
}

/// Whether the window's own `keys` chords take this key, so it goes on to the window.
fn window_takes(s: &Win, ev: &KeyEvent) -> bool {
    let keys = crate::engine::read(|e| e.tree.get(s.node).map(|w| w.props.keys.clone()).unwrap_or_default());
    !keys.is_empty() && crate::keys::Chords::new(&keys).matching(ev).is_some()
}

pub fn build(eng: &Engine, n: u32, p: &Props) -> El {
    let pixels = p.src.as_deref().map(|src| pixels_for(eng, n, src));
    let mut e = match (&pixels, p.fit.as_deref()) {
        (Some(px), Some("contain")) => el().pixels_fit(px, rune::SurfaceFit::Fit),
        (Some(px), _) => el().pixels(px),
        (None, _) => el(),
    };
    if p.listens("pointer") {
        let key = crate::view::rune_key(n, p);
        e = e
            .pointer_buttons([PointerButton::Secondary, PointerButton::Middle])
            .on_pointer_move_local(move |_s: &mut Win, ev: rune::PointerEvent, tx: &mut Tx| {
                if !ev.pressing {
                    pointer(n, Ptr { kind: "move", at: (ev.x, ev.y), button: None, buttons: 0, clicks: 0 }, tx);
                }
            })
            .on_drag(move |_s: &mut Win, d: &mut rune::Drag, tx: &mut Tx| {
                let b = tx.button();
                let bit = match b {
                    PointerButton::Primary => 1,
                    PointerButton::Secondary => 2,
                    PointerButton::Middle => 4,
                    _ => 0,
                };
                match d.phase {
                    rune::Phase::Down => {
                        tx.focus(key.clone(), false);
                        pointer(n, Ptr { kind: "down", at: (d.x, d.y), button: Some(button_name(b)), buttons: bit, clicks: d.clicks.max(1) }, tx);
                    }
                    rune::Phase::Move => pointer(n, Ptr { kind: "move", at: (d.x, d.y), button: None, buttons: bit, clicks: 0 }, tx),
                    rune::Phase::Up => pointer(n, Ptr { kind: "up", at: (d.x, d.y), button: Some(button_name(b)), buttons: 0, clicks: d.clicks.max(1) }, tx),
                }
            })
            .on_hover_change(move |_s: &mut Win, inside: bool, tx: &mut Tx| {
                if !inside {
                    pointer(n, Ptr { kind: "leave", at: (0.0, 0.0), button: None, buttons: 0, clicks: 0 }, tx);
                }
            });
    }
    if p.listens("wheel") {
        e = e.on_wheel(move |_s: &mut Win, w: rune::WheelEvent, tx: &mut Tx| {
            let ev = json!({ "x": w.x, "y": w.y, "dx": w.dx, "dy": w.dy, "mode": if w.precise { "pixel" } else { "line" }, "mods": mods_json(w.mods) });
            element_event(n, "wheel", ev, Some(tx));
            true
        });
    }
    if p.listens("keyRaw") {
        e = e
            .focusable(true)
            .on_key(move |s: &mut Win, ev: &KeyEvent, tx: &mut Tx| {
                if window_takes(s, ev) {
                    return false;
                }
                key(n, "down", ev, tx);
                true
            })
            .on_key_up(move |s: &mut Win, ev: &KeyEvent, tx: &mut Tx| {
                if window_takes(s, ev) {
                    return false;
                }
                key(n, "up", ev, tx);
                true
            });
    }
    e
}
