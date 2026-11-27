//! Element props as sent by the TS host (JSON, parsed on the bridge thread). Every field maps onto
//! a Rune builder in `style.rs`, `text.rs` or `view.rs`; `host/ELEMENTS.md` documents them.

use rune::Color;
use serde::Deserialize;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Kind {
    #[default]
    Col,
    Row,
    Box,
    Text,
    Input,
    Window,
    Image,
    Icon,
    Webview,
    List,
    Markdown,
    Video,
    Audio,
    Vector,
    Surface,
}

impl Kind {
    pub fn parse(s: &str) -> Kind {
        match s {
            "row" => Kind::Row,
            "box" => Kind::Box,
            "text" => Kind::Text,
            "input" => Kind::Input,
            "window" => Kind::Window,
            "image" => Kind::Image,
            "icon" => Kind::Icon,
            "webview" => Kind::Webview,
            "list" => Kind::List,
            "markdown" => Kind::Markdown,
            "video" => Kind::Video,
            "audio" => Kind::Audio,
            "vector" => Kind::Vector,
            "surface" => Kind::Surface,
            _ => Kind::Col,
        }
    }
}

/// A colour from `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()/rgba()` or `transparent`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct C(pub Color);

impl<'de> Deserialize<'de> for C {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        Ok(C(parse_color(&s).unwrap_or(Color::TRANSPARENT)))
    }
}

pub fn parse_color(s: &str) -> Option<Color> {
    let s = s.trim();
    if s.eq_ignore_ascii_case("transparent") {
        return Some(Color::TRANSPARENT);
    }
    if let Some(h) = s.strip_prefix('#')
        && h.len() <= 4
    {
        let long: String = h.chars().flat_map(|c| [c, c]).collect();
        return rune::color::hex(&format!("#{long}"));
    }
    if s.starts_with('#') {
        return rune::color::hex(s);
    }
    let inner = s.strip_prefix("rgba(").or_else(|| s.strip_prefix("rgb("))?.strip_suffix(')')?;
    let parts: Vec<f32> = inner.split([',', ' ', '/']).filter(|p| !p.is_empty()).filter_map(|p| p.trim().parse().ok()).collect();
    if parts.len() < 3 {
        return None;
    }
    let a = parts.get(3).copied().unwrap_or(1.0);
    let byte = |v: f32| v.clamp(0.0, 255.0).round() as u8;
    rune::color::hex(&format!("#{:02x}{:02x}{:02x}{:02x}", byte(parts[0]), byte(parts[1]), byte(parts[2]), byte(a * 255.0)))
}

#[derive(Clone, Debug, Deserialize)]
#[serde(untagged)]
pub enum Size {
    Pt(f32),
    Str(String),
}

/// One inline run of a `<text>`.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct Run {
    pub t: String,
    pub w: Option<f32>,
    pub c: Option<C>,
    #[serde(default)]
    pub m: bool,
    pub bg: Option<C>,
    #[serde(default)]
    pub i: bool,
    pub u: Option<C>,
    pub s: Option<f32>,
    #[serde(default)]
    pub st: bool,
    pub href: Option<String>,
    #[serde(rename = "box")]
    pub bx: Option<RunBox>,
}

