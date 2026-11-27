//! `<input>` on a phone: the field is a real platform text view (`UITextView` on iOS,
//! `EditText` on Android) that the app places over the box Rune lays out and paints here. So
//! selection handles and the loupe, autocorrect, dictation, IME, autofill and the space-bar
//! trackpad are the system's own; Rune draws the field's box (fill, border, radius, glass) at
//! display rate and keeps its place in layout.
//!
//! Rune → app: each frame's drawn rect and the field's look (`native::field`). App → Rune: the
//! text and focus (`ffi::sme_field_event`), reported to TS as the same `input`/`submit`/`focus`/
//! `key` element events a desktop field sends, and the text view's content height, which sizes
//! a growing field's box (`native::height_of`).

use std::collections::VecDeque;

use rune::{El, TextEdit, Tx, el};

use crate::engine::byte_of;
use crate::props::Props;
use crate::view::{handlers, rune_key};
use crate::windows::Win;
use crate::{native, style, text};

pub struct InputState {
    pub edit: TextEdit,
    /// Values reported to TS that it may still echo back through `value`.
    pub sent: VecDeque<String>,
    pub last_prop: Option<String>,
    /// The text changed here (TS `value`, `input.set`, a hot swap) and the native view must show it.
    pub push: bool,
}

impl InputState {
    pub fn new(value: &str) -> Self {
        let mut edit = TextEdit::new(value);
        edit.set_caret(value.len());
        InputState { edit, sent: VecDeque::new(), last_prop: Some(value.to_owned()), push: false }
    }

    /// Applies a `value` prop: a TS echo of a value the field sent changes nothing; anything
    /// else replaces the native text.
    pub fn control(&mut self, value: Option<&str>) {
        let Some(v) = value else { return };
        if self.last_prop.as_deref() == Some(v) {
            return;
        }
        self.last_prop = Some(v.to_owned());
        if let Some(i) = self.sent.iter().position(|s| s == v) {
            self.sent.drain(..=i);
            return;
        }
        if self.edit.text != v {
            self.set(v, None);
        }
    }

    /// Replaces the text; `sel` is a UTF-16 range, else the caret goes to the end.
    pub fn set(&mut self, v: &str, sel: Option<(usize, usize)>) {
        self.edit.replace_text(v);
        match sel {
            Some((a, b)) => {
                let (a, b) = (byte_of(v, a), byte_of(v, b));
                self.edit.set_selection(a, b);
            }
            None => self.edit.set_caret(v.len()),
        }
        self.sent.clear();
        self.push = true;
    }

    /// Puts back text a hot swap took, reported as typed so the UI's echo of it changes nothing.
    pub fn restore(&mut self, v: &str) {
        self.set(v, None);
        self.report();
    }

    /// Records text the native field reported, for TS to echo.
    pub fn typed(&mut self, v: &str, sel: Option<(usize, usize)>) -> String {
        self.edit.replace_text(v);
        if let Some((a, b)) = sel {
            let (a, b) = (byte_of(v, a), byte_of(v, b));
            self.edit.set_selection(a, b);
        }
        self.report()
    }

    fn report(&mut self) -> String {
        let v = self.edit.text.clone();
        self.sent.push_back(v.clone());
        if self.sent.len() > 64 {
            self.sent.pop_front();
        }
        v
    }
}

/// A single-line field of fixed height centres its line, as a browser's does.
fn centred(p: &Props) -> Option<Props> {
    let Some(crate::props::Size::Pt(h)) = p.h else { return None };
    if p.multiline || p.py.is_some() || p.pt.is_some() || p.pb.is_some() || p.pad.is_some() {
        return None;
    }
    let pad = ((h - text::style_of(p).line_px()) / 2.0).max(0.0);
    Some(Props { py: Some(pad), ..p.clone() })
}

pub fn build(s: &Win, n: u32, p: &Props) -> El {
    let centred = centred(p);
    let p = centred.as_ref().unwrap_or(p);
    let value = s.inputs.get(&n).map(|st| st.edit.text.clone()).or_else(|| p.value.clone()).unwrap_or_default();
    native::describe(n, p, &value);
    let line = text::style_of(p).line_px().max(1.0);
    let fixed_h = matches!(p.h, Some(crate::props::Size::Pt(_)));
    let mut e = el().key(rune_key(n, p));
    if !fixed_h {
        // The box is as tall as the text view says its text is (one line until it reports),
        // within the field's own line limits, plus its padding.
        let content = native::height_of(n).unwrap_or(line);
        let lo = p.min_lines.map(|l| l as f32 * line).unwrap_or(line);
        let hi = p.max_lines.map(|l| l as f32 * line).unwrap_or(f32::MAX);
        let [pt, _, pb, _] = native::pads(p);
        let pad_y = pt + pb;
        e = e.h(content.clamp(lo, hi.max(lo)) + pad_y);
    }
    let window = s.node;
    let key = rune_key(n, p);
    e = e.on_drawn_layout_tx(move |_s: &mut Win, r: [f32; 4], tx: &mut Tx| {
        tx.live_only();
        native::place(window, n, &key, r);
    });
    let e = style::apply(e, &Props { on: p.on.iter().filter(|h| h.as_str() != "press").cloned().collect(), ..p.clone() });
    handlers(e, n, p, true)
}
