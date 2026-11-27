//! Hot swap transitions where the interface changed. The host asks for one (`swapfx.begin`)
//! right before it holds the new UI's frames back; the main window's compositor keeps the frame on
//! screen then (the "before"). When the swap's commit lands, the first frame of the new tree draws
//! the before over itself, compares the two on the GPU in 8 px cells, and reads the changed cells
//! back. From the next frame on only the changed regions transition: the old picture blurs and
//! fades out while the new one comes into focus, and an element whose box changed (matched by its
//! place in the tree) morphs its rounded rect from the old shape to the new one. A change over most
//! of the window transitions all of it. The engine runs every frame of it; TS sends two commands.
//!
//! Costs nothing at rest: the slot, the compositor's engagement and the textures exist only while
//! a swap is in flight, and are dropped when its transition ends.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rune::{El, Spring};
use rune::render::EffectPhase;

use crate::engine::Engine;

/// The swap slot's effect mark: no node id comes near it.
pub const MARK: u32 = 0xFFFF_FFF8;
/// Device pixels per compared cell.
const CELL: u32 = 8;
/// A cell changed when a channel moved more than this (of 255), as Electron's picture-diff.ts.
const THRESHOLD: u8 = 12;
/// Changes closer than this (points) join one region.
const JOIN_PT: f32 = 16.0;
/// A region's soft edge, and how far it reaches past its changed cells (points).
const FEATHER_PT: f32 = 10.0;
const MARGIN_PT: f32 = 16.0;
/// Past this share of the window, or this many regions, the whole window transitions.
const WHOLE_SHARE: f32 = 0.4;
const MAX_REGIONS: usize = 8;
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
/// The cells' readback normally takes a frame or two; past this the whole window transitions.
const DIFF_MAX: Duration = Duration::from_millis(250);
const MIPS: u32 = 7;
/// The new tree is compared once no commit has landed for this long (layout-driven re-renders
/// follow a swap's first frame).
const QUIET: Duration = Duration::from_millis(24);

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Stage {
    /// Waiting for a frame to keep as the before.
    Want,
    /// The before is kept; waiting for the swap's commit.
    Have,
    /// The new tree is on screen under the before; its cells are being compared.
    Land,
    /// Changed regions are transitioning.
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

/// A box drawn in the main window, by its place in the tree: its rect and corner radius (points).
#[derive(Clone, Copy, Debug)]
struct Shape {
    rect: [f32; 4],
    radius: f32,
}

/// Every painted box in the main window, keyed by its place in the tree (ids, else kind and
/// index, with React's generated ids masked), so a remounted element finds its old self.
fn shapes(rt: &rune::Runtime<crate::windows::Win>, eng: &Engine) -> HashMap<u64, Shape> {
    let Some(window) = eng.main_node else { return HashMap::new() };
    let by_id: HashMap<&str, u32> = eng.tree.nodes.iter().filter_map(|(n, node)| node.props.id.as_deref().map(|id| (id, *n))).collect();
    let mut paths: HashMap<u32, Option<u64>> = HashMap::new();
    let mut out = HashMap::new();
    let mut dup: Vec<u64> = Vec::new();
    for info in rt.elements() {
        let Some(key) = info.key.as_deref() else { continue };
        let node = match key.strip_prefix('n').and_then(|d| d.parse::<u32>().ok()) {
            Some(n) if eng.tree.get(n).is_some_and(|x| x.props.id.is_none()) => n,
            _ => match by_id.get(key) {
                Some(n) => *n,
                None => continue,
            },
        };
        if info.exiting || info.rect[2] < 4.0 || info.rect[3] < 4.0 {
            continue;
        }
        let Some(node_ref) = eng.tree.get(node) else { continue };
        let p = &node_ref.props;
        let boxed = p.fill.is_some() || p.gradient.is_some() || p.border.is_some() || p.fx.as_ref().is_some_and(|f| !f.0.is_empty());
        if !boxed {
            continue;
        }
        let Some(h) = path_hash(eng, window, node, &mut paths) else { continue };
        if out.insert(h, Shape { rect: info.rect, radius: info.radius.max(0.0) }).is_some() {
            dup.push(h);
        }
    }
    for h in dup {
        out.remove(&h);
    }
    out
}

fn path_hash(eng: &Engine, window: u32, n: u32, memo: &mut HashMap<u32, Option<u64>>) -> Option<u64> {
    if n == window {
        return Some(0x5eed);
    }
    if let Some(h) = memo.get(&n) {
        return *h;
    }
    let node = eng.tree.get(n)?;
    let parent = node.parent;
    let up = if parent == 0 { None } else { path_hash(eng, window, parent, memo) };
    let h = up.and_then(|up| {
        let mut s = std::collections::hash_map::DefaultHasher::new();
        up.hash(&mut s);
        match node.props.id.as_deref() {
            Some(id) => crate::swap_view::stable_id(id).hash(&mut s),
            None => {
                (node.kind as u8).hash(&mut s);
                eng.tree.get(parent)?.children.iter().position(|c| *c == n)?.hash(&mut s);
            }
        }
        Some(s.finish())
    });
    memo.insert(n, h);
    h
}

/// One region transitioning, in device pixels; `morph` is a box that changed shape in it (old,
/// new: rect + radius).
#[derive(Clone, Copy, Debug)]
struct Region {
    rect: [f32; 4],
    feather: f32,
    blur: f32,
    morph: Option<([f32; 5], [f32; 5])>,
}

/// The changed cells → regions (picture-diff.ts): cells past the threshold, joined across
/// `JOIN_PT`, each group's bounds grown by the margin, overlapping ones merged. `None`: the whole
/// window.
fn regions(diff: &[u8], cols: u32, rows: u32, scale: f32, size: (u32, u32)) -> Option<Vec<[f32; 4]>> {
    let (w, h) = (cols as usize, rows as usize);
    let on: Vec<u8> = diff.iter().map(|v| u8::from(*v > THRESHOLD)).collect();
    let r = ((JOIN_PT * scale) / CELL as f32).ceil().max(1.0) as usize;
    let grown = dilate(&on, w, h, r);
    let mut seen = vec![false; w * h];
    let mut queue: Vec<usize> = Vec::new();
    let mut found: Vec<[f32; 4]> = Vec::new();
    for s in 0..w * h {
        if grown[s] == 0 || seen[s] {
            continue;
        }
        let (mut x0, mut y0, mut x1, mut y1, mut count) = (w, h, 0, 0, 0usize);
        queue.clear();
        queue.push(s);
        seen[s] = true;
        let mut head = 0;
        while head < queue.len() {
            let i = queue[head];
            head += 1;
            let (x, y) = (i % w, i / w);
            if on[i] != 0 {
                count += 1;
                x0 = x0.min(x);
                y0 = y0.min(y);
                x1 = x1.max(x);
                y1 = y1.max(y);
            }
            let mut visit = |j: usize| {
                if grown[j] != 0 && !seen[j] {
                    seen[j] = true;
                    queue.push(j);
                }
            };
            if x > 0 {
                visit(i - 1);
            }
            if x + 1 < w {
                visit(i + 1);
            }
            if y > 0 {
                visit(i - w);
            }
            if y + 1 < h {
                visit(i + w);
            }
        }
        if count < 3 {
            continue;
        }
        let c = CELL as f32;
        found.push([x0 as f32 * c, y0 as f32 * c, (x1 - x0 + 1) as f32 * c, (y1 - y0 + 1) as f32 * c]);
    }
    let (vw, vh) = (size.0 as f32, size.1 as f32);
    let m = MARGIN_PT * scale;
    let mut grown_rects: Vec<[f32; 4]> = found
        .iter()
        .map(|[x, y, rw, rh]| {
            let (a, b) = ((x - m).max(0.0), (y - m).max(0.0));
            [a, b, (x + rw + m).min(vw) - a, (y + rh + m).min(vh) - b]
        })
        .collect();
    loop {
        let mut merged = false;
        'outer: for i in 0..grown_rects.len() {
            for j in i + 1..grown_rects.len() {
                let (a, b) = (grown_rects[i], grown_rects[j]);
                if a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3] {
                    let (x, y) = (a[0].min(b[0]), a[1].min(b[1]));
                    grown_rects[i] = [x, y, (a[0] + a[2]).max(b[0] + b[2]) - x, (a[1] + a[3]).max(b[1] + b[3]) - y];
                    grown_rects.swap_remove(j);
                    merged = true;
                    break 'outer;
                }
            }
        }
        if !merged {
            break;
        }
    }
    let covered: f32 = grown_rects.iter().map(|r| r[2] * r[3]).sum();
    (covered <= WHOLE_SHARE * vw * vh && grown_rects.len() <= MAX_REGIONS).then_some(grown_rects)
}

