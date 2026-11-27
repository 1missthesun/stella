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
    if moved && !COVERED.with(|c| c.borrow().contains(&n)) {
        send(json!({ "t": "place", "n": n, "window": window, "rect": r }));
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
    let fields: Vec<(u32, u32, String, [f32; 4])> = KEYS.with(|k| {
        let k = k.borrow();
        RECTS.with(|r| r.borrow().iter().filter_map(|(n, rect)| k.get(n).map(|(w, key)| (*n, *w, key.clone(), *rect))).collect())
    });
    for (n, window, key, r) in fields {
        tx.element_at(r[0] + r[2] / 2.0, r[1] + r[3] / 2.0, move |_s: &mut S, picked: Option<rune::Picked>, _tx: &mut rune::Tx| {
            // The pick answers after the next layout: a field that moved meanwhile (the composer
            // riding up on the keyboard) was asked about where it no longer is. Ask again.
            if RECTS.with(|m| m.borrow().get(&n).copied()) != Some(r) {
                RECHECK.with(|c| c.set(c.get().max(2)));
                return;
            }
            let covered = !picked.is_some_and(|p| picked_is(&p, &key));
            let was = COVERED.with(|c| if covered { !c.borrow_mut().insert(n) } else { c.borrow_mut().remove(&n) });
            if covered == was {
                return;
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
