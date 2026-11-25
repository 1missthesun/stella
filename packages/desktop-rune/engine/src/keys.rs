//! Declarative key capture: an element (or window) names the chords it takes, in DOM-style names
//! (`Enter`, `shift+Enter`, `Escape`, `ArrowUp`, `mod+k`). The engine consumes exactly those and
//! reports them; every other key keeps its native behaviour. `mod` is ⌘ on macOS, Ctrl elsewhere.

use rune::{Key, KeyEvent, Mods, Tx};
use serde_json::json;

use crate::engine::element_event;

/// A normalized chord: sorted modifier set plus a lower-cased key name.
#[derive(Clone, Debug, PartialEq)]
struct Chord {
    mods: [bool; 4],
    key: String,
}

fn parse(s: &str) -> Option<Chord> {
    let mut mods = [false; 4];
    let mut key = None;
    let parts: Vec<&str> = s.split('+').collect();
    for (i, part) in parts.iter().enumerate() {
        let lower = part.trim().to_ascii_lowercase();
        let last = i == parts.len() - 1;
        match lower.as_str() {
            "mod" | "cmdorctrl" | "commandorcontrol" if !last => mods[0] = true,
            "shift" if !last => mods[1] = true,
            "alt" | "option" if !last => mods[2] = true,
            "ctrl" | "control" if !last => mods[3] = true,
            "cmd" | "command" | "meta" | "super" if !last => mods[0] = true,
            "" if last => key = Some("+".to_owned()),
            _ => key = Some(normalize(&lower)),
        }
    }
    Some(Chord { mods, key: key? })
}

fn normalize(k: &str) -> String {
    match k {
        "return" => "enter",
        "esc" => "escape",
        "up" => "arrowup",
        "down" => "arrowdown",
        "left" => "arrowleft",
        "right" => "arrowright",
        "space" | "spacebar" => " ",
        "del" => "delete",
        other => other,
    }
    .to_owned()
}

/// The DOM `KeyboardEvent.key` name of a key.
pub fn name(key: &Key) -> Option<String> {
    Some(match key {
        Key::Text(t) => t.clone(),
        Key::Command(c) => c.to_string(),
        Key::Enter => "Enter".into(),
        Key::Backspace => "Backspace".into(),
        Key::Delete => "Delete".into(),
        Key::Left => "ArrowLeft".into(),
        Key::Right => "ArrowRight".into(),
        Key::Up => "ArrowUp".into(),
        Key::Down => "ArrowDown".into(),
        Key::Home => "Home".into(),
        Key::End => "End".into(),
        Key::PageUp => "PageUp".into(),
        Key::PageDown => "PageDown".into(),
        Key::Escape => "Escape".into(),
        Key::Tab => "Tab".into(),
        Key::Insert => "Insert".into(),
        Key::Function(n) => format!("F{n}"),
        Key::ContextMenu => "ContextMenu".into(),
        _ => return None,
    })
}

fn primary_is_ctrl() -> bool {
    !cfg!(target_os = "macos")
}

fn chord_of(ev: &KeyEvent) -> Option<Chord> {
    let m: Mods = ev.mods;
    let key = normalize(&name(&ev.key)?.to_lowercase());
    let ctrl = if primary_is_ctrl() { false } else { m.ctrl };
    // A typed capital already says Shift; match "shift+a" and "A" alike by the lower-case key.
    Some(Chord { mods: [m.cmd, m.shift, m.alt, ctrl], key })
}

pub fn mods_json(m: Mods) -> serde_json::Value {
    json!({ "mod": m.cmd, "shift": m.shift, "alt": m.alt, "ctrl": m.ctrl, "meta": m.logo })
}

pub struct Chords(Vec<(String, Chord)>);

impl Chords {
    pub fn new(list: &[String]) -> Self {
        Chords(list.iter().filter_map(|s| parse(s).map(|c| (s.clone(), c))).collect())
    }

    /// The chord string `ev` matches, if any.
    pub fn matching(&self, ev: &KeyEvent) -> Option<&str> {
        let c = chord_of(ev)?;
        self.0.iter().find(|(_, want)| *want == c).map(|(s, _)| s.as_str())
    }

    /// Reports a matching key as `key` on node `n` and consumes it.
    pub fn take(&self, n: u32, ev: &KeyEvent, tx: &mut Tx) -> bool {
        let Some(chord) = self.matching(ev) else { return false };
        let key = name(&ev.key).unwrap_or_default();
        element_event(n, "key", json!({ "key": key, "chord": chord, "mods": mods_json(ev.mods) }), Some(tx));
        true
    }
}