fn dilate(src: &[u8], w: usize, h: usize, r: usize) -> Vec<u8> {
    let mut rows = vec![0u8; w * h];
    for y in 0..h {
        let o = y * w;
        let mut n = 0usize;
        for k in 0..r.min(w) {
            n += src[o + k] as usize;
        }
        for x in 0..w {
            if x + r < w {
                n += src[o + x + r] as usize;
            }
            if x > r {
                n -= src[o + x - r - 1] as usize;
            }
            rows[o + x] = u8::from(n > 0);
        }
    }
    let mut out = vec![0u8; w * h];
    for x in 0..w {
        let mut n = 0usize;
        for k in 0..r.min(h) {
            n += rows[k * w + x] as usize;
        }
        for y in 0..h {
            if y + r < h {
                n += rows[(y + r) * w + x] as usize;
            }
            if y > r {
                n -= rows[(y - r - 1) * w + x] as usize;
            }
            out[y * w + x] = u8::from(n > 0);
        }
    }
    out
}

/// The box in `region` whose shape changed the most visibly: matched old → new, both inside the
/// region, covering a fair share of it.
fn morph_in(region: [f32; 4], old: &HashMap<u64, Shape>, new: &HashMap<u64, Shape>, scale: f32) -> Option<([f32; 5], [f32; 5])> {
    let px = |s: &Shape| [s.rect[0] * scale, s.rect[1] * scale, s.rect[2] * scale, s.rect[3] * scale, s.radius * scale];
    let inside = |r: [f32; 5]| r[0] >= region[0] - 2.0 && r[1] >= region[1] - 2.0 && r[0] + r[2] <= region[0] + region[2] + 2.0 && r[1] + r[3] <= region[1] + region[3] + 2.0;
    let area = region[2] * region[3];
    let mut best: Option<(f32, [f32; 5], [f32; 5])> = None;
    for (h, b) in new {
        let Some(a) = old.get(h) else { continue };
        let (a, b) = (px(a), px(b));
        let moved = (0..4).any(|i| (a[i] - b[i]).abs() > scale) || (a[4].min(a[2].min(a[3]) * 0.5) - b[4].min(b[2].min(b[3]) * 0.5)).abs() > 0.5 * scale;
        if !moved || !inside(a) || !inside(b) {
            continue;
        }
        let size = a[2] * a[3].max(1.0) + b[2] * b[3];
        if size < 0.15 * area || best.is_some_and(|(s, ..)| s >= size) {
            continue;
        }
        best = Some((size, a, b));
    }
    best.map(|(_, a, b)| (a, b))
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
/// blur), the cell comparison and its readback, and the transition's regions.
pub struct Swap {
    gpu: Option<Gpu>,
    res: Option<Res>,
    old: HashMap<u64, Shape>,
    diff: Option<Arc<Mutex<Option<Vec<u8>>>>>,
    land_at: Option<Instant>,
    /// When the comparison in flight was asked for.
    asked_at: Instant,
    /// A comparison a later commit made stale: used if the tree never goes quiet.
    last_cells: Option<Vec<u8>>,
    whole: bool,
    regions: Vec<Region>,
    t0: f64,
    uniform: Vec<u8>,
    /// What the hook does this frame.
    plan: Plan,
}

#[derive(Clone, Copy, Default, PartialEq, Eq, Debug)]
enum Plan {
    #[default]
    Nothing,
    /// Keep the backdrop as the before.
    Keep,
    /// Copy the live frame, compare it with the before, draw the before over it.
    Compare,
    /// Draw the before over everything (the comparison is on its way back).
    Cover,
    /// Copy the live frame and draw the regions' transition.
    Run,
}

struct Gpu {
    key: rune::compose::DeviceKey,
    copy_layout: wgpu::BindGroupLayout,
    down_layout: wgpu::BindGroupLayout,
    diff_layout: wgpu::BindGroupLayout,
    comp_layout: wgpu::BindGroupLayout,
    module: wgpu::ShaderModule,
    sampler: wgpu::Sampler,
    pipes: RefCell<HashMap<(&'static str, wgpu::TextureFormat), wgpu::RenderPipeline>>,
    uniform: wgpu::Buffer,
}

/// Sized resources: the before and live textures (mipped), their level views, the cells.
struct Res {
    size: (u32, u32),
    format: wgpu::TextureFormat,
    before: Mipped,
    live: Mipped,
    cells: wgpu::Texture,
    cells_view: wgpu::TextureView,
    cols: u32,
    rows: u32,
    comp: wgpu::BindGroup,
    diff: wgpu::BindGroup,
}

struct Mipped {
    full: wgpu::TextureView,
    levels: Vec<wgpu::TextureView>,
    downs: Vec<wgpu::BindGroup>,
}

impl Default for Swap {
    fn default() -> Swap {
        Swap {
            gpu: None,
            res: None,
            old: HashMap::new(),
            diff: None,
            land_at: None,
            asked_at: Instant::now(),
            last_cells: None,
            whole: false,
            regions: Vec::new(),
            t0: 0.0,
            uniform: Vec::new(),
            plan: Plan::Nothing,
        }
    }
}

impl Swap {
    pub fn engaged(&self) -> bool {
        active()
    }

    /// True while frames must keep coming (the comparison's readback, the transition).
    pub fn animating(&self) -> bool {
        matches!(stage(), Some(Stage::Land | Stage::Run))
    }

    pub fn release_gpu(&mut self) {
        self.gpu = None;
        self.res = None;
    }

    /// Before the frame draws: moves the swap along and says what the slot's hook does.
    pub fn prepare(&mut self, f: &mut rune::compose::Frame<'_, crate::windows::Win>) {
        let key = f.device_key();
        if self.gpu.as_ref().is_none_or(|g| g.key != key) {
            self.res = None;
            self.gpu = Some(Gpu::new(f.device, key));
        }
        let scale = f.rt.window_scale().max(0.5);
        self.plan = match stage() {
            None => {
                if self.res.is_some() || !self.old.is_empty() {
                    self.res = None;
                    self.old.clear();
                    self.regions.clear();
                    self.diff = None;
                    self.land_at = None;
                    self.last_cells = None;
                }
                Plan::Nothing
            }
            Some(Stage::Want) => {
                self.old = crate::engine::read(|eng| shapes(f.rt, eng));
                Plan::Keep
            }
            Some(Stage::Have) => {
                if since() > HAVE_MAX {
                    set(None);
                    crate::engine::with(touch_main);
                }
                Plan::Nothing
            }
            Some(Stage::Land) if self.res.is_none() => {
                set(None);
                Plan::Nothing
            }
            Some(Stage::Land) => {
                let now = Instant::now();
                let landed = *self.land_at.get_or_insert(now);
                let late = now - landed > DIFF_MAX;
                let got = self.diff.as_ref().and_then(|c| c.lock().unwrap_or_else(|e| e.into_inner()).take());
                if got.is_some() {
                    self.diff = None;
                }
                // Cells compared after the last commit landed are the new tree as it settled; a
                // commit since (a layout-driven re-render) asks for another look.
                let fresh = got.is_some() && last_ops() <= self.asked_at;
                if fresh || (late && self.diff.is_none()) {
                    let cells = got.or(self.last_cells.take());
                    self.start(f, cells, scale, now - landed)
                } else {
                    if got.is_some() {
                        self.last_cells = got;
                    }
                    if self.diff.is_none() && (now - last_ops() >= QUIET || late) {
                        if std::env::var_os("STELLA_RUNE_SWAP_FX_DEBUG").is_some() {
                            eprintln!("stella-engine: swapfx: compare at {:.1} ms (stale result: {})", (now - landed).as_secs_f64() * 1000.0, self.last_cells.is_some());
                        }
                        self.asked_at = now;
                        Plan::Compare
                    } else {
                        Plan::Cover
                    }
                }
            }
            Some(Stage::Run) => Plan::Run,
        };
        let scale_px = scale;
        let size = f.size;
        match self.plan {
            Plan::Compare | Plan::Cover => {
                let whole = [Region { rect: [-64.0, -64.0, size.0 as f32 + 128.0, size.1 as f32 + 128.0], feather: 1.0, blur: 1.0, morph: None }];
                self.uniform = uniform(size, &whole, (1.0, 0.0, 0.0, 0.0), scale_px, self.max_lod());
            }
            Plan::Run => {
                let t = (f.rt.t - self.t0) as f32;
                let (a_out, b_out, b_in, morph, done) = timeline(if f.rt.system_reduced_motion() { 10.0 } else { t });
                self.uniform = uniform(size, &self.regions, (a_out, b_out, b_in, morph), scale_px, self.max_lod());
                if done {
                    set(None);
                    crate::engine::with(touch_main);
                }
            }
            _ => {}
        }
        if !self.uniform.is_empty()
            && let Some(g) = &self.gpu
            && matches!(self.plan, Plan::Compare | Plan::Cover | Plan::Run)
        {
            f.write_buffer(&g.uniform, 0, &self.uniform.clone());
        }
    }

    /// The comparison is in: the regions (or the whole window) start transitioning.
    fn start(&mut self, f: &mut rune::compose::Frame<'_, crate::windows::Win>, cells: Option<Vec<u8>>, scale: f32, waited: Duration) -> Plan {
        let Some(res) = self.res.as_ref() else {
            set(None);
            return Plan::Nothing;
        };
        let size = res.size;
        if let (Some(d), Some(dir)) = (&cells, std::env::var_os("STELLA_RUNE_SWAP_FX_DEBUG")) {
            let mut pgm = format!("P5 {} {} 255\n", res.cols, res.rows).into_bytes();
            pgm.extend(d.iter().map(|v| v.saturating_mul(8)));
            let _ = std::fs::write(std::path::Path::new(&dir).join(format!("cells-{:.0}.pgm", f.rt.t * 1000.0)), pgm);
        }
        let found = cells.and_then(|d| regions(&d, res.cols, res.rows, scale, size));
        let new = crate::engine::read(|eng| shapes(f.rt, eng));
        self.whole = found.is_none();
        self.regions = match found {
            None => vec![Region { rect: [-64.0, -64.0, size.0 as f32 + 128.0, size.1 as f32 + 128.0], feather: 1.0, blur: 1.0, morph: None }],
            Some(list) => list
                .into_iter()
                .map(|rect| {
                    let side = rect[2].min(rect[3]) / scale;
                    Region { rect, feather: FEATHER_PT * scale, blur: (side / 64.0).clamp(0.35, 1.0), morph: morph_in(rect, &self.old, &new, scale) }
                })
                .collect(),
        };
        self.t0 = f.rt.t;
        self.land_at = None;
        self.last_cells = None;
        eprintln!(
            "stella-engine: swapfx: {} after {:.1} ms: {}",
            if self.whole { "whole window" } else if self.regions.is_empty() { "nothing changed" } else { "regions" },
            waited.as_secs_f64() * 1000.0,
            self.regions.iter().map(|r| format!("{:.0},{:.0} {:.0}x{:.0}{}", r.rect[0], r.rect[1], r.rect[2], r.rect[3], if r.morph.is_some() { " morph" } else { "" })).collect::<Vec<_>>().join(" | ")
        );
        if self.regions.is_empty() {
            set(None);
            crate::engine::with(touch_main);
            Plan::Nothing
        } else {
            set(Some(Stage::Run));
            Plan::Run
        }
    }

    fn max_lod(&self) -> f32 {
        (MIPS - 1) as f32
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
                        gpu.pipe(device, "cells", wgpu::TextureFormat::R8Unorm);
                        gpu.pipe(device, "comp", s.format);
                        set(Some(Stage::Have));
                    }
                    Plan::Compare => {
                        gpu.copy(device, enc, bd, &res.live, s.format);
                        self.diff = Some(gpu.compare(device, enc, res, s.format.is_srgb()));
                    }
                    Plan::Run => gpu.copy(device, enc, bd, &res.live, s.format),
                    Plan::Cover | Plan::Nothing => {}
                }
            }
            EffectPhase::Draw(pass) => {
                if !matches!(self.plan, Plan::Compare | Plan::Cover | Plan::Run) {
                    return;
                }
                let Some(res) = self.res.as_ref() else { return };
                let pipe = gpu.pipe(device, "comp", s.format);
                pass.set_pipeline(&pipe);
                pass.set_bind_group(0, &res.comp, &[]);
                pass.draw(0..3, 0..1);
            }
        }
    }
}

