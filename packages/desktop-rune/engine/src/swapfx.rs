//! Hot swap transitions where the interface changed. The host asks for one (`swapfx.begin`)
//! right before the new UI renders; the main window's compositor keeps the frame on screen then
//! (the "before") together with every shape Rune painted in it. Once the swap's commit has landed
//! and the new tree has gone quiet, the shapes painted now are set-diffed against the kept ones by
//! content (kind, size, corners, colours, glyph or image), not by element ids:
//!
//! - a shape in both at the same place is untouched;
//! - shapes that moved together (a pushed layout) slide from where they were;
//! - a scroll container's content that moved as one is the user scrolling, not the swap;
//! - a box replaced in the same spot morphs its shape and crossfades into the new one;
//! - a shape only in the before dissolves out, one only in the new tree comes into focus, each in
//!   its own shape;
//! - a change over most of the window transitions all of it.
//!
//! The engine runs every frame of it; TS sends two commands and hears when the after is taken
//! (`{"t":"swapfx"}`), so it can hold live updates back until then. Costs nothing at rest: the
//! slot, the compositor's engagement and the textures exist only while a swap is in flight.

use std::cell::{Cell, RefCell};
use std::collections::{HashMap, VecDeque};
use std::hash::{Hash, Hasher};
use std::time::{Duration, Instant};

use rune::render::{EffectPhase, Instance, Kind};
use rune::{El, Spring};

use crate::engine::Engine;

/// The swap slot's effect mark: no node id comes near it.
pub const MARK: u32 = 0xFFFF_FFF8;
/// Past this share of the window changed, or this much changed or moved, all of it transitions.
const WHOLE_SHARE: f32 = 0.4;
const WHOLE_MOVED_SHARE: f32 = 0.7;
/// Displacements shared by fewer shapes than this are not a move; more groups than this are a
/// rewritten layout.
const MIN_VOTES: usize = 3;
const MAX_SLIDES: usize = 8;
const MAX_RECS: usize = 24_000;
/// Device pixels per cell of the grid that measures changed area and groups changes.
const GRID: f32 = 8.0;
/// What the old picture and the new one blur by (points), as Electron's focus pull.
const OUT_BLUR_PT: f32 = 12.0;
const OUT_END_BLUR_PT: f32 = 14.0;
const IN_BLUR_PT: f32 = 12.0;
const OUT_SECONDS: f32 = 0.18;
const IN_DELAY: f32 = 0.09;
const IN_SPRING: Spring = Spring::new(0.34, 0.0);
const MORPH_SPRING: Spring = Spring::new(0.45, 0.12);
/// A swap whose commit never lands (a build that failed without a cancel) stops waiting.
const HAVE_MAX: Duration = Duration::from_secs(5);
/// A swap commit that comes before the before was kept waits at most this long for it.
pub const WANT_MAX: Duration = Duration::from_millis(120);
/// The new tree is diffed once no commit has landed for this long (layout-driven re-renders
/// follow a swap's first frame), or this long after it landed at the latest.
const QUIET: Duration = Duration::from_millis(24);
const SETTLE_MAX: Duration = Duration::from_millis(250);
const MIPS: u32 = 7;
/// Bytes per record in the shader's `Rec`.
const REC_BYTES: usize = 64;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Stage {
    /// Waiting for a frame to keep as the before.
    Want,
    /// The before is kept (and refreshed each frame); waiting for the swap's commit.
    Have,
    /// The new tree is on screen under the before; waiting for it to go quiet.
    Land,
    /// The changed shapes are transitioning.
    Run,
}

thread_local! {
    static STAGE: Cell<Option<(Stage, Instant)>> = const { Cell::new(None) };
    /// The main window should rebuild (its slot came or went).
    static REBUILD: Cell<bool> = const { Cell::new(false) };
    /// When the last batch with tree ops was applied.
    static LAST_OPS: Cell<Option<Instant>> = const { Cell::new(None) };
}

/// A batch with tree ops was applied.
pub fn note_ops() {
    if active() {
        LAST_OPS.set(Some(Instant::now()));
    }
}

fn last_ops() -> Instant {
    LAST_OPS.get().unwrap_or_else(|| Instant::now() - Duration::from_secs(1))
}

pub fn stage() -> Option<Stage> {
    STAGE.get().map(|s| s.0)
}

fn set(stage: Option<Stage>) {
    let was = STAGE.get().map(|s| s.0);
    STAGE.set(stage.map(|s| (s, Instant::now())));
    if was.is_none() != stage.is_none() {
        REBUILD.set(true);
        crate::windows::wake_all();
    }
    let deciding = |s: Option<Stage>| matches!(s, Some(Stage::Want | Stage::Have | Stage::Land));
    if deciding(was) && !deciding(stage) {
        crate::windows::send_any_thread(serde_json::json!({ "t": "swapfx", "stage": if stage.is_some() { "run" } else { "none" } }));
    }
}

fn since() -> Duration {
    STAGE.get().map_or(Duration::ZERO, |s| s.1.elapsed())
}

/// `swapfx.begin`: keep what the main window shows now as the swap's before.
pub fn begin(e: &mut Engine) {
    if matches!(stage(), Some(Stage::Land | Stage::Run)) {
        // A swap during a transition keeps the before it started from.
        return;
    }
    set(Some(Stage::Want));
    touch_main(e);
}

/// `swapfx.cancel`: the swap failed; nothing transitions.
pub fn cancel(e: &mut Engine) {
    if matches!(stage(), Some(Stage::Want | Stage::Have)) {
        set(None);
        touch_main(e);
    }
}

/// A swap commit arrived before the before was kept: the bridge holds it back a frame.
pub fn hold_commit() -> bool {
    stage() == Some(Stage::Want) && since() < WANT_MAX
}

/// A hot swap's commit is being applied (its ops are in this batch).
pub fn landed() {
    match stage() {
        Some(Stage::Have) => set(Some(Stage::Land)),
        Some(Stage::Want) => set(None),
        _ => {}
    }
}

fn touch_main(e: &mut Engine) {
    if let Some(m) = e.main_node {
        e.tree.touch(m);
    }
}

/// Whether the main window should rebuild because its slot came or went.
pub fn take_rebuild() -> bool {
    REBUILD.replace(false)
}

/// Whether the main window's compositor must draw (a swap is in flight).
pub fn active() -> bool {
    STAGE.get().is_some()
}

/// The slot over the main window while a swap is in flight: above everything, given what is
/// painted under it as its backdrop.
pub fn slot() -> Option<El> {
    active().then(|| {
        rune::effect(MARK)
            .effect_data([9.0, 0.0, 0.0, 0.0])
            .effect_backdrop(true)
            .pin(Some(0.0), Some(0.0), Some(0.0), Some(0.0))
            .raise()
            .paint_order(i16::MAX)
            .transition(rune::Transition::none())
            .key("stella-swapfx")
    })
}

fn debug() -> Option<std::ffi::OsString> {
    std::env::var_os("STELLA_RUNE_SWAP_FX_DEBUG")
}

/// One shape Rune painted, in device pixels.
#[derive(Clone, Copy, Debug)]
struct Prim {
    /// What it looks like, wherever it is.
    key: u64,
    /// Its shape alone, whatever its colour.
    form: u64,
    /// Its rect's corner, where it is.
    at: [f32; 2],
    /// What it covers on screen: x0, y0, x1, y1.
    vis: [f32; 4],
    /// Its whole rect, clipped or not: x0, y0, x1, y1.
    full: [f32; 4],
    /// What its clips leave of the window: x0, y0, x1, y1.
    clip: [f32; 4],
    radius: f32,
    /// Its place in the paint order.
    order: u32,
    glyph: bool,
    /// A box that can morph into another (a rect, gradient, image, glass).
    boxy: bool,
    kind: u8,
}

fn q(v: f32, step: f32) -> i32 {
    (v / step).round() as i32
}

fn overlaps(a: [f32; 4], b: [f32; 4]) -> bool {
    a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]
}

