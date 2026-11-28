//! `<image>`, `<icon>`, `<video>`/`<audio>` and `<markdown>`.

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::Arc;

use rune::{El, Icon, ImageCache, LoopSpec, Player, SurfaceFit, el};

use crate::engine::Engine;
use crate::props::Props;

thread_local! {
    static CACHE: RefCell<Option<ImageCache>> = const { RefCell::new(None) };
    /// Live image handles by source, so a re-render keeps the decoded pixels.
    static IMAGES: RefCell<HashMap<String, rune::image::Image>> = RefCell::new(HashMap::new());
    static ICONS: RefCell<HashMap<(String, u64), &'static Icon>> = RefCell::new(HashMap::new());
    static PLAYERS: RefCell<HashMap<u32, (String, Player)>> = RefCell::new(HashMap::new());
    /// Players of removed nodes, paused, for an element remounted by a hot swap to take back.
    static PARKED: RefCell<Vec<Parked>> = const { RefCell::new(Vec::new()) };
    /// `<vector svg>` rasters by node, with the hash of what they show.
    static RASTERS: RefCell<HashMap<u32, (u64, rune::Pixels)>> = RefCell::new(HashMap::new());
    /// Nodes laid out from an image still decoding (an unsized `<image>`, a markdown picture):
    /// they build again once one lands.
    static SIZING: RefCell<HashMap<u32, Vec<rune::image::Image>>> = RefCell::new(HashMap::new());
    /// The size each SVG `<image>` last drew at, by node: its drawing's longest side in points
    /// and the device pixels to a point.
    static DRAWN: RefCell<HashMap<u32, (f32, f32)>> = RefCell::new(HashMap::new());
    /// SVG `<image>` nodes whose drawn size changed since they were built.
    static RESIZED: RefCell<Vec<u32>> = const { RefCell::new(Vec::new()) };
}

const MAX_IMAGES: usize = 512;
/// How long a removed node's player waits for its remounted element.
const PARK_FOR: std::time::Duration = std::time::Duration::from_secs(3);

struct Parked {
    src: String,
    playing: bool,
    at: std::time::Instant,
    player: Player,
}

/// The player a hot swap left for an element showing `src`, playing again if it was.
fn reclaim(src: &str, audio: bool) -> Option<Player> {
    PARKED.with(|p| {
        let mut p = p.borrow_mut();
        p.retain(|e| e.at.elapsed() < PARK_FOR);
        let i = p.iter().position(|e| e.src == src && e.player.is_audio() == audio)?;
        let e = p.remove(i);
        if e.playing {
            e.player.play();
        }
        Some(e.player)
    })
}

/// Images decode on Rune's workers; when one lands every window redraws.
pub fn init(waker: rune::Waker) {
    CACHE.with(|c| *c.borrow_mut() = Some(ImageCache::new(waker)));
}

fn fit(p: &Props) -> SurfaceFit {
    match p.fit.as_deref() {
        Some("contain") => SurfaceFit::Fit,
        _ => SurfaceFit::Fill,
    }
}

/// Device pixels per point an `<image>` decodes for: phones draw at 3×, the desktop's screens at 2×.
const DECODE_SCALE: f32 = if cfg!(any(target_os = "ios", target_os = "android")) { 3.0 } else { 2.0 };

