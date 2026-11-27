//! What the engine asks of the app's native side, as JSON messages through the app's native
//! callback (`ffi::sme_create`): text fields to place over Rune boxes (`field`, `place`,
//! `fieldGone`, `setText`, `focusField`, `blurField`), haptics, the clipboard, the share sheet
//! and URLs. All on the main thread, during or right after a frame.

use std::cell::RefCell;
use std::collections::HashMap;
use std::ffi::c_void;

use serde_json::{Value, json};

use crate::props::Props;

pub type NativeCb = extern "C" fn(ctx: *mut c_void, json: *const u8, len: usize);

thread_local! {
    static CB: RefCell<Option<(NativeCb, usize)>> = const { RefCell::new(None) };
    /// Each field's look as last sent, so a frame only sends what changed.
    static LOOKS: RefCell<HashMap<u32, String>> = RefCell::new(HashMap::new());
    /// Each field's drawn rect in window points, as last sent.
    static RECTS: RefCell<HashMap<u32, [f32; 4]>> = RefCell::new(HashMap::new());
    /// Each field's text height as its text view last reported it.
    static HEIGHTS: RefCell<HashMap<u32, f32>> = RefCell::new(HashMap::new());
    /// Each field's element key and window, for the cover check.
    static KEYS: RefCell<HashMap<u32, (u32, String)>> = RefCell::new(HashMap::new());
    /// Fields hidden because something Rune draws covers them (a page, a drawer, a dialog).
    static COVERED: RefCell<std::collections::HashSet<u32>> = RefCell::new(Default::default());
    /// Fields whose rect changed since the last cover check: a pick reads the last presented
    /// frame, where a field that just moved wasn't yet, so they wait a frame.
    static MOVED: RefCell<std::collections::HashSet<u32>> = RefCell::new(Default::default());
    /// Each field's top-level layer (the window root's child it's drawn in) as a pick last found
    /// it. Only another layer covers a field (a page, a drawer, a dialog, the launch splash):
    /// within its own layer a pick can land on its parent while it grows or moves.
    static PATHS: RefCell<HashMap<u32, String>> = RefCell::new(HashMap::new());
    /// Consecutive cover checks that found each field covered; it hides at two.
    static VOTES: RefCell<HashMap<u32, u8>> = RefCell::new(HashMap::new());
    /// Frames left to re-check covers after a commit, since a pick reads the last presented frame.
    static RECHECK: std::cell::Cell<u8> = const { std::cell::Cell::new(0) };
}

pub fn set_callback(cb: NativeCb, ctx: *mut c_void) {
    CB.with(|c| *c.borrow_mut() = Some((cb, ctx as usize)));
}

pub fn send(v: Value) {
    let line = v.to_string();
    CB.with(|c| {
        if let Some((cb, ctx)) = *c.borrow() {
            cb(ctx as *mut c_void, line.as_ptr(), line.len());
        }
    });
}

/// Padding `[top, right, bottom, left]` as style.rs applies it (pad, then px/py, then sides).
pub fn pads(p: &Props) -> [f32; 4] {
    let mut t = [0.0f32; 4];
    if let Some(v) = p.pad {
        t = [v; 4];
    }
    if let Some(v) = p.px {
        t[1] = v;
        t[3] = v;
    }
    if let Some(v) = p.py {
        t[0] = v;
        t[2] = v;
    }
    if let Some(v) = p.pt {
        t[0] = v;
    }
    if let Some(v) = p.pr {
        t[1] = v;
    }
    if let Some(v) = p.pb {
        t[2] = v;
    }
    if let Some(v) = p.pl {
        t[3] = v;
    }
    t
}

fn hex(c: Option<crate::props::C>) -> Option<String> {
    c.map(|c| c.0.hex())
}

/// Sends the field's look when it changed: text style, colours, placeholder, padding, kind.
pub fn describe(n: u32, p: &Props, value: &str) {
    let style = crate::text::style_of(p);
    let look = json!({
        "t": "field",
        "n": n,
        "id": p.id,
        "placeholder": p.placeholder,
        "placeholderColor": hex(p.placeholder_color),
        "color": hex(p.color),
        "caret": hex(p.caret_color),
        "size": p.size.unwrap_or(style.size),
        "weight": p.weight,
        "family": p.family,
        "lineHeight": style.line_px(),
        "tracking": p.tracking,
        "pad": pads(p),
        "multiline": p.multiline,
        "secure": p.secure,
        "spellcheck": p.spellcheck,
        "readOnly": p.read_only,
        "autoFocus": p.auto_focus,
        "maxLines": p.max_lines,
        "minLines": p.min_lines,
        "keys": p.keys,
        "submit": p.listens("submit"),
        "align": p.text_align,
        "dir": p.dir,
        "label": p.label,
    })
    .to_string();
    let changed = LOOKS.with(|l| {
        let mut l = l.borrow_mut();
        if l.get(&n) == Some(&look) {
            false
        } else {
            l.insert(n, look.clone());
            true
        }
    });
    if changed {
        let mut v: Value = serde_json::from_str(&look).unwrap_or(Value::Null);
        v["value"] = json!(value);
        send(v);
    }
}

/// Places field `n` (element `key`) at its drawn rect (window points, as scrolled and clipped by nothing).
pub fn place(window: u32, n: u32, key: &str, r: [f32; 4]) {
    KEYS.with(|k| {
        let mut k = k.borrow_mut();
        if k.get(&n).is_none_or(|(w, old)| *w != window || old != key) {
            k.insert(n, (window, key.to_string()));
        }
    });
    let moved = RECTS.with(|m| {
        let mut m = m.borrow_mut();
        let old = m.insert(n, r);
        old.is_none_or(|o| o.iter().zip(r.iter()).any(|(a, b)| (a - b).abs() > 0.01))
    });
    if moved {
        MOVED.with(|m| m.borrow_mut().insert(n));
        if !COVERED.with(|c| c.borrow().contains(&n)) {
            send(json!({ "t": "place", "n": n, "window": window, "rect": r }));
        }
    }
    note_commit();
}

