//! Box props → Rune builders: layout, paint, state styles, motion, interaction, accessibility.

use rune::{Align, Anim, Cursor, El, ResizeEdge, ScrollFade, ScrollSpec, Shadow, Side, Spring, Transition};
use rune::LoopSpec;

use crate::props::{EffectP, PresenceP, Props, RaiseP, Size};

/// `dur <= 0` (or not a number) means instant: a spring that settles within one frame, since
/// Rune's springs need a positive duration.
pub fn spring(dur: f32, bounce: f32) -> Spring {
    let dur = if dur.is_finite() { dur.max(INSTANT) } else { INSTANT };
    let bounce = if bounce.is_finite() { bounce.clamp(-1.0, 1.0) } else { 0.0 };
    Spring::new(dur, bounce)
}

const INSTANT: f32 = 0.001;

/// `"N%"` or `"full"` as a fraction of the parent.
fn frac(s: &Option<Size>) -> Option<f32> {
    match s {
        Some(Size::Str(s)) if s == "full" => Some(1.0),
        Some(Size::Str(s)) if s.ends_with('%') => s.trim_end_matches('%').trim().parse::<f32>().ok().map(|v| v / 100.0),
        _ => None,
    }
}

pub fn layout(mut e: El, p: &Props) -> El {
    match &p.w {
        Some(Size::Pt(v)) => e = e.w(*v),
        Some(Size::Str(s)) if s == "full" => e = e.w_full(),
        Some(Size::Str(s)) if s == "fit" => e = e.w_fit(),
        Some(Size::Str(s)) if s.ends_with('%') => e = e.w_frac(s.trim_end_matches('%').parse::<f32>().unwrap_or(100.0) / 100.0),
        _ => {}
    }
    match &p.h {
        Some(Size::Pt(v)) => e = e.h(*v),
        Some(Size::Str(s)) if s == "full" => e = e.h_full(),
        Some(Size::Str(s)) if s == "fit" => e = e.h_fit(),
        Some(Size::Str(s)) if s.ends_with('%') => e = e.h_frac(s.trim_end_matches('%').parse::<f32>().unwrap_or(100.0) / 100.0),
        _ => {}
    }
    if let Some(f) = frac(&p.min_w) {
        e = e.min_w_frac(f);
    } else if let Some(Size::Pt(v)) = p.min_w {
        e = e.min_w(v);
    }
    if let Some(f) = frac(&p.max_w) {
        e = e.max_w_frac(f);
    } else if let Some(Size::Pt(v)) = p.max_w {
        e = e.max_w(v);
    }
    if let Some(f) = frac(&p.min_h) {
        e = e.min_h_frac(f);
    } else if let Some(Size::Pt(v)) = p.min_h {
        e = e.min_h(v);
    }
    if let Some(f) = frac(&p.max_h) {
        e = e.max_h_frac(f);
    } else if let Some(Size::Pt(v)) = p.max_h {
        e = e.max_h(v);
    }
    if let Some(v) = p.grow {
        e = e.grow(v);
    }
    if p.shrink {
        e = e.shrink();
    }
    if let Some(v) = p.pad {
        e = e.padding(v);
    }
    if let Some(v) = p.px {
        e = e.px(v);
    }
    if let Some(v) = p.py {
        e = e.py(v);
    }
    if let Some(v) = p.pt {
        e = e.pt(v);
    }
    if let Some(v) = p.pr {
        e = e.pr(v);
    }
    if let Some(v) = p.pb {
        e = e.pb(v);
    }
    if let Some(v) = p.pl {
        e = e.pl(v);
    }
    if let Some(v) = p.mx {
        e = e.mx(v);
    }
    if let Some(v) = p.my {
        e = e.my(v);
    }
    if let Some(v) = p.mt {
        e = e.mt(v);
    }
    if let Some(v) = p.mb {
        e = e.mb(v);
    }
    if let Some(v) = p.ml {
        e = e.ml(v);
    }
    if let Some(v) = p.mr {
        e = e.mr(v);
    }
    match (p.gap, p.row_gap) {
        (Some(g), Some(r)) => e = e.gaps(r, g),
        (Some(g), None) => e = e.gap(g),
        (None, Some(r)) => e = e.gaps(r, 0.0),
        _ => {}
    }
    match p.align.as_deref() {
        Some("start") => e = e.items_start(),
        Some("center") => e = e.items_center(),
        Some("end") => e = e.items_end(),
        Some("stretch") => e = e.items_stretch(),
        _ => {}
    }
    match p.justify.as_deref() {
        Some("start") => e = e.justify_start(),
        Some("center") => e = e.justify_center(),
        Some("end") => e = e.justify_end(),
        Some("between") => e = e.justify_between(),
        Some("around") => e = e.justify_around(),
        Some("evenly") => e = e.justify_evenly(),
        _ => {}
    }
    match p.self_align.as_deref() {
        Some("start") => e = e.self_start(),
        Some("center") => e = e.self_center(),
        Some("end") => e = e.self_end(),
        Some("stretch") => e = e.self_stretch(),
        Some("auto") => e = e.self_auto(),
        _ => {}
    }
    if p.center {
        e = e.center();
    }
    if p.wrap {
        e = e.flex_wrap();
    }
    if let Some(r) = p.aspect {
        e = e.aspect_ratio(r);
    }
    if let Some(n) = p.columns {
        e = e.equal_columns(n.max(1));
    }
    if let Some(c) = p.column {
        e = e.grid_cell(c);
    }
    if let Some(i) = p.inset {
        e = e.pin(Some(i), Some(i), Some(i), Some(i));
    }
    if let Some(a) = p.absolute {
        e = e.pin(a.left, a.top, a.right, a.bottom);
    }
    if p.fixed && p.absolute.is_none() && p.inset.is_none() {
        e = e.pin(Some(0.0), Some(0.0), Some(0.0), Some(0.0));
    }
    if p.fixed {
        e = e.raise();
    }
    match p.dir.as_deref() {
        Some("rtl") => e = e.dir(rune::Direction::Rtl),
        Some("ltr") => e = e.dir(rune::Direction::Ltr),
        _ => {}
    }
    match p.raise {
        Some(RaiseP::On(true)) => e = e.raise(),
        Some(RaiseP::Order(n)) => e = e.paint_order(n),
        _ => {}
    }
    e
}

