//! `<markdown>`: rune-kit's native Markdown (streaming, selection, syntax highlighting, tables,
//! mermaid), styled from a JSON object whose keys name `MarkdownStyle` builders.

use std::cell::RefCell;
use std::collections::HashMap;

use rune::El;
use rune::tok::TextStyle;
use rune_kit::{Markdown, MarkdownStyle};
use serde_json::Value;

use crate::props::{Props, parse_color};

thread_local! {
    static STYLES: RefCell<HashMap<u64, MarkdownStyle>> = RefCell::new(HashMap::new());
}

fn col(v: &Value, k: &str) -> Option<rune::Color> {
    v.get(k).and_then(|c| c.as_str()).and_then(parse_color)
}

fn num(v: &Value, k: &str) -> Option<f32> {
    v.get(k).and_then(|c| c.as_f64()).map(|x| x as f32)
}

fn pair(v: &Value, k: &str) -> Option<[f32; 2]> {
    let a = v.get(k)?.as_array()?;
    Some([a.first()?.as_f64()? as f32, a.get(1)?.as_f64()? as f32])
}

fn font(v: &Value, base: TextStyle) -> TextStyle {
    let mut p = Props { size: num(v, "size"), weight: num(v, "weight"), line_height: num(v, "lineHeight"), tracking: num(v, "tracking"), ..Default::default() };
    p.family = v.get("family").and_then(|f| f.as_str()).map(str::to_owned);
    let mut s = crate::text::style_of(&p);
    if p.size.is_none() {
        s.size = base.size;
    }
    if p.weight.is_none() {
        s.weight = base.weight;
    }
    if p.line_height.is_none() {
        s.line_height = base.line_height;
    }
    s
}

fn style(v: &Value) -> MarkdownStyle {
    let dark = v.get("dark").and_then(|d| d.as_bool()).unwrap_or(true);
    let mut s = MarkdownStyle::neutral(dark);
    let body = rune::tok::type_::BODY;
    if let Some(c) = col(v, "text") {
        s = s.text(c);
    }
    if let Some(c) = col(v, "muted") {
        s = s.muted(c);
    }
    if let Some(c) = col(v, "link") {
        s = s.link(c);
    }
    if let Some(c) = col(v, "linkUnderline") {
        s = s.link_underline(c);
    }
    if let Some(c) = col(v, "linkHover") {
        s = s.link_hover(c);
    }
    if let Some(c) = col(v, "inlineCodeBg") {
        s = s.inline_code_bg(c);
    }
    if let Some(c) = col(v, "inlineCodeText") {
        s = s.inline_code_text(c);
    }
    if let (Some(f), Some(b)) = (col(v, "codeBlockFill"), col(v, "codeBlockBorder")) {
        s = s.code_block(f, b);
    }
    if let Some(c) = col(v, "codeBlockText") {
        s = s.code_block_text(c);
    }
    if let Some([x, y]) = pair(v, "codeBlockPadding") {
        s = s.code_block_padding(x, y);
    }
    if let Some(r) = num(v, "codeBlockRadius") {
        s = s.code_block_radius(r);
    }
    if let Some([i, g]) = pair(v, "list") {
        s = s.list(i, g);
    }
    if let Some(c) = col(v, "quoteRule") {
        s = s.quote_rule(c);
    }
    if let Some(c) = col(v, "rule") {
        s = s.rule(c);
    }
    if let Some(f) = v.get("body") {
        s = s.body_font(font(f, body));
    }
    if let Some(hs) = v.get("headings").and_then(|h| h.as_array()) {
        for (i, h) in hs.iter().enumerate().take(4) {
            s = s.heading_font(i as u8 + 1, font(h, body));
        }
    }
    if let Some(f) = v.get("codeBlockFont") {
        s = s.code_block_font(font(f, body));
    }
    if let Some([sc, w]) = pair(v, "inlineCodeFont") {
        s = s.inline_code_font(sc, w);
    }
    if let Some(w) = num(v, "strongWeight") {
        s = s.strong_weight(w);
    }
    if let Some([t, b]) = pair(v, "paragraphMargin") {
        s = s.paragraph_margin(t, b);
    }
    if let Some(hs) = v.get("headingMargins").and_then(|h| h.as_array()) {
        for (i, h) in hs.iter().enumerate().take(4) {
            if let Some(a) = h.as_array()
                && let (Some(t), Some(b)) = (a.first().and_then(|x| x.as_f64()), a.get(1).and_then(|x| x.as_f64()))
            {
                s = s.heading_margin(i as u8 + 1, t as f32, b as f32);
            }
        }
    }
    if let Some([t, b]) = pair(v, "codeMargin") {
        s = s.code_margin(t, b);
    }
    if let Some(c) = col(v, "selection") {
        s = s.selection(c);
    }
    if let Some(w) = num(v, "textWidth") {
        s = s.text_width(w);
    }
    s
}

fn style_for(v: Option<&Value>) -> MarkdownStyle {
    let v = v.cloned().unwrap_or(Value::Null);
    let h = {
        use std::hash::{Hash, Hasher};
        let mut s = std::collections::hash_map::DefaultHasher::new();
        v.to_string().hash(&mut s);
        s.finish()
    };
    STYLES.with(|m| {
        let mut m = m.borrow_mut();
        if m.len() > 64 {
            m.clear();
        }
        m.entry(h).or_insert_with(|| style(&v)).clone()
    })
}

pub fn build(_n: u32, p: &Props) -> El {
    let src = p.src.clone().unwrap_or_default();
    Markdown::new(src).streaming(p.streaming).selectable(p.selectable || p.selection_group).render(&style_for(p.md_style.as_ref()))
}