/// Every shape the frame paints, but the swap's own slot and what nothing can see.
fn painted(list: &[Instance], size: (u32, u32), caret: Option<[f32; 4]>) -> Vec<Prim> {
    let (w, h) = (size.0 as f32, size.1 as f32);
    let mut out = Vec::with_capacity(list.len());
    for (order, inst) in list.iter().enumerate() {
        let Some(kind) = inst.kind() else { continue };
        let r = inst.rect;
        let own = [r[0], r[1], r[0] + r[2], r[1] + r[3]];
        let (bounds, boxy) = match kind {
            Kind::Layer | Kind::LayerEnd => continue,
            Kind::Effect => {
                let mark = inst.border[0] as u32 | ((inst.border[1] as u32) << 16);
                if mark == MARK {
                    continue;
                }
                (own, true)
            }
            Kind::BackdropBlur => (own, true),
            _ => match inst.quad_bounds() {
                Some(b) => (b, matches!(kind, Kind::Rect | Kind::Gradient | Kind::Image | Kind::Dashed | Kind::Inset | Kind::Radial)),
                None => continue,
            },
        };
        let seen = match kind {
            Kind::Rect | Kind::Dashed => inst.fill[3] > 0.004 || (inst.params[0] > 0.0 && inst.border[3] > 0.004),
            Kind::Gradient => inst.fill[3] > 0.004 || inst.uv[3] > 0.004,
            Kind::Effect | Kind::BackdropBlur => true,
            _ => inst.fill[3] > 0.004,
        };
        if !seen {
            continue;
        }
        let c = inst.clip;
        let clip = [c[0].max(0.0), c[1].max(0.0), c[2].min(w), c[3].min(h)];
        let vis = [bounds[0].max(clip[0]), bounds[1].max(clip[1]), bounds[2].min(clip[2]), bounds[3].min(clip[3])];
        if vis[2] - vis[0] < 0.5 || vis[3] - vis[1] < 0.5 {
            continue;
        }
        if kind == Kind::Rect && r[2] <= 3.0 && caret.is_some_and(|k| overlaps(vis, k)) {
            continue;
        }
        let mut hs = std::collections::hash_map::DefaultHasher::new();
        (kind as u8).hash(&mut hs);
        for v in [r[2], r[3]].into_iter().chain(inst.radii) {
            q(v, 0.25).hash(&mut hs);
        }
        let mut shape = hs.clone();
        if kind == Kind::Glyph {
            inst.uv.map(f32::to_bits).hash(&mut shape);
        }
        let form = shape.finish();
        for v in inst.fill {
            q(v, 1.0 / 64.0).hash(&mut hs);
        }
        match kind {
            Kind::Glyph => inst.uv.map(f32::to_bits).hash(&mut hs),
            // Where an image sits in the atlas changes when its element remounts; its size does not.
            Kind::Image => [inst.uv[2], inst.uv[3]].map(f32::to_bits).hash(&mut hs),
            Kind::Effect => {
                inst.uv.map(f32::to_bits).hash(&mut hs);
                [inst.border[0], inst.border[1]].map(f32::to_bits).hash(&mut hs);
            }
            Kind::Gradient => inst.uv.map(|v| q(v, 1.0 / 64.0)).hash(&mut hs),
            _ => {}
        }
        if matches!(kind, Kind::Rect | Kind::Gradient | Kind::Dashed | Kind::Radial | Kind::Shadow) {
            inst.border.map(|v| q(v, 1.0 / 64.0)).hash(&mut hs);
        }
        [q(inst.params[0], 0.25), q(inst.params[2], 0.25), q(inst.params[3], 1.0 / 64.0)].hash(&mut hs);
        let radius = if kind == Kind::Glyph { 0.0 } else { inst.radii.iter().fold(0.0f32, |m, v| m.max(v.abs())) };
        out.push(Prim { key: hs.finish(), form, at: [r[0], r[1]], vis, full: bounds, clip, radius, order: order as u32, glyph: kind == Kind::Glyph, boxy, kind: kind as u8 });
    }
    out
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Fate {
    /// In both, where it was.
    Same,
    /// Scrolled within its container (or in or out of view): the user, not the swap.
    Scrolled,
    /// Moved with its group (`slides[i]`).
    Slide(usize),
    /// Carried past its clip's edge with its group (`slides[i]`): out of view, or into it.
    Edge(usize),
    Gone,
    New,
    /// Replaced in place by the other side's shape.
    Morph(usize),
}

struct Diff {
    old: Vec<Fate>,
    new: Vec<Fate>,
    slides: Vec<Group>,
}

/// Shapes that moved by the same displacement.
struct Group {
    d: [f32; 2],
    /// A scroll container's content: the user scrolled, nothing to show.
    scroll: bool,
    /// One shape of its kind that moved on its own (a neighbour pushed aside).
    single: bool,
}

/// A scroll viewport whose offset changed between the before and the after: where it shows
/// (device pixels) and how far its content moved.
struct Scrolled {
    was: [f32; 4],
    vis: [f32; 4],
    moved: [f32; 2],
}

/// Each scroll viewport's visible rect and offset (device pixels), by its place in the tree.
fn viewports(rt: &rune::Runtime<crate::windows::Win>, scale: f32) -> HashMap<String, View> {
    let list = rt.elements();
    let mut out = HashMap::new();
    for (k, e) in list.iter().enumerate() {
        if !(e.scroll_axes[0] || e.scroll_axes[1]) || e.exiting {
            continue;
        }
        let Some(child) = list.iter().find(|c| c.parent == Some(k)) else { continue };
        let off = [(child.scrolled[0] - e.scrolled[0]) * scale, (child.scrolled[1] - e.scrolled[1]) * scale];
        out.insert(e.path.clone(), View { vis: e.visible.map(|v| v * scale), off, riding: e.scrolling || child.scrolling });
    }
    out
}

/// A scroll viewport in one frame: its visible rect (x, y, w, h) and offset, device pixels, and
/// whether a wheel, its momentum or a glide is carrying it.
#[derive(Clone, Copy)]
struct View {
    vis: [f32; 4],
    off: [f32; 2],
    riding: bool,
}

/// The viewports a scroll moved between two snapshots. An offset the swap's own layout moved
/// (a list held to its bottom as its viewport shrinks) is the swap's, and transitions with it.
fn scrolled(old: &HashMap<String, View>, new: &HashMap<String, View>) -> Vec<Scrolled> {
    new.iter()
        .filter_map(|(path, n)| {
            let o = old.get(path)?;
            let moved = [o.off[0] - n.off[0], o.off[1] - n.off[1]];
            let rect = |v: [f32; 4]| [v[0], v[1], v[0] + v[2], v[1] + v[3]];
            ((moved[0].abs() > 0.5 || moved[1].abs() > 0.5) && (o.riding || n.riding)).then_some(Scrolled { was: rect(o.vis), vis: rect(n.vis), moved })
        })
        .collect()
}

/// A single shape slides this far at most (device pixels); past it, it fades out and in.
const SINGLE_REACH: f32 = 160.0;

fn same_spot(a: [f32; 4], b: [f32; 4]) -> bool {
    (0..4).all(|i| (a[i] - b[i]).abs() <= 2.0)
}

/// Matches the shapes painted before and after the swap by what they look like.
fn diff(old: &[Prim], new: &[Prim], lively: &[[f32; 4]], scrolls: &[Scrolled]) -> Diff {
    let mut fo = vec![Fate::Gone; old.len()];
    let mut fnew = vec![Fate::New; new.len()];
    let mut at: HashMap<(u64, i32, i32), Vec<usize>> = HashMap::new();
    for (i, p) in old.iter().enumerate().rev() {
        at.entry((p.key, q(p.at[0], 0.5), q(p.at[1], 0.5))).or_default().push(i);
    }
    for (j, p) in new.iter().enumerate() {
        if let Some(i) = at.get_mut(&(p.key, q(p.at[0], 0.5), q(p.at[1], 0.5))).and_then(Vec::pop) {
            fo[i] = Fate::Same;
            fnew[j] = Fate::Same;
        }
    }

    // Moves: displacements voted for by shapes rare enough to pair, then each taken in turn.
    let mut by_key: HashMap<u64, Vec<usize>> = HashMap::new();
    for (i, p) in old.iter().enumerate().filter(|(i, _)| fo[*i] == Fate::Gone) {
        by_key.entry(p.key).or_default().push(i);
    }
    let mut votes: HashMap<(i32, i32), usize> = HashMap::new();
    for (_, p) in new.iter().enumerate().filter(|(j, _)| fnew[*j] == Fate::New) {
        let Some(c) = by_key.get(&p.key).filter(|c| c.len() <= 6) else { continue };
        for &i in c {
            *votes.entry((q(p.at[0] - old[i].at[0], 1.0), q(p.at[1] - old[i].at[1], 1.0))).or_default() += 1;
        }
    }
    let mut cands: Vec<((i32, i32), usize)> = votes.into_iter().filter(|(d, n)| *n >= MIN_VOTES && *d != (0, 0)).collect();
    cands.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    cands.truncate(32);
    let mut slides: Vec<Group> = Vec::new();
    for (d, _) in cands {
        let mut left: HashMap<(u64, i32, i32), Vec<usize>> = HashMap::new();
        for (i, p) in old.iter().enumerate().filter(|(i, _)| fo[*i] == Fate::Gone) {
            left.entry((p.key, q(p.at[0], 1.0), q(p.at[1], 1.0))).or_default().push(i);
        }
        let mut pairs = Vec::new();
        for (j, p) in new.iter().enumerate().filter(|(j, _)| fnew[*j] == Fate::New) {
            let (x, y) = (q(p.at[0], 1.0) - d.0, q(p.at[1], 1.0) - d.1);
            let hit = [(0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)].into_iter().find_map(|(ox, oy)| left.get_mut(&(p.key, x + ox, y + oy)).and_then(Vec::pop));
            if let Some(i) = hit {
                pairs.push((i, j));
            }
        }
        if pairs.len() < MIN_VOTES {
            for (i, _) in pairs {
                let p = old[i];
                left.entry((p.key, q(p.at[0], 1.0), q(p.at[1], 1.0))).or_default().push(i);
            }
            continue;
        }
        let c = slides.len();
        slides.push(Group { d: [d.0 as f32, d.1 as f32], scroll: false, single: false });
        for (i, j) in pairs {
            fo[i] = Fate::Slide(c);
            fnew[j] = Fate::Slide(c);
        }
    }

    // What moved with a scroll viewport's own offset is the user scrolling; what scrolled in or
    // out of view with it came and went with the scroll, not the swap.
    for v in scrolls {
        let within = |r: [f32; 4], c: [f32; 4]| {
            let (cx, cy) = ((r[0] + r[2]) * 0.5, (r[1] + r[3]) * 0.5);
            cx >= c[0] && cx <= c[2] && cy >= c[1] && cy <= c[3]
        };
        let d = v.moved;
        for (c, g) in slides.iter_mut().enumerate() {
            if (g.d[0] - d[0]).abs() > 1.5 || (g.d[1] - d[1]).abs() > 1.5 {
                continue;
            }
            g.scroll = true;
            for (j, p) in new.iter().enumerate() {
                if fnew[j] == Fate::Slide(c) && within(p.vis, v.vis) {
                    fnew[j] = Fate::Scrolled;
                }
            }
            for (i, p) in old.iter().enumerate() {
                if fo[i] == Fate::Slide(c) && within(p.vis, v.was) {
                    fo[i] = Fate::Scrolled;
                }
            }
        }
        for (i, p) in old.iter().enumerate() {
            let shifted = [p.vis[0] + d[0], p.vis[1] + d[1], p.vis[2] + d[0], p.vis[3] + d[1]];
            if fo[i] == Fate::Gone && within(p.vis, v.was) && !overlaps(shifted, v.vis) {
                fo[i] = Fate::Scrolled;
            }
        }
        for (j, p) in new.iter().enumerate() {
            let back = [p.vis[0] - d[0], p.vis[1] - d[1], p.vis[2] - d[0], p.vis[3] - d[1]];
            if fnew[j] == Fate::New && within(p.vis, v.vis) && !overlaps(back, v.was) {
                fnew[j] = Fate::Scrolled;
            }
        }
    }

    // Inside a clip whose content moved as one, what moved past the clip's edge went with it.
    let ck = |c: [f32; 4]| c.map(|v| q(v, 1.0));
    let mut by_clip: HashMap<[i32; 4], HashMap<usize, usize>> = HashMap::new();
    for (p, f) in old.iter().zip(&fo).chain(new.iter().zip(&fnew)) {
        if let Fate::Slide(c) = f {
            *by_clip.entry(ck(p.clip)).or_default().entry(*c).or_default() += 1;
        }
    }
    let group_of: HashMap<[i32; 4], usize> = by_clip.into_iter().filter_map(|(k, v)| v.into_iter().max_by_key(|(c, n)| (*n, usize::MAX - c)).map(|(c, _)| (k, c))).collect();
    let past = |p: &Prim, d: [f32; 2]| {
        let r = [p.full[0] + d[0], p.full[1] + d[1], p.full[2] + d[0], p.full[3] + d[1]];
        !overlaps(r, p.clip)
    };
    for (i, p) in old.iter().enumerate() {
        if let (Fate::Gone, Some(&c)) = (fo[i], group_of.get(&ck(p.clip)))
            && past(p, slides[c].d)
        {
            fo[i] = if slides[c].scroll { Fate::Scrolled } else { Fate::Edge(c) };
        }
    }
    for (j, p) in new.iter().enumerate() {
        if let (Fate::New, Some(&c)) = (fnew[j], group_of.get(&ck(p.clip)))
            && past(p, [-slides[c].d[0], -slides[c].d[1]])
        {
            fnew[j] = if slides[c].scroll { Fate::Scrolled } else { Fate::Edge(c) };
        }
    }

    // One of a kind gone here and come there, nearby: it moved on its own.
    let mut gone_by: HashMap<u64, Vec<usize>> = HashMap::new();
    let mut new_by: HashMap<u64, Vec<usize>> = HashMap::new();
    for (i, p) in old.iter().enumerate().filter(|(i, _)| fo[*i] == Fate::Gone) {
        gone_by.entry(p.key).or_default().push(i);
    }
    for (j, p) in new.iter().enumerate().filter(|(j, _)| fnew[*j] == Fate::New) {
        new_by.entry(p.key).or_default().push(j);
    }
    for (key, js) in &new_by {
        let (&[j], Some(&[i])) = (js.as_slice(), gone_by.get(key).map(Vec::as_slice)) else { continue };
        let d = [new[j].at[0] - old[i].at[0], new[j].at[1] - old[i].at[1]];
        if d[0].hypot(d[1]) > SINGLE_REACH {
            continue;
        }
        fo[i] = Fate::Slide(slides.len());
        fnew[j] = Fate::Slide(slides.len());
        slides.push(Group { d, scroll: false, single: true });
    }

    // Something animating by itself (a shimmering "Working…") that moved with its group goes with it.
    if !lively.is_empty() {
        let mut came: HashMap<(u64, i32, i32), Vec<usize>> = HashMap::new();
        for (j, p) in new.iter().enumerate().filter(|(j, _)| fnew[*j] == Fate::New) {
            came.entry((p.form, q(p.at[0], 1.0), q(p.at[1], 1.0))).or_default().push(j);
        }
        for (i, p) in old.iter().enumerate() {
            if fo[i] != Fate::Gone || !lively.iter().any(|l| same_spot(*l, p.vis)) {
                continue;
            }
            for (c, g) in slides.iter().enumerate().filter(|(_, g)| !g.scroll && !g.single) {
                let (x, y) = (q(p.at[0] + g.d[0], 1.0), q(p.at[1] + g.d[1], 1.0));
                let hit = [(0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)].into_iter().find_map(|(ox, oy)| came.get_mut(&(p.form, x + ox, y + oy)).and_then(Vec::pop));
                if let Some(j) = hit {
                    fo[i] = Fate::Slide(c);
                    fnew[j] = Fate::Slide(c);
                    break;
                }
            }
        }
    }

    // What changes by itself in place (a blinking mascot, a spinner, the caret) is not the swap.
    for (i, p) in old.iter().enumerate() {
        if fo[i] == Fate::Gone && lively.iter().any(|l| same_spot(*l, p.vis)) {
            fo[i] = Fate::Same;
        }
    }
    for (j, p) in new.iter().enumerate() {
        if fnew[j] == Fate::New && lively.iter().any(|l| same_spot(*l, p.vis)) {
            fnew[j] = Fate::Same;
        }
    }

    // A box gone where a box came is that box changing: it morphs.
    const CELL: f32 = 64.0;
    let mut grid: HashMap<(i32, i32), Vec<usize>> = HashMap::new();
    for (j, p) in new.iter().enumerate().filter(|(j, p)| fnew[*j] == Fate::New && p.boxy) {
        for gy in (p.vis[1] / CELL) as i32..=(p.vis[3] / CELL) as i32 {
            for gx in (p.vis[0] / CELL) as i32..=(p.vis[2] / CELL) as i32 {
                grid.entry((gx, gy)).or_default().push(j);
            }
        }
    }
    let area = |r: [f32; 4]| (r[2] - r[0]).max(0.0) * (r[3] - r[1]).max(0.0);
    let mut gone: Vec<usize> = (0..old.len()).filter(|&i| fo[i] == Fate::Gone && old[i].boxy).collect();
    gone.sort_by(|a, b| area(old[*b].vis).total_cmp(&area(old[*a].vis)));
    for i in gone {
        let a = old[i].vis;
        let mut best: Option<(f32, usize)> = None;
        for gy in (a[1] / CELL) as i32..=(a[3] / CELL) as i32 {
            for gx in (a[0] / CELL) as i32..=(a[2] / CELL) as i32 {
                for &j in grid.get(&(gx, gy)).map_or(&[][..], Vec::as_slice) {
                    if fnew[j] != Fate::New {
                        continue;
                    }
                    let b = new[j].vis;
                    let inter = area([a[0].max(b[0]), a[1].max(b[1]), a[2].min(b[2]), a[3].min(b[3])]);
                    let iou = inter / (area(a) + area(b) - inter).max(1.0);
                    if iou >= 0.3 && best.is_none_or(|(s, _)| iou > s) {
                        best = Some((iou, j));
                    }
                }
            }
        }
        if let Some((_, j)) = best {
            fo[i] = Fate::Morph(j);
            fnew[j] = Fate::Morph(i);
        }
    }
    Diff { old: fo, new: fnew, slides }
}

/// One shape's transition (`Rec` in the WGSL): `a` where it starts, `b` where it ends (x, y, w,
/// h), `p` = radius at a, radius at b, mode, blur share; `c` the clip it never leaves (x0, y0,
/// x1, y1).
#[derive(Clone, Copy, Debug)]
struct Rec {
    a: [f32; 4],
    b: [f32; 4],
    p: [f32; 4],
    c: [f32; 4],
}

const UNCLIPPED: [f32; 4] = [-1e6, -1e6, 1e6, 1e6];

const HOLE: f32 = 0.0;
const SLIDE: f32 = 1.0;
const FADE: f32 = 2.0;
const MORPH: f32 = 3.0;
/// A slide of the before (what slid out of view).
const SLIDE_OLD: f32 = 4.0;

fn xywh(v: [f32; 4], pad: f32) -> [f32; 4] {
    [v[0] - pad, v[1] - pad, v[2] - v[0] + 2.0 * pad, v[3] - v[1] + 2.0 * pad]
}

/// What the swap does: nothing, the whole window, or these shapes (in drawing order: morphs,
/// the spots slides are headed for, slides, then what fades).
enum Outcome {
    Nothing,
    Whole(&'static str),
    Local(Vec<Rec>),
}

/// Each clip whose content moves, less the bands along its top and bottom edges where something
/// that stays is painted over it (a top bar over a chat): moving content neither shows there nor
/// brings those bands' pixels along.
fn uncovered(list: &[Prim], fates: &[Fate], out: &mut HashMap<[i32; 4], [f32; 4]>) {
    let ck = |c: [f32; 4]| c.map(|v| q(v, 1.0));
    let mut moving: HashMap<[i32; 4], ([f32; 4], u32)> = HashMap::new();
    for (p, f) in list.iter().zip(fates) {
        if matches!(f, Fate::Slide(_) | Fate::Edge(_)) {
            let e = moving.entry(ck(p.clip)).or_insert((p.clip, p.order));
            e.1 = e.1.min(p.order);
        }
    }
    for (key, (c, first)) in moving {
        let (mut top, mut bottom) = (c[1], c[3]);
        let edge = (c[3] - c[1]) * 0.15;
        for (p, f) in list.iter().zip(fates) {
            if *f != Fate::Same || p.order < first || !overlaps(p.vis, c) {
                continue;
            }
            if p.vis[3] <= c[1] + edge {
                top = top.max(p.vis[3]);
            } else if p.vis[1] >= c[3] - edge {
                bottom = bottom.min(p.vis[1]);
            }
        }
        if bottom - top >= (c[3] - c[1]) * 0.5 && (top > c[1] || bottom < c[3]) {
            out.insert(key, [c[0], top, c[2], bottom]);
        }
    }
}

fn outcome(old: &[Prim], new: &[Prim], d: &Diff, scale: f32, size: (u32, u32)) -> Outcome {
    let mut bands = HashMap::new();
    uncovered(old, &d.old, &mut bands);
    uncovered(new, &d.new, &mut bands);
    if debug().is_some() {
        eprintln!("stella-engine: swapfx: bands {bands:?}");
    }
    let clip_of = |p: &Prim| bands.get(&p.clip.map(|v| q(v, 1.0))).copied().unwrap_or(p.clip);
    let pad = |p: &Prim| if p.glyph { 1.5 * scale } else { scale };
    let mut morphs = Vec::new();
    let mut holes = Vec::new();
    let mut slides = Vec::new();
    let mut fades = Vec::new();
    let mut edges = Vec::new();
    for (i, p) in old.iter().enumerate() {
        match d.old[i] {
            Fate::Gone => fades.push(Rec { a: xywh(p.vis, pad(p)), b: xywh(p.vis, pad(p)), p: [p.radius + pad(p), 0.0, FADE, 1.0], c: p.clip }),
            Fate::Morph(j) => {
                let n = &new[j];
                morphs.push(Rec { a: xywh(p.vis, 0.0), b: xywh(n.vis, 0.0), p: [p.radius, n.radius, MORPH, 1.0], c: UNCLIPPED });
            }
            Fate::Edge(c) => {
                let from = xywh(p.vis, 0.0);
                let dv = d.slides[c].d;
                edges.push(Rec { a: from, b: [from[0] + dv[0], from[1] + dv[1], from[2], from[3]], p: [p.radius, p.radius, SLIDE_OLD, 0.0], c: clip_of(p) });
            }
            _ => {}
        }
    }
    for (j, p) in new.iter().enumerate() {
        match d.new[j] {
            Fate::New => fades.push(Rec { a: xywh(p.vis, pad(p)), b: xywh(p.vis, pad(p)), p: [p.radius + pad(p), 0.0, FADE, 1.0], c: p.clip }),
            Fate::Slide(c) if !d.slides[c].scroll => {
                // A pixel wider: glyphs sit at fractions of a pixel, and their edges must move too.
                let to = xywh(p.vis, 1.0);
                let dv = d.slides[c].d;
                let from = [to[0] - dv[0], to[1] - dv[1], to[2], to[3]];
                holes.push(Rec { a: to, b: to, p: [p.radius, p.radius, HOLE, 0.0], c: clip_of(p) });
                slides.push(Rec { a: from, b: to, p: [p.radius, p.radius, SLIDE, 0.0], c: clip_of(p) });
            }
            Fate::Edge(c) => {
                let to = xywh(p.vis, 0.0);
                let dv = d.slides[c].d;
                edges.push(Rec { a: [to[0] - dv[0], to[1] - dv[1], to[2], to[3]], b: to, p: [p.radius, p.radius, SLIDE, 0.0], c: clip_of(p) });
            }
            _ => {}
        }
    }
    // A shape moving on or off something that morphs or fades (lying mostly on it) goes with it,
    // not on its own.
    let rect = |r: [f32; 4]| [r[0], r[1], r[0] + r[2], r[1] + r[3]];
    let mut buckets: HashMap<(i32, i32), Vec<[f32; 4]>> = HashMap::new();
    for r in morphs.iter().flat_map(|m| [m.a, m.b]).chain(fades.iter().map(|f| f.a)) {
        let v = rect(r);
        for gy in (v[1] / 64.0) as i32..=(v[3] / 64.0) as i32 {
            for gx in (v[0] / 64.0) as i32..=(v[2] / 64.0) as i32 {
                buckets.entry((gx, gy)).or_default().push(v);
            }
        }
    }
    let on_change = |r: [f32; 4]| {
        let v = rect(r);
        let half = r[2] * r[3] * 0.5;
        let lies_on = |c: &[f32; 4]| (c[2].min(v[2]) - c[0].max(v[0])).max(0.0) * (c[3].min(v[3]) - c[1].max(v[1])).max(0.0) >= half;
        (v[1] as i32 / 64..=v[3] as i32 / 64).any(|gy| (v[0] as i32 / 64..=v[2] as i32 / 64).any(|gx| buckets.get(&(gx, gy)).is_some_and(|list| list.iter().any(lies_on))))
    };
    let carried: Vec<bool> = slides.iter().map(|s| on_change(s.a) || on_change(s.b)).collect();
    let mut keep = carried.iter().map(|c| !c);
    holes.retain(|_| keep.next().unwrap_or(true));
    let mut keep = carried.iter().map(|c| !c);
    slides.retain(|_| keep.next().unwrap_or(true));
    let groups = d.slides.iter().filter(|g| !g.scroll && !g.single).count();
    if morphs.is_empty() && fades.is_empty() && slides.is_empty() && edges.is_empty() {
        return Outcome::Nothing;
    }
    if groups > MAX_SLIDES {
        return Outcome::Whole("rewritten layout");
    }
    let n = morphs.len() + holes.len() + slides.len() + edges.len() + fades.len();
    if n > MAX_RECS {
        return Outcome::Whole("too many shapes");
    }

    // Changed and moved area on a grid; connected changes share one blur, sized by their extent.
    let (cols, rows) = ((size.0 as f32 / GRID).ceil() as usize, (size.1 as f32 / GRID).ceil() as usize);
    let mut changed = vec![0u32; cols * rows];
    let mut moved = vec![false; cols * rows];
    let cells = |r: [f32; 4]| {
        let x0 = (r[0] / GRID).floor().max(0.0) as usize;
        let y0 = (r[1] / GRID).floor().max(0.0) as usize;
        let x1 = ((r[0] + r[2]) / GRID).ceil().clamp(0.0, cols as f32) as usize;
        let y1 = ((r[1] + r[3]) / GRID).ceil().clamp(0.0, rows as f32) as usize;
        (x0, y0, x1, y1)
    };
    for r in morphs.iter().flat_map(|m| [m.a, m.b]).chain(fades.iter().map(|f| f.a)) {
        let (x0, y0, x1, y1) = cells(r);
        for y in y0..y1 {
            for x in x0..x1 {
                changed[y * cols + x] = u32::MAX;
            }
        }
    }
    for r in slides.iter().chain(&edges).flat_map(|s| [s.a, s.b]) {
        let (x0, y0, x1, y1) = cells(r);
        for y in y0..y1 {
            for x in x0..x1 {
                moved[y * cols + x] = true;
            }
        }
    }
    let total = (cols * rows).max(1) as f32;
    let changed_n = changed.iter().filter(|c| **c != 0).count() as f32;
    let either_n = changed.iter().zip(&moved).filter(|(c, m)| **c != 0 || **m).count() as f32;
    if changed_n / total > WHOLE_SHARE {
        return Outcome::Whole("most of it changed");
    }
    if either_n / total > WHOLE_MOVED_SHARE {
        return Outcome::Whole("most of it changed or moved");
    }
    let mut blur_of = Vec::new();
    let mut queue = VecDeque::new();
    for start in 0..changed.len() {
        if changed[start] != u32::MAX {
            continue;
        }
        let id = blur_of.len() as u32;
        let (mut x0, mut y0, mut x1, mut y1) = (usize::MAX, usize::MAX, 0, 0);
        changed[start] = id + 1;
        queue.push_back(start);
        while let Some(k) = queue.pop_front() {
            let (x, y) = (k % cols, k / cols);
            (x0, y0, x1, y1) = (x0.min(x), y0.min(y), x1.max(x), y1.max(y));
            let mut visit = |k: usize| {
                if changed[k] == u32::MAX {
                    changed[k] = id + 1;
                    queue.push_back(k);
                }
            };
            if x > 0 {
                visit(k - 1);
            }
            if x + 1 < cols {
                visit(k + 1);
            }
            if y > 0 {
                visit(k - cols);
            }
            if y + 1 < rows {
                visit(k + cols);
            }
        }
        let side = ((x1 - x0 + 1).min(y1 - y0 + 1)) as f32 * GRID / scale;
        blur_of.push((side / 64.0).clamp(0.3, 1.0));
    }
    for r in morphs.iter_mut().chain(fades.iter_mut()) {
        let cx = ((r.a[0] + r.a[2] * 0.5) / GRID).clamp(0.0, cols as f32 - 1.0) as usize;
        let cy = ((r.a[1] + r.a[3] * 0.5) / GRID).clamp(0.0, rows as f32 - 1.0) as usize;
        let id = changed[cy * cols + cx];
        r.p[3] = if id == 0 || id == u32::MAX { 0.5 } else { blur_of[(id - 1) as usize] };
    }
    fades.sort_by(|a, b| (b.a[2] * b.a[3]).total_cmp(&(a.a[2] * a.a[3])));
    let mut recs = morphs;
    recs.extend(holes);
    recs.extend(slides);
    recs.extend(edges);
    recs.extend(fades);
    Outcome::Local(recs)
}

/// The transition's values at `t` seconds: the old picture's opacity and blur, and the new
/// one's blur, each 0..1 of its full amount; and the shape morph's progress.
fn timeline(t: f32) -> (f32, f32, f32, f32, bool) {
    let u = (t / OUT_SECONDS).clamp(0.0, 1.0);
    let (a_out, b_out) = if u < 0.55 {
        let k = u / 0.55;
        (1.0, k * k * OUT_BLUR_PT / OUT_END_BLUR_PT)
    } else {
        let k = (u - 0.55) / 0.45;
        (1.0 - k, (OUT_BLUR_PT + (OUT_END_BLUR_PT - OUT_BLUR_PT) * k) / OUT_END_BLUR_PT)
    };
    let ti = (t - IN_DELAY).max(0.0);
    let b_in = if t < IN_DELAY { 1.0 } else { IN_SPRING.sample(1.0, 0.0, 0.0, ti).0.max(0.0) };
    let morph = MORPH_SPRING.sample(0.0, 0.0, 1.0, t).0;
    let done = t >= OUT_SECONDS
        && ti >= IN_SPRING.settling_duration_from(1.0, 0.0, 0.0, 0.01)
        && t >= MORPH_SPRING.settling_duration_from(0.0, 0.0, 1.0, 0.002);
    (a_out, b_out, b_in, morph, done)
}

/// The compositor's side: GPU copies of the before and of the live frame (with mips for the
/// blur), the shapes painted in the before, and the transition's records.
pub struct Swap {
    gpu: Option<Gpu>,
    res: Option<Res>,
    old: Vec<Prim>,
    old_views: HashMap<String, View>,
    /// The last frame's shapes, when they were taken, and where shapes changed by themselves
    /// from one frame to the next with no commit between (live, not the swap).
    prev: Vec<Prim>,
    prev_at: Instant,
    lively: Vec<[f32; 4]>,
    land_at: Option<Instant>,
    whole: bool,
    /// Records, and their GPU copy with the bind groups reading it.
    recs: usize,
    bound: Option<Bound>,
    t0: f64,
    uniform: [f32; 8],
    /// What the hook does this frame.
    plan: Plan,
}

#[derive(Clone, Copy, Default, PartialEq, Eq, Debug)]
enum Plan {
    #[default]
    Nothing,
    /// Keep the backdrop as the before.
    Keep,
    /// Draw the before over everything.
    Cover,
    /// Copy the live frame, find each pixel's shape, draw the transition.
    Run,
}

struct Gpu {
    key: rune::compose::DeviceKey,
    copy_layout: wgpu::BindGroupLayout,
    down_layout: wgpu::BindGroupLayout,
    index_layout: wgpu::BindGroupLayout,
    comp_layout: wgpu::BindGroupLayout,
    module: wgpu::ShaderModule,
    sampler: wgpu::Sampler,
    pipes: RefCell<HashMap<(&'static str, wgpu::TextureFormat), wgpu::RenderPipeline>>,
    uniform: wgpu::Buffer,
    /// Stands in for the records until a swap has some.
    no_recs: wgpu::Buffer,
}

/// Sized resources: the before and live textures (mipped), each pixel's record.
struct Res {
    size: (u32, u32),
    format: wgpu::TextureFormat,
    before: Mipped,
    live: Mipped,
    index: wgpu::TextureView,
    comp: wgpu::BindGroup,
}

/// Bind groups over one swap's records.
struct Bound {
    index: wgpu::BindGroup,
    comp: wgpu::BindGroup,
}

struct Mipped {
    full: wgpu::TextureView,
    levels: Vec<wgpu::TextureView>,
    downs: Vec<wgpu::BindGroup>,
}

impl Default for Swap {
    fn default() -> Swap {
        Swap { gpu: None, res: None, old: Vec::new(), old_views: HashMap::new(), prev: Vec::new(), prev_at: Instant::now(), lively: Vec::new(), land_at: None, whole: false, recs: 0, bound: None, t0: 0.0, uniform: [0.0; 8], plan: Plan::Nothing }
    }
}

impl Swap {
    pub fn engaged(&self) -> bool {
        active()
    }

    /// True while frames must keep coming (waiting for the new tree to settle, the transition).
    pub fn animating(&self) -> bool {
        matches!(stage(), Some(Stage::Land | Stage::Run))
    }

    /// After a swap: the pictures and shapes it kept go.
    pub fn settle(&mut self) {
        if self.res.is_some() || !self.old.is_empty() || !self.prev.is_empty() || self.bound.is_some() {
            self.res = None;
            self.old = Vec::new();
            self.old_views = HashMap::new();
            self.prev = Vec::new();
            self.lively = Vec::new();
            self.bound = None;
            self.recs = 0;
            self.land_at = None;
        }
    }

    pub fn release_gpu(&mut self) {
        self.gpu = None;
        self.res = None;
        self.bound = None;
    }

    /// Before the frame draws: moves the swap along and says what the slot's hook does.
    pub fn prepare(&mut self, f: &mut rune::compose::Frame<'_, crate::windows::Win>) {
        let key = f.device_key();
        if self.gpu.as_ref().is_none_or(|g| g.key != key) {
            self.res = None;
            self.bound = None;
            self.gpu = Some(Gpu::new(f.device, key));
        }
        let scale = f.rt.window_scale().max(0.5);
        let size = f.size;
        self.plan = match stage() {
            None => {
                self.settle();
                Plan::Nothing
            }
            Some(Stage::Want | Stage::Have) => {
                if stage() == Some(Stage::Have) && since() > HAVE_MAX {
                    set(None);
                    crate::engine::with(touch_main);
                    Plan::Nothing
                } else {
                    let snap = painted(&f.rt.instances, size, caret(f.rt.ime_area, scale));
                    self.watch(&snap);
                    self.old = snap;
                    self.old_views = viewports(f.rt, scale);
                    Plan::Keep
                }
            }
            Some(Stage::Land) if self.res.is_none() => {
                set(None);
                Plan::Nothing
            }
            Some(Stage::Land) => {
                let now = Instant::now();
                let landed = *self.land_at.get_or_insert(now);
                let snap = painted(&f.rt.instances, size, caret(f.rt.ime_area, scale));
                self.watch(&snap);
                if now - last_ops() >= QUIET || now - landed >= SETTLE_MAX {
                    self.start(f, scale, now - landed, snap)
                } else {
                    Plan::Cover
                }
            }
            Some(Stage::Run) => Plan::Run,
        };
        match self.plan {
            Plan::Cover => self.uniform = [size.0 as f32, size.1 as f32, (MIPS - 1) as f32, 2.0, 1.0, 0.0, 0.0, 0.0],
            Plan::Run => {
                let t = (f.rt.t - self.t0) as f32;
                let (a_out, b_out, b_in, morph, done) = timeline(if f.rt.system_reduced_motion() { 10.0 } else { t });
                self.uniform = [size.0 as f32, size.1 as f32, (MIPS - 1) as f32, if self.whole { 1.0 } else { 0.0 }, a_out, b_out * OUT_END_BLUR_PT * scale, b_in * IN_BLUR_PT * scale, morph];
                if done {
                    set(None);
                    crate::engine::with(touch_main);
                }
            }
            _ => {}
        }
        if let Some(g) = &self.gpu
            && matches!(self.plan, Plan::Cover | Plan::Run)
        {
            let bytes: Vec<u8> = self.uniform.iter().flat_map(|x| x.to_le_bytes()).collect();
            f.write_buffer(&g.uniform, 0, &bytes);
        }
    }

    /// The new tree has settled: its shapes against the before's decide what transitions.
    /// Notes where shapes changed since the last frame without a commit between.
    fn watch(&mut self, snap: &[Prim]) {
        if !self.prev.is_empty() && last_ops() <= self.prev_at {
            let spots = |list: &[Prim]| {
                let mut m: HashMap<[i32; 4], Vec<u64>> = HashMap::new();
                for p in list {
                    m.entry(p.vis.map(|v| q(v, 1.0))).or_default().push(p.key);
                }
                for keys in m.values_mut() {
                    keys.sort_unstable();
                }
                m
            };
            let (a, b) = (spots(&self.prev), spots(snap));
            // Only what changed where it is: a shape moving or resizing on a spring is the
            // swap's own change settling. Many at once is a scroll or a relayout.
            let changed: Vec<[f32; 4]> = a.iter().filter(|(k, v)| b.get(*k).is_some_and(|w| w != *v)).map(|(k, _)| k.map(|v| v as f32)).collect();
            if changed.len() <= 24 {
                for c in changed {
                    if !self.lively.iter().any(|l| same_spot(*l, c)) {
                        self.lively.push(c);
                    }
                }
            }
        }
        self.prev = snap.to_vec();
        self.prev_at = Instant::now();
    }

    fn start(&mut self, f: &mut rune::compose::Frame<'_, crate::windows::Win>, scale: f32, waited: Duration, new: Vec<Prim>) -> Plan {
        let size = f.size;
        let t = Instant::now();
        let views = scrolled(&self.old_views, &viewports(f.rt, scale));
        let d = diff(&self.old, &new, &self.lively, &views);
        let out = outcome(&self.old, &new, &d, scale, size);
        let cost = t.elapsed();
        let count = |fates: &[Fate], m: fn(&Fate) -> bool| fates.iter().filter(|f| m(f)).count();
        let summary = format!(
            "{} → {} shapes: same {}, moved {} in {} group(s), past a clip's edge {}, scrolled {}, gone {}, new {}, morphed {} (diff {:.1} ms)",
            self.old.len(),
            new.len(),
            count(&d.new, |f| *f == Fate::Same),
            count(&d.new, |f| matches!(f, Fate::Slide(_))),
            d.slides.iter().filter(|g| !g.scroll).count(),
            count(&d.old, |f| matches!(f, Fate::Edge(_))) + count(&d.new, |f| matches!(f, Fate::Edge(_))),
            count(&d.new, |f| *f == Fate::Scrolled),
            count(&d.old, |f| *f == Fate::Gone),
            count(&d.new, |f| *f == Fate::New),
            count(&d.new, |f| matches!(f, Fate::Morph(_))),
            cost.as_secs_f64() * 1000.0
        );
        if let Some(dir) = debug() {
            let dump = |name: &str, list: &[Prim], fates: &[Fate]| {
                let rows: Vec<String> = list
                    .iter()
                    .zip(fates)
                    .filter(|(_, f)| !matches!(f, Fate::Same | Fate::Scrolled))
                    .map(|(p, f)| format!("{:?} {:.0},{:.0},{:.0},{:.0} r{:.0} kind {}", f, p.vis[0], p.vis[1], p.vis[2] - p.vis[0], p.vis[3] - p.vis[1], p.radius, p.kind))
                    .collect();
                let _ = std::fs::write(std::path::Path::new(&dir).join(format!("{name}-{:.0}.txt", f.rt.t * 1000.0)), rows.join("\n"));
            };
            dump("before", &self.old, &d.old);
            dump("after", &new, &d.new);
        }
        self.whole = false;
        self.recs = 0;
        self.bound = None;
        self.t0 = f.rt.t;
        self.land_at = None;
        let verdict = match out {
            Outcome::Nothing => "nothing changed".to_string(),
            Outcome::Whole(why) => {
                self.whole = true;
                format!("whole window ({why})")
            }
            Outcome::Local(recs) => {
                self.recs = recs.len();
                if let (Some(g), Some(res)) = (&self.gpu, &self.res) {
                    self.bound = Some(g.bind(f.device, res, &recs));
                }
                format!("{} shapes", recs.len())
            }
        };
        eprintln!("stella-engine: swapfx: {verdict} after {:.1} ms; {summary}", waited.as_secs_f64() * 1000.0);
        if !self.lively.is_empty() {
            eprintln!("stella-engine: swapfx: live, not the swap: {}", self.lively.iter().map(|l| format!("{:.0},{:.0} {:.0}x{:.0}", l[0], l[1], l[2] - l[0], l[3] - l[1])).collect::<Vec<_>>().join(" | "));
        }
        self.old = Vec::new();
        self.old_views = HashMap::new();
        self.prev = Vec::new();
        self.lively = Vec::new();
        if !self.whole && self.bound.is_none() {
            set(None);
            crate::engine::with(touch_main);
            Plan::Nothing
        } else {
            set(Some(Stage::Run));
            Plan::Run
        }
    }

    /// The slot's hook: `phase` at the swap slot, `bd` what is painted under it.
    pub fn hook(&mut self, device: &wgpu::Device, phase: EffectPhase<'_, '_>, s: &rune::render::EffectSite<'_>) {
        let Some(gpu) = self.gpu.as_ref() else { return };
        match phase {
            EffectPhase::Backdrop(enc) => {
                let Some(bd) = s.backdrop else { return };
                let size = (s.size[0].max(1), s.size[1].max(1));
                if matches!(self.plan, Plan::Keep) && self.res.as_ref().is_none_or(|r| r.size != size || r.format != s.format) {
                    self.res = Some(Res::new(device, gpu, size, s.format));
                    self.bound = None;
                }
                let Some(res) = self.res.as_ref().filter(|r| r.size == size && r.format == s.format) else {
                    if !matches!(self.plan, Plan::Nothing) {
                        self.res = None;
                    }
                    return;
                };
                match self.plan {
                    Plan::Keep => {
                        gpu.copy(device, enc, bd, &res.before, s.format);
                        gpu.pipe(device, "comp", s.format);
                        gpu.pipe(device, "index", wgpu::TextureFormat::R32Uint);
                        if stage() == Some(Stage::Want) {
                            set(Some(Stage::Have));
                            crate::windows::wake_all();
                        }
                    }
                    Plan::Run => {
                        gpu.copy(device, enc, bd, &res.live, s.format);
                        if let Some(b) = &self.bound {
                            gpu.index(device, enc, &res.index, &b.index, self.recs as u32);
                        }
                    }
                    Plan::Cover | Plan::Nothing => {}
                }
            }
            EffectPhase::Draw(pass) => {
                if !matches!(self.plan, Plan::Cover | Plan::Run) {
                    return;
                }
                let Some(res) = self.res.as_ref() else { return };
                let pipe = gpu.pipe(device, "comp", s.format);
                pass.set_pipeline(&pipe);
                pass.set_bind_group(0, self.bound.as_ref().map_or(&res.comp, |b| &b.comp), &[]);
                pass.draw(0..3, 0..1);
            }
        }
    }
}

/// The text caret's neighbourhood (device pixels): its blink is not a change.
fn caret(ime: Option<[f32; 4]>, scale: f32) -> Option<[f32; 4]> {
    ime.map(|r| [r[0] * scale - 4.0, r[1] * scale - 4.0, (r[0] + r[2]) * scale + 4.0, (r[1] + r[3]) * scale + 4.0])
}

const WGSL: &str = r#"
struct Rec { a: vec4f, b: vec4f, p: vec4f, c: vec4f }
// size: w, h, max lod, mode (0 shapes, 1 whole window, 2 cover); t: old opacity, old blur,
// new blur (px), morph progress.
struct U { size: vec4f, t: vec4f }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(5) var<storage, read> recs: array<Rec>;

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    let p = array(vec2f(-1., -1.), vec2f(3., -1.), vec2f(-1., 3.));
    return vec4f(p[i], 0., 1.);
}

// Copy: the backdrop into a texture's first level.
@group(0) @binding(0) var src: texture_2d<f32>;
@fragment fn copy(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    return textureLoad(src, vec2i(pos.xy), 0);
}

// Down: a level from the one above it (each texel the mean of four).
@group(0) @binding(0) var up: texture_2d<f32>;
@group(0) @binding(1) var smp_d: sampler;
@fragment fn down(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    let dim = vec2f(textureDimensions(up)) * 0.5;
    return textureSampleLevel(up, smp_d, pos.xy / dim, 0.);
}

fn sd(p: vec2f, rect: vec4f, r: f32) -> f32 {
    let half = rect.zw * 0.5;
    let rr = min(r, min(half.x, half.y));
    let q = abs(p - rect.xy - half) - half + vec2f(rr);
    return length(max(q, vec2f(0.))) + min(max(q.x, q.y), 0.) - rr;
}
fn mode(r: Rec) -> u32 { return u32(r.p.z + 0.5); }
// Where a record's shape is now.
fn now(r: Rec) -> vec4f {
    let s = u.t.w;
    var c = r.a;
    if (mode(r) == 1u || mode(r) == 4u) { c = vec4f(mix(r.a.xy, r.b.xy, s), r.b.zw); }
    if (mode(r) == 3u) { c = mix(r.a, r.b, s); }
    return c;
}
fn now_r(r: Rec) -> f32 {
    if (mode(r) == 3u) { return mix(r.p.x, r.p.y, u.t.w); }
    return r.p.x;
}

// Index: each pixel's topmost record (+1), 0 where nothing transitions.
struct VOut { @builtin(position) pos: vec4f, @location(0) @interpolate(flat) k: u32 }
@vertex fn vs_index(@builtin(vertex_index) v: u32, @builtin(instance_index) k: u32) -> VOut {
    let r = recs[k];
    let c = now(r);
    var lo = c.xy;
    var hi = c.xy + c.zw;
    if (mode(r) == 3u) {
        lo = min(lo, min(r.a.xy, r.b.xy));
        hi = max(hi, max(r.a.xy + r.a.zw, r.b.xy + r.b.zw));
    }
    lo -= vec2f(1.);
    hi += vec2f(1.);
    let corner = array(vec2f(0., 0.), vec2f(1., 0.), vec2f(0., 1.), vec2f(0., 1.), vec2f(1., 0.), vec2f(1., 1.));
    let p = mix(lo, hi, corner[v]);
    var o: VOut;
    o.pos = vec4f(p.x / u.size.x * 2. - 1., 1. - p.y / u.size.y * 2., 0., 1.);
    o.k = k;
    return o;
}
@fragment fn index(i: VOut) -> @location(0) vec4u {
    let r = recs[i.k];
    let p = i.pos.xy;
    if (any(p < r.c.xy) || any(p > r.c.zw)) { discard; }
    var d = sd(p, now(r), now_r(r));
    if (mode(r) == 3u) { d = min(d, min(sd(p, r.a, r.p.x), sd(p, r.b, r.p.y))); }
    // Moved pixels carry their own antialiasing: a slide or hole owns whole pixels, so the
    // record under it (not the live frame) shows at its edge.
    var edge = 0.5;
    if (mode(r) <= 1u || mode(r) == 4u) { edge = 0.; }
    if (d > edge) { discard; }
    return vec4u(i.k + 1u, 0u, 0u, 0u);
}

// Composite over the live frame.
@group(0) @binding(1) var before: texture_2d<f32>;
@group(0) @binding(2) var live: texture_2d<f32>;
@group(0) @binding(3) var smp: sampler;
@group(0) @binding(4) var idx: texture_2d<u32>;

fn blur(t: texture_2d<f32>, uv: vec2f, r: f32) -> vec4f {
    if (r < 0.75) { return textureSampleLevel(t, smp, uv, 0.); }
    let lod = clamp(log2(r) - 0.6, 0., u.size.z);
    let o = r * 0.75 / u.size.xy;
    var c = textureSampleLevel(t, smp, uv, lod) * 4.;
    c += (textureSampleLevel(t, smp, uv + vec2f(o.x, 0.), lod) + textureSampleLevel(t, smp, uv - vec2f(o.x, 0.), lod)
        + textureSampleLevel(t, smp, uv + vec2f(0., o.y), lod) + textureSampleLevel(t, smp, uv - vec2f(0., o.y), lod)) * 2.;
    c += textureSampleLevel(t, smp, uv + o, lod) + textureSampleLevel(t, smp, uv - o, lod)
        + textureSampleLevel(t, smp, uv + vec2f(o.x, -o.y), lod) + textureSampleLevel(t, smp, uv + vec2f(-o.x, o.y), lod);
    return c / 16.;
}
fn mixed(uv_old: vec2f, uv_new: vec2f, k: f32) -> vec4f {
    let n = blur(live, uv_new, u.t.z * k);
    let o = blur(before, uv_old, u.t.y * k);
    return mix(n, o, u.t.x);
}
@fragment fn comp(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    let p = pos.xy;
    let size = u.size.xy;
    let uv = p / size;
    if (u.size.w > 1.5) { return textureSampleLevel(before, smp, uv, 0.); }
    if (u.size.w > 0.5) { return mixed(uv, uv, 1.); }
    let k = textureLoad(idx, vec2i(p), 0).r;
    if (k == 0u) { discard; }
    let r = recs[k - 1u];
    let shape = now(r);
    let inside = clamp(0.5 - sd(p, shape, now_r(r)), 0., 1.);
    let m = mode(r);
    var c = vec4f(0.);
    if (m == 0u) {
        c = textureSampleLevel(before, smp, uv, 0.);
    } else if (m == 1u || m == 4u) {
        // A moving shape never brings along what lies outside its clip.
        var look = p + r.b.xy - shape.xy;
        if (m == 4u) { look = p + r.a.xy - shape.xy; }
        if (any(look < r.c.xy) || any(look > r.c.zw)) { discard; }
        if (m == 1u) { c = textureSampleLevel(live, smp, look / size, 0.); } else { c = textureSampleLevel(before, smp, look / size, 0.); }
    } else if (m == 2u) {
        c = mixed(uv, uv, r.p.w) * inside;
    } else {
        let local = (p - shape.xy) / max(shape.zw, vec2f(1.));
        let warped = mixed((r.a.xy + local * r.a.zw) / size, (r.b.xy + local * r.b.zw) / size, r.p.w);
        let in_a = sd(p, r.a, r.p.x) <= 0.;
        let in_b = sd(p, r.b, r.p.y) <= 0.;
        var outer = textureSampleLevel(live, smp, uv, 0.);
        if (in_b && !in_a) { outer = textureSampleLevel(before, smp, uv, 0.); }
        c = mix(outer, warped, inside);
    }
    return c;
}
"#;

fn tex_entry(binding: u32, sample_type: wgpu::TextureSampleType) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::FRAGMENT,
        ty: wgpu::BindingType::Texture { sample_type, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false },
        count: None,
    }
}

