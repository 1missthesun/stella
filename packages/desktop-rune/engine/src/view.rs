//! Mirror tree → Rune `El`, one window at a time, with the handlers each element listens to.

use std::borrow::Cow;

use rune::{El, GrowthSpec, Tx, col, el, row};
use serde_json::json;

use crate::engine::{Engine, element_event, utf16_of};
use crate::props::{Kind, Props};
use crate::tree::Node;
use crate::windows::Win;
use crate::{keys, media, style, text};

pub fn rune_key(n: u32, p: &Props) -> String {
    p.id.clone().unwrap_or_else(|| format!("n{n}"))
}

pub fn build(s: &Win, eng: &Engine, id: u32) -> El {
    let Some(n) = eng.tree.get(id) else { return el() };
    if n.props.id.is_some() && !eng.tree.live_above.contains(&id) && !matches!(n.kind, Kind::Input | Kind::Video | Kind::Webview) {
        let key = rune_key(id, &n.props);
        return rune::memo::memo_with_hash(key, n.ver, || build_node(s, eng, id, n));
    }
    build_node(s, eng, id, n)
}

pub fn children(s: &Win, eng: &Engine, n: &Node, mut e: El) -> El {
    for c in &n.children {
        if eng.tree.get(*c).is_some_and(|c| c.props.lifted()) {
            continue;
        }
        e = e.child(build(s, eng, *c));
    }
    e
}

fn build_node(s: &Win, eng: &Engine, id: u32, n: &Node) -> El {
    let p = &*n.props;
    let e = match n.kind {
        Kind::Row => children(s, eng, n, row()),
        Kind::Col | Kind::Window => children(s, eng, n, col()),
        Kind::Box => children(s, eng, n, el()),
        Kind::Text => text::build(p),
        Kind::Input => return crate::input::build(s, id, p),
        Kind::Image => media::image(eng, p),
        Kind::Icon => media::icon(p),
        Kind::Vector => media::vector(id, p),
        Kind::Video => media::video(id, p),
        Kind::Markdown => media::markdown(id, p),
        #[cfg(feature = "webview")]
        Kind::Webview => crate::webview::slot(id),
        #[cfg(not(feature = "webview"))]
        Kind::Webview => el(),
        Kind::List => list(id, n),
    };
    let e = style::apply(e, p);
    let mut e = handlers(e, id, p, false);
    #[cfg(feature = "webview")]
    if eng.tree.clippers.contains(&id) {
        e = crate::webview::clipper(e, id);
    }
    e.key(rune_key(id, p))
}

fn list(id: u32, n: &Node) -> El {
    let count = n.children.len();
    let est = n.props.estimate.unwrap_or(64.0);
    let mut e = col();
    match &n.props.growth {
        Some(crate::props::GrowthP::On(false)) => {}
        Some(crate::props::GrowthP::Spec(g)) => e = e.growth(growth_spec(g)),
        _ => e = e.growth(GrowthSpec::default()),
    }
    let mut e = e.virtual_rows(
        count,
        est,
        move |_s: &Win, i| -> Cow<'_, str> {
            crate::engine::read(|eng| {
                let child = eng.tree.get(id).and_then(|l| l.children.get(i).copied()).unwrap_or(0);
                let key = eng.tree.get(child).map(|c| rune_key(child, &c.props)).unwrap_or_else(|| format!("n{child}"));
                Cow::Owned(key)
            })
        },
        move |s: &Win, i| {
            crate::engine::read(|eng| {
                let child = eng.tree.get(id).and_then(|l| l.children.get(i).copied()).unwrap_or(0);
                build(s, eng, child)
            })
        },
    );
    if let Some((o, edge)) = n.props.overscan {
        e = e.virtual_overscan(o, edge);
    }
    if n.props.listens("visibleRows") {
        e = e.on_visible_rows(move |_s: &mut Win, r: std::ops::Range<usize>| {
            element_event(id, "visibleRows", json!({ "first": r.start, "last": r.end.saturating_sub(1), "end": r.end }), None);
            false
        });
    }
    e.virtual_rows_version(n.ver)
}

fn growth_spec(g: &crate::props::GrowthSpecP) -> GrowthSpec {
    let mut spec = GrowthSpec::default();
    if g.dur.is_some() || g.bounce.is_some() {
        spec.spring = rune::Spring::new(g.dur.unwrap_or(0.3).max(0.0), g.bounce.unwrap_or(0.0).clamp(-1.0, 1.0));
    }
    let edges = rune::edge::ALL;
    if let Some(name) = g.edge.as_deref() {
        let want = match name {
            "fastFeather" => "fast-feather",
            "none" => "no-mask",
            "wordFade" => "word-fade",
            n => n,
        };
        if let Some(e) = edges.iter().find(|e| e.name == want) {
            spec.edge = *e;
        }
    }
    if let Some(clip) = g.clip {
        spec.edge.clip = clip;
    }
    spec
}