/// The decoded image for `src` with its longest side about `size` points; one decode per size
/// bucket, so a photo first drawn as a small peek isn't reused at that size on a larger tile.
pub fn load(eng: &Engine, src: &str, size: f32) -> Option<rune::image::Image> {
    let size = size.max(16.0);
    // Buckets of 32 pt keep a resized element from decoding again for every few points.
    let bucket = (size / 32.0).ceil() * 32.0;
    let key = if src.starts_with("blob:") { src.to_owned() } else { format!("{src}\u{1}{bucket}") };
    if let Some(img) = IMAGES.with(|m| m.borrow().get(&key).cloned()) {
        return Some(img);
    }
    let img = CACHE.with(|c| {
        let c = c.borrow();
        let cache = c.as_ref()?;
        if let Some(id) = src.strip_prefix("blob:") {
            let bytes: Arc<[u8]> = eng.blobs.get(&id.parse().ok()?)?.clone();
            return Some(cache.load(bytes));
        }
        let path = src.strip_prefix("file://").unwrap_or(src);
        // At most 2048 px on its longest side, as before, however large it draws.
        Some(cache.file(path, bucket, DECODE_SCALE.min((2048.0 / bucket).max(1.0))))
    })?;
    IMAGES.with(|m| {
        let mut m = m.borrow_mut();
        if m.len() >= MAX_IMAGES {
            m.clear();
        }
        m.insert(key, img.clone());
    });
    Some(img)
}

/// Whether `src` is an SVG: a `.svg`/`.svgz` file, or blob bytes that are SVG markup or gzip.
fn is_svg(eng: &Engine, src: &str) -> bool {
    if let Some(id) = src.strip_prefix("blob:") {
        let Some(bytes) = id.parse().ok().and_then(|id| eng.blobs.get(&id)) else { return false };
        let bytes = bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(bytes);
        return bytes.starts_with(&[0x1f, 0x8b]) || bytes.iter().find(|b| !b.is_ascii_whitespace()) == Some(&b'<');
    }
    let path = src.strip_prefix("file://").unwrap_or(src);
    std::path::Path::new(path).extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("svg") || e.eq_ignore_ascii_case("svgz"))
}

/// An SVG rasterized at the size `n` last drew it, as a browser rasterizes an `<img>`'s SVG at
/// its drawn device pixels; `None` until it has drawn once.
fn drawn_svg(eng: &Engine, n: u32, src: &str) -> Option<rune::image::Image> {
    let (side, scale) = DRAWN.with(|d| d.borrow().get(&n).copied())?;
    let key = format!("{src}\0{}", (side * scale).ceil());
    if let Some(img) = IMAGES.with(|m| m.borrow().get(&key).cloned()) {
        return Some(img);
    }
    let img = CACHE.with(|c| {
        let c = c.borrow();
        let cache = c.as_ref()?;
        if let Some(id) = src.strip_prefix("blob:") {
            let bytes: Arc<[u8]> = eng.blobs.get(&id.parse().ok()?)?.clone();
            return Some(cache.load_scaled(bytes, side, scale));
        }
        Some(cache.file(src.strip_prefix("file://").unwrap_or(src), side, scale))
    })?;
    IMAGES.with(|m| {
        let mut m = m.borrow_mut();
        if m.len() >= MAX_IMAGES {
            m.clear();
        }
        m.insert(key, img.clone());
    });
    Some(img)
}

/// Notes where SVG `<image>` `n` drew (`rect` in its view's points) and has it build again when
/// that takes a raster of another size. `natural` is the drawing's own size, `cover` whether it
/// fills its box (cropped or stretched) rather than fitting inside it.
fn note_drawn(n: u32, window: u32, rect: [f32; 4], natural: [f32; 2], cover: bool, scale: f32) {
    let [w, h] = natural;
    if !(w > 0.0 && h > 0.0 && rect[2] > 0.0 && rect[3] > 0.0) {
        return;
    }
    let (kw, kh) = (rect[2] / w, rect[3] / h);
    let k = if cover { kw.max(kh) } else { kw.min(kh) };
    // A zoomed view lays out in its own points: each is `zoom` of the window's.
    let zoom = crate::engine::read(|e| e.tree.get(window).and_then(|node| node.props.zoom)).unwrap_or(1.0);
    let drawn = (k * w.max(h), scale * zoom);
    let changed = DRAWN.with(|d| {
        let mut d = d.borrow_mut();
        if d.len() >= MAX_IMAGES * 8 {
            d.clear();
        }
        let px = |(side, scale): (f32, f32)| (side * scale).ceil();
        let changed = d.get(&n).is_none_or(|was| px(*was) != px(drawn));
        d.insert(n, drawn);
        changed
    });
    if changed {
        RESIZED.with(|r| r.borrow_mut().push(n));
        crate::windows::wake_all();
    }
}

