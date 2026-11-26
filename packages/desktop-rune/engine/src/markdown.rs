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
    p.features = v.get("features").and_then(|f| f.as_str()).map(str::to_owned);
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
    let pairs: [(&str, SetPair); 13] = [
        ("codeBlockPadding", MarkdownStyle::code_block_padding),
        ("list", MarkdownStyle::list),
        ("listPadding", MarkdownStyle::list_padding),
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
    if let Some(a) = v.get("tableHeaderPadEdges").and_then(|a| a.as_array())
        && let [Some(x), Some(top), Some(bottom)] = [0, 1, 2].map(|i| a.get(i).and_then(Value::as_f64))
    {
        s = s.table_header_pad_edges(x as f32, top as f32, bottom as f32);
    }
    let nums: [(&str, Set<f32>); 8] = [
        ("codeBlockRadius", MarkdownStyle::code_block_radius),
        ("tableRadius", MarkdownStyle::table_radius),
        ("tableHeaderRuleWidth", MarkdownStyle::table_header_rule_width),
        ("wideFade", MarkdownStyle::wide_fade),
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
    for (k, f) in [
        ("listMarkersOutside", MarkdownStyle::list_markers_outside as Set<bool>),
        ("tableFlushLeft", MarkdownStyle::table_flush_left),
        ("tableEndRule", MarkdownStyle::table_end_rule),
        ("tableCellsFlushLeft", MarkdownStyle::table_cells_flush_left),
        ("tableFlushRight", MarkdownStyle::table_flush_right),
        ("syntaxHighlight", MarkdownStyle::syntax_highlight),
    ] {
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
    if let Some(n) = v.get("codeLineNumbers")
        && let Some(color) = col(n, "color")
    {
        let f = n.get("font").map(|f| font(f, body)).unwrap_or(body);
        s = s.code_line_numbers(f, color, num(n, "width").unwrap_or(24.0), num(n, "gap").unwrap_or(16.0));
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
    /// The label row's height (22 by default).
    label_height: Option<f32>,
    /// The label's inset from the row's start.
    label_inset: Option<f32>,
    label_family: Option<String>,
    label_gap: Option<f32>,
    actions: Vec<ActionP>,
    action_color: Option<crate::props::C>,
    action_hover: Option<crate::props::C>,
    actions_on_hover: Option<bool>,
    /// Draw the block's frame here, the label row inside it (streamdown's layout).
    inside: Option<InsideP>,
    /// `[top, right]`: the actions float at this inset from the frame's top right corner
    /// instead of sitting in the label row.
    actions_at: Option<[f32; 2]>,
    /// Painted behind the action row, which then takes `actionsPad` `[x, y]` and `actionsRadius`.
    actions_fill: Option<crate::props::C>,
    actions_pad: Option<[f32; 2]>,
    actions_radius: Option<f32>,
    gap: Option<f32>,
    /// Square buttons of the icon's size plus this on each side, instead of 22 high with 4 each side.
    button_pad: Option<f32>,
    /// One block's action shown with another icon, such as the check after a copy.
    swap: Option<SwapP>,
}

#[derive(serde::Deserialize, Default)]
#[serde(default)]
struct SwapP {
    index: usize,
    id: String,
    svg: String,
    view: Option<f32>,
}

#[derive(serde::Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct InsideP {
    fill: Option<crate::props::C>,
    border: Option<crate::props::C>,
    radius: Option<f32>,
    /// `[x, top, bottom]` around the label row and code.
    pad: Option<[f32; 3]>,
    /// Right padding when it differs from 6.
    pad_right: Option<f32>,
}

#[derive(serde::Deserialize, Default)]
#[serde(default)]
struct ActionP {
    id: String,
    label: Option<String>,
    svg: Option<String>,
    view: Option<f32>,
    size: Option<f32>,
}

#[derive(serde::Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct TableFrameP {
    actions: Vec<ActionP>,
    action_color: Option<crate::props::C>,
    action_hover: Option<crate::props::C>,
    actions_on_hover: Option<bool>,
    /// `[top, right]` from the table's top right corner.
    actions_at: Option<[f32; 2]>,
    /// Painted behind the action row so it covers the header text it floats over.
    actions_fill: Option<crate::props::C>,
    gap: Option<f32>,
    button_pad: Option<f32>,
}

fn label(t: &str, size: f32, color: rune::Color, family: Option<&str>) -> El {
    crate::text::build(&Props { content: Some(t.to_owned()), size: Some(size), color: Some(crate::props::C(color)), family: family.map(str::to_owned), ..Default::default() })
}

/// `mdStyle.codeFrame`: a language label row above each code block and actions at its top
/// right (shown on hover unless `actionsOnHover: false`); pressing one fires `codeAction`.
fn code_frame(n: u32, md: Markdown, v: &Value) -> Markdown {
    let Ok(f) = serde_json::from_value::<CodeFrameP>(v.clone()) else { return md };
    md.code_frame(move |card, c| {
        let weak = f.label.map(|c| c.0).unwrap_or(parse_color("#8a8a8e").unwrap_or(rune::Color::TRANSPARENT));
        let size = f.label_size.unwrap_or(12.0);
        let mut head = rune::row().w_full().items_center().justify_between().h(f.label_height.unwrap_or(22.0)).pl(f.label_inset.unwrap_or(0.0));
        head = head.child(label(c.language.unwrap_or(""), size, weak, f.label_family.as_deref()));
        let mut actions = rune::row().gap(f.gap.unwrap_or(2.0)).items_center();
        if let Some(c) = f.actions_fill {
            let [x, y] = f.actions_pad.unwrap_or([0.0, 0.0]);
            actions = actions.fill(c.0).px(x).py(y).radius(f.actions_radius.unwrap_or(0.0));
        }
        for a in &f.actions {
            let color = f.action_color.map(|c| c.0).unwrap_or(weak);
            let icon_size = a.size.unwrap_or(14.0);
            let mut b = rune::el().key(a.id.clone()).center().cursor(rune::Cursor::Pointer).role("button");
            b = match f.button_pad {
                Some(pad) => b.size(icon_size + 2.0 * pad, icon_size + 2.0 * pad).hover_group(),
                None => b.h(22.0).px(4.0).radius(6.0),
            };
            let swapped = f.swap.as_ref().filter(|s| s.index == c.index && s.id == a.id);
            b = match (&a.svg, &a.label) {
                (Some(svg), _) => {
                    let (svg, view) = swapped.map_or((svg, a.view), |s| (&s.svg, s.view.or(a.view)));
                    let ip = Props { svg: Some(svg.clone()), view, size: Some(icon_size), color: Some(crate::props::C(color)), ..Default::default() };
                    let mut icon = crate::media::icon(&ip);
                    if let (Some(h), Some(_)) = (f.action_hover, f.button_pad) {
                        icon = icon.group_color(h.0);
                    }
                    b.child(icon).label(a.label.clone().unwrap_or_else(|| a.id.clone()))
                }
                (None, Some(l)) => b.child(label(l, size, color, None)),
                (None, None) => b.child(label(&a.id, size, color, None)),
            };
            if let (Some(h), None) = (f.action_hover, f.button_pad) {
                b = b.hover(h.0);
            }
            let (id, index, language, source) = (a.id.clone(), c.index, c.language.map(str::to_owned), c.source.to_owned());
            b = b.on_press_tx(move |_s: &mut crate::windows::Win, tx: &mut rune::Tx| {
                crate::engine::element_event(n, "codeAction", serde_json::json!({ "action": id, "index": index, "language": language, "source": source }), Some(tx));
            });
            actions = actions.child(b);
        }
        if f.actions_on_hover.unwrap_or(true) {
            actions = actions.group_opacity(0.0, 1.0);
        }
        let floating = match f.actions_at {
            Some([top, right]) => Some(actions.pin(None, Some(top), Some(right), None).raise()),
            None => {
                head = head.child(actions);
                None
            }
        };
        let mut frame = rune::col().key(format!("code-{}", c.index)).w_full().gap(f.label_gap.unwrap_or(4.0)).hover_group();
        if let Some(i) = &f.inside {
            let [x, top, bottom] = i.pad.unwrap_or([12.0, 6.0, 0.0]);
            frame = frame.pl(x).pr(i.pad_right.unwrap_or(6.0)).pt(top).pb(bottom).radius(i.radius.unwrap_or(0.0));
            if let Some(c) = i.fill {
                frame = frame.fill(c.0);
            }
            if let Some(c) = i.border {
                frame = frame.border(1.0, c.0);
            }
        }
        let frame = frame.child(head).child(card);
        match floating {
            Some(a) => frame.child(a),
            None => frame,
        }
    })
}

/// `mdStyle.tableFrame`: actions floating at each table's top right (shown on hover unless
/// `actionsOnHover: false`); pressing one fires `tableAction` with the table's cells and the
/// button's window rect.
fn table_frame(n: u32, md: Markdown, v: &Value) -> Markdown {
    let Ok(f) = serde_json::from_value::<TableFrameP>(v.clone()) else { return md };
    md.table_frame_with(move |table, t| {
        let color = f.action_color.map(|c| c.0).unwrap_or(parse_color("#8a8a8e").unwrap_or(rune::Color::TRANSPARENT));
        let pad = f.button_pad.unwrap_or(4.0);
        let mut actions = rune::row().gap(f.gap.unwrap_or(4.0)).items_center().pl(6.0).radius(6.0);
        if let Some(c) = f.actions_fill {
            actions = actions.fill(c.0);
        }
        let cells: std::rc::Rc<Vec<Vec<String>>> = std::rc::Rc::new(t.cells().into_iter().map(|r| r.into_iter().map(str::to_owned).collect()).collect());
        let align: std::rc::Rc<Vec<&'static str>> = std::rc::Rc::new(t.align.iter().map(|a| match a {
            rune::Align::Center => "center",
            rune::Align::End => "end",
            _ => "start",
        }).collect());
        for a in &f.actions {
            let size = a.size.unwrap_or(14.0);
            let side = size + 2.0 * pad;
            let mut b = rune::el().key(a.id.clone()).size(side, side).center().cursor(rune::Cursor::Pointer).role("button").hover_group()
                .label(a.label.clone().unwrap_or_else(|| a.id.clone()));
            let mut icon = match &a.svg {
                Some(svg) => crate::media::icon(&Props { svg: Some(svg.clone()), view: a.view, size: Some(size), color: Some(crate::props::C(color)), ..Default::default() }),
                None => label(a.label.as_deref().unwrap_or(&a.id), 12.0, color, None),
            };
            if let Some(h) = f.action_hover {
                icon = icon.group_color(h.0);
            }
            b = b.child(icon);
            let (id, index, cells, align) = (a.id.clone(), t.index, cells.clone(), align.clone());
            b = b.on_press_tx(move |_s: &mut crate::windows::Win, tx: &mut rune::Tx| {
                let rect = tx.press_point().map(|p| serde_json::json!({ "x": p.window_x - p.x, "y": p.window_y - p.y, "w": side, "h": side }));
                crate::engine::element_event(n, "tableAction", serde_json::json!({ "action": id, "index": index, "rows": *cells, "align": *align, "rect": rect }), Some(tx));
            });
            actions = actions.child(b);
        }
        if f.actions_on_hover.unwrap_or(true) {
            actions = actions.group_opacity(0.0, 1.0);
        }
        let [top, right] = f.actions_at.unwrap_or([6.0, 0.0]);
        rune::col().key(format!("table-{}", t.index)).w_full().hover_group().child(table).child(actions.pin(None, Some(top), Some(right), None).raise())
    })
}