pub fn paint(mut e: El, p: &Props) -> El {
    if let Some(c) = p.fill {
        e = e.fill(c.0);
    }
    if let Some(g) = &p.gradient {
        let stops: Vec<_> = g.stops.iter().map(|(t, c)| (*t, c.0)).collect();
        e = e.linear_gradient(g.angle.to_radians(), stops);
    } else if let Some(g) = &p.radial {
        let stops: Vec<_> = g.stops.iter().map(|(t, c)| (*t, c.0)).collect();
        let r = match g.radius {
            crate::props::RadiusP::Circle(r) => [r, r],
            crate::props::RadiusP::Ellipse(r) => r,
        };
        e = e.radial_gradient(g.center, rune::RadialRadius(r), stops);
    }
    if let Some(c) = p.border {
        match p.border_sides {
            Some(sides) => e = e.border_sides(sides, c.0),
            None => e = e.border(p.border_width.unwrap_or(1.0), c.0),
        }
        if let Some(d) = p.border_dash {
            e = e.border_dash(d, d);
        }
    }
    if let Some(r) = p.radius {
        e = e.radius(r);
    }
    if let Some(c) = p.corners {
        e = e.corners(c);
    }
    if let Some(r) = p.clip {
        e = e.clip_rounded(r);
    }
    if let Some((y, blur, c)) = p.shadow {
        e = e.shadow(y, blur, c.0);
    }
    if let Some(list) = &p.shadows {
        for s in list {
            e = e.box_shadow(Shadow { x: s.x, y: s.y, blur: s.blur, spread: s.spread, color: s.color.0, inset: s.inset });
        }
    }
    if let Some(o) = p.opacity {
        e = e.opacity(o);
    }
    if let Some(b) = p.blur {
        e = e.blur(b);
    }
    if let Some(b) = p.backdrop_blur {
        e = e.backdrop_blur(b);
    }
    e
}