fn float(filterable: bool) -> wgpu::TextureSampleType {
    wgpu::TextureSampleType::Float { filterable }
}

fn buffer_entry(binding: u32, ty: wgpu::BufferBindingType) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
        ty: wgpu::BindingType::Buffer { ty, has_dynamic_offset: false, min_binding_size: None },
        count: None,
    }
}

const UNIFORM: wgpu::BufferBindingType = wgpu::BufferBindingType::Uniform;
const STORAGE: wgpu::BufferBindingType = wgpu::BufferBindingType::Storage { read_only: true };

fn sampler_entry(binding: u32) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry { binding, visibility: wgpu::ShaderStages::FRAGMENT, ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering), count: None }
}

impl Gpu {
    fn new(device: &wgpu::Device, key: rune::compose::DeviceKey) -> Gpu {
        let layout = |label: &str, entries: &[wgpu::BindGroupLayoutEntry]| device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor { label: Some(label), entries });
        let copy_layout = layout("swapfx copy", &[tex_entry(0, float(false))]);
        let down_layout = layout("swapfx down", &[tex_entry(0, float(true)), sampler_entry(1)]);
        let index_layout = layout("swapfx index", &[buffer_entry(0, UNIFORM), buffer_entry(5, STORAGE)]);
        let comp_layout = layout(
            "swapfx composite",
            &[buffer_entry(0, UNIFORM), tex_entry(1, float(true)), tex_entry(2, float(true)), sampler_entry(3), tex_entry(4, wgpu::TextureSampleType::Uint), buffer_entry(5, STORAGE)],
        );
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("swapfx"), source: wgpu::ShaderSource::Wgsl(WGSL.into()) });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("swapfx"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Linear,
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            ..Default::default()
        });
        let uniform = device.create_buffer(&wgpu::BufferDescriptor { label: Some("swapfx"), size: 32, usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
        let no_recs = device.create_buffer(&wgpu::BufferDescriptor { label: Some("swapfx records"), size: REC_BYTES as u64, usage: wgpu::BufferUsages::STORAGE, mapped_at_creation: false });
        Gpu { key, copy_layout, down_layout, index_layout, comp_layout, module, sampler, pipes: RefCell::default(), uniform, no_recs }
    }

    fn pipe(&self, device: &wgpu::Device, entry: &'static str, format: wgpu::TextureFormat) -> wgpu::RenderPipeline {
        self.pipes
            .borrow_mut()
            .entry((entry, format))
            .or_insert_with(|| {
                let bind = match entry {
                    "copy" => &self.copy_layout,
                    "down" => &self.down_layout,
                    "index" => &self.index_layout,
                    _ => &self.comp_layout,
                };
                let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: Some("swapfx"), bind_group_layouts: &[Some(bind)], immediate_size: 0 });
                let blend = (entry == "comp").then_some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING);
                device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                    label: Some("swapfx"),
                    layout: Some(&layout),
                    vertex: wgpu::VertexState { module: &self.module, entry_point: Some(if entry == "index" { "vs_index" } else { "vs" }), compilation_options: Default::default(), buffers: &[] },
                    fragment: Some(wgpu::FragmentState {
                        module: &self.module,
                        entry_point: Some(entry),
                        compilation_options: Default::default(),
                        targets: &[Some(wgpu::ColorTargetState { format, blend, write_mask: wgpu::ColorWrites::ALL })],
                    }),
                    primitive: Default::default(),
                    depth_stencil: None,
                    multisample: Default::default(),
                    multiview_mask: None,
                    cache: None,
                })
            })
            .clone()
    }

    fn pass(&self, device: &wgpu::Device, enc: &mut wgpu::CommandEncoder, pipe: (&'static str, wgpu::TextureFormat), target: &wgpu::TextureView, bind: &wgpu::BindGroup, draw: (u32, u32)) {
        let pipe = self.pipe(device, pipe.0, pipe.1);
        let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("swapfx"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: target,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT), store: wgpu::StoreOp::Store },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&pipe);
        pass.set_bind_group(0, bind, &[]);
        pass.draw(0..draw.0, 0..draw.1);
    }

    /// The backdrop into `dst`'s first level, then its mips.
    fn copy(&self, device: &wgpu::Device, enc: &mut wgpu::CommandEncoder, src: &wgpu::TextureView, dst: &Mipped, format: wgpu::TextureFormat) {
        let bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("swapfx copy"),
            layout: &self.copy_layout,
            entries: &[wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(src) }],
        });
        self.pass(device, enc, ("copy", format), &dst.levels[0], &bind, (3, 1));
        for (i, down) in dst.downs.iter().enumerate() {
            self.pass(device, enc, ("down", format), &dst.levels[i + 1], down, (3, 1));
        }
    }

    /// Each pixel's topmost record, where the shapes are this frame.
    fn index(&self, device: &wgpu::Device, enc: &mut wgpu::CommandEncoder, target: &wgpu::TextureView, bind: &wgpu::BindGroup, recs: u32) {
        self.pass(device, enc, ("index", wgpu::TextureFormat::R32Uint), target, bind, (6, recs));
    }

    fn comp_group(&self, device: &wgpu::Device, before: &Mipped, live: &Mipped, index: &wgpu::TextureView, recs: &wgpu::Buffer) -> wgpu::BindGroup {
        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("swapfx composite"),
            layout: &self.comp_layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: self.uniform.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(&before.full) },
                wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::TextureView(&live.full) },
                wgpu::BindGroupEntry { binding: 3, resource: wgpu::BindingResource::Sampler(&self.sampler) },
                wgpu::BindGroupEntry { binding: 4, resource: wgpu::BindingResource::TextureView(index) },
                wgpu::BindGroupEntry { binding: 5, resource: recs.as_entire_binding() },
            ],
        })
    }

    /// One swap's records on the GPU, with the bind groups that read them.
    fn bind(&self, device: &wgpu::Device, res: &Res, recs: &[Rec]) -> Bound {
        let buffer = device.create_buffer(&wgpu::BufferDescriptor { label: Some("swapfx records"), size: (recs.len().max(1) * REC_BYTES) as u64, usage: wgpu::BufferUsages::STORAGE, mapped_at_creation: true });
        let mut data = vec![0u8; recs.len().max(1) * REC_BYTES];
        for (k, r) in recs.iter().enumerate() {
            for (w, v) in r.a.iter().chain(&r.b).chain(&r.p).chain(&r.c).enumerate() {
                let o = k * REC_BYTES + w * 4;
                data[o..o + 4].copy_from_slice(&v.to_le_bytes());
            }
        }
        if let Ok(mut bytes) = buffer.slice(..).get_mapped_range_mut() {
            bytes.copy_from_slice(&data);
        }
        buffer.unmap();
        let index = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("swapfx index"),
            layout: &self.index_layout,
            entries: &[wgpu::BindGroupEntry { binding: 0, resource: self.uniform.as_entire_binding() }, wgpu::BindGroupEntry { binding: 5, resource: buffer.as_entire_binding() }],
        });
        Bound { index, comp: self.comp_group(device, &res.before, &res.live, &res.index, &buffer) }
    }
}

