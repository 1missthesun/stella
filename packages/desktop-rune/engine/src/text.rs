//! `<text>` and text props: styles, inline runs, links, truncation.

use std::cell::RefCell;
use std::collections::HashMap;

use rune::tok::{Family, TextStyle, type_};
use rune::{Align, El, Link, Span, TextCase};

use crate::props::{Props, Run, TruncateP};

thread_local! {
    static FAMILIES: RefCell<HashMap<String, &'static str>> = RefCell::new(HashMap::new());
}

/// Rune keeps family names as `&'static str`; each distinct name is leaked once.
pub fn family_name(name: &str) -> &'static str {
    FAMILIES.with(|f| *f.borrow_mut().entry(name.to_owned()).or_insert_with(|| Box::leak(name.to_owned().into_boxed_str())))
}

pub fn style_of(p: &Props) -> TextStyle {
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
    if let Some(f) = &p.features {
        s.features = family_name(f);
    }
    if p.mono {
        s.family = Family::Mono;
    } else if let Some(f) = &p.family {
        s.family = match f.as_str() {
            "mono" => Family::Mono,
            "sans" => Family::Sans,
            "system-mono" => Family::SystemMono,
            other => Family::Named(family_name(other)),
        };
    }
    s
}

/// Text props that apply to `<text>` and `<input>` alike.
pub fn apply(mut e: El, p: &Props, content_len: usize) -> El {
    e = e.font(style_of(p));
    if let Some(c) = p.color {
        e = e.color(c.0);
    }
    if p.selectable {
        e = e.selectable(true);
    }
    if let Some(c) = p.selection_color {
        e = e.selection_color(c.0);
    }
    match (&p.truncate, p.max_lines) {
        (_, Some(n)) => e = e.max_lines(n),
        (Some(TruncateP::On(true)), _) => e = e.truncate(),
        (Some(TruncateP::Mode(m)), _) if m == "middle" => e = e.truncate_middle(),
        (Some(TruncateP::Mode(m)), _) if m == "head" => e = e.truncate_head(),
        (Some(TruncateP::Mode(m)), _) if m == "fade" => e = e.truncate_fade(),
        (Some(TruncateP::Mode(_)), _) => e = e.truncate(),
        _ if p.nowrap => e = e.nowrap(),
        _ if p.balance => e = e.wrap().wrap_balance(),
        _ => e = e.wrap(),
    }
    match p.text_align.as_deref() {
        Some("center") => e = e.align(Align::Center),
        Some("end") | Some("right") => e = e.align(Align::End),
        _ => {}
    }
    match p.text_case.as_deref() {
        Some("upper") => e = e.text_case(TextCase::Uppercase),
        Some("lower") => e = e.text_case(TextCase::Lowercase),
        _ => {}
    }
    if p.strike && content_len > 0 {
        e = e.strike(0, content_len, None);
    }
    e
}

/// The content and spans of a `<text>`, with links (`href` runs) as byte ranges.
pub struct Rich {
    pub content: String,
    pub spans: Vec<Span>,
    pub links: Vec<(usize, usize, String)>,
    pub strikes: Vec<(usize, usize)>,
}

pub fn rich(runs: &[Run], whole: &Props) -> Rich {
    let mut out = Rich { content: String::new(), spans: Vec::new(), links: Vec::new(), strikes: Vec::new() };
    for r in runs {
        let start = out.content.len();
        out.content.push_str(&r.t);
        let end = out.content.len();
        if let Some(h) = &r.href {
            out.links.push((start, end, h.clone()));
        }
        if r.st {
            out.strikes.push((start, end));
        }
        let italic = r.i || whole.italic;
        let underline = r.u.map(|c| c.0).or(if whole.underline { whole.color.map(|c| c.0) } else { None });
        if r.w.is_none() && r.c.is_none() && !r.m && r.bg.is_none() && !italic && underline.is_none() && r.s.is_none() {
            continue;
        }
        let mut s = Span::new(start, end);
        s.weight = r.w;
        s.color = r.c.map(|c| c.0);
        s.mono = r.m;
        s.size = r.s;
        if let Some(bg) = r.bg {
            s.bg = Some(bg.0);
            s.bg_pad = 3.0;
        }
        s.italic = italic;
        s.underline = underline;
        out.spans.push(s);
    }
    out
}

pub fn build(p: &Props) -> El {
    let (e, len) = match &p.spans {
        Some(runs) => {
            let r = rich(runs, p);
            let len = r.content.len();
            let mut e = rune::rich(r.content, r.spans);
            for (i, (s, end, href)) in r.links.into_iter().enumerate() {
                e = e.link(Link::new(s..end, format!("l{i}")).href(href));
            }
            if !r.strikes.is_empty() {
                e = e.strikes(r.strikes.into_iter().map(|(s, end)| (s, end, None)));
            }
            (e, len)
        }
        None => {
            let content = p.content.clone().unwrap_or_default();
            let len = content.len();
            if p.italic || p.underline {
                let mut s = Span::new(0, len);
                s.italic = p.italic;
                s.underline = if p.underline { p.color.map(|c| c.0) } else { None };
                (rune::rich(content, vec![s]), len)
            } else {
                (rune::text(content), len)
            }
        }
    };
    apply(e, p, len).shrink()
}