/// An `<image>` with neither `w` nor `h` takes its image's natural size, fitted to its room and
/// maximums with the ratio kept, as `<img>` does. An SVG draws from a raster of the size it draws
/// at once it has laid out, the first raster until that one lands.
pub fn image(eng: &Engine, n: u32, p: &Props) -> El {
    let Some(src) = p.src.as_deref() else { return el() };
    // The longest side it draws at; a cover-fitted image crops its long side, so it decodes half
    // again as large to keep a wide photo's short side sharp.
    let side = |s: &Option<crate::props::Size>| match s {
        Some(crate::props::Size::Pt(v)) => Some(*v),
        _ => None,
    };
    let size = match (side(&p.w), side(&p.h)) {
        (Some(w), Some(h)) if !matches!(p.fit.as_deref(), Some("contain") | Some("stretch")) => w.max(h) * 1.5,
        (Some(w), Some(h)) => w.max(h),
        (Some(w), None) => w,
        (None, Some(h)) => h,
        (None, None) => 64.0,
    };
    let Some(img) = load(eng, src, size) else { return el() };
    let svg = is_svg(eng, src);
    let shown = match svg.then(|| drawn_svg(eng, n, src)).flatten() {
        Some(sized) if sized.is_ready() => sized,
        Some(sized) => {
            rebuild_when_decoded(n, &sized);
            img.clone()
        }
        None => img.clone(),
    };
    let mut e = match p.fit.as_deref() {
        Some("stretch") => el().pixels(shown.pixels()),
        _ => el().pixels_fit(shown.pixels(), fit(p)),
    };
    if svg && let Some(natural) = img.intrinsic_size() {
        let cover = !matches!(p.fit.as_deref(), Some("contain")) && (p.w.is_some() || p.h.is_some());
        e = e.on_layout_tx(move |s: &mut crate::windows::Win, rect: [f32; 4], tx: &mut rune::Tx| {
            tx.live_only();
            note_drawn(n, s.node, rect, natural, cover, tx.scale());
        });
    }
    if let Some(t) = p.tint {
        e = e.pixels_tint(t.0);
    }
    if p.w.is_none() && p.h.is_none() {
        match img.intrinsic_size() {
            Some([w, h]) => e = e.pixels_natural(w, h),
            None => rebuild_when_decoded(n, &img),
        }
    } else if p.w.is_none() || p.h.is_none() {
        // One side set (a chat photo's `h` with its width left to the ratio): that side comes from
        // the decoded image, so it lays out again once the image lands rather than staying empty.
        rebuild_when_decoded(n, &img);
    }
    e
}

/// Builds node `n` again once `img` has decoded, when it hasn't yet.
pub fn rebuild_when_decoded(n: u32, img: &rune::image::Image) {
    if !img.is_ready() {
        SIZING.with(|m| {
            let mut m = m.borrow_mut();
            let waiting = m.entry(n).or_default();
            if !waiting.iter().any(|w| w.id() == img.id()) {
                waiting.push(img.clone());
            }
        });
    }
}

/// Nodes with an image that has decoded since they were built, and SVG images that drew at
/// another size.
pub fn decoded_since_built() -> Vec<u32> {
    let mut ready = SIZING.with(|m| {
        let mut m = m.borrow_mut();
        let ready: Vec<u32> = m.iter().filter(|(_, imgs)| imgs.iter().any(|i| i.is_ready())).map(|(n, _)| *n).collect();
        for n in &ready {
            m.remove(n);
        }
        ready
    });
    ready.extend(RESIZED.with(|r| std::mem::take(&mut *r.borrow_mut())));
    ready
}