/// The composite's uniform: the target, the transition's values, the regions (`U` in the WGSL).
fn uniform(size: (u32, u32), regions: &[Region], (a_out, b_out, b_in, morph): (f32, f32, f32, f32), scale: f32, max_lod: f32) -> Vec<u8> {
    let mut v: Vec<f32> = vec![size.0 as f32, size.1 as f32, max_lod, regions.len().min(MAX_REGIONS) as f32];
    v.extend([a_out, b_out * OUT_END_BLUR_PT * scale, b_in * IN_BLUR_PT * scale, morph]);
    for i in 0..MAX_REGIONS {
        let Some(r) = regions.get(i) else {
            v.extend([0.0; 24]);
            continue;
        };
        v.extend(r.rect);
        v.extend([r.feather, r.blur, if r.morph.is_some() { 1.0 } else { 0.0 }, 0.0]);
        let (a, b) = r.morph.unwrap_or(([0.0; 5], [0.0; 5]));
        let t = morph;
        let m = |x: f32, y: f32| x + (y - x) * t;
        let s = [m(a[0], b[0]), m(a[1], b[1]), m(a[2], b[2]).max(1.0), m(a[3], b[3]).max(1.0)];
        let cap = |r: f32, w: f32, h: f32| r.min(w.min(h) * 0.5).max(0.0);
        let (ra, rb) = (cap(a[4], a[2], a[3]), cap(b[4], b[2], b[3]));
        v.extend(&a[..4]);
        v.extend(&b[..4]);
        v.extend(s);
        v.extend([ra, rb, cap(m(ra, rb), s[2], s[3]), 0.0]);
    }
    v.iter().flat_map(|x| x.to_le_bytes()).collect()
}