pub fn states(mut e: El, p: &Props) -> El {
    if let Some(c) = p.hover {
        e = e.hover(c.0);
    }
    if let Some(c) = p.press {
        e = e.press(c.0);
    }
    if let Some(c) = p.hover_fill {
        e = e.hover_fill(c.0);
    }
    if let Some(c) = p.press_fill {
        e = e.press_fill(c.0);
    }
    if let Some(c) = p.hover_border {
        e = e.hover_border(c.0);
    }
    if let Some(c) = p.press_border {
        e = e.press_border(c.0);
    }
    if p.hover_group {
        e = e.hover_group();
    }
    if let Some(c) = p.hover_color {
        e = e.group_color(c.0);
    }
    if let Some((rest, hovered)) = p.hover_opacity {
        e = e.group_opacity(rest, hovered);
    }
    if let Some(s) = p.press_scale {
        e = e.press_scale(s);
    }
    if let Some(f) = p.focus_ring {
        e = e.focus_ring(f.width, f.offset, f.color.0);
        if let Some(r) = f.radius {
            e = e.focus_ring_radius(r);
        }
    }
    if let Some(c) = p.focus_fill {
        e = e.focus_fill(c.0);
    }
    if let Some(c) = p.focus_border {
        e = e.focus_border(c.0);
    }
    if p.disabled {
        e = e.disabled(true);
    }
    e
}

fn effect(base: rune::Effect, f: &EffectP) -> rune::Effect {
    let mut out = base;
    if let Some(o) = f.opacity {
        out.opacity = o;
    }
    if let Some(s) = f.scale {
        out.scale = s;
    }
    if f.x.is_some() || f.y.is_some() {
        out.offset = rune::Vec2::new(f.x.unwrap_or(0.0), f.y.unwrap_or(0.0));
    }
    if let Some(b) = f.blur {
        out.blur = b;
    }
    out
}

fn preset(name: &str) -> Transition {
    match name {
        "fade" => Transition::opacity(),
        "rise" => Transition::offset(0.0, 10.0).combined(Transition::opacity()),
        "drop" => Transition::offset(0.0, -8.0).combined(Transition::opacity()),
        "blur" => Transition::blur_replace(),
        "scale" => Transition::scale(0.96),
        "pop" => Transition::scale(0.9),
        "slide" => Transition::slide(),
        _ => Transition::opacity(),
    }
}

fn presence(p: &PresenceP) -> (Transition, Option<Spring>) {
    match p {
        PresenceP::Preset(name) => (preset(name), None),
        PresenceP::Effect(f) => {
            let e = effect(rune::Effect::IDENTITY, f);
            let t = Transition { insertion: e, removal: e, ..Transition::identity() };
            (t, f.dur.map(|d| spring(d, f.bounce.unwrap_or(0.0))))
        }
    }
}

pub fn motion(mut e: El, p: &Props) -> El {
    if let Some(m) = p.motion {
        let s = spring(m.dur, m.bounce);
        e = e.motion(s).frame_motion(s);
    }
    if let Some(d) = p.layout {
        e = e.animate_layout().motion(spring(d, 0.0));
    }
    if p.x.is_some() || p.y.is_some() {
        e = e.offset(p.x.unwrap_or(0.0), p.y.unwrap_or(0.0));
    }
    if let Some(s) = p.scale {
        e = e.scale(s);
    }
    if let Some(r) = p.rotate {
        e = e.rotate(r);
    }
    if let Some([x, y]) = p.origin {
        e = e.origin(x, y);
    }
    match (&p.enter, &p.exit) {
        (None, None) => {}
        (enter, exit) => {
            let (ti, si) = enter.as_ref().map(presence).unwrap_or((Transition::identity(), None));
            let (to, so) = exit.as_ref().map(presence).unwrap_or_else(|| (ti, si));
            let t = Transition::asymmetric(ti, to);
            e = e.transition(t);
            if si.is_some() || so.is_some() {
                let enter_anim: Anim = si.unwrap_or(t.springs.enter).into();
                let exit_anim: Anim = so.unwrap_or(t.springs.exit).into();
                e = e.transition_motion(enter_anim, exit_anim);
            }
        }
    }
    if let Some(l) = &p.loop_ {
        let period = l.period.max(0.01) as f64;
        if l.kind == "sequence" {
            e = sequence(e, l);
            if let Some([x, y]) = l.origin {
                e = e.origin(x, y);
            }
            return e;
        }
        let spec = match l.kind.as_str() {
            "rotation" => LoopSpec::rotation(period),
            "slide" => LoopSpec::slide(period, l.from.map_or([0.0, 0.0], |o| o.xy()), l.to.map_or([0.0, 0.0], |o| o.xy())),
            _ => LoopSpec::opacity(period, 0.0, l.low.unwrap_or(0.35), l.high.unwrap_or(1.0)),
        };
        e = e.looping(spec);
        if let Some(n) = l.times {
            e = e.loop_times(n);
        }
    }
    if p.instant {
        e = e.instant_changes();
    }
    e
}