fn link_styles(md: Markdown, styles: Vec<crate::props::LinkStyleP>) -> Markdown {
    let styles = std::rc::Rc::new(styles);
    let find = |styles: &std::rc::Rc<Vec<crate::props::LinkStyleP>>, href: &str| styles.iter().position(|s| href.starts_with(&s.prefix));
    let (a, b, c) = (styles.clone(), styles.clone(), styles.clone());
    md.link_style(move |href| {
        let s = &a[find(&a, href)?];
        let mut span = rune::Span::new(0, 0);
        if let Some(c) = s.color {
            span = span.color(c.0);
        }
        if let Some(w) = s.weight {
            span = span.weight(w);
        }
        if let Some(c) = s.bg {
            span = span.bg(c.0, s.pad.unwrap_or(2.0));
        }
        if let Some(c) = s.underline {
            span = span.underline(c.0);
        }
        let mut hover = rune::LinkPaint::new();
        if let Some(h) = &s.hover {
            if let Some(c) = h.color {
                hover = hover.color(c.0);
            }
            if let Some(c) = h.bg {
                hover = hover.bg(c.0);
            }
            if let Some(c) = h.underline {
                hover = hover.underline(c.0);
            }
            if let Some((c, w)) = h.ring {
                hover = hover.ring(c.0, w);
            }
        }
        Some((span, hover))
    })
    .link_ring(move |href| b[find(&b, href)?].ring.map(|(c, w)| (c.0, w)))
    .link_help(move |href| c[find(&c, href)?].help.clone())
}