const WGSL: &str = r#"
struct R { rect: vec4f, p: vec4f, a: vec4f, b: vec4f, s: vec4f, rad: vec4f }
struct U { size: vec4f, t: vec4f, r: array<R, 8> }

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

// Cells: the largest channel change in each 8 x 8 cell, in sRGB terms.
@group(0) @binding(0) var a_tex: texture_2d<f32>;
@group(0) @binding(1) var b_tex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> enc: vec4f;
fn perceived(c: vec4f) -> vec3f {
    if (enc.x > 0.5) { return pow(max(c.rgb, vec3f(0.)), vec3f(1. / 2.2)); }
    return c.rgb;
}
@fragment fn cells(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    let dim = vec2i(textureDimensions(a_tex));
    let o = vec2i(pos.xy) * 8;
    var m = 0.;
    for (var y = 0; y < 8; y++) {
        for (var x = 0; x < 8; x++) {
            let q = min(o + vec2i(x, y), dim - vec2i(1));
            let d = abs(perceived(textureLoad(a_tex, q, 0)) - perceived(textureLoad(b_tex, q, 0)));
            m = max(m, max(d.r, max(d.g, d.b)));
        }
    }
    return vec4f(m, 0., 0., 1.);
}

// Composite: inside each region the old picture blurs and fades over the new one coming into
// focus; a box that changed shape morphs its rounded rect from the old to the new.
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var before: texture_2d<f32>;
@group(0) @binding(2) var live: texture_2d<f32>;
@group(0) @binding(3) var smp: sampler;

