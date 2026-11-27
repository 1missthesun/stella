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

/// Places field `n` at its drawn rect (window points, as scrolled and clipped by nothing).
pub fn place(window: u32, n: u32, r: [f32; 4]) {
    let moved = RECTS.with(|m| {
        let mut m = m.borrow_mut();
        let old = m.insert(n, r);
        old.is_none_or(|o| o.iter().zip(r.iter()).any(|(a, b)| (a - b).abs() > 0.01))
    });
    if moved {
        send(json!({ "t": "place", "n": n, "window": window, "rect": r }));
    }
}

/// The field's node left the tree.
pub fn forget(n: u32) {
    let had = LOOKS.with(|l| l.borrow_mut().remove(&n)).is_some();
    RECTS.with(|m| m.borrow_mut().remove(&n));
    HEIGHTS.with(|h| h.borrow_mut().remove(&n));
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