pub fn build(n: u32, p: &Props) -> El {
    let src = p.src.clone().unwrap_or_default();
    let mut md = Markdown::new(src).streaming(p.streaming).selectable(p.selectable || p.selection_group);
    if p.md_style.as_ref().and_then(|v| v.get("scrollWide")).and_then(Value::as_bool) == Some(true) {
        md = md.scroll_wide(true);
    }
    if let Some(f) = p.md_style.as_ref().and_then(|v| v.get("codeFrame")) {
        md = code_frame(n, md, f);
    }
    if let Some(f) = p.md_style.as_ref().and_then(|v| v.get("tableFrame")) {
        md = table_frame(n, md, f);
    }
    if p.listens("link") {
        md = md.on_link_tx(move |_s: &mut crate::windows::Win, href: &str, tx: &mut rune::Tx| {
            crate::engine::element_event(n, "link", serde_json::json!({ "href": href }), Some(tx));
        });
    }
    if p.listens("linkContextMenu") {
        md = md.on_link_secondary(move |_s: &mut crate::windows::Win, href: &str, at: rune::PointerPress, tx: &mut rune::Tx| {
            crate::engine::element_event(n, "linkContextMenu", serde_json::json!({ "href": href, "x": at.x, "y": at.y }), Some(tx));
        });
    }
    if let Some(styles) = p.link_styles.clone().filter(|s| !s.is_empty()) {
        md = link_styles(md, styles);
    }
    if let Some(images) = p.images.clone() {
        md = md.images(move |src| {
            let to = images.get(src).map(String::as_str).unwrap_or(src);
            let img = crate::engine::read(|e| crate::media::load(e, to, 1024.0))?;
            crate::media::rebuild_when_decoded(n, &img);
            Some(img)
        });
    }
    let radius = p.image_radius;
    let on_image = p.listens("image");
    if radius.is_some() || on_image {
        md = md.image_frame(move |el, frame| {
            let mut el = el;
            if let Some(r) = radius {
                el = el.radius(r);
            }
            if on_image {
                let (src, alt) = (frame.src.to_owned(), frame.alt.to_owned());
                el = el.cursor(rune::Cursor::Pointer).on_press_tx(move |_s: &mut crate::windows::Win, tx: &mut rune::Tx| {
                    crate::engine::element_event(n, "image", serde_json::json!({ "src": src, "alt": alt }), Some(tx));
                });
            }
            el
        });
    }
    md.render(&style_for(p.md_style.as_ref()))
}