fn sd(p: vec2f, rect: vec4f, r: f32) -> f32 {
    let half = rect.zw * 0.5;
    let q = abs(p - rect.xy - half) - half + vec2f(r);
    return length(max(q, vec2f(0.))) + min(max(q.x, q.y), 0.) - r;
}
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
    var m = 0.;
    var best = 0u;
    let n = u32(u.size.w);
    for (var i = 0u; i < n; i++) {
        let r = u.r[i];
        let f = max(r.p.x, 1.);
        let d = sd(p, r.rect, f);
        let k = clamp(-d / f, 0., 1.);
        if (k > m) { m = k; best = i; }
    }
    if (m <= 0.) { discard; }
    let r = u.r[best];
    let uv = p / size;
    var c = mixed(uv, uv, r.p.y);
    if (r.p.z > 0.5) {
        let ds = sd(p, r.s, r.rad.z);
        let inside = clamp(0.5 - ds, 0., 1.);
        let local = (p - r.s.xy) / r.s.zw;
        let warped = mixed((r.a.xy + local * r.a.zw) / size, (r.b.xy + local * r.b.zw) / size, r.p.y);
        let in_a = sd(p, r.a, r.rad.x) <= 0.;
        let in_b = sd(p, r.b, r.rad.y) <= 0.;
        var outer = c;
        if (in_b && !in_a) { outer = textureSampleLevel(before, smp, uv, 0.); }
        else if (in_a) { outer = textureSampleLevel(live, smp, uv, 0.); }
        c = mix(outer, warped, inside);
    }
    return c * m;
}
"#;

