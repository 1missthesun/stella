//! `<input>`: a native Rune text field whose `TextEdit` lives in the window state, so typing,
//! selection, IME, spellcheck and undo never cross the bridge. TS hears the value afterwards and
//! may control it with `value` (echoes of what the engine sent are recognised and ignored).

use std::collections::VecDeque;

use rune::{El, TextEdit, Tx, text_input};
use serde_json::json;

use crate::engine::{byte_of, element_event};
use crate::keys::{Chords, mods_json, name};
use crate::props::Props;
use crate::view::{handlers, rune_key, selection16};
use crate::windows::Win;
use crate::{style, text};

pub struct InputState {
    pub edit: TextEdit,
    /// Values reported to TS that it may still echo back through `value`.
    pub sent: VecDeque<String>,
    pub last_prop: Option<String>,
}

impl InputState {
    pub fn new(value: &str) -> Self {
        let mut edit = TextEdit::new(value);
        edit.set_caret(value.len());
        InputState { edit, sent: VecDeque::new(), last_prop: Some(value.to_owned()) }
    }

    /// Applies a `value` prop: a TS echo of a value we sent changes nothing; anything else
    /// replaces the text, caret at the end.
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

fn state(s: &mut Win, n: u32) -> &mut InputState {
    s.inputs.entry(n).or_insert_with(|| InputState::new(""))
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
    let blank;
    let edit = match s.inputs.get(&n) {
        Some(st) => &st.edit,
        None => {
            blank = TextEdit::new(p.value.as_deref().unwrap_or(""));
            &blank
        }
    };
    let mut e = text_input(edit, text::style_of(p))
        .key(rune_key(n, p))
        .on_edit(move |s: &mut Win| &mut state(s, n).edit)
        .on_input_change(move |s: &mut Win, tx: &mut Tx| {
            let v = state(s, n).report();
            crate::metrics::METRICS.lock().unwrap_or_else(|e| e.into_inner()).typing_input = tx.input_time().map(crate::metrics::epoch_of);
            element_event(n, "input", json!({ "value": v }), Some(tx));
        });
    if p.listens("submit") {
        e = e.on_submit(move |s: &mut Win, tx: &mut Tx| {
            let v = state(s, n).edit.text.clone();
            element_event(n, "submit", json!({ "value": v }), Some(tx));
        });
    }
    if p.listens("selection") {
        e = e.on_input_selection(move |s: &mut Win, tx: &mut Tx| {
            let (a, b) = selection16(&state(s, n).edit);
            element_event(n, "selection", json!({ "start": a, "end": b }), Some(tx));
        });
    }
    if p.listens("paste") {
        e = e.on_input_paste(move |_s: &mut Win, c: &rune::ClipboardContent, tx: &mut Tx| {
            let files: Vec<String> = c.files().iter().map(|f| f.to_string_lossy().into_owned()).collect();
            let image = c.image().and_then(|img| crate::commands::save_png(img.png()));
            if files.is_empty() && image.is_none() {
                return false;
            }
            element_event(n, "paste", json!({ "files": files, "image": image, "text": c.text() }), Some(tx));
            true
        });
    }
    if !p.keys.is_empty() {
        let chords = Chords::new(&p.keys);
        e = e.on_input_key(move |s: &mut Win, ev: &rune::KeyEvent, tx: &mut Tx| {
            let Some(chord) = chords.matching(ev) else { return false };
            let st = state(s, n);
            let (a, b) = selection16(&st.edit);
            let len = st.edit.text.encode_utf16().count();
            let key = name(&ev.key).unwrap_or_default();
            element_event(
                n,
                "key",
                json!({ "key": key, "chord": chord, "mods": mods_json(ev.mods), "value": st.edit.text, "start": a, "end": b, "length": len }),
                Some(tx),
            );
            true
        });
    }
    if let Some(ph) = &p.placeholder {
        e = e.placeholder(ph.clone(), p.placeholder_color.map(|c| c.0).unwrap_or(rune::Color::TRANSPARENT));
    }
    if !p.multiline {
        e = e.single_line();
    }
    if p.secure {
        e = e.secure();
    }
    if let Some(on) = p.spellcheck {
        e = e.spellcheck(on);
    }
    if p.read_only {
        e = e.read_only(true);
    }
    if let Some(c) = p.caret_color {
        e = e.caret(c.0, p.selection_color.map(|c| c.0).unwrap_or(c.0.alpha(0.3)));
    }
    if let Some(c) = p.color {
        e = e.color(c.0);
    }
    if p.select_on_focus {
        let key = rune_key(n, p);
        e = e.on_focus_change(move |_s: &mut Win, focused: bool, tx: &mut Tx| {
            if focused {
                tx.select_all_text(key.clone());
            }
            element_event(n, "focus", json!({ "focused": focused, "visible": tx.focus_visible() }), Some(tx));
        });
    }
    if p.auto_focus {
        e = e.autofocus();
    }
    let e = style::apply(e, p);
    handlers(e, n, p, true)
}