thread_local! {
    static SEQUENCES: std::cell::RefCell<std::collections::HashMap<u64, &'static [rune::Beat]>> = std::cell::RefCell::new(std::collections::HashMap::new());
}

/// A keyframed loop. `at` is a fraction of `period` (0..1), or seconds when any exceeds 1.
/// Rune scales uniformly: `scale`, else the mean of `scaleX`/`scaleY`.
fn sequence(e: El, l: &crate::props::LoopP) -> El {
    if l.frames.len() < 2 {
        return e;
    }
    let fractions = l.frames.iter().all(|f| f.at <= 1.0);
    let period = l.period.max(0.01);
    let beats: Vec<rune::Beat> = l
        .frames
        .iter()
        .map(|f| {
            let at = if fractions { f.at * period } else { f.at };
            let scale = f.scale.or(match (f.scale_x, f.scale_y) {
                (Some(x), Some(y)) => Some((x + y) * 0.5),
                (x, y) => x.or(y),
            });
            rune::Beat::new(at as f64)
                .opacity(f.opacity.unwrap_or(1.0))
                .scale(scale.unwrap_or(1.0))
                .translate(f.x.unwrap_or(0.0), f.y.unwrap_or(0.0))
                .rotate(f.rotate.unwrap_or(0.0))
        })
        .collect();
    let h = {
        use std::hash::{Hash, Hasher};
        let mut s = std::collections::hash_map::DefaultHasher::new();
        for b in &beats {
            b.at.to_bits().hash(&mut s);
            b.opacity.to_bits().hash(&mut s);
            b.scale.to_bits().hash(&mut s);
            b.translate[0].to_bits().hash(&mut s);
            b.translate[1].to_bits().hash(&mut s);
            b.rotate.to_bits().hash(&mut s);
        }
        s.finish()
    };
    let frames: &'static [rune::Beat] = SEQUENCES.with(|m| *m.borrow_mut().entry(h).or_insert_with(|| Box::leak(beats.into_boxed_slice())));
    let mut seq = rune::Sequence::new(frames).repeating();
    if let Some(d) = l.delay {
        seq = seq.delay(d as f64);
    }
    e.sequence(seq)
}

fn cursor(name: &str) -> Option<Cursor> {
    Some(match name {
        "default" => Cursor::Default,
        "pointer" => Cursor::Pointer,
        "text" => Cursor::Text,
        "grab" => Cursor::Grab,
        "grabbing" => Cursor::Grabbing,
        "notAllowed" | "not-allowed" => Cursor::NotAllowed,
        "move" => Cursor::Move,
        "colResize" | "col-resize" => Cursor::ResizeColumn,
        "rowResize" | "row-resize" => Cursor::ResizeRow,
        "ewResize" | "ew-resize" => Cursor::ResizeEw,
        "nsResize" | "ns-resize" => Cursor::ResizeNs,
        "nwseResize" | "nwse-resize" => Cursor::ResizeNwse,
        "neswResize" | "nesw-resize" => Cursor::ResizeNesw,
        _ => return None,
    })
}

pub fn side(s: Option<&str>) -> Side {
    match s {
        Some("top") => Side::Top,
        Some("left") => Side::Left,
        Some("right") => Side::Right,
        _ => Side::Bottom,
    }
}

pub fn align(s: Option<&str>) -> Align {
    match s {
        Some("center") => Align::Center,
        Some("end") => Align::End,
        _ => Align::Start,
    }
}

fn resize_edge(s: &str) -> Option<ResizeEdge> {
    Some(match s {
        "n" | "top" => ResizeEdge::North,
        "s" | "bottom" => ResizeEdge::South,
        "e" | "right" => ResizeEdge::East,
        "w" | "left" => ResizeEdge::West,
        "ne" => ResizeEdge::NorthEast,
        "nw" => ResizeEdge::NorthWest,
        "se" => ResizeEdge::SouthEast,
        "sw" => ResizeEdge::SouthWest,
        _ => return None,
    })
}