impl Res {
    fn new(device: &wgpu::Device, gpu: &Gpu, size: (u32, u32), format: wgpu::TextureFormat) -> Res {
        let levels = MIPS.min(32 - size.0.min(size.1).max(1).leading_zeros());
        let mipped = |label: &str| {
            let tex = device.create_texture(&wgpu::TextureDescriptor {
                label: Some(label),
                size: wgpu::Extent3d { width: size.0, height: size.1, depth_or_array_layers: 1 },
                mip_level_count: levels,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            });
            let full = tex.create_view(&Default::default());
            let level_views: Vec<wgpu::TextureView> =
                (0..levels).map(|l| tex.create_view(&wgpu::TextureViewDescriptor { base_mip_level: l, mip_level_count: Some(1), ..Default::default() })).collect();
            let downs = (1..levels as usize)
                .map(|l| {
                    device.create_bind_group(&wgpu::BindGroupDescriptor {
                        label: Some("swapfx down"),
                        layout: &gpu.down_layout,
                        entries: &[wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&level_views[l - 1]) }, wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&gpu.sampler) }],
                    })
                })
                .collect();
            Mipped { full, levels: level_views, downs }
        };
        let before = mipped("swapfx before");
        let live = mipped("swapfx live");
        let index = device
            .create_texture(&wgpu::TextureDescriptor {
                label: Some("swapfx index"),
                size: wgpu::Extent3d { width: size.0, height: size.1, depth_or_array_layers: 1 },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::R32Uint,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            })
            .create_view(&Default::default());
        let comp = gpu.comp_group(device, &before, &live, &index, &gpu.no_recs);
        Res { size, format, before, live, index, comp }
    }
}
