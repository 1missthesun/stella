//! `<markdown>`: rune-kit's native Markdown (streaming, selection, syntax highlighting, tables,
//! mermaid), styled from a JSON object whose keys name `MarkdownStyle` builders.

use std::cell::RefCell;
use std::collections::HashMap;

use rune::El;
use rune::tok::TextStyle;
use rune_kit::syntax::Syntax;
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

type Set<T> = fn(MarkdownStyle, T) -> MarkdownStyle;
type SetPair = fn(MarkdownStyle, f32, f32) -> MarkdownStyle;

fn levels<'a>(v: &'a Value, k: &str) -> Vec<(u8, &'a Value)> {
    match v.get(k) {
        Some(Value::Array(a)) => a.iter().enumerate().map(|(i, x)| (i as u8 + 1, x)).collect(),
        Some(Value::Object(o)) => o.iter().filter_map(|(l, x)| Some((l.parse().ok()?, x))).collect(),
        _ => Vec::new(),
    }
}

fn syntax_kind(name: &str) -> Option<Syntax> {
    Some(match name {
        "keyword" => Syntax::Keyword,
        "string" => Syntax::String,
        "number" => Syntax::Number,
        "comment" => Syntax::Comment,
        "type" => Syntax::Type,
        "function" => Syntax::Function,
        "property" => Syntax::Property,
        "punctuation" => Syntax::Punctuation,
        "operator" => Syntax::Operator,
        "inserted" => Syntax::Inserted,
        "deleted" => Syntax::Deleted,
        _ => return None,
    })
}