/// Something changed on screen: check the fields' covers over the next few frames.
pub fn note_commit() {
    RECHECK.with(|c| c.set(3));
}

fn picked_is(p: &rune::Picked, key: &str) -> bool {
    if p.key() == Some(key) {
        return true;
    }
    let path = p.path();
    path.match_indices(key).any(|(i, _)| {
        let before = path[..i].chars().next_back();
        let after = path[i + key.len()..].chars().next();
        !before.is_some_and(|c| c.is_alphanumeric() || c == '-' || c == '_') && !after.is_some_and(|c| c.is_alphanumeric() || c == '-' || c == '_')
    })
}

/// A UIKit text view sits above everything Rune draws, so a field Rune covers (a page or a
/// drawer slid over it, a dialog) is hidden until it's uncovered: each frame after a change,
/// the topmost element at the field's centre must be the field.
pub fn check_covers<S: 'static>(tx: &mut rune::Tx) {
    let left = RECHECK.with(|c| c.get());
    if left == 0 {
        return;
    }
    RECHECK.with(|c| c.set(left - 1));
    tx.wake_after(std::time::Duration::from_millis(16));
    let moved: std::collections::HashSet<u32> = MOVED.with(|m| std::mem::take(&mut *m.borrow_mut()));
    if !moved.is_empty() {
        RECHECK.with(|c| c.set(c.get().max(2)));
    }
    let fields: Vec<(u32, u32, String, [f32; 4])> = KEYS.with(|k| {
        let k = k.borrow();
        RECTS.with(|r| r.borrow().iter().filter(|(n, _)| !moved.contains(n)).filter_map(|(n, rect)| k.get(n).map(|(w, key)| (*n, *w, key.clone(), *rect))).collect())
    });
    for (n, window, key, r) in fields {
        tx.element_at(r[0] + r[2] / 2.0, r[1] + r[3] / 2.0, move |_s: &mut S, picked: Option<rune::Picked>, _tx: &mut rune::Tx| {
            // The pick answers after the next layout: a field that moved meanwhile (the composer
            // riding up on the keyboard) was asked about where it no longer is. Ask again.
            if RECTS.with(|m| m.borrow().get(&n).copied()) != Some(r) {
                RECHECK.with(|c| c.set(c.get().max(2)));
                return;
            }
            let own = picked.as_ref().is_some_and(|p| picked_is(p, &key));
            let layer = |p: &rune::Picked| p.path().split('/').nth(1).unwrap_or("").to_owned();
            if let Some(p) = picked.as_ref().filter(|_| own) {
                PATHS.with(|m| m.borrow_mut().insert(n, layer(p)));
            }
            let same_layer = picked.as_ref().is_some_and(|p| PATHS.with(|m| m.borrow().get(&n).is_some_and(|l| *l == layer(p))));
            let hit = !own && !same_layer;
            let votes = VOTES.with(|v| {
                let mut v = v.borrow_mut();
                let e = v.entry(n).or_insert(0);
                *e = if hit { e.saturating_add(1) } else { 0 };
                *e
            });
            let was_covered = COVERED.with(|c| c.borrow().contains(&n));
            if hit && votes < 2 && !was_covered {
                RECHECK.with(|c| c.set(c.get().max(1)));
                return;
            }
            let covered = hit;
            let was = COVERED.with(|c| if covered { !c.borrow_mut().insert(n) } else { c.borrow_mut().remove(&n) });
            if covered == was {
                return;
            }
            if std::env::var_os("STELLA_DEBUG_COVERS").is_some() {
                eprintln!("stella-engine: field {n} ({key}) covered={covered} by {:?}", picked.as_ref().map(|p| (p.key().map(str::to_owned), p.path().to_owned())));
            }
            if covered {
                send(json!({ "t": "hideField", "n": n }));
            } else if let Some(rect) = RECTS.with(|m| m.borrow().get(&n).copied()) {
                send(json!({ "t": "place", "n": n, "window": window, "rect": rect }));
            }
        });
    }
}

/// The field's node left the tree.
pub fn forget(n: u32) {
    let had = LOOKS.with(|l| l.borrow_mut().remove(&n)).is_some();
    RECTS.with(|m| m.borrow_mut().remove(&n));
    HEIGHTS.with(|h| h.borrow_mut().remove(&n));
    KEYS.with(|k| k.borrow_mut().remove(&n));
    COVERED.with(|c| c.borrow_mut().remove(&n));
    VOTES.with(|v| v.borrow_mut().remove(&n));
    PATHS.with(|m| m.borrow_mut().remove(&n));
    MOVED.with(|m| m.borrow_mut().remove(&n));
    if had {
        send(json!({ "t": "fieldGone", "n": n }));
    }
}

pub fn height_of(n: u32) -> Option<f32> {
    HEIGHTS.with(|h| h.borrow().get(&n).copied())
}

/// The text view's content height changed; true when the box must lay out again.
pub fn set_height(n: u32, h: f32) -> bool {
    HEIGHTS.with(|m| {
        let mut m = m.borrow_mut();
        let old = m.insert(n, h);
        old.is_none_or(|o| (o - h).abs() > 0.25)
    })
}

/// TS (or a hot swap) set the field's text.
pub fn set_text(n: u32, v: &str) {
    if n != 0 {
        send(json!({ "t": "setText", "n": n, "value": v }));
    }
}
