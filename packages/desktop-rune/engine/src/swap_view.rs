//! Keeps what the user typed, the focused text field and where each viewport is scrolled across
//! a hot swap, as desktop-ui's swap does with `restoreDomState` (platform/view-state/dom-state.ts):
//! the swap remounts every node under new ids (and new `useId` values), so each field and viewport
//! is found again by its place in the tree and its look, a field given its text back through an
//! `input` event and refocused with its selection, a viewport scrolled back in the swap's first
//! frame.

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
/// dom-state.ts: viewports are held in place this long once all are, while late content lands.
const QUIET: Duration = Duration::from_millis(300);
const DEADLINE: Duration = Duration::from_secs(3);
const TICK: Duration = Duration::from_millis(16);
const AT_EDGE: f32 = 2.0;
const MAX_SCROLLED: usize = 512;
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

struct Scroll {
    steps: Vec<Step>,
    mark: String,
    left: f32,
    top: f32,
    from_bottom: f32,
}

pub struct View {
    fields: Vec<Field>,
    focus: Option<Focus>,
    scroll: Vec<Scroll>,
    armed: Option<Armed>,
}

struct Armed {
    at: Instant,
    changed: Instant,
    quiet: Option<Instant>,
    input: u64,
}

/// What a window's last poll saw focused: the key, its ring, and a text field's selection.
pub type Seen = (String, bool, Option<(usize, usize)>);

/// `_r_4a_`, `«r4a»` and `:r4a:` (React's `useId` across versions) differ per mount.
pub fn stable_id(id: &str) -> String {
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

/// dom-state.ts `scrollMark`: the axes it scrolls and its id.
fn scroll_mark(p: &Props) -> String {
    format!("{}{}|{}", u8::from(p.scroll_x), u8::from(p.scroll_y), p.id.as_deref().map(stable_id).unwrap_or_default())
}

/// A viewport's offset and range as it reports them; a scroll by the user stops a restore.
pub fn scrolled(n: u32, pos: [f32; 4], by_user: bool) {
    if by_user {
        USER_INPUT.fetch_add(1, Ordering::Relaxed);
    }
    engine::with(|e| {
        if e.scrolled.len() >= MAX_SCROLLED && !e.scrolled.contains_key(&n) {
            let tree = &e.tree;
            e.scrolled.retain(|n, _| tree.get(*n).is_some());
        }
        e.scrolled.insert(n, pos);
    });
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
    find_by(e, window, steps, |n| e.tree.get(n).is_some_and(|node| node.kind == Kind::Input && mark(&node.props) == want))
}

/// The viewport at the same place with the same look, else the only scrollable one in the
/// window with that look (dom-state.ts `placeScroll`).
fn find_scroll(e: &Engine, window: u32, steps: &[Step], want: &str) -> Option<u32> {
    let looks = |n: u32| e.tree.get(n).is_some_and(|node| (node.props.scroll_x || node.props.scroll_y) && scroll_mark(&node.props) == want);
    if let Some(n) = at_path(e, window, steps).filter(|n| looks(*n)) {
        return Some(n);
    }
    let scrolls = |n: u32| e.scrolled.get(&n).is_some_and(|p| p[2] > 0.0 || p[3] > 0.0);
    only_one(e, window, |n| looks(n) && scrolls(n))
}

fn find_by(e: &Engine, window: u32, steps: &[Step], fits: impl Fn(u32) -> bool) -> Option<u32> {
    if let Some(n) = at_path(e, window, steps).filter(|n| fits(*n)) {
        return Some(n);
    }
    only_one(e, window, fits)
}

fn only_one(e: &Engine, window: u32, fits: impl Fn(u32) -> bool) -> Option<u32> {
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
            let scroll: Vec<Scroll> = e
                .scrolled
                .iter()
                .filter(|(n, pos)| (pos[2] > 0.0 || pos[3] > 0.0) && e.tree.window_of(**n) == Some(*w))
                .filter_map(|(n, pos)| {
                    let p = &e.tree.get(*n)?.props;
                    (p.scroll_x || p.scroll_y).then_some(())?;
                    Some(Scroll { steps: path(e, *w, *n)?, mark: scroll_mark(p), left: pos[0], top: pos[1], from_bottom: pos[3] - pos[1] })
                })
                .collect();
            (*w, View { fields, focus, scroll, armed: None })
        })
        .collect();
    for (w, view) in views {
        if let Some(slot) = e.windows.get_mut(&w) {
            slot.typed.clear();
            slot.swap_view = (!view.fields.is_empty() || view.focus.is_some() || !view.scroll.is_empty()).then_some(view);
        }
    }
}