fn style(v: &Value) -> MarkdownStyle {
    let dark = v.get("dark").and_then(|d| d.as_bool()).unwrap_or(true);
    let mut s = MarkdownStyle::neutral(dark);
    let body = rune::tok::type_::BODY;
    let colors: [(&str, Set<rune::Color>); 12] = [
        ("text", MarkdownStyle::text),
        ("muted", MarkdownStyle::muted),
        ("link", MarkdownStyle::link),
        ("linkUnderline", MarkdownStyle::link_underline),
        ("linkHover", MarkdownStyle::link_hover),
        ("inlineCodeBg", MarkdownStyle::inline_code_bg),
        ("inlineCodeText", MarkdownStyle::inline_code_text),
        ("codeBlockText", MarkdownStyle::code_block_text),
        ("quoteRule", MarkdownStyle::quote_rule),
        ("rule", MarkdownStyle::rule),
        ("selection", MarkdownStyle::selection),
        ("tableRules", MarkdownStyle::table_rules),
    ];
    for (k, f) in colors {
        if let Some(c) = col(v, k) {
            s = f(s, c);
        }
    }
    for (k, f) in [("tableHeaderRule", MarkdownStyle::table_header_rule as Set<rune::Color>), ("tableHeaderText", MarkdownStyle::table_header_text)] {
        if let Some(c) = col(v, k) {
            s = f(s, c);
        }
    }
    let pairs: [(&str, SetPair); 12] = [
        ("codeBlockPadding", MarkdownStyle::code_block_padding),
        ("list", MarkdownStyle::list),
        ("listNestedIndent", MarkdownStyle::list_nested_indent),
        ("inlineCodeFont", MarkdownStyle::inline_code_font),
        ("paragraphMargin", MarkdownStyle::paragraph_margin),
        ("codeMargin", MarkdownStyle::code_margin),
        ("imageMargin", MarkdownStyle::image_margin),
        ("listMargin", MarkdownStyle::list_margin),
        ("quoteMargin", MarkdownStyle::quote_margin),
        ("ruleMargin", MarkdownStyle::rule_margin),
        ("tableMargin", MarkdownStyle::table_margin),
        ("tableCellPadding", MarkdownStyle::table_cell_padding),
    ];
    for (k, f) in pairs {
        if let Some([a, b]) = pair(v, k) {
            s = f(s, a, b);
        }
    }
    if let Some([x, y]) = pair(v, "tableHeaderPad") {
        s = s.table_header_pad(x, y);
    }
    let nums: [(&str, Set<f32>); 5] = [
        ("codeBlockRadius", MarkdownStyle::code_block_radius),
        ("inlineCodePad", MarkdownStyle::inline_code_pad),
        ("strongWeight", MarkdownStyle::strong_weight),
        ("textWidth", MarkdownStyle::text_width),
        ("tableHeaderWeight", MarkdownStyle::table_header_weight),
    ];
    for (k, f) in nums {
        if let Some(x) = num(v, k) {
            s = f(s, x);
        }
    }
    for (k, f) in [("listMarkersOutside", MarkdownStyle::list_markers_outside as Set<bool>), ("tableFlushLeft", MarkdownStyle::table_flush_left)] {
        if let Some(on) = v.get(k).and_then(|b| b.as_bool()) {
            s = f(s, on);
        }
    }
    let code_block = v.get("codeBlock").and_then(|a| a.as_array()).map(|a| (a.first().and_then(|c| c.as_str()).and_then(parse_color), a.get(1).and_then(|c| c.as_str()).and_then(parse_color)));
    if let Some((Some(f), Some(b))) = code_block.or(Some((col(v, "codeBlockFill"), col(v, "codeBlockBorder")))) {
        s = s.code_block(f, b);
    }
    if let Some(q) = v.get("quote").and_then(|a| a.as_array())
        && let (Some(rule), Some(w), Some(pad), Some(text)) = (
            q.first().and_then(|c| c.as_str()).and_then(parse_color),
            q.get(1).and_then(|x| x.as_f64()),
            q.get(2).and_then(|x| x.as_f64()),
            q.get(3).and_then(|c| c.as_str()).and_then(parse_color),
        )
    {
        s = s.quote(rule, w as f32, pad as f32, text);
    }
    if let Some(t) = v.get("table").and_then(|a| a.as_array())
        && let (Some(border), Some(head)) = (t.first().and_then(|c| c.as_str()).and_then(parse_color), t.get(1).and_then(|c| c.as_str()).and_then(parse_color))
    {
        s = s.table(border, head);
    }
    if let Some(o) = v.get("tableOutline") {
        s = s.table_outline(o.as_str().and_then(parse_color));
    }
    if let Some(f) = v.get("body").or_else(|| v.get("bodyFont")) {
        s = s.body_font(font(f, body));
    }
    for key in ["headings", "headingFont"] {
        for (level, h) in levels(v, key) {
            s = s.heading_font(level, font(h, body));
        }
    }
    for key in ["headingMargins", "headingMargin"] {
        for (level, h) in levels(v, key) {
            if let Some(a) = h.as_array()
                && let (Some(t), Some(b)) = (a.first().and_then(|x| x.as_f64()), a.get(1).and_then(|x| x.as_f64()))
            {
                s = s.heading_margin(level, t as f32, b as f32);
            }
        }
    }
    if let Some(f) = v.get("codeBlockFont") {
        s = s.code_block_font(font(f, body));
    }
    if let Some(f) = v.get("tableFont") {
        s = s.table_font(font(f, body));
    }
    if let Some(on) = v.get("tableFullWidth").and_then(|b| b.as_bool()) {
        s = s.table_full_width(on);
    }
    if let Some(Value::Object(m)) = v.get("syntax").or_else(|| v.get("syntaxTheme")) {
        for (k, c) in m {
            if let (Some(kind), Some(c)) = (syntax_kind(k), c.as_str().and_then(parse_color)) {
                s = s.syntax(kind, c);
            }
        }
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

#[derive(serde::Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct CodeFrameP {
    label: Option<crate::props::C>,
    label_size: Option<f32>,
    label_gap: Option<f32>,
    actions: Vec<ActionP>,
    action_color: Option<crate::props::C>,
    action_hover: Option<crate::props::C>,
    actions_on_hover: Option<bool>,
}

#[derive(serde::Deserialize, Default)]
#[serde(default)]
struct ActionP {
    id: String,
    label: Option<String>,
    svg: Option<String>,
    view: Option<f32>,
}

fn label(t: &str, size: f32, color: rune::Color) -> El {
    crate::text::build(&Props { content: Some(t.to_owned()), size: Some(size), color: Some(crate::props::C(color)), ..Default::default() })
}

/// `mdStyle.codeFrame`: a language label row above each code block and actions at its top
/// right (shown on hover unless `actionsOnHover: false`); pressing one fires `codeAction`.
fn code_frame(n: u32, md: Markdown, v: &Value) -> Markdown {
    let Ok(f) = serde_json::from_value::<CodeFrameP>(v.clone()) else { return md };
    md.code_frame(move |card, c| {
        let weak = f.label.map(|c| c.0).unwrap_or(parse_color("#8a8a8e").unwrap_or(rune::Color::TRANSPARENT));
        let size = f.label_size.unwrap_or(12.0);
        let mut head = rune::row().w_full().items_center().justify_between().h(22.0);
        head = head.child(label(c.language.unwrap_or(""), size, weak));
        let mut actions = rune::row().gap(2.0).items_center();
        for a in &f.actions {
            let color = f.action_color.map(|c| c.0).unwrap_or(weak);
            let mut b = rune::el().key(a.id.clone()).h(22.0).px(4.0).radius(6.0).center().cursor(rune::Cursor::Pointer).role("button");
            if let Some(h) = f.action_hover {
                b = b.hover(h.0);
            }
            b = match (&a.svg, &a.label) {
                (Some(svg), _) => {
                    let ip = Props { svg: Some(svg.clone()), view: a.view, size: Some(14.0), color: Some(crate::props::C(color)), ..Default::default() };
                    b.child(crate::media::icon(&ip)).label(a.label.clone().unwrap_or_else(|| a.id.clone()))
                }
                (None, Some(l)) => b.child(label(l, size, color)),
                (None, None) => b.child(label(&a.id, size, color)),
            };
            let (id, index, language, source) = (a.id.clone(), c.index, c.language.map(str::to_owned), c.source.to_owned());
            b = b.on_press_tx(move |_s: &mut crate::windows::Win, tx: &mut rune::Tx| {
                crate::engine::element_event(n, "codeAction", serde_json::json!({ "action": id, "index": index, "language": language, "source": source }), Some(tx));
            });
            actions = actions.child(b);
        }
        if f.actions_on_hover.unwrap_or(true) {
            actions = actions.group_opacity(0.0, 1.0);
        }
        head = head.child(actions);
        rune::col().key(format!("code-{}", c.index)).w_full().gap(f.label_gap.unwrap_or(4.0)).hover_group().child(head).child(card)
    })
}

pub fn build(n: u32, p: &Props) -> El {
    let src = p.src.clone().unwrap_or_default();
    let mut md = Markdown::new(src).streaming(p.streaming).selectable(p.selectable || p.selection_group);
    if let Some(f) = p.md_style.as_ref().and_then(|v| v.get("codeFrame")) {
        md = code_frame(n, md, f);
    }
    if p.listens("link") {
        md = md.on_link_tx(move |_s: &mut crate::windows::Win, href: &str, tx: &mut rune::Tx| {
            crate::engine::element_event(n, "link", serde_json::json!({ "href": href }), Some(tx));
        });
    }
    md.render(&style_for(p.md_style.as_ref()))
}
