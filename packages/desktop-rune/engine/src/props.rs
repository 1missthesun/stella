//! JSX props → Rune `El` builders. Props are parsed from JSON on the bridge thread (off the UI
//! thread); here they are only read.

use rune::tok::{Family, TextStyle, type_};
use rune::{Align, Color, El, ScrollSpec, Span, Spring, Transition};
use serde::Deserialize;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub enum Kind {
    #[default]
    Col,
    Row,
    Box,
    Text,
    Input,
}

impl Kind {
    pub fn parse(s: &str) -> Kind {
        match s {
            "row" => Kind::Row,
            "box" => Kind::Box,
            "text" => Kind::Text,
            "input" => Kind::Input,
            _ => Kind::Col,
        }
    }
}

/// A colour from `#rrggbb` / `#rrggbbaa`.
#[derive(Clone, Copy, Debug)]
pub struct C(pub Color);

impl<'de> Deserialize<'de> for C {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        Ok(C(rune::color::hex(&s).unwrap_or(Color::TRANSPARENT)))
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(untagged)]
pub enum Size {
    Pt(f32),
    Str(String),
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct Run {
    pub t: String,
    /// Weight (e.g. 600).
    pub w: Option<f32>,
    pub c: Option<C>,
    #[serde(default)]
    pub m: bool,
    pub bg: Option<C>,
    #[serde(default)]
    pub i: bool,
    pub u: Option<C>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Props {
    /// Stable identity: Rune key + memo id. Survives a React remount (hot swap).
    pub id: Option<String>,
    pub w: Option<Size>,
    pub h: Option<Size>,
    pub min_w: Option<f32>,
    pub max_w: Option<f32>,
    pub min_h: Option<f32>,
    pub max_h: Option<f32>,
    pub grow: Option<f32>,
    pub shrink: bool,
    pub pad: Option<f32>,
    pub px: Option<f32>,
    pub py: Option<f32>,
    pub pt: Option<f32>,
    pub pr: Option<f32>,
    pub pb: Option<f32>,
    pub pl: Option<f32>,
    pub mt: Option<f32>,
    pub mb: Option<f32>,
    pub ml: Option<f32>,
    pub mr: Option<f32>,
    pub gap: Option<f32>,
    pub align: Option<String>,
    pub justify: Option<String>,
    pub center: bool,
    pub wrap: bool,
    pub fill: Option<C>,
    pub hover: Option<C>,
    pub press: Option<C>,
    pub border: Option<C>,
    pub border_width: Option<f32>,
    pub radius: Option<f32>,
    pub clip: Option<f32>,
    pub scroll_y: bool,
    pub stick_bottom: bool,
    pub edge_fade: Option<f32>,
    pub opacity: Option<f32>,
    pub enter: Option<String>,
    /// Animate layout changes (width/height/position) with a spring of this duration.
    pub layout: Option<f32>,
    pub role: Option<String>,
    pub label: Option<String>,
    pub focusable: bool,
    /// Selectable texts inside select as one, like a web page (drag across paragraphs, Cmd+A).
    pub selection_group: bool,
    pub on_press: bool,
    pub shadow: Option<(f32, f32, C)>,
    // Text
    pub content: Option<String>,
    pub spans: Option<Vec<Run>>,
    pub size: Option<f32>,
    pub weight: Option<f32>,
    pub line_height: Option<f32>,
    pub tracking: Option<f32>,
    pub color: Option<C>,
    pub mono: bool,
    pub selectable: bool,
    pub max_lines: Option<usize>,
    pub truncate: bool,
    pub text_align: Option<String>,
    // Input
    pub placeholder: Option<String>,
    pub placeholder_color: Option<C>,
    pub value: Option<String>,
    pub auto_focus: bool,
    /// A lazy OS WebView slot: the URL to show in this box's rect.
    pub webview: Option<String>,
}

pub fn text_style_of(p: &Props) -> TextStyle {
    let mut s = type_::BODY;
    if let Some(v) = p.size {
        s.size = v;
    }
    if let Some(v) = p.weight {
        s.weight = v;
    }
    if let Some(v) = p.line_height {
        s.line_height = v;
    }
    if let Some(v) = p.tracking {
        s.tracking = v;
    }
    if p.mono {
        s.family = Family::Mono;
    }
    s
}

pub fn text_style(mut e: El, p: &Props) -> El {
    e = e.font(text_style_of(p));
    if let Some(c) = p.color {
        e = e.color(c.0);
    }
    if p.selectable {
        e = e.selectable(true);
    }
    if let Some(n) = p.max_lines {
        e = e.max_lines(n);
    } else if p.truncate {
        e = e.truncate();
    } else {
        e = e.wrap();
    }
    match p.text_align.as_deref() {
        Some("center") => e = e.align(Align::Center),
        Some("end") => e = e.align(Align::End),
        _ => {}
    }
    e
}

/// Concatenates runs into one string with byte-range spans (UTF-8, as Rune wants).
pub fn spans(runs: &[Run]) -> (String, Vec<Span>) {
    let mut content = String::new();
    let mut spans = Vec::new();
    for r in runs {
        let start = content.len();
        content.push_str(&r.t);
        let end = content.len();
        if r.w.is_none() && r.c.is_none() && !r.m && r.bg.is_none() && !r.i && r.u.is_none() {
            continue;
        }
        let mut s = Span::new(start, end);
        s.weight = r.w;
        s.color = r.c.map(|c| c.0);
        s.mono = r.m;
        if let Some(bg) = r.bg {
            s.bg = Some(bg.0);
            s.bg_pad = 3.0;
        }
        s.italic = r.i;
        s.underline = r.u.map(|c| c.0);
        spans.push(s);
    }
    (content, spans)
}

thread_local! {
    /// Latest (offset, max) of each keyed scroll viewport, for scripted scrolling.
    pub static SCROLL: std::cell::RefCell<std::collections::HashMap<String, (f32, f32)>> = Default::default();
}

pub fn scroll_of(key: &str) -> (f32, f32) {
    SCROLL.with(|m| m.borrow().get(key).copied().unwrap_or((0.0, 0.0)))
}

pub fn apply(mut e: El, p: &Props) -> El {
    match &p.w {
        Some(Size::Pt(v)) => e = e.w(*v),
        Some(Size::Str(s)) if s == "full" => e = e.w_full(),
        Some(Size::Str(s)) if s.ends_with('%') => e = e.w_frac(s.trim_end_matches('%').parse::<f32>().unwrap_or(100.0) / 100.0),
        _ => {}
    }
    match &p.h {
        Some(Size::Pt(v)) => e = e.h(*v),
        Some(Size::Str(s)) if s == "full" => e = e.h_full(),
        Some(Size::Str(s)) if s.ends_with('%') => e = e.h_frac(s.trim_end_matches('%').parse::<f32>().unwrap_or(100.0) / 100.0),
        _ => {}
    }
    if let Some(v) = p.min_w {
        e = e.min_w(v);
    }
    if let Some(v) = p.max_w {
        e = e.max_w(v);
    }
    if let Some(v) = p.min_h {
        e = e.min_h(v);
    }
    if let Some(v) = p.max_h {
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
    if let Some(v) = p.gap {
        e = e.gap(v);
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
        _ => {}
    }
    if p.center {
        e = e.center();
    }
    if p.wrap {
        e = e.flex_wrap();
    }
    if let Some(c) = p.fill {
        e = e.fill(c.0);
    }
    if let Some(c) = p.hover {
        e = e.hover(c.0);
    }
    if let Some(c) = p.press {
        e = e.press(c.0);
    }
    if let Some(c) = p.border {
        e = e.border(p.border_width.unwrap_or(1.0), c.0);
    }
    if let Some(r) = p.radius {
        e = e.radius(r);
    }
    if let Some(r) = p.clip {
        e = e.clip_rounded(r);
    }
    if let Some((y, blur, c)) = p.shadow {
        e = e.shadow(y, blur, c.0);
    }
    if p.scroll_y {
        e = e.scroll(ScrollSpec { stick_bottom: p.stick_bottom }).scroll_anchor();
        if let Some(k) = p.id.clone() {
            e = e.on_scroll_offset(move |pos| {
                if std::env::var_os("SCROLL_DEBUG").is_some() { eprintln!("scroll {k} {:?} {:?}", pos.offset, pos.max); }
                SCROLL.with(|m| m.borrow_mut().insert(k.clone(), (pos.offset[1], pos.max[1])));
            });
        }
        if let Some(f) = p.edge_fade {
            e = e.scroll_edge_fade(f);
        }
    }
    if let Some(o) = p.opacity {
        e = e.opacity(o);
    }
    match p.enter.as_deref() {
        Some("fade") => e = e.transition(Transition::opacity()),
        Some("rise") => e = e.transition(Transition::offset(0.0, 10.0)),
        Some("blur") => e = e.transition(Transition::blur_replace()),
        Some("scale") => e = e.transition(Transition::scale(0.96)),
        _ => {}
    }
    if let Some(d) = p.layout {
        e = e.animate_layout().motion(Spring::new(d, 0.0));
    }
    if let Some(r) = p.role.as_deref().and_then(role) {
        e = e.role(r);
    }
    if let Some(l) = &p.label {
        e = e.label(l.clone());
    }
    if p.focusable {
        e = e.focusable(true);
    }
    if p.selection_group {
        e = e.selection_group(true);
    }
    if let Some(k) = &p.id {
        e = e.key(k.clone());
    }
    e
}

fn role(s: &str) -> Option<&'static str> {
    Some(match s {
        "button" => "button",
        "textbox" => "textbox",
        "list" => "list",
        "listitem" => "listitem",
        "heading" => "heading",
        "region" => "region",
        "group" => "group",
        "switch" => "switch",
        "tab" => "tab",
        _ => return None,
    })
}
