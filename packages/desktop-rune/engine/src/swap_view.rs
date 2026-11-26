//! Keeps what the user typed, and the focused text field, across a hot swap, as desktop-ui's
//! swap does with `restoreDomState` (platform/view-state/dom-state.ts): the swap remounts every
//! node under new ids (and new `useId` values), so each field is found again by its place in the
//! tree and its look, given its text back through an `input` event, and refocused with its
//! selection.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use serde_json::json;

use crate::engine::{self, Engine};
use crate::props::{Kind, Props};
use crate::windows::Win;

/// dom-state.ts: a missing field stops being waited for once the page has been still this long,
/// or this long after the swap at the latest.
const STILL: Duration = Duration::from_millis(200);
const GRACE: Duration = Duration::from_millis(1_200);
const MAX_FIELD_CHARS: usize = 200_000;
const SECRET_HINTS: [&str; 8] = ["pass", "secret", "token", "credential", "otp", "card", "cvc", "cvv"];

/// Bumped by every user key or press; a restore still waiting gives up on the next one.
pub static USER_INPUT: AtomicU64 = AtomicU64::new(0);

pub struct Step {
    id: Option<String>,
    ix: usize,
}

struct Field {
    steps: Vec<Step>,
    mark: String,
    value: String,
}

struct Focus {
    steps: Vec<Step>,
    mark: String,
    ring: bool,
    selection: (usize, usize),
}

pub struct View {
    fields: Vec<Field>,
    focus: Option<Focus>,
    armed: Option<Armed>,
}

struct Armed {
    at: Instant,
    changed: Instant,
    input: u64,
}

/// What a window's last poll saw focused: the key, its ring, and a text field's selection.
pub type Seen = (String, bool, Option<(usize, usize)>);

/// `_r_4a_`, `«r4a»` and `:r4a:` (React's `useId` across versions) differ per mount.
fn stable_id(id: &str) -> String {
    let mut out = String::with_capacity(id.len());
    let mut rest = id;
    while !rest.is_empty() {
        let generated = [("_r_", '_'), ("\u{ab}r", '\u{bb}'), (":r", ':')].iter().find_map(|(open, close)| {
            let body = rest.strip_prefix(open)?;
            let end = body.find(*close)?;
            (end > 0 && body[..end].chars().all(|c| c.is_ascii_alphanumeric())).then(|| open.len() + end + close.len_utf8())
        });
        match generated {
            Some(len) => {
                out.push('*');
                rest = &rest[len..];
            }
            None => {
                let c = rest.chars().next().unwrap_or_default();
                out.push(c);
                rest = &rest[c.len_utf8()..];
            }
        }
    }
    out
}

/// dom-state.ts `fieldMark`: what a field looks like, to tell it from another at the same place.
fn mark(p: &Props) -> String {
    format!("{}|{}|{}|{}", p.multiline, p.secure, p.placeholder.as_deref().unwrap_or(""), p.label.as_deref().unwrap_or(""))
}

/// dom-state.ts `recordable`: never a field that may hold a secret (its `SECRET_HINT`).
fn recordable(p: &Props) -> bool {
    let hint = format!("{} {} {}", p.id.as_deref().unwrap_or(""), p.placeholder.as_deref().unwrap_or(""), p.label.as_deref().unwrap_or("")).to_lowercase();
    let api_key = hint.match_indices("api").any(|(i, _)| {
        let rest = &hint[i + 3..];
        rest.starts_with("key") || rest.chars().next().is_some_and(|c| rest[c.len_utf8()..].starts_with("key"))
    });
    let code = hint.split(|c: char| !(c.is_alphanumeric() || c == '_')).any(|w| w == "code");
    !p.secure && !p.read_only && !p.disabled && !api_key && !code && !SECRET_HINTS.iter().any(|h| hint.contains(h))
}

/// Each poll: what has focus, with the selection when it's one of this window's fields.
pub fn seen(s: &Win, tx: &rune::Tx) -> Option<Seen> {
    let key = tx.focused()?;
    let field = engine::read(|e| s.inputs.keys().copied().find(|n| e.tree.get(*n).is_some_and(|node| crate::view::rune_key(*n, &node.props) == key)));
    let selection = field.and_then(|n| s.inputs.get(&n)).map(|st| (st.edit.anchor, st.edit.focus));
    Some((key.to_owned(), tx.focus_visible(), selection))
}

pub fn typed(window: u32, n: u32, value: &str) {
    engine::with(|e| {
        if let Some(slot) = e.windows.get_mut(&window) {
            slot.typed.insert(n, value.to_owned());
        }
    });
}

fn path(e: &Engine, window: u32, mut n: u32) -> Option<Vec<Step>> {
    let mut steps = Vec::new();
    while n != window {
        let node = e.tree.get(n)?;
        let ix = e.tree.get(node.parent)?.children.iter().position(|c| *c == n)?;
        steps.push(Step { id: node.props.id.as_deref().map(stable_id), ix });
        n = node.parent;
    }
    steps.reverse();
    Some(steps)
}

fn at_path(e: &Engine, window: u32, steps: &[Step]) -> Option<u32> {
    let mut n = window;
    for step in steps {
        let children = &e.tree.get(n)?.children;
        let id_of = |c: &u32| e.tree.get(*c).and_then(|x| x.props.id.as_deref().map(stable_id));
        n = match &step.id {
            Some(id) => {
                let same: Vec<(usize, u32)> = children.iter().enumerate().filter(|(_, c)| id_of(c).as_deref() == Some(id)).map(|(i, c)| (i, *c)).collect();
                same.iter().find(|(i, _)| *i == step.ix).or(same.first()).map(|(_, c)| *c)?
            }
            None => children.get(step.ix).copied().filter(|c| id_of(c).is_none())?,
        };
    }
    Some(n)
}