pub(crate) fn icon_of(name: &str, body: &str, view: f32) -> &'static Icon {
    let h = {
        use std::hash::{Hash, Hasher};
        let mut s = std::collections::hash_map::DefaultHasher::new();
        body.hash(&mut s);
        view.to_bits().hash(&mut s);
        s.finish()
    };
    ICONS.with(|m| {
        *m.borrow_mut().entry((name.to_owned(), h)).or_insert_with(|| {
            Box::leak(Box::new(Icon {
                name: Box::leak(name.to_owned().into_boxed_str()),
                view,
                body: Box::leak(body.to_owned().into_boxed_str()),
            }))
        })
    })
}

pub fn icon(p: &Props) -> El {
    let Some(body) = p.svg.as_deref() else { return el() };
    let name = p.name.as_deref().unwrap_or("icon");
    let size = p.size.unwrap_or(16.0);
    let mut e = rune::icon(icon_of(name, body, p.view.unwrap_or(24.0)), size);
    if let Some(c) = p.color {
        e = e.color(c.0);
    }
    if let Some(period) = p.spin {
        e = e.looping(LoopSpec::rotation(period.max(0.05) as f64));
    }
    e
}

/// `<vector svg>`: a whole SVG document rasterized into the node's own pixels on each change
/// (gradients, clip paths, transforms), replaced in place.
fn vector_raster_key(svg: &str, p: &Props) -> (u32, u64) {
    let side = |s: &Option<crate::props::Size>| match s {
        Some(crate::props::Size::Pt(v)) => *v,
        _ => 0.0,
    };
    let px = (side(&p.w).max(side(&p.h)).max(16.0) * VECTOR_SCALE).round() as u32;
    let h = {
        use std::hash::{Hash, Hasher};
        let mut s = std::collections::hash_map::DefaultHasher::new();
        svg.hash(&mut s);
        px.hash(&mut s);
        s.finish()
    };
    (px, h)
}

/// Repaints node `n`'s `<vector svg>` in place for new props that change only its drawing,
/// when it has drawn before. `false`: it needs building.
pub fn repaint_vector(n: u32, p: &Props) -> bool {
    let Some(svg) = p.svg.as_deref() else { return false };
    let (px, h) = vector_raster_key(svg, p);
    RASTERS.with(|m| {
        let mut m = m.borrow_mut();
        let Some(entry) = m.get_mut(&n) else { return false };
        if entry.0 != h {
            entry.0 = h;
            raster_later(n, svg.to_owned(), px, entry.1.clone());
        }
        true
    })
}

fn vector_svg(n: u32, svg: &str, p: &Props) -> El {
    let (px, h) = vector_raster_key(svg, p);
    let pixels = RASTERS.with(|m| {
        let mut m = m.borrow_mut();
        let first = !m.contains_key(&n);
        let entry = m.entry(n).or_insert_with(|| (0, rune::Pixels::new()));
        if entry.0 != h {
            entry.0 = h;
            // The first picture draws with the node; a change (an animated drawing's next pose)
            // rasterizes off the frame thread and lands on a later frame.
            if first {
                raster_svg(n, svg, px, &entry.1);
            } else {
                raster_later(n, svg.to_owned(), px, entry.1.clone());
            }
        }
        entry.1.clone()
    });
    el().pixels(&pixels)
}

fn raster_svg(n: u32, svg: &str, px: u32, into: &rune::Pixels) {
    match rune::image::svg_rgba(svg.as_bytes(), px) {
        Ok((w, h, rgba)) => into.set(w, h, rgba),
        Err(e) => eprintln!("stella-engine: vector {n}: {}", e.0),
    }
}

/// SVG changes waiting for the raster thread, latest per node.
struct RasterQueue {
    jobs: std::sync::Mutex<HashMap<u32, (String, u32, rune::Pixels)>>,
    ready: std::sync::Condvar,
}

