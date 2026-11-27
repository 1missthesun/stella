//! The desktop's verification controls (`control.*`, scripted input, recordings) live in the
//! desktop engine's HTTP control port. The phone has none yet: what view.rs reaches here keeps
//! the scroll extents the hot-swap view restores to.

use std::collections::HashMap;
use std::sync::Mutex;

use rune::Tx;
use serde_json::{Value, json};

use crate::windows::Win;

static SCROLL_MAX: Mutex<Option<HashMap<String, f32>>> = Mutex::new(None);

pub fn note_scroll_max(key: &str, max: f32) {
    SCROLL_MAX.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(HashMap::new).insert(key.to_owned(), max);
}

pub fn tick(_s: &mut Win, _tx: &mut Tx) {}

/// `control.elements` answers with the laid-out elements (what the desktop's control port dumps),
/// which the phone's own harness reads through the bridge.
pub fn command(_s: &mut Win, tx: &mut Tx, rid: Option<u64>, cmd: &str, _v: &Value) -> Result<Value, String> {
    match cmd {
        "control.elements" => {
            tx.read_elements(move |_: &mut Win, els, _| {
                let list: Vec<Value> = els
                    .iter()
                    .map(|e| json!({ "key": e.key, "path": e.path, "role": e.role, "label": e.label, "text": e.text, "rect": e.rect, "opacity": e.opacity, "focused": e.focused }))
                    .collect();
                crate::engine::reply(rid, Ok(json!(list)));
            });
            Err(String::from("\u{0}pending"))
        }
        other => Err(format!("{other}: no control port on the phone")),
    }
}
