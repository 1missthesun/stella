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
}

const MAX_IMAGES: usize = 512;

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

fn load(eng: &Engine, src: &str, size: f32) -> Option<rune::image::Image> {
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

pub fn image(eng: &Engine, p: &Props) -> El {
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
    e
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

/// `<vector>`: SVG paths drawn as Rune shapes, rebuilt whenever they change and never cached.
pub fn vector(p: &Props) -> El {
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
                let pl = if src.starts_with("http://") || src.starts_with("https://") { Player::url(&src) } else { Player::file(src.strip_prefix("file://").unwrap_or(&src)) };
                if p.autoplay {
                    pl.play();
                }
                m.insert(n, (src.clone(), pl.clone()));
                pl
            }
        }
    });
    player.set_muted(p.muted);
    player.set_looping(p.loop_media);
    el().video(&player, fit(p))
}

pub fn player(n: u32) -> Option<Player> {
    PLAYERS.with(|m| m.borrow().get(&n).map(|(_, p)| p.clone()))
}

pub fn forget(n: u32) {
    PLAYERS.with(|m| m.borrow_mut().remove(&n));
}

pub fn markdown(n: u32, p: &Props) -> El {
    crate::markdown::build(n, p)
}
