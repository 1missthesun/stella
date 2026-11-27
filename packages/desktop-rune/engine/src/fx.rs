//! The `fx`, `light` and `lit` props: rune-fx layers (Liquid Glass lenses and fills such as liquid
//! metal, fluted glass and metaballs) and rune-light lighting. Each becomes a Rune effect slot
//! inside its element, and a compositor every window carries paints them there. It engages only
//! while its window holds such an element, so every other window draws as Rune's default frame.
//!
//! Slots carry the element's node as their mark and `[index, role]` as their data; the compositor
//! reads the element's current props from the tree at each frame, so a prop change from TS (a hot
//! swap, a `ref.set`) reaches the GPU with no engine rebuild.

use std::cell::Cell;
use std::collections::HashMap;

use rune::{El, Spring};
use rune::compose::{Compositor, DeviceKey, Frame};
use rune::render::{EffectPhase, EffectSite, Instance, KIND_EFFECT};
use rune_fx::{Fx, FxBlend, FxFrame, FxLayer, FxOptions, FxRenderer, FxSlot, GlassUnion, LensParams, ParamKind, Rgb, Shape, Stops, Value};
use rune_light::{Light, LightRenderer, Prim, Scene, Settings};
use serde::Deserialize;
use serde_json::Value as J;

use crate::props::{C, Props};
use crate::windows::Win;

const LAYER: f32 = 1.0;
const LIGHT: f32 = 2.0;
const OCCLUDER: f32 = 3.0;

/// How far a lens's shadow and rim may paint past its shape, in points.
const GLASS_BLEED: f32 = 24.0;

#[derive(Clone, Debug)]
pub enum Effect {
    /// A Liquid Glass lens over what is painted behind the element; `merge` is a second shape
    /// `[x, y, w, h, radius]` in the element's points that the glass flows into.
    Glass { lens: LensParams, merge: Option<[f32; 5]>, group: Option<String>, morph: Option<MorphSpec> },
    Fill(rune_fx::FillParams),
}

/// `morphFrom`: the glass grows out of another element's shape when it mounts and goes back
/// into it as it leaves, on `spring`. `from` is that element's `id` (`None`: the `anchor`'s).
#[derive(Clone, Debug)]
pub struct MorphSpec {
    pub from: Option<String>,
    pub spring: Spring,
}

/// Opens in about 0.2 s, with no visible overshoot.
const MORPH_SPRING: Spring = Spring::new(0.18, 0.06);

/// The spring a morph goes back on: quicker than it opened, and critically damped.
fn close_spring(open: Spring) -> Spring {
    Spring::new((open.duration * 0.7).max(0.01), 0.0)
}

/// How far through a morph its glass is drawn: none at the source's shape, so the source
/// (glass, icon and label) shows as itself at both ends, and all of it from `MORPH_SHOWN`.
const MORPH_HIDDEN: f32 = 0.04;
const MORPH_SHOWN: f32 = 0.55;