/// After the swap's first render (its mount effects included): starts putting the view back.
pub fn arm(s: &mut Win, tx: &mut rune::Tx) {
    let now = Instant::now();
    engine::with(|e| {
        if let Some(view) = e.windows.get_mut(&s.node).and_then(|slot| slot.swap_view.as_mut()) {
            view.armed = Some(Armed { at: now, changed: now, quiet: None, input: USER_INPUT.load(Ordering::Relaxed) });
        }
    });
    place(s, tx, false);
}

/// Whether a restore is waiting in `window`.
pub fn waiting(window: u32) -> bool {
    engine::read(|e| e.windows.get(&window).and_then(|s| s.swap_view.as_ref()).is_some_and(|v| v.armed.is_some()))
}

/// Each poll while armed: places every field that shows, then focus, and scrolls each viewport
/// back; gives up on what's still missing as dom-state.ts does, and on all of it once the user
/// acts. Viewports stay held for `QUIET` once all are in place, as late content lands.
pub fn place(s: &mut Win, tx: &mut rune::Tx, changed: bool) {
    let window = s.node;
    let now = Instant::now();
    let Some((view, interrupted)) = engine::with(|e| {
        let slot = e.windows.get_mut(&window)?;
        let armed = slot.swap_view.as_mut()?.armed.as_mut()?;
        if changed {
            armed.changed = now;
        }
        let interrupted = USER_INPUT.load(Ordering::Relaxed) != armed.input;
        Some((slot.swap_view.take()?, interrupted))
    }) else {
        return;
    };
    if interrupted {
        return;
    }
    let View { fields, focus, scroll, armed } = view;
    let Some(mut armed) = armed else { return };
    let missing_ok = now - armed.at >= GRACE || now - armed.changed >= STILL;
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
    let scrolls_in_place = scroll.iter().all(|entry| match place_scroll(window, entry, tx) {
        Placement::Placed => true,
        Placement::Waiting => false,
        Placement::Missing => missing_ok,
    });
    let in_place = scrolls_in_place && (missing_ok || (left.is_empty() && focus.is_none()));
    let quiet = if scroll.is_empty() { Duration::ZERO } else { QUIET };
    armed.quiet = if in_place { Some(armed.quiet.unwrap_or(now)) } else { None };
    let done = now - armed.at >= DEADLINE || armed.quiet.is_some_and(|since| now - since >= quiet);
    if !done {
        tx.wake_after(TICK);
    }
    engine::with(|e| {
        if let Some(slot) = e.windows.get_mut(&window) {
            slot.typed.extend(placed);
            if !done {
                slot.swap_view = Some(View { fields: left, focus, scroll, armed: Some(armed) });
            }
        }
    });
}

enum Placement {
    Placed,
    Waiting,
    Missing,
}

/// dom-state.ts `placeScroll`: near its end a viewport keeps its distance from the end, else
/// from the start. Before the swap's first layout it asks for the offset it had, so the first
/// frame already shows it.
fn place_scroll(window: u32, entry: &Scroll, tx: &mut rune::Tx) -> Placement {
    let Some((key, pos)) = engine::read(|e| {
        let n = find_scroll(e, window, &entry.steps, &entry.mark)?;
        Some((crate::view::rune_key(n, &e.tree.get(n)?.props), e.scrolled.get(&n).copied()))
    }) else {
        return Placement::Missing;
    };
    let near_end = entry.from_bottom <= AT_EDGE || entry.from_bottom < entry.top;
    let Some([x, y, _, range]) = pos else {
        tx.scroll_to_instant(key, entry.left, entry.top);
        return Placement::Waiting;
    };
    let top = if near_end { range - entry.from_bottom } else { entry.top };
    if top < 0.0 || top > range + AT_EDGE {
        return Placement::Waiting;
    }
    if (y - top).abs() <= 0.01 && (x - entry.left).abs() <= 0.01 {
        return Placement::Placed;
    }
    tx.scroll_to_instant(key, entry.left, top);
    Placement::Waiting
}