pub fn interaction(mut e: El, p: &Props) -> El {
    if let Some(c) = p.cursor.as_deref().and_then(cursor) {
        e = e.cursor(c);
    }
    if p.inert {
        e = e.inert();
    }
    if p.focusable {
        e = e.focusable(true);
    }
    if let Some(t) = p.tab_index {
        e = e.tab_index(t);
    }
    if p.focus_group {
        e = e.focus_group();
    }
    if p.window_drag {
        e = e.window_drag();
    }
    if p.no_window_drag {
        e = e.no_window_drag();
    }
    if let Some(edge) = p.window_resize.as_deref().and_then(resize_edge) {
        e = e.window_resize(edge);
    }
    if let Some(t) = &p.title {
        e = e.help(t.clone());
        if let Some(s) = p.title_side.as_deref() {
            e = e.help_side(side(Some(s)));
        }
    }
    if let Some(a) = &p.anchor {
        let (s, al) = (side(a.side.as_deref()), align(a.align.as_deref()));
        e = if a.fit { e.anchored_fit(a.to.clone(), s, al, a.gap) } else { e.anchored(a.to.clone(), s, al, a.gap) };
    }
    e
}

pub fn scroll(mut e: El, p: &Props) -> El {
    if p.scroll_x && p.scroll_y {
        e = e.scroll_xy();
    } else if p.scroll_x {
        e = e.scroll_x();
    } else if p.scroll_y {
        e = e.scroll(ScrollSpec { stick_bottom: p.stick_bottom }).scroll_anchor();
    }
    if (p.scroll_x || p.scroll_y)
        && let Some(f) = p.edge_fade
    {
        e = e.scroll_edge_fade(f);
    }
    if (p.scroll_x || p.scroll_y)
        && let Some(f) = &p.scroll_fade
    {
        e = e.scroll_fade(scroll_fade(f));
    }
    if p.no_scroll_anchor {
        e = e.no_scroll_anchor();
    }
    if p.arrives_whole {
        e = e.arrives_whole();
    }
    match p.sticky.as_deref() {
        Some("top") => e = e.sticky_top(p.sticky_inset.unwrap_or(0.0)),
        Some("bottom") => e = e.sticky_bottom(p.sticky_inset.unwrap_or(0.0)),
        _ => {}
    }
    e
}

fn fade_edge(f: &crate::props::FadeEdgeP) -> ScrollFade {
    let mut fade = if f.feather { ScrollFade::feather(f.size) } else { ScrollFade::strength(f.size) };
    if let Some(at) = f.full_at {
        fade = fade.full_at(at);
    }
    if let Some(stops) = &f.stops {
        let stops: Vec<(f32, f32)> = stops.iter().map(|[t, a]| (*t, *a)).collect();
        fade = fade.stops(&stops);
    } else if f.linear {
        fade = fade.linear();
    }
    fade
}

fn scroll_fade(f: &crate::props::ScrollFadeP) -> ScrollFade {
    let none = crate::props::FadeEdgeP::default();
    let top = fade_edge(f.top.as_ref().unwrap_or(&none));
    match &f.bottom {
        Some(b) => top.with_end(fade_edge(b)),
        None => top.with_end(ScrollFade::strength(0.0)),
    }
}

pub fn a11y(mut e: El, p: &Props) -> El {
    if let Some(r) = p.role.as_deref().and_then(role) {
        e = e.role(r);
    }
    if let Some(l) = &p.label {
        e = e.label(l.clone());
    }
    if let Some(c) = p.checked {
        e = e.checked(c);
    }
    if let Some(x) = p.expanded {
        e = e.expanded(x);
    }
    if p.a11y_hidden || p.hidden {
        e = e.a11y_hidden();
    }
    if p.hidden {
        e = e.opacity(0.0).inert();
    }
    e
}

fn role(s: &str) -> Option<&'static str> {
    const ROLES: &[&str] = &[
        "button", "textbox", "list", "listitem", "heading", "region", "group", "switch", "tab", "tablist", "tabpanel", "menu",
        "menuitem", "menuitemcheckbox", "menuitemradio", "listbox", "option", "dialog", "alertdialog", "checkbox", "radio",
        "radiogroup", "slider", "link", "img", "toolbar", "tooltip", "status", "alert", "log", "navigation", "main", "article",
        "separator", "combobox", "progressbar", "tree", "treeitem", "grid", "row", "cell", "searchbox", "banner", "complementary",
    ];
    ROLES.iter().find(|r| **r == s).copied()
}

/// All box props in their builder order. Keys go last so a key path resolves to this element.
pub fn apply(e: El, p: &Props) -> El {
    let e = layout(e, p);
    let e = paint(e, p);
    let e = states(e, p);
    let e = scroll(e, p);
    let e = motion(e, p);
    let e = interaction(e, p);
    a11y(e, p)
}