/// dom-state.ts `find`: the field at the same place with the same look, else the only field in
/// the window with that look.
fn find(e: &Engine, window: u32, steps: &[Step], want: &str) -> Option<u32> {
    let fits = |n: u32| e.tree.get(n).is_some_and(|node| node.kind == Kind::Input && mark(&node.props) == want);
    if let Some(n) = at_path(e, window, steps).filter(|n| fits(*n)) {
        return Some(n);
    }
    let mut same = e.tree.nodes.keys().copied().filter(|n| fits(*n) && e.tree.window_of(*n) == Some(window));
    let first = same.next()?;
    same.next().is_none().then_some(first)
}

fn input_in(e: &Engine, window: u32, n: u32) -> Option<&Props> {
    let node = e.tree.get(n).filter(|node| node.kind == Kind::Input && e.tree.window_of(n) == Some(window))?;
    recordable(&node.props).then_some(&*node.props)
}

/// Before a hot swap's ops land: each window's typed fields and focused field.
pub fn remember(e: &mut Engine) {
    let views: Vec<(u32, View)> = e
        .windows
        .iter()
        .map(|(w, slot)| {
            let fields: Vec<Field> = slot
                .typed
                .iter()
                .filter_map(|(n, typed)| {
                    let p = input_in(e, *w, *n)?;
                    let value = p.value.clone().unwrap_or_else(|| typed.clone());
                    (!value.is_empty() && value.len() <= MAX_FIELD_CHARS).then_some(())?;
                    Some(Field { steps: path(e, *w, *n)?, mark: mark(p), value })
                })
                .collect();
            let focus = slot.focus.as_ref().and_then(|(key, ring, selection)| {
                let selection = (*selection)?;
                let n = e.tree.nodes.iter().find(|(n, node)| node.kind == Kind::Input && crate::view::rune_key(**n, &node.props) == *key && e.tree.window_of(**n) == Some(*w)).map(|(n, _)| *n)?;
                Some(Focus { steps: path(e, *w, n)?, mark: mark(&e.tree.get(n)?.props), ring: *ring, selection })
            });
            (*w, View { fields, focus, armed: None })
        })
        .collect();
    for (w, view) in views {
        if let Some(slot) = e.windows.get_mut(&w) {
            slot.typed.clear();
            slot.swap_view = (!view.fields.is_empty() || view.focus.is_some()).then_some(view);
        }
    }
}

/// After the swap's first render (its mount effects included): starts putting the view back.
pub fn arm(s: &mut Win, tx: &mut rune::Tx) {
    let now = Instant::now();
    engine::with(|e| {
        if let Some(view) = e.windows.get_mut(&s.node).and_then(|slot| slot.swap_view.as_mut()) {
            view.armed = Some(Armed { at: now, changed: now, input: USER_INPUT.load(Ordering::Relaxed) });
        }
    });
    place(s, tx, false);
}

/// Whether a restore is waiting in `window`.
pub fn waiting(window: u32) -> bool {
    engine::read(|e| e.windows.get(&window).and_then(|s| s.swap_view.as_ref()).is_some_and(|v| v.armed.is_some()))
}

/// Each poll while armed: places every field that shows, then focus; gives up on what's still
/// missing as dom-state.ts does, and on all of it once the user acts.
pub fn place(s: &mut Win, tx: &mut rune::Tx, changed: bool) {
    let window = s.node;
    let Some((view, interrupted, given_up)) = engine::with(|e| {
        let slot = e.windows.get_mut(&window)?;
        let armed = slot.swap_view.as_mut()?.armed.as_mut()?;
        let now = Instant::now();
        if changed {
            armed.changed = now;
        }
        let interrupted = USER_INPUT.load(Ordering::Relaxed) != armed.input;
        let given_up = now - armed.at >= GRACE || now - armed.changed >= STILL;
        Some((slot.swap_view.take()?, interrupted, given_up))
    }) else {
        return;
    };
    if interrupted {
        return;
    }
    let View { fields, focus, armed } = view;
    let mut left = Vec::new();
    let mut placed: HashMap<u32, String> = HashMap::new();
    for field in fields {
        match engine::read(|e| find(e, window, &field.steps, &field.mark)) {
            Some(n) => {
                let st = s.inputs.entry(n).or_insert_with(|| crate::input::InputState::new(""));
                if st.edit.text != field.value {
                    st.restore(&field.value);
                    crate::engine::element_event(n, "input", json!({ "value": field.value }), Some(tx));
                }
                placed.insert(n, field.value);
            }
            None => left.push(field),
        }
    }
    let focus = match focus {
        Some(f) => match engine::read(|e| find(e, window, &f.steps, &f.mark)) {
            Some(n) => {
                if let Some(st) = s.inputs.get_mut(&n) {
                    let text = &st.edit.text;
                    let at = |i: usize| (0..=i.min(text.len())).rev().find(|b| text.is_char_boundary(*b)).unwrap_or(0);
                    let (a, b) = (at(f.selection.0), at(f.selection.1));
                    st.edit.set_selection(a, b);
                }
                if let Some(key) = engine::read(|e| e.tree.get(n).map(|node| crate::view::rune_key(n, &node.props))) {
                    tx.focus(key, f.ring);
                }
                None
            }
            None => Some(f),
        },
        None => None,
    };
    let done = given_up || (left.is_empty() && focus.is_none());
    engine::with(|e| {
        if let Some(slot) = e.windows.get_mut(&window) {
            slot.typed.extend(placed);
            if !done {
                slot.swap_view = Some(View { fields: left, focus, armed });
            }
        }
    });
}