fn tex_entry(binding: u32, filterable: bool) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::FRAGMENT,
        ty: wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false },
        count: None,
    }
}

fn uniform_entry(binding: u32) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::FRAGMENT,
        ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None },
        count: None,
    }
}

fn sampler_entry(binding: u32) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry { binding, visibility: wgpu::ShaderStages::FRAGMENT, ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering), count: None }
}

impl Gpu {
    fn new(device: &wgpu::Device, key: rune::compose::DeviceKey) -> Gpu {
        let layout = |label: &str, entries: &[wgpu::BindGroupLayoutEntry]| device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor { label: Some(label), entries });
        let copy_layout = layout("swapfx copy", &[tex_entry(0, false)]);
        let down_layout = layout("swapfx down", &[tex_entry(0, true), sampler_entry(1)]);
        let diff_layout = layout("swapfx cells", &[tex_entry(0, false), tex_entry(1, false), uniform_entry(2)]);
        let comp_layout = layout("swapfx composite", &[uniform_entry(0), tex_entry(1, true), tex_entry(2, true), sampler_entry(3)]);
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
        let uniform = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("swapfx"),
            size: 8 * 4 + MAX_REGIONS as u64 * 24 * 4,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        Gpu { key, copy_layout, down_layout, diff_layout, comp_layout, module, sampler, pipes: RefCell::default(), uniform }
    }

    fn pipe(&self, device: &wgpu::Device, entry: &'static str, format: wgpu::TextureFormat) -> wgpu::RenderPipeline {
        self.pipes
            .borrow_mut()
            .entry((entry, format))
            .or_insert_with(|| {
                let bind = match entry {
                    "copy" => &self.copy_layout,
                    "down" => &self.down_layout,
                    "cells" => &self.diff_layout,
                    _ => &self.comp_layout,
                };
                let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: Some("swapfx"), bind_group_layouts: &[Some(bind)], immediate_size: 0 });
                let blend = (entry == "comp").then_some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING);
                device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                    label: Some("swapfx"),
                    layout: Some(&layout),
                    vertex: wgpu::VertexState { module: &self.module, entry_point: Some("vs"), compilation_options: Default::default(), buffers: &[] },
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

    fn pass(&self, device: &wgpu::Device, enc: &mut wgpu::CommandEncoder, entry: &'static str, format: wgpu::TextureFormat, target: &wgpu::TextureView, bind: &wgpu::BindGroup) {
        let pipe = self.pipe(device, entry, format);
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
        pass.draw(0..3, 0..1);
    }

    /// The backdrop into `dst`'s first level, then its mips.
    fn copy(&self, device: &wgpu::Device, enc: &mut wgpu::CommandEncoder, src: &wgpu::TextureView, dst: &Mipped, format: wgpu::TextureFormat) {
        let bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("swapfx copy"),
            layout: &self.copy_layout,
            entries: &[wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(src) }],
        });
        self.pass(device, enc, "copy", format, &dst.levels[0], &bind);
        for (i, down) in dst.downs.iter().enumerate() {
            self.pass(device, enc, "down", format, &dst.levels[i + 1], down);
        }
    }

    /// Compares the before and the live copy in cells and reads the cells back.
    fn compare(&self, device: &wgpu::Device, enc: &mut wgpu::CommandEncoder, res: &Res, srgb: bool) -> Arc<Mutex<Option<Vec<u8>>>> {
        self.pass(device, enc, "cells", wgpu::TextureFormat::R8Unorm, &res.cells_view, &res.diff);
        let row = res.cols.div_ceil(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT) * wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
        let buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("swapfx cells"),
            size: u64::from(row) * u64::from(res.rows),
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        enc.copy_texture_to_buffer(
            res.cells.as_image_copy(),
            wgpu::TexelCopyBufferInfo { buffer: &buffer, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(row), rows_per_image: Some(res.rows) } },
            wgpu::Extent3d { width: res.cols, height: res.rows, depth_or_array_layers: 1 },
        );
        let _ = srgb;
        let out: Arc<Mutex<Option<Vec<u8>>>> = Arc::new(Mutex::new(None));
        let done = Arc::new(AtomicBool::new(false));
        let (cell, landed, held, cols, rows) = (out.clone(), done.clone(), buffer.clone(), res.cols as usize, res.rows as usize);
        enc.map_buffer_on_submit(&buffer, wgpu::MapMode::Read, .., move |r| {
            if r.is_ok()
                && let Ok(bytes) = held.slice(..).get_mapped_range()
            {
                let mut cells = Vec::with_capacity(cols * rows);
                for y in 0..rows {
                    cells.extend_from_slice(&bytes[y * row as usize..y * row as usize + cols]);
                }
                drop(bytes);
                *cell.lock().unwrap_or_else(|e| e.into_inner()) = Some(cells);
            }
            held.unmap();
            landed.store(true, Ordering::Release);
            crate::windows::wake_all();
        });
        crate::backdrop::await_readback(device, done);
        out
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
        let (cols, rows) = (size.0.div_ceil(CELL), size.1.div_ceil(CELL));
        let cells = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("swapfx cells"),
            size: wgpu::Extent3d { width: cols, height: rows, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::R8Unorm,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let cells_view = cells.create_view(&Default::default());
        let enc_flag = device.create_buffer(&wgpu::BufferDescriptor { label: Some("swapfx cells"), size: 16, usage: wgpu::BufferUsages::UNIFORM, mapped_at_creation: true });
        {
            let flag: [f32; 4] = [if format.is_srgb() { 1.0 } else { 0.0 }, 0.0, 0.0, 0.0];
            if let Ok(mut bytes) = enc_flag.slice(..).get_mapped_range_mut() {
                bytes.copy_from_slice(&flag.iter().flat_map(|x| x.to_le_bytes()).collect::<Vec<u8>>());
            }
        }
        enc_flag.unmap();
        let diff = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("swapfx cells"),
            layout: &gpu.diff_layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&before.levels[0]) },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(&live.levels[0]) },
                wgpu::BindGroupEntry { binding: 2, resource: enc_flag.as_entire_binding() },
            ],
        });
        let comp = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("swapfx composite"),
            layout: &gpu.comp_layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: gpu.uniform.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(&before.full) },
                wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::TextureView(&live.full) },
                wgpu::BindGroupEntry { binding: 3, resource: wgpu::BindingResource::Sampler(&gpu.sampler) },
            ],
        });
        Res { size, format, before, live, cells, cells_view, cols, rows, comp, diff }
    }
}
