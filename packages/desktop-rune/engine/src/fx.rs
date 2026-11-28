//! The `fx`, `light` and `lit` props: rune-fx layers (Liquid Glass lenses and fills such as liquid
//! metal, fluted glass and metaballs) and rune-light lighting. Each becomes a Rune effect slot
//! inside its element, and a compositor every window carries paints them there. It engages only
//! while its window holds such an element, so every other window draws as Rune's default frame.
//!
//! Slots carry the element's node as their mark and `[index, role]` as their data; the compositor
//! reads the element's current props from the tree at each frame, so a prop change from TS (a hot
//! swap, a `ref.set`) reaches the GPU with no engine rebuild.

use std::cell::Cell;
use std::collections::{HashMap, HashSet};

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
const GLASS_BLEED: f32 = 28.0;

#[derive(Clone, Debug)]
pub enum Effect {
    /// A Liquid Glass lens over what is painted behind the element; `merge` is a second shape
    /// `[x, y, w, h, radius]` in the element's points that the glass flows into.
    Glass {
        lens: LensParams,
        merge: Option<[f32; 5]>,
        group: Option<String>,
        morph: Option<MorphSpec>,
        /// Interactive pointer-press jelly ripple (Apple `.interactive()`). `None`: enabled
        /// automatically when the element listens to `press` or `drag`.
        interactive: Option<bool>,
    },
    Fill(rune_fx::FillParams),
}

/// `morphFrom`: the glass grows out of another element's shape when it mounts and goes back
/// into it as it leaves, on `spring`. `from` is that element's `id` (`None`: the `anchor`'s).
#[derive(Clone, Debug)]
pub struct MorphSpec {
    pub from: Option<String>,
    pub spring: Spring,
    /// Unified single-view morph (`glassEffectID`-style): absorb the trigger's own glass and
    /// crossfade its content instead of leaving it parked underneath. `None`: automatic when the
    /// trigger is a standalone glass element not in the same glass group.
    pub unified: Option<bool>,
}

/// The spring a morph grows on: UIKit's menu, measured frame by frame on iOS 26.2 (the blob's
/// width fits a 315 ms spring with 0.23 bounce, overshooting about 3%).
const MORPH_SPRING: Spring = Spring::new(0.315, 0.23);

/// The spring a unified morph (a menu back into its button) goes back on: UIKit's is slower than
/// its open (about 400 ms, 0.2 bounce), so the blob lands a little smaller than the button and swells back.
fn unified_close_spring(open: Spring) -> Spring {
    Spring::new((open.duration * 1.25).max(0.01), 0.2)
}

/// Response of a spring to a kick, normalised to peak at 1: what lifts UIKit's menu blob off its
/// button as it grows (and again as it goes back), then lets it land with a small overshoot.
fn impulse(t: f32, duration: f32, bounce: f32) -> f32 {
    if t <= 0.0 {
        return 0.0;
    }
    let w = std::f32::consts::TAU / duration.max(1e-3);
    let z = (1.0 - bounce).clamp(0.05, 0.95);
    let wd = w * (1.0 - z * z).sqrt();
    let tp = wd.atan2(z * w) / wd;
    let peak = (-z * w * tp).exp() * (wd * tp).sin();
    (-z * w * t).exp() * (wd * t).sin() / peak
}

fn centre(s: Shape) -> [f32; 2] {
    [s.rect.x + s.rect.w * 0.5, s.rect.y + s.rect.h * 0.5]
}

/// A critically damped step from 0 to 1 over about `duration`.
fn crit(t: f32, duration: f32) -> f32 {
    if t <= 0.0 {
        return 0.0;
    }
    let w = std::f32::consts::TAU / duration.max(1e-3);
    1.0 - (1.0 + w * t) * (-w * t).exp()
}

/// The spring a morph goes back on: slightly quicker and softly damped into the trigger.
fn close_spring(open: Spring) -> Spring {
    Spring::new((open.duration * 0.78).max(0.01), (open.bounce * 0.25).clamp(0.0, 0.06))
}

/// How long a closing unified morph keeps its blob after it starts back: the landing's overshoot
/// has settled by then.
const UNIFIED_LANDING: f64 = 0.5;

/// How far through a morph its glass is drawn: none at the source's shape, so the source
/// (glass, icon and label) shows as itself at both ends, and full by `MORPH_SHOWN`.
const MORPH_HIDDEN: f32 = 0.03;
const MORPH_SHOWN: f32 = 0.24;

fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn morph_alpha(at: f32) -> f32 {
    smoothstep(MORPH_HIDDEN, MORPH_SHOWN, at)
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
    // Stella's glass takes Apple's continuous corner curve unless it says otherwise.
    let mut lens = LensParams { continuous: true, ..LensParams::default() };
    let mut merge = None;
    let mut group = None;
    let mut morph: Option<MorphSpec> = None;
    let mut interactive: Option<bool> = None;
    let Some(o) = v.as_object() else {
        return match v {
            J::Bool(true) => Ok(Effect::Glass { lens, merge, group, morph, interactive }),
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
            ("continuous", _) => lens.continuous = val.as_bool().ok_or("glass `continuous` is true or false")?,
            ("interactive", _) => interactive = Some(val.as_bool().ok_or("glass `interactive` is true or false")?),
            ("unionK" | "spacing", Some(x)) => lens.union_k = x,
            ("group", _) => group = Some(val.as_str().ok_or("glass `group` is a string")?.to_owned()),
            ("morphFrom", _) => {
                let from = match val {
                    J::String(k) => Some(k.clone()),
                    J::Bool(true) => None,
                    _ => return Err("glass `morphFrom` is an element id or true (the anchor)".into()),
                };
                morph = Some(MorphSpec {
                    from,
                    spring: morph.as_ref().map_or(MORPH_SPRING, |m| m.spring),
                    unified: morph.as_ref().and_then(|m| m.unified),
                });
            }
            ("morphMotion", _) => {
                let m = val.as_object().ok_or("glass `morphMotion` is {dur, bounce}")?;
                let spring = crate::style::spring(num(m, "dur").unwrap_or(MORPH_SPRING.duration), num(m, "bounce").unwrap_or(MORPH_SPRING.bounce));
                morph = Some(MorphSpec {
                    spring,
                    from: morph.as_ref().and_then(|m| m.from.clone()),
                    unified: morph.as_ref().and_then(|m| m.unified),
                });
            }
            ("morphUnified", _) => {
                let u = val.as_bool().ok_or("glass `morphUnified` is true or false")?;
                morph = Some(MorphSpec {
                    unified: Some(u),
                    spring: morph.as_ref().map_or(MORPH_SPRING, |m| m.spring),
                    from: morph.as_ref().and_then(|m| m.from.clone()),
                });
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
        return Err("glass `morphMotion` / `morphUnified` needs `morphFrom`".into());
    }
    Ok(Effect::Glass { lens, merge, group, morph, interactive })
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

/// Per-node smoothed center position from the previous frame, used for subtle Apple-style
/// velocity-driven liquid inertia stretch on sliding glass controls (e.g. tab pills).
struct SlideTrack {
    cx: f32,
    cy: f32,
    t: f64,
    stretch_x: f32,
    stretch_y: f32,
    seen: bool,
}

/// Per-node pointer-press spring state for Apple `.interactive()` tactile specular jelly ripple.
struct PressState {
    x: f32,
    y: f32,
    start_t: f64,
    e_x0: f32,
    e_v0: f32,
    e_target: f32,
    e_t0: f64,
    e_spring: Spring,
    s_x0: f32,
    s_v0: f32,
    s_target: f32,
    s_t0: f64,
    s_spring: Spring,
    seen: bool,
}

const PRESS_ENERGY_IN: Spring = Spring::new(0.14, 0.0);
const PRESS_ENERGY_OUT: Spring = Spring::new(0.20, 0.0);
const PRESS_SWELL_IN: Spring = Spring::new(0.22, 0.28);
const PRESS_SWELL_OUT: Spring = Spring::new(0.30, 0.34);

impl PressState {
    fn new(x: f32, y: f32, now: f64) -> Self {
        PressState {
            x,
            y,
            start_t: now,
            e_x0: 0.0,
            e_v0: 0.0,
            e_target: 1.0,
            e_t0: now,
            e_spring: PRESS_ENERGY_IN,
            s_x0: 0.0,
            s_v0: 0.0,
            s_target: 1.0,
            s_t0: now,
            s_spring: PRESS_SWELL_IN,
            seen: true,
        }
    }

    fn energy(&self, now: f64) -> (f32, f32) {
        self.e_spring.sample(self.e_x0, self.e_v0, self.e_target, (now - self.e_t0).max(0.0) as f32)
    }

    fn swell(&self, now: f64) -> (f32, f32) {
        self.s_spring.sample(self.s_x0, self.s_v0, self.s_target, (now - self.s_t0).max(0.0) as f32)
    }

    fn go_energy(&mut self, target: f32, now: f64) {
        if (self.e_target - target).abs() < 1e-4 {
            return;
        }
        let (x, v) = self.energy(now);
        (self.e_x0, self.e_v0, self.e_target, self.e_t0) = (x, v, target, now);
        self.e_spring = if target > x { PRESS_ENERGY_IN } else { PRESS_ENERGY_OUT };
    }

    fn go_swell(&mut self, target: f32, now: f64) {
        if (self.s_target - target).abs() < 1e-4 {
            return;
        }
        let (x, v) = self.swell(now);
        (self.s_x0, self.s_v0, self.s_target, self.s_t0) = (x, v, target, now);
        self.s_spring = if target > x { PRESS_SWELL_IN } else { PRESS_SWELL_OUT };
    }

    fn settled(&self, now: f64) -> bool {
        let e_done = (now - self.e_t0) as f32 >= self.e_spring.settling_duration_from(self.e_x0, self.e_v0, self.e_target, 1e-3);
        let s_done = (now - self.s_t0) as f32 >= self.s_spring.settling_duration_from(self.s_x0, self.s_v0, self.s_target, 1e-3);
        e_done && s_done
    }

    fn idle(&self, now: f64) -> bool {
        self.e_target == 0.0 && self.s_target == 0.0 && self.settled(now)
    }
}

/// Every window's compositor. `window` is its `<window>` node; `None` is the main window.
pub struct Comp {
    window: Option<u32>,
    engaged: Cell<bool>,
    gpu: Option<Gpu>,
    animating: bool,
    /// Glass growing out of (or going back into) its `morphFrom` source, by effect node.
    morphs: HashMap<u32, Morph>,
    /// Sliding glass velocity tracker, by element key/node (for matched pill liquid inertia).
    slides: HashMap<String, SlideTrack>,
    /// Interactive pointer-press jelly ripple states, by effect node.
    presses: HashMap<u32, PressState>,
    /// Currently pressed interactive glass node (captured on pointer-down rising edge).
    active_press: Option<u32>,
    /// Previous frame's primary-button-down state (for rising-edge detection).
    was_down: bool,
    /// Last set of unified trigger nodes whose content was requested hidden.
    last_hidden_triggers: HashSet<u32>,
}

impl Comp {
    pub fn new(window: Option<u32>) -> Comp {
        Comp {
            window,
            engaged: Cell::new(false),
            gpu: None,
            animating: false,
            morphs: HashMap::new(),
            slides: HashMap::new(),
            presses: HashMap::new(),
            active_press: None,
            was_down: false,
            last_hidden_triggers: HashSet::new(),
        }
    }
}

thread_local! {
    /// Closing `morphFrom` elements whose glass is back in its source: removed at the next poll.
    static CLOSED: std::cell::RefCell<Vec<u32>> = const { std::cell::RefCell::new(Vec::new()) };
    /// Each `morphFrom` element's size as last shown whole, which it keeps while it closes.
    static WHOLE: std::cell::RefCell<HashMap<u32, [f32; 2]>> = std::cell::RefCell::new(HashMap::new());
    /// Latest set of unified morph trigger nodes whose children should stay hidden (crossfaded out).
    static TRIGGER_SYNC: std::cell::RefCell<Option<HashSet<u32>>> = const { std::cell::RefCell::new(None) };
    /// Live transforms of unified morphs' content, by element node.
    static CONTENT: std::cell::RefCell<HashMap<u32, std::rc::Rc<ContentLive>>> = std::cell::RefCell::new(HashMap::new());
}

/// How the content of a unified morph (a menu's rows) is drawn while the glass morphs: `Comp` sets it every frame so the content rides inside the blob,
/// scaled with it, carried by its lift and blurred while it moves, as UIKit's menus do. Bound to
/// the element in `view::children` (`view::ride`).
pub struct ContentLive {
    pub scale: rune::Live<f32>,
    pub offset: rune::Live<[f32; 2]>,
    pub blur: rune::Live<f32>,
    pub opacity: rune::Live<f32>,
    /// The offset set last, to recover the element's laid-out centre from where it was drawn.
    applied: Cell<[f32; 2]>,
    /// The element's laid-out centre while it rides, found from where it's drawn.
    home: Cell<Option<[f32; 2]>>,
}

/// Blur (pt) of a unified morph's content while its blob is small and moving.
const RIDE_BLUR: f32 = 6.0;

impl ContentLive {
    fn new(hidden: bool) -> ContentLive {
        ContentLive {
            scale: rune::Live::new(if hidden { 0.3 } else { 1.0 }),
            offset: rune::Live::new([0.0; 2]),
            blur: rune::Live::new(if hidden { RIDE_BLUR } else { 0.0 }),
            opacity: rune::Live::new(if hidden { 0.0 } else { 1.0 }),
            applied: Cell::new([0.0; 2]),
            home: Cell::new(None),
        }
    }

    fn set(&self, scale: f32, offset: [f32; 2], blur: f32, opacity: f32) {
        self.scale.set(scale);
        self.offset.set(offset);
        self.blur.set(blur);
        self.opacity.set(opacity);
        self.applied.set(offset);
    }
}

/// The live transform of `node`, a unified morph's content: made `hidden` (as a
/// menu's content is on the frame the menu appears) the first time it's asked for.
pub fn content_live(node: u32, hidden: bool) -> std::rc::Rc<ContentLive> {
    CONTENT.with(|c| c.borrow_mut().entry(node).or_insert_with(|| std::rc::Rc::new(ContentLive::new(hidden))).clone())
}

/// One unified morph's content to move for the coming frame.
struct Ride {
    node: u32,
    to: Shape,
    /// The blob as it will be drawn next frame, `None` once settled open (content at rest).
    next: Option<Pose>,
    closing: bool,
}

/// Binds `e`, the content `node` of an opening unified morph, to its live transform (see
/// `ContentLive`), starting hidden.
pub fn ride(e: El, node: u32) -> El {
    let l = content_live(node, true);
    e.live_scale(&l.scale).live_offset(&l.offset).live_blur(&l.blur).live_opacity(&l.opacity)
}

/// Moves each unified morph's content with its blob for the coming frame: scaled to the blob
/// (as a whole, about the menu's centre) and a little magnified, carried by its lift, blurred
/// until it's nearly grown and faded in over its first 60 ms, as UIKit's menus are.
fn move_content(rt: &rune::Runtime<Win>, eng: &crate::engine::Engine, rides: &[Ride]) {
    let mut live: HashSet<u32> = HashSet::new();
    for r in rides {
        if r.closing {
            continue;
        }
        let Some(n) = eng.tree.get(r.node) else { continue };
        let (tc, [tw, th]) = (centre(r.to), [r.to.rect.w.max(1.0), r.to.rect.h.max(1.0)]);
        for &c in &n.children {
            let Some(child) = eng.tree.get(c) else { continue };
            live.insert(c);
            let l = content_live(c, true);
            let Some(pose) = &r.next else {
                l.set(1.0, [0.0; 2], 0.0, 1.0);
                l.home.set(None);
                continue;
            };
            let home = match l.home.get() {
                Some(h) => h,
                None => {
                    let Some(([x, y, w, h], _)) = rt.presented(&crate::view::rune_key(c, &child.props)) else { continue };
                    let a = l.applied.get();
                    let h = [x + w * 0.5 - a[0], y + h * 0.5 - a[1]];
                    l.home.set(Some(h));
                    h
                }
            };
            let bc = centre(pose.shape);
            // UIKit's content rides a little magnified in the blob (its lens) and settles to size
            // as the blob does.
            let lens = 1.0 + 0.25 * (1.0 - smoothstep(0.08, 0.22, pose.tau));
            let k = ((pose.shape.rect.w / tw).min(pose.shape.rect.h / th) * lens).clamp(0.05, 1.4);
            let offset = [bc[0] - tc[0] + (k - 1.0) * (home[0] - tc[0]), bc[1] - tc[1] + (k - 1.0) * (home[1] - tc[1])];
            let blur = RIDE_BLUR * (1.0 - smoothstep(0.05, 0.15, pose.tau));
            let opacity = smoothstep(0.0, 0.06, pose.tau);
            l.set(k, offset, blur, opacity);
        }
    }
    CONTENT.with(|m| {
        m.borrow_mut().retain(|n, l| {
            let keep = live.contains(n);
            if !keep {
                // Left at rest for whatever still holds it.
                l.set(1.0, [0.0; 2], 0.0, 1.0);
            }
            keep
        })
    });
}

/// Latest unified morph trigger content-hide set reported by `fx::Comp` (for `windows::poll`).
pub fn take_trigger_sync() -> Option<HashSet<u32>> {
    TRIGGER_SYNC.with(|t| t.borrow_mut().take())
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
    /// Trigger node id resolved from `key`, when `unified` is true.
    trigger_node: Option<u32>,
    /// Unified single-view morph (`glassEffectID`-style): one continuous glass shape absorbs
    /// the trigger's own glass and crossfades its content.
    unified: bool,
    spring: Spring,
    open: Spring,
    x0: f32,
    v0: f32,
    target: f32,
    t0: f64,
    /// How round a unified morph's blob was when it last turned around (see `roundness`).
    round0: f32,
    seen: bool,
}

/// Where a unified morph's blob is drawn at one moment, and how its content rides in it.
struct Pose {
    shape: Shape,
    /// Seconds since the morph last turned (opened or started back).
    tau: f32,
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
        self.round0 = self.roundness((now - self.t0).max(0.0) as f32);
        (self.x0, self.v0, self.target, self.t0) = (x, v, target, now);
        self.spring = match (target == 0.0, self.unified) {
            (true, true) => unified_close_spring(self.open),
            (true, false) => close_spring(self.open),
            _ => self.open,
        };
    }

    /// Whether it's done: a closing unified morph lands on its trigger, overshoots and settles
    /// before handing back; a non-unified one finishes once its glass fades out.
    fn done(&self, now: f64) -> bool {
        if self.unified {
            return self.settled(now) && (self.target == 1.0 || (now - self.t0) >= UNIFIED_LANDING);
        }
        self.settled(now) || (self.target == 0.0 && self.at(now).0 <= MORPH_HIDDEN)
    }

    /// How round a unified morph's blob is, 0 (its own corners) to 1 (fully round): UIKit's menu
    /// blob stays a round droplet for its first 130 ms, then relaxes to the menu's corners; going
    /// back it rounds up again at once.
    fn roundness(&self, tau: f32) -> f32 {
        if self.target == 1.0 {
            1.0 - crit(tau - 0.13, 0.22)
        } else {
            self.round0 + (1.0 - self.round0) * crit(tau, 0.2)
        }
    }

    /// A unified morph's blob at `now`, after UIKit's menu measured frame by frame on iOS 26.2:
    /// its size on the morph spring; its centre lifted off the button toward the menu by a damped
    /// kick (about 0.6 of the travel, peaking at 80 ms, then landing with a small overshoot),
    /// stretched along the way it goes, and round while it moves. `axis` is the anchor's (0 sideways, 1 up and down).
    fn pose(&self, from: Shape, to: Shape, axis: Option<usize>, now: f64) -> Pose {
        let tau = (now - self.t0).max(0.0) as f32;
        let p = self.at(now).0;
        let mut s = mix_shape(from, to, p);
        let (fc, tc) = (centre(from), centre(to));
        let ax = axis.unwrap_or(if (tc[1] - fc[1]).abs() >= (tc[0] - fc[0]).abs() { 1 } else { 0 });
        let travel = tc[ax] - fc[ax];
        let extent = if ax == 0 { to.rect.w } else { to.rect.h };
        let (gain, kick) = if self.target == 1.0 { (0.6, impulse(tau + 0.01, 0.38, 0.3)) } else { (0.65, impulse(tau, 0.36, 0.5)) };
        let lift = (travel.abs() * gain).min(0.25 * extent) * travel.signum() * kick;
        // And it stretches along the way it travels while it moves: UIKit's grows about a fifth of
        // the travel longer as it leaves, and nearly half as it drops back into the button.
        let stretch = if self.target == 1.0 {
            0.22 * smoothstep(-0.01, 0.06, tau) * (1.0 - smoothstep(0.05, 0.19, tau))
        } else {
            0.43 * smoothstep(0.0, 0.15, tau) * (1.0 - smoothstep(0.17, 0.29, tau))
        };
        let stretch = (travel.abs() * stretch).min(0.3 * extent);
        // Across that way it leads a little toward the menu: ahead of its size as it grows, behind
        // it as it goes back (UIKit's centre sits about an eighth of the travel nearer the menu).
        let across = tc[1 - ax] - fc[1 - ax];
        let lead = if self.target == 1.0 {
            0.145 * (1.0 - p.clamp(0.0, 1.0)) * smoothstep(0.0, 0.04, p)
        } else {
            0.12 * smoothstep(0.85, 0.15, p) * (1.0 - smoothstep(0.19, 0.29, tau))
        };
        let lead = across * lead;
        if ax == 0 {
            s.rect.x += lift - stretch * 0.5;
            s.rect.w += stretch;
            s.rect.y += lead;
        } else {
            s.rect.y += lift - stretch * 0.5;
            s.rect.h += stretch;
            s.rect.x += lead;
        }
        let half = s.rect.w.min(s.rect.h) * 0.5;
        let k = self.roundness(tau) * smoothstep(0.0, 0.04, p.abs());
        s.radius = (s.radius + (half - s.radius) * k).clamp(0.0, half);
        Pose { shape: s, tau }
    }

    fn settled(&self, now: f64) -> bool {
        (now - self.t0) as f32 >= self.spring.settling_duration_from(self.x0, self.v0, self.target, 1e-3)
    }
}

/// Resolves the trigger node absorbed by `node` when `node` is a unified single-view `morphFrom`
/// element (`glassEffectID`-style: standalone glass trigger not in the same glass group, or
/// explicit `morphUnified: true`).
pub fn unified_trigger(tree: &crate::tree::Tree, node: u32) -> Option<u32> {
    let p = &tree.get(node)?.props;
    let list = p.fx.as_ref()?;
    for s in &list.0 {
        if let Effect::Glass { group, morph: Some(ms), .. } = &s.effect {
            let key = ms.from.as_deref().or_else(|| p.anchor.as_ref().map(|a| a.to.as_str()))?;
            let t_id = tree.find_key(key)?;
            if t_id == node {
                continue;
            }
            let tp = &tree.get(t_id)?.props;
            let t_glass = tp.fx.as_ref().and_then(|l| {
                l.0.iter().find_map(|ts| match &ts.effect {
                    Effect::Glass { group: tg, .. } => Some(tg.as_deref()),
                    Effect::Fill(_) => None,
                })
            });
            let kin = group.is_some() && t_glass.flatten() == group.as_deref();
            if kin {
                continue;
            }
            let unified = ms.unified.unwrap_or(t_glass.is_some());
            if unified {
                return Some(t_id);
            }
        }
    }
    None
}

fn is_interactive_glass(interactive: Option<bool>, p: &Props) -> bool {
    interactive.unwrap_or_else(|| p.on.iter().any(|h| h == "press" || h == "drag"))
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

/// The glass group of the element keyed `key`, if its glass is in one.
fn source_group(eng: &crate::engine::Engine, key: &str) -> Option<String> {
    let p = eng.tree.find_key(key).and_then(|n| eng.tree.get(n)).map(|n| &*n.props)?;
    p.fx.as_ref()?.0.iter().find_map(|s| match &s.effect {
        Effect::Glass { group, .. } => group.clone(),
        Effect::Fill(_) => None,
    })
}

/// `own` at its own size and radius, moved just inside `source` where it's nearest: where a glass
/// rises out of a larger member of its group (a button out of the composer) and sinks back.
fn tucked(source: Shape, own: Shape) -> Shape {
    let (s, o) = (source.rect, own.rect);
    let fit = |at: f32, len: f32, lo: f32, room: f32| if len >= room { lo + (room - len) * 0.5 } else { at.clamp(lo, lo + room - len) };
    Shape::rounded(fit(o.x, o.w, s.x, s.w), fit(o.y, o.h, s.y, s.h), o.w, o.h, own.radius)
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

/// Whether `p`'s `morphFrom` glass belongs to the same glass group as its source (pinch-off
/// droplet rather than anchored menu/popover).
pub fn is_kin_morph(eng: &crate::engine::Engine, p: &Props) -> bool {
    let Some(list) = &p.fx else { return false };
    list.0.iter().any(|s| match &s.effect {
        Effect::Glass { group: Some(g), morph: Some(m), .. } => {
            let key = m.from.as_deref().or_else(|| p.anchor.as_ref().map(|a| a.to.as_str()));
            key.and_then(|k| source_group(eng, k)).as_deref() == Some(g.as_str())
        }
        _ => false,
    })
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
        let ptr = f.rt.pointer();
        let is_down = f.rt.pressing() || f.rt.primary_down();
        let just_pressed = is_down && !self.was_down;
        if !is_down {
            self.active_press = None;
        }
        let morphs = &mut self.morphs;
        let slides = &mut self.slides;
        let presses = &mut self.presses;
        let active_press = &mut self.active_press;
        let mut closed: Vec<u32> = Vec::new();
        let mut moving = false;
        let mut grouped: Vec<(String, usize, Shape)> = Vec::new();
        let mut glass_layer_nodes: Vec<(usize, u32)> = Vec::new();
        let mut absorbed_glass_nodes: HashSet<u32> = HashSet::new();
        let mut want_hidden_triggers: HashSet<u32> = HashSet::new();
        let mut rides: Vec<Ride> = Vec::new();
        let mut handed: Vec<(u32, u32)> = Vec::new();
        let frame_dt = f.dt.clamp(1.0 / 120.0, 1.0 / 30.0);
        crate::engine::read(|eng| {
            // Rising-edge hit-test for interactive `.interactive()` glass controls (topmost wins).
            if just_pressed
                && let Some((px, py)) = ptr
            {
                let mut hit: Option<u32> = None;
                for i in &f.rt.instances {
                    if i.params[1] != KIND_EFFECT || i.uv[1] != LAYER {
                        continue;
                    }
                    let node = effect_mark(i);
                    let Some(p) = eng.tree.get(node).map(|n| &*n.props) else { continue };
                    let Some(s) = p.fx.as_ref().and_then(|l| l.0.get(i.uv[0] as usize)) else { continue };
                    if let Effect::Glass { interactive, .. } = &s.effect
                        && is_interactive_glass(*interactive, p)
                        && !eng.tree.closing.contains_key(&node)
                        && !eng.tree.morph_absorbed.contains(&node)
                    {
                        let k = i.params[3].max(1e-3);
                        let [x, y, w, h] = i.rect.map(|v| v / k);
                        if px >= x && px <= x + w && py >= y && py <= y + h {
                            hit = Some(node);
                        }
                    }
                }
                *active_press = hit;
                if let Some(node) = hit {
                    match presses.get_mut(&node) {
                        Some(ps) => {
                            ps.x = px;
                            ps.y = py;
                            ps.start_t = now;
                            ps.go_energy(1.0, now);
                            ps.go_swell(1.0, now);
                            ps.seen = true;
                        }
                        None => {
                            presses.insert(node, PressState::new(px, py, now));
                        }
                    }
                }
            }
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
                        let mut is_glass = false;
                        let fx = match &s.effect {
                            Effect::Glass { lens, merge, group, morph, interactive } => {
                                is_glass = true;
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
                                            let kin = group.is_some() && source_group(eng, &key) == *group;
                                            let trigger_node = eng.tree.find_key(&key).filter(|&t_id| t_id != node);
                                            let unified = !kin && trigger_node.is_some() && ms.unified.unwrap_or(from_lens.is_some());
                                            WHOLE.with(|w| w.borrow_mut().insert(node, [shape.rect.w, shape.rect.h]));
                                            morphs.entry(node).or_insert(Morph {
                                                from,
                                                to: shape,
                                                from_lens,
                                                key,
                                                trigger_node,
                                                unified,
                                                spring: ms.spring,
                                                open: ms.spring,
                                                x0,
                                                v0,
                                                target: 1.0,
                                                t0: now,
                                                round0: 1.0,
                                                seen: false,
                                            })
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
                                            let at_c = at.clamp(0.0, 1.0);
                                            let kin = group.is_some() && source_group(eng, &m.key) == *group;
                                            // Unified single-view morph (`glassEffectID`-style): one
                                            // continuous glass surface from at = 0 through rest and
                                            // close; absorb the trigger's own glass and crossfade its
                                            // content cleanly.
                                            if m.unified {
                                                // UIKit's menu: the button's own glass is the blob from
                                                // the first frame; its icon is gone at once and comes
                                                // back once the blob going back is a third of the way.
                                                alpha = 1.0;
                                                if let Some(t_id) = m.trigger_node {
                                                    absorbed_glass_nodes.insert(t_id);
                                                    if !closing || at > 0.3 {
                                                        want_hidden_triggers.insert(t_id);
                                                    } else {
                                                        handed.push((node, t_id));
                                                    }
                                                }
                                                moving |= !settled;
                                                let axis = match p.anchor.as_ref().and_then(|a| a.side.as_deref()) {
                                                    Some("top" | "bottom") => Some(1),
                                                    Some("left" | "right" | "start" | "end") => Some(0),
                                                    _ => None,
                                                };
                                                let from = m.from;
                                                let pose = (!settled).then(|| m.pose(from, shape, axis, now));
                                                // The menu's material from the start, as UIKit's.
                                                lens = mix_lens(&m.from_lens.unwrap_or(lens), &lens, smoothstep(0.0, 0.2, at_c));
                                                if let Some(pose) = &pose {
                                                    shape = pose.shape;
                                                    // Landing, the button's glass wells back up under
                                                    // the blob and they pull together into one drop,
                                                    // a neck between them, until they meet.
                                                    if closing && at <= 0.3 {
                                                        let g = smoothstep(0.3, 0.15, at);
                                                        let (c, r) = (centre(from), from.rect);
                                                        let (w, h) = (r.w * g, r.h * g);
                                                        lens.second = Some(Shape::rounded(c[0] - w * 0.5, c[1] - h * 0.5, w, h, from.radius * g));
                                                        lens.union_k = 16.0 * (at / 0.12).clamp(0.0, 1.0);
                                                        lens.morph = 0.0;
                                                    }
                                                }
                                                rides.push(Ride { node, to: m.to, next: pose.map(|_| m.pose(from, m.to, axis, now + frame_dt)), closing });
                                            } else if !kin {
                                                alpha = morph_alpha(at);
                                            }
                                            if !m.unified {
                                            moving |= !settled;
                                            let from = if kin { tucked(m.from, shape) } else { m.from };
                                            let morphed = mix_shape(from, shape, at);
                                            lens = mix_lens(&m.from_lens.unwrap_or(lens), &lens, at_c);
                                            // Living "liquid energy" mid-morph: slightly clearer veil, brighter
                                            // specular rim, richer edge curvature and organic oval rounding while flowing.
                                            if !settled {
                                                let energy = (4.0 * at_c * (1.0 - at_c)).clamp(0.0, 1.0);
                                                lens.veil *= 1.0 - 0.22 * energy;
                                                lens.rim *= 1.0 + 0.28 * energy;
                                                lens.depth *= 1.0 + 0.22 * energy;
                                            }
                                            // Bar-embedded (non-unified) triggers smoothly bridge out
                                            // of their anchor.
                                            if !kin && !settled && m.from_lens.is_some() && at_c < 0.62 {
                                                let bridge_t = smoothstep(0.04, 0.62, at_c);
                                                shape = m.from;
                                                lens.second = Some(morphed);
                                                lens.union_k = 20.0 * (1.0 - bridge_t * 0.75);
                                                lens.morph = bridge_t;
                                            } else {
                                                shape = morphed;
                                            }
                                            }
                                        }
                                    }
                                } else if !reduced && let Some(mid) = p.matched.as_deref() {
                                    // Sliding shared-element glass pill (e.g. tab bar): subtle Apple
                                    // liquid inertia stretch along velocity + momentary glass clarity lift.
                                    let cx = shape.rect.x + shape.rect.w * 0.5;
                                    let cy = shape.rect.y + shape.rect.h * 0.5;
                                    let tr = slides.entry(mid.to_owned()).or_insert(SlideTrack { cx, cy, t: now, stretch_x: 0.0, stretch_y: 0.0, seen: false });
                                    let dt = (now - tr.t).clamp(1e-4, 0.1) as f32;
                                    let vx = (cx - tr.cx) / dt;
                                    let vy = (cy - tr.cy) / dt;
                                    let target_sx = (vx.abs() * 0.008).min(5.5);
                                    let target_sy = (vy.abs() * 0.008).min(5.5);
                                    let blend = (1.0 - (-dt * 28.0).exp()).clamp(0.0, 1.0);
                                    tr.stretch_x += (target_sx - tr.stretch_x) * blend;
                                    tr.stretch_y += (target_sy - tr.stretch_y) * blend;
                                    tr.cx = cx;
                                    tr.cy = cy;
                                    tr.t = now;
                                    tr.seen = true;
                                    let speed_k = ((tr.stretch_x + tr.stretch_y) / 5.5).clamp(0.0, 1.0);
                                    if speed_k > 0.01 {
                                        let dx = tr.stretch_x - tr.stretch_y * 0.25;
                                        let dy = tr.stretch_y - tr.stretch_x * 0.25;
                                        shape.rect.x -= dx;
                                        shape.rect.w = (shape.rect.w + dx * 2.0).max(4.0);
                                        shape.rect.y -= dy;
                                        shape.rect.h = (shape.rect.h + dy * 2.0).max(4.0);
                                        lens.veil *= 1.0 - 0.35 * speed_k;
                                        lens.rim *= 1.0 + 0.35 * speed_k;
                                        lens.magnification += 0.05 * speed_k;
                                        moving = true;
                                    }
                                }
                                // Interactive pointer-press jelly ripple (Apple `.interactive()`).
                                if is_interactive_glass(*interactive, p) && !closing
                                    && let Some(ps) = presses.get_mut(&node)
                                {
                                    ps.seen = true;
                                    let held = is_down && *active_press == Some(node);
                                    if held {
                                        if let Some((px, py)) = ptr {
                                            let r = shape.rect;
                                            let clamped_x = px.clamp(r.x - 16.0, r.x + r.w + 16.0);
                                            let clamped_y = py.clamp(r.y - 16.0, r.y + r.h + 16.0);
                                            ps.x += (clamped_x - ps.x) * 0.45;
                                            ps.y += (clamped_y - ps.y) * 0.45;
                                            let near = px >= r.x - 28.0 && px <= r.x + r.w + 28.0 && py >= r.y - 28.0 && py <= r.y + r.h + 28.0;
                                            ps.go_energy(if near { 1.0 } else { 0.35 }, now);
                                            ps.go_swell(if near { 1.0 } else { 0.25 }, now);
                                        }
                                    } else {
                                        ps.go_energy(0.0, now);
                                        ps.go_swell(0.0, now);
                                    }
                                    let (energy, _) = ps.energy(now);
                                    let (swell, _) = ps.swell(now);
                                    let energy_c = energy.clamp(0.0, 1.35);
                                    let active = !ps.idle(now);
                                    if active {
                                        moving = true;
                                    }
                                    if !reduced && swell.abs() > 0.002 {
                                        let sx = (shape.rect.w * 0.048).clamp(2.2, 5.2) * swell;
                                        let sy = (shape.rect.h * 0.056).clamp(1.6, 4.6) * swell;
                                        let cx = shape.rect.x + shape.rect.w * 0.5;
                                        let cy = shape.rect.y + shape.rect.h * 0.5;
                                        let lean_x = ((ps.x - cx) / (shape.rect.w * 0.5).max(1.0)).clamp(-1.0, 1.0) * 1.4 * swell;
                                        let lean_y = ((ps.y - cy) / (shape.rect.h * 0.5).max(1.0)).clamp(-1.0, 1.0) * 1.0 * swell;
                                        shape.rect.x -= sx - lean_x;
                                        shape.rect.y -= sy - lean_y;
                                        shape.rect.w = (shape.rect.w + sx * 2.0).max(4.0);
                                        shape.rect.h = (shape.rect.h + sy * 2.0).max(4.0);
                                        shape.radius = (shape.radius + sx.min(sy)).clamp(0.0, shape.rect.w.min(shape.rect.h) * 0.5);
                                    }
                                    if energy_c > 0.002 {
                                        lens.magnification += 0.03 * energy_c;
                                        lens.depth *= 1.0 + 0.16 * energy_c;
                                        lens.press = [ps.x, ps.y, energy_c, (now - ps.start_t).max(0.0) as f32];
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
                        if is_glass {
                            glass_layer_nodes.push((layers.len(), node));
                        }
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
            move_content(f.rt, eng, &rides);
        });
        self.was_down = is_down;
        morphs.retain(|_, m| std::mem::take(&mut m.seen));
        slides.retain(|_, s| std::mem::take(&mut s.seen));
        presses.retain(|_, p| std::mem::take(&mut p.seen) && !p.idle(now));
        WHOLE.with(|w| w.borrow_mut().retain(|n, _| morphs.contains_key(n)));
        if !closed.is_empty() {
            CLOSED.with(|c| c.borrow_mut().extend(closed));
            moving = true;
        }
        // Hide absorbed triggers' own glass layers so unified morphs draw one continuous surface.
        if !absorbed_glass_nodes.is_empty() {
            for &(layer_idx, node) in &glass_layer_nodes {
                if absorbed_glass_nodes.contains(&node) {
                    layers[layer_idx].opacity = 0.0;
                }
            }
        }
        // Landing, the blob is drawn as the button's own glass, under the button's icon coming back
        // (the menu's glass draws over the button).
        for (menu, trigger) in handed {
            let at = |n: u32| glass_layer_nodes.iter().find(|g| g.1 == n).map(|g| g.0);
            if let (Some(mi), Some(ti)) = (at(menu), at(trigger)) {
                layers[ti] = layers[mi].clone();
                layers[mi].opacity = 0.0;
            }
        }
        if want_hidden_triggers != self.last_hidden_triggers {
            self.last_hidden_triggers = want_hidden_triggers.clone();
            TRIGGER_SYNC.with(|sync| *sync.borrow_mut() = Some(want_hidden_triggers));
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