fn raster_later(n: u32, svg: String, px: u32, into: rune::Pixels) {
    static QUEUE: std::sync::OnceLock<Option<Arc<RasterQueue>>> = std::sync::OnceLock::new();
    let queue = QUEUE.get_or_init(|| {
        let q = Arc::new(RasterQueue { jobs: std::sync::Mutex::new(HashMap::new()), ready: std::sync::Condvar::new() });
        let worker = q.clone();
        let spawned = std::thread::Builder::new().name("stella-vector".into()).spawn(move || loop {
            let (n, (svg, px, into)) = {
                let mut jobs = worker.jobs.lock().unwrap_or_else(|e| e.into_inner());
                loop {
                    if let Some(&n) = jobs.keys().next() {
                        break (n, jobs.remove(&n).unwrap());
                    }
                    jobs = worker.ready.wait(jobs).unwrap_or_else(|e| e.into_inner());
                }
            };
            raster_svg(n, &svg, px, &into);
        });
        match spawned {
            Ok(_) => Some(q),
            Err(e) => {
                eprintln!("stella-engine: vector thread: {e}");
                None
            }
        }
    });
    let Some(queue) = queue else { return raster_svg(n, &svg, px, &into) };
    queue.jobs.lock().unwrap_or_else(|e| e.into_inner()).insert(n, (svg, px, into));
    queue.ready.notify_one();
}

const VECTOR_SCALE: f32 = 2.0;

/// `<vector>`: SVG paths drawn as Rune shapes, rebuilt whenever they change and never cached.
pub fn vector(n: u32, p: &Props) -> El {
    if let Some(svg) = p.svg.as_deref() {
        return vector_svg(n, svg, p);
    }
    let mut shape = rune::Shape::new();
    for path in p.paths.iter().flatten() {
        let alpha = path.opacity.unwrap_or(1.0).clamp(0.0, 1.0);
        if let Some(c) = path.fill {
            let rule = if path.even_odd { rune::FillRule::EvenOdd } else { rune::FillRule::NonZero };
            shape = shape.fill_svg_with(&path.d, rule, c.0.alpha(c.0.a * alpha));
        }
        if let Some(c) = path.stroke {
            let cap = if path.cap.as_deref() == Some("butt") { rune::LineCap::Butt } else { rune::LineCap::Round };
            shape = shape.stroke_svg(&path.d, path.stroke_width.unwrap_or(1.0), cap, c.0.alpha(c.0.a * alpha));
        }
    }
    if let Some([w, h]) = p.view_box {
        shape = shape.view_box(w, h);
    }
    rune::canvas(shape)
}

pub fn video(n: u32, p: &Props) -> El {
    let Some(src) = p.src.clone() else { return el() };
    let player = PLAYERS.with(|m| {
        let mut m = m.borrow_mut();
        match m.get(&n) {
            Some((cur, pl)) if *cur == src => pl.clone(),
            _ => {
                let pl = reclaim(&src, false).unwrap_or_else(|| {
                    let pl = if src.starts_with("http://") || src.starts_with("https://") { Player::url(&src) } else { Player::file(src.strip_prefix("file://").unwrap_or(&src)) };
                    if p.autoplay {
                        pl.play();
                    }
                    pl
                });
                m.insert(n, (src.clone(), pl.clone()));
                pl
            }
        }
    });
    player.set_muted(p.muted);
    player.set_looping(p.loop_media);
    el().video(&player, fit(p))
}

/// `<audio>`: a player with no picture, loaded at mount so its duration is known before it plays.
pub fn audio(n: u32, p: &Props) -> El {
    let Some(src) = p.src.clone() else { return el() };
    let player = PLAYERS.with(|m| {
        let mut m = m.borrow_mut();
        match m.get(&n) {
            Some((cur, pl)) if *cur == src => pl.clone(),
            _ => {
                let source = if src.starts_with("http://") || src.starts_with("https://") {
                    rune::MediaSource::Url(src.clone())
                } else {
                    rune::MediaSource::File(src.strip_prefix("file://").unwrap_or(&src).into())
                };
                let pl = reclaim(&src, true).unwrap_or_else(|| {
                    let pl = Player::audio(source);
                    if p.autoplay {
                        pl.play();
                    }
                    pl
                });
                m.insert(n, (src.clone(), pl.clone()));
                pl
            }
        }
    });
    player.set_muted(p.muted);
    player.set_looping(p.loop_media);
    el()
}