/// Wires every handler the element listens to (`props.on`).
pub fn handlers(mut e: El, n: u32, p: &Props, is_input: bool) -> El {
    for name in &p.on {
        e = match name.as_str() {
            "press" => e.on_press_tx(move |_s: &mut Win, tx: &mut Tx| element_event(n, "press", json!({}), Some(tx))),
            "doublePress" => e.on_double_press_tx(move |_s: &mut Win, tx: &mut Tx| element_event(n, "doublePress", json!({}), Some(tx))),
            "contextMenu" => e.on_secondary_press(move |_s: &mut Win, at: rune::PointerPress, tx: &mut Tx| {
                element_event(n, "contextMenu", json!({ "x": at.x, "y": at.y }), Some(tx))
            }),
            "hover" => e.on_hover_change(move |_s: &mut Win, inside: bool, tx: &mut Tx| element_event(n, "hover", json!({ "inside": inside }), Some(tx))),
            "focus" => e.on_focus_change(move |_s: &mut Win, focused: bool, tx: &mut Tx| {
                element_event(n, "focus", json!({ "focused": focused, "visible": tx.focus_visible() }), Some(tx))
            }),
            "focusWithin" => e.on_focus_within_change(move |_s: &mut Win, within: bool, tx: &mut Tx| {
                element_event(n, "focusWithin", json!({ "within": within }), Some(tx))
            }),
            "layout" => e.on_layout(move |_s: &mut Win, r: [f32; 4]| element_event(n, "layout", json!({ "x": r[0], "y": r[1], "w": r[2], "h": r[3] }), None)),
            "farFromBottom" => {
                let min = p.far_from_bottom.unwrap_or(180.0);
                e.on_far_from_bottom(min, move |_s: &mut Win, far: bool| element_event(n, "farFromBottom", json!({ "far": far }), None))
            }
            "atBottom" => e
                .on_at_bottom(move |_s: &mut Win, at: bool| element_event(n, "atBottom", json!({ "atBottom": at }), None)),
            "dropFiles" => e.on_drop_files(move |_s: &mut Win, paths: &[std::path::PathBuf], tx: &mut Tx| {
                let paths: Vec<String> = paths.iter().map(|p| p.to_string_lossy().into_owned()).collect();
                element_event(n, "dropFiles", json!({ "paths": paths }), Some(tx))
            }),
            "dropHover" => e.on_drop_hover(move |_s: &mut Win, over: bool, tx: &mut Tx| element_event(n, "dropHover", json!({ "over": over }), Some(tx))),
            "link" => e.on_link(move |_s: &mut Win, href: &str, tx: &mut Tx| element_event(n, "link", json!({ "href": href }), Some(tx))),
            "drag" => e.on_drag(move |_s: &mut Win, d: &mut rune::Drag, tx: &mut Tx| {
                let phase = match d.phase {
                    rune::Phase::Down => "start",
                    rune::Phase::Move => "move",
                    rune::Phase::Up => "end",
                };
                element_event(n, "drag", json!({ "phase": phase, "dx": d.dx, "dy": d.dy, "x": d.x, "y": d.y }), Some(tx))
            }),
            _ => e,
        };
    }
    if p.selection_group {
        e = e.selection_group(true);
    }
    if (p.selection_group || p.selectable) && !is_input {
        e = e.on_selection_change(move |s: &mut Win, change: &rune::SelectionChange, _tx: &mut Tx| {
            crate::windows::note_selection(s.node, n, change.selection().map(|t| t.text().to_owned()));
        });
    }
    if p.scroll_x || p.scroll_y {
        let listens = p.listens("scroll");
        let key = rune_key(n, p);
        let last = std::cell::Cell::new([f32::NAN; 4]);
        e = e.on_scroll_offset(move |pos: rune::ScrollPos| {
            let now = [pos.offset[0], pos.offset[1], pos.max[0], pos.max[1]];
            if now == last.get() {
                return;
            }
            last.set(now);
            crate::control::note_scroll_max(&key, pos.max[1]);
            if listens {
                element_event(n, "scroll", json!({ "x": pos.offset[0], "y": pos.offset[1], "maxX": pos.max[0], "maxY": pos.max[1], "viewport": pos.viewport }), None);
            }
        });
    }
    if let Some(m) = p.modal {
        let listens = p.listens("dismiss");
        e = e.modal(m.click_outside, move |_s: &mut Win| {
            if listens {
                element_event(n, "dismiss", json!({}), None)
            }
        });
        if m.wheel_outside {
            e = e.modal_wheel_outside(true);
        }
    }
    if !p.keys.is_empty() && !is_input {
        let chords = keys::Chords::new(&p.keys);
        e = e.on_key(move |_s: &mut Win, ev: &rune::KeyEvent, tx: &mut Tx| chords.take(n, ev, tx));
    }
    if let Some(d) = &p.drag_out {
        let paths: Vec<std::path::PathBuf> = d.paths.iter().map(std::path::PathBuf::from).collect();
        let text = d.text.clone();
        e = e.drag_out(move |_s: &Win| {
            if !paths.is_empty() {
                Some(paths.iter().fold(rune::DragItem::new(), |d, p| d.file(p.clone())))
            } else {
                text.as_ref().map(|t| rune::DragItem::new().text(t.clone()))
            }
        });
    }
    if let Some(exts) = &p.drop_exts {
        let exts: Vec<&str> = exts.iter().map(|s| s.as_str()).collect();
        e = e.accepts_extensions(&exts);
    }
    e
}

/// Selection of a text field in UTF-16 units: `(start, end)`.
pub fn selection16(edit: &rune::TextEdit) -> (usize, usize) {
    let (a, b) = (edit.anchor.min(edit.focus), edit.anchor.max(edit.focus));
    (utf16_of(&edit.text, a), utf16_of(&edit.text, b))
}