/// A run's `bg` drawn as a CSS inline background: the font's content area, widened by `pad`,
/// with `margin` of room outside it, both taking room in the line.
#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(default)]
pub struct RunBox {
    pub pad: f32,
    pub margin: f32,
    pub radius: f32,
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(default)]
pub struct Insets {
    pub left: Option<f32>,
    pub top: Option<f32>,
    pub right: Option<f32>,
    pub bottom: Option<f32>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
pub struct ShadowP {
    #[serde(default)]
    pub x: f32,
    #[serde(default)]
    pub y: f32,
    #[serde(default)]
    pub blur: f32,
    #[serde(default)]
    pub spread: f32,
    pub color: C,
    #[serde(default)]
    pub inset: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub struct GradientP {
    /// Degrees, CSS convention (0 = to top, 90 = to right, 180 = to bottom).
    #[serde(default = "deg180")]
    pub angle: f32,
    pub stops: Vec<(f32, C)>,
}
fn deg180() -> f32 {
    180.0
}

#[derive(Clone, Debug, Deserialize)]
pub struct RadialP {
    #[serde(default = "half")]
    pub center: [f32; 2],
    pub radius: RadiusP,
    pub stops: Vec<(f32, C)>,
}
fn half() -> [f32; 2] {
    [0.5, 0.5]
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(untagged)]
pub enum RadiusP {
    Circle(f32),
    Ellipse([f32; 2]),
}

#[derive(Clone, Debug, Deserialize)]
pub struct AnchorP {
    pub to: String,
    #[serde(default)]
    pub side: Option<String>,
    #[serde(default)]
    pub align: Option<String>,
    #[serde(default)]
    pub gap: f32,
    #[serde(default)]
    pub fit: bool,
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ModalP {
    pub click_outside: bool,
    /// Background wheel dismisses the modal (menus).
    pub wheel_outside: bool,
    /// `false`: closing leaves nothing focused instead of returning focus to what had it.
    pub return_focus: Option<bool>,
    /// Native pages under it stay live and take their own presses, as under a non-modal Radix
    /// popover, instead of showing their snapshot.
    pub live_pages: bool,
}

#[derive(Clone, Copy, Debug, Deserialize)]
pub struct MotionP {
    #[serde(default = "dur_default")]
    pub dur: f32,
    #[serde(default)]
    pub bounce: f32,
}
fn dur_default() -> f32 {
    0.3
}

/// A presence effect: a named preset or explicit values (`opacity`, `scale`, `x`, `y`, `blur`).
#[derive(Clone, Debug, Deserialize)]
#[serde(untagged)]
pub enum PresenceP {
    Preset(String),
    Effect(EffectP),
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(default)]
pub struct EffectP {
    pub opacity: Option<f32>,
    pub scale: Option<f32>,
    pub x: Option<f32>,
    pub y: Option<f32>,
    pub blur: Option<f32>,
    pub dur: Option<f32>,
    pub bounce: Option<f32>,
}

/// A slide end: an x offset, or `[x, y]`.
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(untagged)]
pub enum Offset {
    X(f32),
    Xy([f32; 2]),
}

impl Offset {
    pub fn xy(self) -> [f32; 2] {
        match self {
            Offset::X(x) => [x, 0.0],
            Offset::Xy(p) => p,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct LoopP {
    pub kind: String,
    #[serde(default = "one")]
    pub period: f32,
    #[serde(default)]
    pub low: Option<f32>,
    #[serde(default)]
    pub high: Option<f32>,
    #[serde(default)]
    pub from: Option<Offset>,
    #[serde(default)]
    pub to: Option<Offset>,
    #[serde(default)]
    pub times: Option<u32>,
    #[serde(default)]
    pub delay: Option<f32>,
    #[serde(default)]
    pub frames: Vec<FrameP>,
    #[serde(default)]
    pub origin: Option<[f32; 2]>,
    #[serde(default)]
    pub ease: Option<String>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct FrameP {
    pub at: f32,
    pub x: Option<f32>,
    pub y: Option<f32>,
    pub scale: Option<f32>,
    pub scale_x: Option<f32>,
    pub scale_y: Option<f32>,
    pub opacity: Option<f32>,
    pub rotate: Option<f32>,
}
fn one() -> f32 {
    1.0
}

#[derive(Clone, Copy, Debug, Deserialize)]
pub struct FocusRingP {
    #[serde(default = "two")]
    pub width: f32,
    #[serde(default)]
    pub offset: f32,
    pub color: C,
    #[serde(default)]
    pub radius: Option<f32>,
}
fn two() -> f32 {
    2.0
}

#[derive(Clone, Debug, Deserialize)]
#[serde(untagged)]
pub enum TruncateP {
    On(bool),
    Mode(String),
}

#[derive(Clone, Debug, Deserialize)]
#[serde(untagged)]
pub enum RaiseP {
    On(bool),
    Order(i16),
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct GrowthSpecP {
    pub dur: Option<f32>,
    pub bounce: Option<f32>,
    /// `feather` (default), `fastFeather`, `none`, `wordFade`.
    pub edge: Option<String>,
    pub clip: Option<bool>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(untagged)]
pub enum GrowthP {
    On(bool),
    Spec(GrowthSpecP),
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct FadeEdgeP {
    pub size: f32,
    pub stops: Option<Vec<[f32; 2]>>,
    pub linear: bool,
    pub feather: bool,
    pub full_at: Option<f32>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct ScrollFadeP {
    pub top: Option<FadeEdgeP>,
    pub bottom: Option<FadeEdgeP>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct VectorPathP {
    pub d: String,
    pub fill: Option<C>,
    pub stroke: Option<C>,
    pub stroke_width: Option<f32>,
    /// `round` (default) or `butt`.
    pub cap: Option<String>,
    pub opacity: Option<f32>,
    pub even_odd: bool,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct LinkPaintP {
    pub color: Option<C>,
    pub bg: Option<C>,
    pub underline: Option<C>,
    pub ring: Option<(C, f32)>,
}

/// A look for markdown links whose destination starts with `prefix`.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct LinkStyleP {
    pub prefix: String,
    pub color: Option<C>,
    pub weight: Option<f32>,
    pub bg: Option<C>,
    pub pad: Option<f32>,
    pub underline: Option<C>,
    pub ring: Option<(C, f32)>,
    pub hover: Option<LinkPaintP>,
    pub help: Option<String>,
}

/// A highlight over UTF-16 range `start..end` of an input's value.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct MarkP {
    pub start: usize,
    pub end: usize,
    pub bg: Option<C>,
    pub color: Option<C>,
    pub radius: Option<f32>,
    pub pad: Option<f32>,
    pub vpad: Option<f32>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PasteAsEventP {
    pub min_chars: Option<usize>,
    pub min_lines: Option<usize>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct DragOutP {
    pub paths: Vec<String>,
    pub text: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Props {
    /// Stable identity: Rune key, memo id, anchor and command target. Survives a React remount.
    pub id: Option<String>,
    /// Handler names this element listens to (`press`, `hover`, …); the reconciler fills it.
    pub on: Vec<String>,

    // Layout
    pub w: Option<Size>,
    pub h: Option<Size>,
    pub min_w: Option<Size>,
    pub max_w: Option<Size>,
    pub min_h: Option<Size>,
    pub max_h: Option<Size>,
    pub grow: Option<f32>,
    pub basis: Option<Size>,
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
    pub mx: Option<f32>,
    pub my: Option<f32>,
    pub gap: Option<f32>,
    pub row_gap: Option<f32>,
    pub align: Option<String>,
    pub justify: Option<String>,
    pub self_align: Option<String>,
    pub center: bool,
    pub wrap: bool,
    pub aspect: Option<f32>,
    pub columns: Option<usize>,
    pub column: Option<usize>,
    pub absolute: Option<Insets>,
    pub inset: Option<f32>,
    pub raise: Option<RaiseP>,
    /// position:fixed: placed against the window and painted in its top layer.
    pub fixed: bool,
    pub dir: Option<String>,

    // Paint
    pub fill: Option<C>,
    pub gradient: Option<GradientP>,
    pub radial: Option<RadialP>,
    pub border: Option<C>,
    pub border_width: Option<f32>,
    /// Per-side widths `[top, right, bottom, left]`.
    pub border_sides: Option<[f32; 4]>,
    pub border_dash: Option<f32>,
    pub radius: Option<f32>,
    /// Per-corner radii `[topLeft, topRight, bottomRight, bottomLeft]`.
    pub corners: Option<[f32; 4]>,
    pub clip: Option<f32>,
    /// Soft clip `[left, top, right, bottom]`: content fades out over each width to the edge.
    pub clip_fade: Option<[f32; 4]>,
    pub shadow: Option<(f32, f32, C)>,
    pub shadows: Option<Vec<ShadowP>>,
    pub opacity: Option<f32>,
    pub blur: Option<f32>,
    pub backdrop_blur: Option<f32>,
    /// Effect layers (`crate::fx`): Liquid Glass lenses and rune-fx fills, under or over the children.
    pub fx: Option<crate::fx::FxList>,
    /// Lights over the element's box (`crate::fx`), lighting what is painted inside it.
    pub light: Option<Box<crate::fx::LightSpec>>,
    /// How the element stands under an enclosing `light`.
    pub lit: Option<crate::fx::LitSpec>,

    // State styles
    pub hover: Option<C>,
    pub press: Option<C>,
    pub hover_fill: Option<C>,
    pub press_fill: Option<C>,
    pub hover_border: Option<C>,
    pub press_border: Option<C>,
    pub hover_color: Option<C>,
    pub hover_opacity: Option<(f32, f32)>,
    pub hover_group: bool,
    pub press_scale: Option<f32>,
    pub focus_ring: Option<FocusRingP>,
    pub focus_fill: Option<C>,
    pub focus_border: Option<C>,
    pub disabled: bool,

    // Transform and motion
    pub x: Option<f32>,
    pub y: Option<f32>,
    pub scale: Option<f32>,
    pub rotate: Option<f32>,
    pub origin: Option<[f32; 2]>,
    pub motion: Option<MotionP>,
    pub layout: Option<f32>,
    pub enter: Option<PresenceP>,
    pub exit: Option<PresenceP>,
    #[serde(rename = "loop")]
    pub loop_: Option<LoopP>,
    pub instant: bool,

    // Interaction
    pub cursor: Option<String>,
    pub inert: bool,
    pub focusable: bool,
    pub tab_index: Option<i32>,
    pub auto_focus: bool,
    pub focus_group: bool,
    pub keys: Vec<String>,
    pub keys_pass: Vec<String>,
    pub window_drag: bool,
    pub no_window_drag: bool,
    pub window_resize: Option<String>,
    pub title: Option<String>,
    pub title_side: Option<String>,
    pub drag_out: Option<DragOutP>,
    pub drop_exts: Option<Vec<String>>,

    // Scroll
    pub scroll_y: bool,
    pub scroll_x: bool,
    pub stick_bottom: bool,
    pub edge_fade: Option<f32>,
    pub scroll_fade: Option<ScrollFadeP>,
    pub no_scroll_anchor: bool,
    pub far_from_bottom: Option<f32>,
    pub sticky: Option<String>,
    pub sticky_inset: Option<f32>,

    // Accessibility
    pub role: Option<String>,
    pub label: Option<String>,
    pub checked: Option<bool>,
    pub expanded: Option<bool>,
    pub selected: Option<bool>,
    /// Laid out but not drawn, hit-tested or announced (visibility:hidden).
    pub hidden: bool,
    pub a11y_hidden: bool,

    // Overlays
    pub anchor: Option<AnchorP>,
    pub modal: Option<ModalP>,

    // Text
    pub content: Option<String>,
    pub spans: Option<Vec<Run>>,
    pub size: Option<f32>,
    pub weight: Option<f32>,
    pub line_height: Option<f32>,
    pub tracking: Option<f32>,
    pub color: Option<C>,
    pub mono: bool,
    pub family: Option<String>,
    /// CSS `font-feature-settings`, e.g. `"'ss01' 1, 'tnum' 1"`.
    pub features: Option<String>,
    pub italic: bool,
    pub underline: bool,
    pub strike: bool,
    pub selectable: bool,
    pub selection_group: bool,
    pub selection_color: Option<C>,
    pub max_lines: Option<usize>,
    pub truncate: Option<TruncateP>,
    pub nowrap: bool,
    pub balance: bool,
    pub text_align: Option<String>,
    pub text_case: Option<String>,

    // Input
    pub placeholder: Option<String>,
    pub placeholder_color: Option<C>,
    pub value: Option<String>,
    pub multiline: bool,
    pub secure: bool,
    pub spellcheck: Option<bool>,
    pub read_only: bool,
    pub select_on_focus: bool,
    pub caret_color: Option<C>,
    pub min_lines: Option<usize>,
    pub marks: Option<Vec<MarkP>>,
    pub paste_as_event: Option<PasteAsEventP>,

    // Image, icon, video
    pub src: Option<String>,
    pub fit: Option<String>,
    pub tint: Option<C>,
    pub svg: Option<String>,
    pub name: Option<String>,
    pub view: Option<f32>,
    pub view_box: Option<[f32; 2]>,
    pub paths: Option<Vec<VectorPathP>>,
    pub spin: Option<f32>,
    pub autoplay: bool,
    pub muted: bool,
    #[serde(rename = "loopMedia")]
    pub loop_media: bool,

    // List
    pub estimate: Option<f32>,
    pub overscan: Option<(f32, f32)>,
    pub growth: Option<GrowthP>,
    pub arrives_whole: bool,

    // Markdown
    pub streaming: bool,
    pub md_style: Option<serde_json::Value>,
    pub link_styles: Option<Vec<LinkStyleP>>,
    /// Markdown image sources as written → what to load (path, `file://`, `blob:N`).
    pub images: Option<std::collections::HashMap<String, String>>,
    pub image_radius: Option<f32>,

    // Webview
    pub url: Option<String>,
    pub html: Option<String>,
    pub transparent: bool,
    pub devtools: bool,
    pub user_agent: Option<String>,
    pub preload: Option<String>,
    /// Custom URL schemes this webview serves through TS (`request` events).
    pub protocols: Vec<String>,
    /// The page may capture the microphone without a prompt.
    pub microphone: bool,

    // Window
    pub kind: Option<String>,
    pub min_size: Option<[f32; 2]>,
    pub max_size: Option<[f32; 2]>,
    pub position: Option<[i32; 2]>,
    pub resizable: Option<bool>,
    pub frameless: bool,
    pub always_on_top: bool,
    pub click_through: bool,
    pub forward_mouse: bool,
    pub content_protection: bool,
    pub visible: Option<bool>,
    pub bg: Option<C>,
    pub titlebar: Option<f32>,
    pub traffic_lights: Option<[f32; 2]>,
    pub dark: Option<bool>,
    /// The window's page zoom (Electron's `setZoomFactor`), 1 unzoomed.
    pub zoom: Option<f32>,
    /// CSS `-webkit-font-smoothing` for the window's text on macOS, `antialiased` unset.
    pub font_smoothing: Option<String>,
}

impl Props {
    /// Built at the window root rather than in place: fixed layers and anchored overlays.
    pub fn lifted(&self) -> bool {
        self.fixed || self.anchor.is_some()
    }

    pub fn listens(&self, name: &str) -> bool {
        self.on.iter().any(|n| n == name)
    }
}