pub fn player(n: u32) -> Option<Player> {
    PLAYERS.with(|m| m.borrow().get(&n).map(|(_, p)| p.clone()))
}

pub fn forget(n: u32) {
    if let Some((src, player)) = PLAYERS.with(|m| m.borrow_mut().remove(&n)) {
        let playing = player.is_playing();
        player.pause();
        PARKED.with(|p| {
            let mut p = p.borrow_mut();
            p.retain(|e| e.at.elapsed() < PARK_FOR);
            p.push(Parked { src, playing, at: std::time::Instant::now(), player });
        });
    }
    RASTERS.with(|m| m.borrow_mut().remove(&n));
    SIZING.with(|m| m.borrow_mut().remove(&n));
}

pub fn markdown(n: u32, p: &Props) -> El {
    crate::markdown::build(n, p)
}

/// `media.probe {path, poster?: {width, height, out}}`, off the UI thread: a clip's length (and
/// picture size), as a `<video>` reads its metadata, and with `poster` a frame from 0.6 s in (a
/// quarter into a shorter clip) cover-cropped to that box and saved as JPEG at `out`, as master's
/// offscreen probe draws it.
pub fn probe(rid: Option<u64>, v: &serde_json::Value) {
    let path = v.get("path").and_then(|p| p.as_str()).unwrap_or_default().to_owned();
    let poster = v.get("poster").and_then(|p| {
        let n = |k: &str| p.get(k).and_then(|x| x.as_u64()).map(|x| x.clamp(1, 4096) as u32);
        Some((n("width")?, n("height")?, std::path::PathBuf::from(p.get("out")?.as_str()?)))
    });
    std::thread::spawn(move || crate::engine::reply_any_thread(rid, probe_clip(&path, poster)));
}

fn probe_clip(path: &str, poster: Option<(u32, u32, std::path::PathBuf)>) -> Result<serde_json::Value, String> {
    let source = rune::MediaSource::File(path.into());
    let info = source.probe()?;
    let size = info.size.map(|(w, h)| serde_json::json!({ "width": w, "height": h }));
    let mut out = serde_json::json!({ "duration": info.duration, "size": size, "poster": null });
    if let (Some((width, height, file)), Some((sw, sh))) = (poster, info.size) {
        let cover = (width as f64 / sw as f64).max(height as f64 / sh as f64).min(1.0);
        let longest = (sw.max(sh) as f64 * cover).ceil() as u32;
        let strip = rune::Thumbnails::request(source).at((info.duration / 4.0).min(0.6)).max_size(longest.max(1)).start();
        strip.wait();
        let frame = strip.frame(0).ok_or("no frame")?;
        if let Some(e) = frame.error() {
            return Err(e.to_owned());
        }
        let (fw, fh, rgba) = frame.pixels().to_rgba().ok_or("no picture")?;
        let picture = image::RgbaImage::from_raw(fw, fh, rgba).ok_or("bad picture")?;
        let boxed = image::DynamicImage::ImageRgba8(picture).resize_to_fill(width, height, image::imageops::FilterType::Triangle).to_rgb8();
        let writer = std::io::BufWriter::new(std::fs::File::create(&file).map_err(|e| format!("{}: {e}", file.display()))?);
        image::codecs::jpeg::JpegEncoder::new_with_quality(writer, 78).encode_image(&boxed).map_err(|e| e.to_string())?;
        out["poster"] = serde_json::json!(file.to_string_lossy());
    }
    Ok(out)
}