fn morph_alpha(at: f32) -> f32 {
    let t = ((at - MORPH_HIDDEN) / (MORPH_SHOWN - MORPH_HIDDEN)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

#[derive(Clone, Debug)]
pub struct FxSpec {
    pub effect: Effect,
    pub over: bool,
    pub inset: f32,
    pub opacity: f32,
    pub seed: u32,
    pub blend: FxBlend,
}

impl FxSpec {
    fn backdrop(&self) -> bool {
        match &self.effect {
            Effect::Glass { .. } => true,
            Effect::Fill(f) => f.needs_backdrop() || self.blend.needs_backdrop(),
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct FxList(pub Vec<FxSpec>);

impl<'de> Deserialize<'de> for FxList {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let v = J::deserialize(d)?;
        let items: Vec<&J> = match &v {
            J::Array(a) => a.iter().collect(),
            J::Null | J::Bool(false) => Vec::new(),
            one => vec![one],
        };
        let mut out = Vec::new();
        for item in items {
            match spec(item) {
                Ok(s) => out.push(s),
                Err(e) => eprintln!("stella-engine: fx: {e}"),
            }
        }
        Ok(FxList(out))
    }
}

fn snake(k: &str) -> String {
    let mut s = String::with_capacity(k.len() + 4);
    for c in k.chars() {
        if c.is_ascii_uppercase() {
            s.push('_');
            s.push(c.to_ascii_lowercase());
        } else {
            s.push(c);
        }
    }
    s
}

fn num(o: &serde_json::Map<String, J>, k: &str) -> Option<f32> {
    o.get(k).and_then(J::as_f64).map(|v| v as f32).filter(|v| v.is_finite())
}

fn rgb(v: &J) -> Option<Rgb> {
    let c = crate::props::parse_color(v.as_str()?)?;
    Some(Rgb([c.r, c.g, c.b]))
}

fn spec(v: &J) -> Result<FxSpec, String> {
    let o = v.as_object().ok_or("a layer is an object")?;
    let effect = if let Some(g) = o.get("glass") {
        glass(g)?
    } else if let Some(name) = o.get("fill").and_then(J::as_str) {
        Effect::Fill(fill(name, o)?)
    } else {
        return Err("a layer needs `glass` or `fill`".into());
    };
    let blend = match o.get("blend").and_then(J::as_str) {
        None | Some("normal") => FxBlend::Normal,
        Some("multiply") => FxBlend::Multiply,
        Some("screen") => FxBlend::Screen,
        Some("overlay") => FxBlend::Overlay,
        Some("softLight") => FxBlend::SoftLight,
        Some(b) => return Err(format!("unknown blend `{b}`")),
    };
    Ok(FxSpec {
        effect,
        over: o.get("place").and_then(J::as_str) == Some("over"),
        inset: num(o, "inset").unwrap_or(0.0),
        opacity: num(o, "opacity").unwrap_or(1.0).clamp(0.0, 1.0),
        seed: o.get("seed").and_then(J::as_u64).unwrap_or(1) as u32,
        blend,
    })
}

fn glass(v: &J) -> Result<Effect, String> {
    let mut lens = LensParams::default();
    let mut merge = None;
    let mut group = None;
    let mut morph: Option<MorphSpec> = None;
    let Some(o) = v.as_object() else {
        return match v {
            J::Bool(true) => Ok(Effect::Glass { lens, merge, group, morph }),
            _ => Err("`glass` is true or an object".into()),
        };
    };
    for (k, val) in o {
        let n = val.as_f64().map(|x| x as f32).filter(|x| x.is_finite());
        match (k.as_str(), n) {
            ("bevel", Some(x)) => lens.bevel = x,
            ("depth", Some(x)) => lens.depth = x,
            ("dispersion", Some(x)) => lens.dispersion = x,
            ("magnification", Some(x)) => lens.magnification = x,
            ("presence", Some(x)) => lens.presence = x,
            ("frost", Some(x)) => lens.frost = x,
            ("frostSigma", Some(x)) => lens.frost_sigma = x,
            ("shadow", Some(x)) => lens.shadow = x,
            ("rim", Some(x)) => lens.rim = x,
            ("lightAngle", Some(x)) => lens.light_angle = x,
            ("tintAmount", Some(x)) => lens.tint_amount = x,
            ("veil", Some(x)) => lens.veil = x,
            ("adapt", Some(x)) => lens.adapt = x,
            ("saturation", Some(x)) => lens.saturation = x,
            ("perceptual", _) => lens.perceptual = val.as_bool().ok_or("glass `perceptual` is true or false")?,
            ("unionK" | "spacing", Some(x)) => lens.union_k = x,
            ("group", _) => group = Some(val.as_str().ok_or("glass `group` is a string")?.to_owned()),
            ("morphFrom", _) => {
                let from = match val {
                    J::String(k) => Some(k.clone()),
                    J::Bool(true) => None,
                    _ => return Err("glass `morphFrom` is an element id or true (the anchor)".into()),
                };
                morph = Some(MorphSpec { from, spring: morph.map_or(MORPH_SPRING, |m| m.spring) });
            }
            ("morphMotion", _) => {
                let m = val.as_object().ok_or("glass `morphMotion` is {dur, bounce}")?;
                let spring = crate::style::spring(num(m, "dur").unwrap_or(MORPH_SPRING.duration), num(m, "bounce").unwrap_or(MORPH_SPRING.bounce));
                morph = Some(MorphSpec { spring, from: morph.and_then(|m| m.from) });
            }
            ("morph", Some(x)) => lens.morph = x,
            ("tint", _) => lens.tint = rgb(val).ok_or("glass `tint` is a colour")?,
            ("merge", _) => {
                let m = val.as_object().ok_or("glass `merge` is {x, y, w, h, radius}")?;
                let (x, y, w, h) = (num(m, "x").unwrap_or(0.0), num(m, "y").unwrap_or(0.0), num(m, "w").unwrap_or(0.0), num(m, "h").unwrap_or(0.0));
                merge = Some([x, y, w, h, num(m, "radius").unwrap_or(w.min(h) * 0.5)]);
            }
            (k, _) => return Err(format!("glass has no `{k}`")),
        }
    }
    if morph.is_some() && !o.contains_key("morphFrom") {
        return Err("glass `morphMotion` needs `morphFrom`".into());
    }
    Ok(Effect::Glass { lens, merge, group, morph })
}

const RESERVED: &[&str] = &["fill", "preset", "place", "inset", "opacity", "seed", "blend"];

fn fill(name: &str, o: &serde_json::Map<String, J>) -> Result<rune_fx::FillParams, String> {
    let id = snake(name);
    let style = rune_fx::fill_style(&id).ok_or_else(|| format!("unknown fill `{name}`"))?;
    let mut f = match o.get("preset").and_then(J::as_str) {
        Some(p) => style.preset(&snake(p)).ok_or_else(|| format!("{name} has no preset `{p}`"))?.fill(),
        None => style.default_fill(),
    };
    for (k, v) in o {
        if RESERVED.contains(&k.as_str()) {
            continue;
        }
        let pid = snake(k);
        let param = style.params.iter().chain(rune_fx::FillParams::COMMON).find(|p| p.id == pid).ok_or_else(|| format!("{name} has no `{k}`"))?;
        let value = value(param.kind, v).ok_or_else(|| format!("{name} `{k}`: wrong kind of value"))?;
        if !f.set(&pid, value) {
            return Err(format!("{name} `{k}`: not accepted"));
        }
    }
    Ok(f)
}

fn point(v: &J) -> Option<[f32; 2]> {
    let a = v.as_array()?;
    Some([a.first()?.as_f64()? as f32, a.get(1)?.as_f64()? as f32])
}

fn value(kind: ParamKind, v: &J) -> Option<Value> {
    Some(match kind {
        ParamKind::Number { .. } => Value::Number(v.as_f64()? as f32),
        ParamKind::Count { .. } => Value::Count(v.as_f64()?.round().max(0.0) as u32),
        ParamKind::Toggle => Value::Toggle(v.as_bool()?),
        ParamKind::Choice(choices) => match v {
            J::Number(n) => Value::Choice(n.as_u64()? as usize),
            J::String(s) => Value::Choice(choices.iter().position(|c| c.id == snake(s))?),
            _ => return None,
        },
        ParamKind::Color => Value::Color(rgb(v)?),
        ParamKind::Colors { .. } => {
            let list: Option<Vec<Rgb>> = v.as_array()?.iter().map(rgb).collect();
            Value::Colors(Stops::new(&list?))
        }
        ParamKind::Point => Value::Point(point(v)?),
        ParamKind::Points { .. } => {
            let mut out = [[0.5f32; 2]; rune_fx::MAX_STOPS];
            for (slot, p) in out.iter_mut().zip(v.as_array()?) {
                *slot = point(p)?;
            }
            Value::Points(out)
        }
    })
}

/// `light`: lights over the element's box, in its own points.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct LightSpec {
    pub lights: Vec<LightP>,
    pub ambient: Option<AmbientP>,
    pub exposure: Option<f32>,
    pub contact_ao: Option<f32>,
    pub rim: Option<f32>,
    pub background_gloss: Option<f32>,
    pub background_roughness: Option<f32>,
    pub albedo_floor: Option<f32>,
    pub shafts_over: Option<f32>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(untagged)]
pub enum AmbientP {
    Grey(f32),
    Rgb([f32; 3]),
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct LightP {
    pub x: f32,
    pub y: f32,
    /// Height above the UI, points.
    pub z: Option<f32>,
    pub color: Option<C>,
    pub intensity: Option<f32>,
    pub radius: Option<f32>,
    pub range: Option<f32>,
    pub bulb: Option<f32>,
    pub specular: Option<f32>,
    pub softness: Option<f32>,
    pub shafts: Option<f32>,
    pub spot: Option<SpotP>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct SpotP {
    pub axis: [f32; 3],
    pub angle: f32,
}

/// `lit`: how an element inside a `light` stands on the UI plane, in points.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct LitSpec {
    pub raised: Option<f32>,
    pub floating: Option<[f32; 2]>,
    pub bevel: Option<[f32; 2]>,
    pub gloss: Option<[f32; 2]>,
    pub emissive: Option<C>,
    pub unlit: bool,
}

pub fn has_fx(p: &Props) -> bool {
    p.fx.as_ref().is_some_and(|f| !f.0.is_empty()) || p.light.is_some() || p.lit.is_some()
}

fn slot(id: u32, index: usize, role: f32, inset: f32, p: &Props) -> El {
    let mut e = rune::effect(id).effect_data([index as f32, role, 0.0, 0.0]).pin(Some(inset), Some(inset), Some(inset), Some(inset)).key(format!("fx{id}.{role}.{index}"));
    if let Some(c) = p.corners {
        e = e.corners(c.map(|r| (r - inset).max(0.0)));
    } else if let Some(r) = p.radius {
        e = e.radius((r - inset).max(0.0));
    }
    e
}

/// A `morphFrom` element's border and shadows, drawn by a child that fades in with its content
/// once the glass has grown, and goes at once when it's removed (see `view::build_node`).
fn morph_chrome(id: u32, p: &Props) -> El {
    let chrome = Props { border: p.border, border_width: p.border_width, border_sides: p.border_sides, border_dash: p.border_dash, radius: p.radius, corners: p.corners, shadow: p.shadow, shadows: p.shadows.clone(), ..Props::default() };
    crate::style::paint(rune::el(), &chrome).pin(Some(0.0), Some(0.0), Some(0.0), Some(0.0)).key(format!("fx{id}.chrome"))
}

/// Without its border and shadows, which a `morphFrom` element's chrome child draws.
pub fn without_chrome(p: &Props) -> Props {
    Props { border: None, border_sides: None, border_dash: None, shadow: None, shadows: None, ..p.clone() }
}

/// The slots painted under the element's children: its occluder mark (`lit`) and its `fx` layers
/// placed under (the default).
pub fn under(mut e: El, id: u32, p: &Props) -> El {
    if let Some(spring) = morph_spring(p)
        && (p.border.is_some() || p.shadow.is_some() || p.shadows.is_some())
    {
        e = e.child(crate::view::reveal_chrome(morph_chrome(id, p), spring));
    }
    if p.lit.is_some() {
        e = e.child(slot(id, 0, OCCLUDER, 0.0, p));
    }
    if let Some(list) = &p.fx {
        for (i, s) in list.0.iter().enumerate().filter(|(_, s)| !s.over) {
            e = e.child(layer_slot(id, i, s, p));
        }
    }
    e
}

/// The slots painted over the element's children: `fx` layers with `place: "over"`, then the
/// element's `light`, which lights everything painted inside it.
pub fn over(mut e: El, id: u32, p: &Props) -> El {
    if let Some(list) = &p.fx {
        for (i, s) in list.0.iter().enumerate().filter(|(_, s)| s.over) {
            e = e.child(layer_slot(id, i, s, p));
        }
    }
    if p.light.is_some() {
        e = e.child(slot(id, 0, LIGHT, 0.0, p).effect_backdrop(true));
    }
    e
}

fn layer_slot(id: u32, i: usize, s: &FxSpec, p: &Props) -> El {
    let mut e = slot(id, i, LAYER, s.inset, p);
    if s.backdrop() {
        e = e.effect_backdrop(true);
    }
    if matches!(s.effect, Effect::Glass { .. }) {
        e = e.effect_bleed(GLASS_BLEED);
    }
    // A fade would draw the lens in a layer of its own, with no backdrop to bend; the morph is
    // its entrance.
    if matches!(s.effect, Effect::Glass { morph: Some(_), .. }) {
        e = e.transition(rune::Transition::none());
    }
    e
}

/// Whether `window` (its node; the main window's is read from the engine) holds an element with
/// effects. `None` while the engine is busy elsewhere on this thread.
fn window_has_fx(window: Option<u32>) -> Option<bool> {
    crate::engine::ENGINE.with(|e| {
        let e = e.try_borrow().ok()?;
        let w = window.or(e.main_node)?;
        Some(e.tree.fx.iter().any(|n| e.tree.window_of(*n) == Some(w)))
    })
}

fn effect_mark(i: &Instance) -> u32 {
    (i.border[0] as u32 & 0xFFFF) | ((i.border[1] as u32 & 0xFFFF) << 16)
}

/// One `fx` layer on screen this frame: its index among the frame's instances and the FxRenderer layer.
struct OnScreen {
    instance: u32,
    layer: usize,
}

struct Lighting {
    instance: u32,
    node: u32,
    rect: [f32; 4],
    radii: [f32; 4],
    scale: f32,
    spec: LightSpec,
    prims: Vec<Prim>,
}

struct Lit {
    renderer: LightRenderer,
    size: (u32, u32),
    view: wgpu::TextureView,
    uniform: wgpu::Buffer,
    bind: Option<wgpu::BindGroup>,
    drew: bool,
    seen: bool,
}

struct Gpu {
    key: DeviceKey,
    format: wgpu::TextureFormat,
    fx: FxRenderer,
    lights: HashMap<u32, Lit>,
    blit: Blit,
    clear: wgpu::TextureView,
}

/// Every window's compositor. `window` is its `<window>` node; `None` is the main window.
pub struct Comp {
    window: Option<u32>,
    engaged: Cell<bool>,
    gpu: Option<Gpu>,
    animating: bool,
    /// Glass growing out of (or going back into) its `morphFrom` source, by effect node.
    morphs: HashMap<u32, Morph>,
}

impl Comp {
    pub fn new(window: Option<u32>) -> Comp {
        Comp { window, engaged: Cell::new(false), gpu: None, animating: false, morphs: HashMap::new() }
    }
}

thread_local! {
    /// Closing `morphFrom` elements whose glass is back in its source: removed at the next poll.
    static CLOSED: std::cell::RefCell<Vec<u32>> = const { std::cell::RefCell::new(Vec::new()) };
    /// Each `morphFrom` element's size as last shown whole, which it keeps while it closes.
    static WHOLE: std::cell::RefCell<HashMap<u32, [f32; 2]>> = std::cell::RefCell::new(HashMap::new());
}

/// The size `node` (a `morphFrom` element) was last shown at, while open.
pub fn whole_size(node: u32) -> Option<[f32; 2]> {
    WHOLE.with(|w| w.borrow().get(&node).copied())
}

/// How long a removed `morphFrom` element may stay to morph back before it goes regardless.
pub const CLOSE_MAX: std::time::Duration = std::time::Duration::from_secs(3);

/// The closing elements whose morph ended (see `Tree::closing`).
pub fn take_closed() -> Vec<u32> {
    CLOSED.with(|c| std::mem::take(&mut *c.borrow_mut()))
}

/// One glass morph: progress 0 (the source's shape) to 1 (the element's own) on a spring.
struct Morph {
    from: Shape,
    /// The element's own shape when it was last shown whole: what a closing one shrinks from.
    to: Shape,
    from_lens: Option<LensParams>,
    key: String,
    spring: Spring,
    open: Spring,
    x0: f32,
    v0: f32,
    target: f32,
    t0: f64,
    seen: bool,
}

impl Morph {
    fn at(&self, now: f64) -> (f32, f32) {
        self.spring.sample(self.x0, self.v0, self.target, (now - self.t0).max(0.0) as f32)
    }

    fn go(&mut self, target: f32, now: f64) {
        if self.target == target {
            return;
        }
        let (x, v) = self.at(now);
        (self.x0, self.v0, self.target, self.t0) = (x, v, target, now);
        self.spring = if target == 0.0 { close_spring(self.open) } else { self.open };
    }

    /// Whether it's done: a closing one once its glass is no longer drawn.
    fn done(&self, now: f64) -> bool {
        self.settled(now) || (self.target == 0.0 && self.at(now).0 <= MORPH_HIDDEN)
    }

    fn settled(&self, now: f64) -> bool {
        (now - self.t0) as f32 >= self.spring.settling_duration_from(self.x0, self.v0, self.target, 1e-3)
    }
}

/// Where the element keyed `key` was drawn last frame, with its corner radius, and its glass.
fn source_shape(rt: &rune::Runtime<Win>, eng: &crate::engine::Engine, key: &str) -> Option<(Shape, Option<LensParams>)> {
    let ([x, y, w, h], _) = rt.presented(key)?;
    let p = eng.tree.find_key(key).and_then(|n| eng.tree.get(n)).map(|n| &*n.props);
    let r = p.and_then(|p| p.corners.map(|c| c.iter().fold(0.0f32, |a, v| a.max(*v))).or(p.radius)).unwrap_or(0.0);
    let lens = p.and_then(|p| p.fx.as_ref()).and_then(|l| {
        l.0.iter().find_map(|s| match &s.effect {
            Effect::Glass { lens, .. } => Some(*lens),
            Effect::Fill(_) => None,
        })
    });
    Some((Shape::rounded(x, y, w, h, r), lens))
}

fn mix_shape(a: Shape, b: Shape, t: f32) -> Shape {
    let m = |x: f32, y: f32| x + (y - x) * t;
    let (ra, rb) = (a.rect, b.rect);
    let (w, h) = (m(ra.w, rb.w).max(1.0), m(ra.h, rb.h).max(1.0));
    let r = m(a.radius.min(ra.w.min(ra.h) * 0.5), b.radius.min(rb.w.min(rb.h) * 0.5));
    Shape::rounded(m(ra.x, rb.x), m(ra.y, rb.y), w, h, r.clamp(0.0, w.min(h) * 0.5))
}

fn mix_lens(a: &LensParams, b: &LensParams, t: f32) -> LensParams {
    let m = |x: f32, y: f32| x + (y - x) * t;
    let tint = Rgb([m(a.tint.0[0], b.tint.0[0]), m(a.tint.0[1], b.tint.0[1]), m(a.tint.0[2], b.tint.0[2])]);
    LensParams {
        bevel: m(a.bevel, b.bevel),
        depth: m(a.depth, b.depth),
        dispersion: m(a.dispersion, b.dispersion),
        magnification: m(a.magnification, b.magnification),
        frost: m(a.frost, b.frost),
        frost_sigma: m(a.frost_sigma, b.frost_sigma),
        shadow: m(a.shadow, b.shadow),
        rim: m(a.rim, b.rim),
        light_angle: m(a.light_angle, b.light_angle),
        tint,
        tint_amount: m(a.tint_amount, b.tint_amount),
        veil: m(a.veil, b.veil),
        saturation: m(a.saturation, b.saturation),
        adapt: m(a.adapt, b.adapt),
        ..*b
    }
}

/// Whether the element's glass grows out of a `morphFrom` source (and so morphs back into it
/// when removed, before it goes).
pub fn morphs(p: &Props) -> bool {
    morph_spring(p).is_some()
}

/// The spring a `morphFrom` glass grows on.
pub fn morph_spring(p: &Props) -> Option<Spring> {
    p.fx.as_ref()?.0.iter().find_map(|s| match &s.effect {
        Effect::Glass { morph: Some(m), .. } => Some(m.spring),
        _ => None,
    })
}

impl Compositor<Win> for Comp {
    fn engaged(&self) -> bool {
        if let Some(on) = window_has_fx(self.window) {
            self.engaged.set(on || !self.morphs.is_empty());
        }
        self.engaged.get()
    }

    fn animating(&self) -> bool {
        self.animating
    }

    fn release_gpu(&mut self) {
        self.gpu = None;
    }

    fn render(&mut self, f: &mut Frame<'_, Win>) {
        let (device, queue, size) = (f.device, f.queue, f.size);
        let t = f.rt.t as f32;
        let reduced = f.rt.system_reduced_motion();
        let mut layers: Vec<FxLayer> = Vec::new();
        let mut slots: Vec<FxSlot> = Vec::new();
        let mut shown: Vec<OnScreen> = Vec::new();
        let mut lights: Vec<Lighting> = Vec::new();
        let mut occluders: Vec<(u32, Prim)> = Vec::new();
        let mut watched: Vec<(usize, u32)> = Vec::new();
        let now = f.rt.t;
        let morphs = &mut self.morphs;
        let mut closed: Vec<u32> = Vec::new();
        let mut moving = false;
        let mut grouped: Vec<(String, usize, Shape)> = Vec::new();
        crate::engine::read(|eng| {
            for (n, i) in f.rt.instances.iter().enumerate() {
                if i.params[1] != KIND_EFFECT {
                    continue;
                }
                let node = effect_mark(i);
                let Some(p) = eng.tree.get(node).map(|n| &*n.props) else { continue };
                let k = i.params[3].max(1e-3);
                let [x, y, w, h] = i.rect.map(|v| v / k);
                let r = i.radii.iter().fold(0.0f32, |a, v| a.max(v.abs())) / k;
                match i.uv[1] {
                    LAYER => {
                        let Some(s) = p.fx.as_ref().and_then(|l| l.0.get(i.uv[0] as usize)) else { continue };
                        let watch = matches!(s.effect, Effect::Glass { .. }) && p.on.iter().any(|h| h == "backdrop") && !watched.iter().any(|w| w.1 == node);
                        let mut shape = Shape::rounded(x, y, w, h, r);
                        let mut alpha = 1.0;
                        let fx = match &s.effect {
                            Effect::Glass { lens, merge, group, morph } => {
                                let mut lens = *lens;
                                lens.second = merge.map(|[mx, my, mw, mh, mr]| Shape::rounded(x - s.inset + mx, y - s.inset + my, mw, mh, mr));
                                let closing = eng.tree.closing.contains_key(&node);
                                if let Some(ms) = morph {
                                    let source = ms.from.clone().or_else(|| p.anchor.as_ref().map(|a| a.to.clone()));
                                    let m = match (morphs.contains_key(&node), source) {
                                        (true, _) => morphs.get_mut(&node),
                                        (false, Some(key)) if !closing => source_shape(f.rt, eng, &key).map(|(from, from_lens)| {
                                            // Reopened while the last one still goes back into the same source: carry on
                                            // from where that one is drawn, and let it go.
                                            let (mut x0, mut v0) = (if reduced { 1.0 } else { 0.0 }, 0.0);
                                            let back = morphs.iter().find(|(n, m)| m.key == key && m.target == 0.0 && eng.tree.closing.contains_key(*n)).map(|(n, _)| *n);
                                            if let Some(old) = back.filter(|_| !reduced).and_then(|n| morphs.remove(&n).map(|m| (n, m))) {
                                                (x0, v0) = old.1.at(now);
                                                closed.push(old.0);
                                            }
                                            WHOLE.with(|w| w.borrow_mut().insert(node, [shape.rect.w, shape.rect.h]));
                                            morphs.entry(node).or_insert(Morph { from, to: shape, from_lens, key, spring: ms.spring, open: ms.spring, x0, v0, target: 1.0, t0: now, seen: false })
                                        }),
                                        _ => None,
                                    };
                                    match m {
                                        None if closing => {
                                            closed.push(node);
                                            continue;
                                        }
                                        None => {}
                                        Some(m) => {
                                            m.seen = true;
                                            if closing {
                                                m.go(0.0, now);
                                                shape = m.to;
                                            } else if m.to != shape {
                                                m.to = shape;
                                                WHOLE.with(|w| w.borrow_mut().insert(node, [shape.rect.w, shape.rect.h]));
                                            }
                                            let settled = reduced || m.done(now);
                                            if settled && m.target == 0.0 {
                                                morphs.remove(&node);
                                                closed.push(node);
                                                continue;
                                            }
                                            if !settled && let Some((from, _)) = source_shape(f.rt, eng, &m.key) {
                                                m.from = from;
                                            }
                                            let at = if settled { m.target } else { m.at(now).0 };
                                            alpha = morph_alpha(at);
                                            moving |= !settled;
                                            shape = mix_shape(m.from, shape, at);
                                            lens = mix_lens(&m.from_lens.unwrap_or(lens), &lens, at.clamp(0.0, 1.0));
                                        }
                                    }
                                }
                                if let Some(g) = group {
                                    grouped.push((g.clone(), layers.len(), shape));
                                }
                                Fx::lens(lens)
                            }
                            Effect::Fill(fill) => Fx::fill(*fill),
                        };
                        let mut l = fx.on(shape).at(t).seed(s.seed).reduced(reduced).opacity(s.opacity * alpha);
                        l.place = rune_fx::Place::Over;
                        if watch {
                            watched.push((layers.len(), node));
                        }
                        shown.push(OnScreen { instance: n as u32, layer: layers.len() });
                        layers.push(l);
                        slots.push(FxSlot::default().scale(k).clip(i.clip, i.fade).blend(s.blend).measure(watch));
                    }
                    LIGHT => {
                        let Some(spec) = p.light.as_deref() else { continue };
                        lights.push(Lighting { instance: n as u32, node, rect: i.rect, radii: i.radii, scale: k, spec: spec.clone(), prims: Vec::new() });
                    }
                    OCCLUDER => {
                        let Some(l) = &p.lit else { continue };
                        let mut prim = Prim::from_rune(i.rect, i.radii.map(f32::abs));
                        if let Some([b, top]) = l.floating {
                            prim = prim.floating(b * k, top * k);
                        } else if let Some(h) = l.raised {
                            prim = prim.raised(h * k);
                        }
                        if let Some([bw, bh]) = l.bevel {
                            prim = prim.bevel(bw * k, bh * k);
                        }
                        if let Some([g, rough]) = l.gloss {
                            prim = prim.gloss(g, rough);
                        }
                        if let Some(c) = l.emissive {
                            prim = prim.emissive([c.0.r * c.0.a, c.0.g * c.0.a, c.0.b * c.0.a]);
                        }
                        if l.unlit {
                            prim = prim.unlit();
                        }
                        occluders.push((node, prim));
                    }
                    _ => {}
                }
            }
            for l in &mut lights {
                l.prims = occluders.iter().filter(|(n, _)| *n != l.node && inside(&eng.tree, *n, l.node)).map(|(_, p)| *p).collect();
            }
            if !watched.is_empty() {
                crate::backdrop::forget(|n| eng.tree.get(n).is_some());
            }
        });
        morphs.retain(|_, m| std::mem::take(&mut m.seen));
        WHOLE.with(|w| w.borrow_mut().retain(|n, _| morphs.contains_key(n)));
        if !closed.is_empty() {
            CLOSED.with(|c| c.borrow_mut().extend(closed));
            moving = true;
        }
        // A glass group draws as one surface at its first member: the others' shapes join its union.
        grouped.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
        for run in grouped.chunk_by(|a, b| a.0 == b.0) {
            let Some(lead) = run.iter().find(|m| layers[m.1].opacity > 0.0).map(|m| m.1) else { continue };
            let mut union = GlassUnion::EMPTY;
            for m in run {
                if m.1 != lead && layers[m.1].opacity > 0.0 {
                    union.push(m.2);
                    layers[m.1].opacity = 0.0;
                }
            }
            if !union.is_empty() {
                slots[lead] = slots[lead].union(union);
            }
        }
        self.animating = moving || layers.iter().any(FxLayer::is_animating);
        let key = f.device_key();
        if self.gpu.as_ref().is_none_or(|g| g.key != key || g.format != f.format) {
            self.gpu = None;
            let mut fx = FxRenderer::new(device, f.format, FxOptions { dither: true });
            fx.add_format(device, wgpu::TextureFormat::Rgba16Float);
            let clear = device
                .create_texture(&wgpu::TextureDescriptor {
                    label: Some("fx clear"),
                    size: wgpu::Extent3d { width: 1, height: 1, depth_or_array_layers: 1 },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: wgpu::TextureFormat::Rgba16Float,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                    view_formats: &[],
                })
                .create_view(&Default::default());
            self.gpu = Some(Gpu { key, format: f.format, fx, lights: HashMap::new(), blit: Blit::new(device), clear });
        }
        let Some(gpu) = self.gpu.as_mut() else { return };
        gpu.fx.set_srgb_blend(f.srgb_blend());
        gpu.fx.set_fade_stops(f.fade_stops());
        gpu.fx.prepare_with_slots(device, queue, &FxFrame { viewport: [size.0, size.1], scale: 1.0, layers: &layers, backdrop: None, sources: &[] }, &slots);
        for lit in gpu.lights.values_mut() {
            lit.seen = false;
        }
        let clear = f.rt.clear_color();
        f.prepare_ui();
        let Gpu { fx, lights: lits, blit, clear: clear_tex, .. } = gpu;
        f.ui.draw_with_backdrop(f.encoder, f.target, clear, &mut |phase, s: &EffectSite<'_>| {
            if let Some(on) = shown.iter().find(|o| o.instance == s.index) {
                match phase {
                    EffectPhase::Backdrop(enc) => {
                        if let Some(bd) = s.backdrop {
                            fx.blur_backdrop(device, queue, enc, bd, on.layer);
                        }
                    }
                    EffectPhase::Draw(pass) => fx.draw_layer_in(pass, s.format, s.origin, on.layer),
                }
                return;
            }
            let Some(l) = lights.iter().find(|l| l.instance == s.index) else { return };
            match phase {
                EffectPhase::Backdrop(enc) => {
                    let Some(bd) = s.backdrop else { return };
                    let want = (s.size[0].max(1), s.size[1].max(1));
                    let lit = lits.entry(l.node).or_insert_with(|| Lit::new(device, queue, want));
                    if lit.size != want {
                        *lit = Lit::new(device, queue, want);
                    }
                    lit.seen = true;
                    let o = s.origin;
                    let prims: Vec<Prim> = l.prims.iter().map(|p| shifted(*p, o)).collect();
                    let lights: Vec<Light> = l.spec.lights.iter().take(rune_light::MAX_LIGHTS).map(|q| light(q, l.rect, l.scale, o)).collect();
                    let scene = Scene { prims: &prims, lights: &lights, settings: settings(&l.spec, t), emission: None };
                    lit.drew = lit.renderer.render(device, queue, enc, &scene, bd, clear_tex, &lit.view);
                    let rect = [l.rect[0] - o[0], l.rect[1] - o[1], l.rect[2], l.rect[3]];
                    blit.write(queue, &lit.uniform, rect, l.radii, want);
                    if lit.bind.is_none() {
                        lit.bind = Some(blit.bind(device, &lit.uniform, &lit.view));
                    }
                }
                EffectPhase::Draw(pass) => {
                    let Some(lit) = lits.get(&l.node).filter(|x| x.drew) else { return };
                    if let Some(bind) = &lit.bind {
                        blit.draw(device, pass, s.format, bind);
                    }
                }
            }
        });
        gpu.lights.retain(|_, l| l.seen);
        if !watched.is_empty() {
            let done = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
            let landed = done.clone();
            let asked = gpu.fx.read_backdrop_stats(device, f.encoder, move |stats| {
                crate::backdrop::report(stats.into_iter().filter_map(|(layer, s)| watched.iter().find(|w| w.0 == layer).map(|w| (w.1, s))));
                landed.store(true, std::sync::atomic::Ordering::Release);
            });
            if asked {
                crate::backdrop::await_readback(device, done);
            }
        }
    }
}

fn inside(tree: &crate::tree::Tree, mut n: u32, ancestor: u32) -> bool {
    for _ in 0..4096 {
        let Some(node) = tree.get(n) else { return false };
        if node.parent == ancestor {
            return true;
        }
        if node.parent == 0 {
            return false;
        }
        n = node.parent;
    }
    false
}

fn shifted(mut p: Prim, o: [f32; 2]) -> Prim {
    p.rect[0] -= o[0];
    p.rect[1] -= o[1];
    p
}

fn light(q: &LightP, rect: [f32; 4], k: f32, o: [f32; 2]) -> Light {
    let mut l = Light::point(rect[0] - o[0] + q.x * k, rect[1] - o[1] + q.y * k, q.z.unwrap_or(80.0) * k);
    if let Some(c) = q.color {
        l = l.color([c.0.r, c.0.g, c.0.b]);
    }
    if let Some(i) = q.intensity {
        l = l.intensity(i);
    }
    if let Some(r) = q.radius {
        l = l.radius(r * k);
    }
    l = l.range(q.range.unwrap_or(600.0) * k);
    if let Some(b) = q.bulb {
        l = l.bulb(b);
    }
    if let Some(s) = q.specular {
        l = l.specular(s);
    }
    if let Some(s) = q.softness {
        l = l.softness(s);
    }
    if let Some(s) = q.shafts {
        l = l.shafts(s);
    }
    if let Some(s) = &q.spot {
        l = l.spot(s.axis, s.angle);
    }
    l
}

fn settings(s: &LightSpec, t: f32) -> Settings {
    let d = Settings::default();
    Settings {
        ambient: match s.ambient {
            Some(AmbientP::Grey(g)) => [g, g, g],
            Some(AmbientP::Rgb(c)) => c,
            None => d.ambient,
        },
        exposure: s.exposure.unwrap_or(d.exposure),
        contact_ao: s.contact_ao.unwrap_or(d.contact_ao),
        rim: s.rim.unwrap_or(d.rim),
        background_gloss: s.background_gloss.unwrap_or(d.background_gloss),
        background_roughness: s.background_roughness.unwrap_or(d.background_roughness),
        albedo_floor: s.albedo_floor.unwrap_or(d.albedo_floor),
        shafts_over: s.shafts_over.unwrap_or(d.shafts_over),
        time: t,
        ..d
    }
}

impl Lit {
    fn new(device: &wgpu::Device, queue: &wgpu::Queue, size: (u32, u32)) -> Lit {
        let out = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("light out"),
            size: wgpu::Extent3d { width: size.0, height: size.1, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba16Float,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let uniform = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("light blit"),
            size: 64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        Lit {
            renderer: LightRenderer::new(device, queue, size.0, size.1, wgpu::TextureFormat::Rgba16Float),
            size,
            view: out.create_view(&Default::default()),
            uniform,
            bind: None,
            drew: false,
            seen: true,
        }
    }
}

const BLIT_WGSL: &str = r#"
struct U { rect: vec4f, radii: vec4f, size: vec4f, pad: vec4f }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var lit: texture_2d<f32>;
struct V { @builtin(position) pos: vec4f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
    let c = array(vec2f(0., 0.), vec2f(1., 0.), vec2f(0., 1.), vec2f(1., 0.), vec2f(1., 1.), vec2f(0., 1.));
    let p = u.rect.xy + c[i] * u.rect.zw;
    var v: V;
    v.pos = vec4f(p.x / u.size.x * 2. - 1., 1. - p.y / u.size.y * 2., 0., 1.);
    return v;
}
fn sd(p: vec2f, half: vec2f, r: f32) -> f32 {
    let q = abs(p) - half + vec2f(r);
    return length(max(q, vec2f(0.))) + min(max(q.x, q.y), 0.) - r;
}
@fragment fn fs(v: V) -> @location(0) vec4f {
    let px = v.pos.xy;
    let c = u.rect.xy + u.rect.zw * 0.5;
    let d = px - c;
    var r = u.radii.x;
    if (d.x > 0. && d.y < 0.) { r = u.radii.y; }
    if (d.x > 0. && d.y > 0.) { r = u.radii.z; }
    if (d.x < 0. && d.y > 0.) { r = u.radii.w; }
    let a = clamp(0.5 - sd(d, u.rect.zw * 0.5, min(r, min(u.rect.z, u.rect.w) * 0.5)), 0., 1.);
    let col = textureLoad(lit, vec2i(px), 0).rgb;
    return vec4f(col * a, a);
}
"#;

/// Draws a light's lit frame into its element's rounded rect.
struct Blit {
    module: wgpu::ShaderModule,
    layout: wgpu::BindGroupLayout,
    pipes: std::cell::RefCell<HashMap<wgpu::TextureFormat, wgpu::RenderPipeline>>,
}

impl Blit {
    fn new(device: &wgpu::Device) -> Blit {
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("light blit"), source: wgpu::ShaderSource::Wgsl(BLIT_WGSL.into()) });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("light blit"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                    ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: false }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false },
                    count: None,
                },
            ],
        });
        Blit { module, layout, pipes: Default::default() }
    }

    fn bind(&self, device: &wgpu::Device, uniform: &wgpu::Buffer, view: &wgpu::TextureView) -> wgpu::BindGroup {
        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("light blit"),
            layout: &self.layout,
            entries: &[wgpu::BindGroupEntry { binding: 0, resource: uniform.as_entire_binding() }, wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(view) }],
        })
    }

    fn write(&self, queue: &wgpu::Queue, uniform: &wgpu::Buffer, rect: [f32; 4], radii: [f32; 4], size: (u32, u32)) {
        let v: [f32; 16] = [
            rect[0], rect[1], rect[2], rect[3],
            radii[0].abs(), radii[1].abs(), radii[2].abs(), radii[3].abs(),
            size.0 as f32, size.1 as f32, 0.0, 0.0,
            0.0, 0.0, 0.0, 0.0,
        ];
        let bytes: Vec<u8> = v.iter().flat_map(|x| x.to_le_bytes()).collect();
        queue.write_buffer(uniform, 0, &bytes);
    }

    fn draw(&self, device: &wgpu::Device, pass: &mut wgpu::RenderPass<'_>, format: wgpu::TextureFormat, bind: &wgpu::BindGroup) {
        let mut pipes = self.pipes.borrow_mut();
        let pipe = pipes.entry(format).or_insert_with(|| {
            let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: Some("light blit"), bind_group_layouts: &[Some(&self.layout)], immediate_size: 0 });
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("light blit"),
                layout: Some(&layout),
                vertex: wgpu::VertexState { module: &self.module, entry_point: Some("vs"), compilation_options: Default::default(), buffers: &[] },
                fragment: Some(wgpu::FragmentState {
                    module: &self.module,
                    entry_point: Some("fs"),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState { format, blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING), write_mask: wgpu::ColorWrites::ALL })],
                }),
                primitive: Default::default(),
                depth_stencil: None,
                multisample: Default::default(),
                multiview_mask: None,
                cache: None,
            })
        });
        pass.set_pipeline(pipe);
        pass.set_bind_group(0, bind, &[]);
        pass.draw(0..6, 0..1);
    }
}
