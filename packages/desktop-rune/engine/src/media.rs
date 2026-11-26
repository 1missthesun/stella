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

pub fn load(eng: &Engine, src: &str, size: f32) -> Option<rune::image::Image> {
    if let Some(img) = IMAGES.with(|m| m.borrow().get(src).cloned()) {
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
        Some(cache.file(path, size.max(16.0), 2.0))
    })?;
    IMAGES.with(|m| {
        let mut m = m.borrow_mut();
        if m.len() >= MAX_IMAGES {
            m.clear();
        }
        m.insert(src.to_owned(), img.clone());
    });
    Some(img)
}

/// An `<image>` with neither `w` nor `h` takes its image's natural size, fitted to its room and
/// maximums with the ratio kept, as `<img>` does.
pub fn image(eng: &Engine, n: u32, p: &Props) -> El {
    let Some(src) = p.src.as_deref() else { return el() };
    let size = match &p.w {
        Some(crate::props::Size::Pt(w)) => *w,
        _ => 64.0,
    };
    let Some(img) = load(eng, src, size) else { return el() };
    let mut e = match p.fit.as_deref() {
        Some("stretch") => el().pixels(img.pixels()),
        _ => el().pixels_fit(img.pixels(), fit(p)),
    };
    if let Some(t) = p.tint {
        e = e.pixels_tint(t.0);
    }
    if p.w.is_none() && p.h.is_none() {
        match img.intrinsic_size() {
            Some([w, h]) => e = e.pixels_natural(w, h),
            None => rebuild_when_decoded(n, &img),
        }
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

/// Nodes with an image that has decoded since they were built.
pub fn decoded_since_built() -> Vec<u32> {
    SIZING.with(|m| {
        let mut m = m.borrow_mut();
        let ready: Vec<u32> = m.iter().filter(|(_, imgs)| imgs.iter().any(|i| i.is_ready())).map(|(n, _)| *n).collect();
        for n in &ready {
            m.remove(n);
        }
        ready
    })
}

fn icon_of(name: &str, body: &str, view: f32) -> &'static Icon {
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
fn vector_svg(n: u32, svg: &str, p: &Props) -> El {
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
    let pixels = RASTERS.with(|m| {
        let mut m = m.borrow_mut();
        let entry = m.entry(n).or_insert_with(|| (0, rune::Pixels::new()));
        if entry.0 != h {
            entry.0 = h;
            match rune::image::svg_rgba(svg.as_bytes(), px) {
                Ok((w, h, rgba)) => entry.1.set(w, h, rgba),
                Err(e) => eprintln!("stella-engine: vector {n}: {}", e.0),
            }
        }
        entry.1.clone()
    });
    el().pixels(&pixels)
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
