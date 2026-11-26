//! Verification hooks: real input injected through Rune's input paths (`control.input`), the
//! element tree as Rune sees it (`control.elements`), and the PoC's scripted bench motions.

use std::cell::RefCell;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rune::Tx;
use serde_json::{Value, json};

use crate::engine::{self, reply};
use crate::windows::Win;

/// A scripted window resize: start, from, to, duration in seconds.
type ResizeRun = (Instant, (f32, f32), (f32, f32), f32);

thread_local! {
    static RESIZE: RefCell<Option<ResizeRun>> = const { RefCell::new(None) };
    static SCROLL: RefCell<Option<(String, Instant, f32, f32)>> = const { RefCell::new(None) };
    static SCROLL_POS: RefCell<std::collections::HashMap<String, f32>> = RefCell::new(std::collections::HashMap::new());
}

pub fn resize_anim(v: &Value) {
    let f = |k: &str, d: f32| v.get(k).and_then(|x| x.as_f64()).map(|x| x as f32).unwrap_or(d);
    RESIZE.with(|r| *r.borrow_mut() = Some((Instant::now(), (f("w", 1280.0), f("h", 820.0)), (f("w2", 900.0), f("h2", 640.0)), f("dur", 1.5))));
}

pub fn scroll_run(key: String, speed: f32, dur: f32, at: Instant) {
    SCROLL.with(|r| *r.borrow_mut() = Some((key, at, speed, dur)));
}

/// The last reported vertical scroll extent of a keyed viewport (for scripted scrolling).
pub fn note_scroll_max(key: &str, max: f32) {
    SCROLL_POS.with(|m| m.borrow_mut().insert(key.to_owned(), max));
}

pub fn tick(s: &mut Win, tx: &mut Tx) {
    if !s.main {
        return;
    }
    let run = RESIZE.with(|r| *r.borrow());
    if let Some((start, from, to, dur)) = run {
        let t = (start.elapsed().as_secs_f32() / dur).min(1.0);
        let k = 0.5 - 0.5 * (std::f32::consts::PI * 2.0 * t).cos();
        tx.resize_window((from.0 + (to.0 - from.0) * k, from.1 + (to.1 - from.1) * k));
        if t >= 1.0 {
            RESIZE.with(|r| *r.borrow_mut() = None);
            tx.resize_window(from);
        } else {
            tx.wake_after(Duration::ZERO);
        }
    }
    let run = SCROLL.with(|r| r.borrow().clone());
    if let Some((key, start, speed, dur)) = run {
        let t = start.elapsed().as_secs_f32();
        let max = SCROLL_POS.with(|m| m.borrow().get(&key).copied().unwrap_or(0.0));
        if max > 0.0 {
            let travel = (speed * t) % (2.0 * max);
            let y = if travel < max { max - travel } else { travel - max };
            tx.scroll_to_instant(key.clone(), 0.0, y);
        }
        if t >= dur {
            SCROLL.with(|r| *r.borrow_mut() = None);
        } else {
            tx.wake_after(Duration::ZERO);
        }
    }
}

fn color(c: rune::Color) -> String {
    c.hex()
}

fn element_json(e: &rune::ElementInfo) -> Value {
    json!({
        "key": e.key, "path": e.path, "role": e.role, "label": e.label, "text": e.text,
        "rect": e.rect, "opacity": e.opacity, "focused": e.focused, "focusable": e.focusable,
        "inert": e.inert, "exiting": e.exiting, "fill": color(e.fill),
        "textColor": e.text_color.map(color),
    })
}

pub fn command(s: &mut Win, tx: &mut Tx, rid: Option<u64>, cmd: &str, v: &Value) -> Result<Value, String> {
    match cmd {
        "control.elements" => {
            let filter = v.get("key").and_then(|k| k.as_str()).map(str::to_owned);
            tx.read_elements(move |_s: &mut Win, els: &[rune::ElementInfo], _tx: &mut Tx| {
                let list: Vec<Value> = els
                    .iter()
                    .filter(|e| filter.as_deref().is_none_or(|f| e.key.as_deref() == Some(f) || e.path.contains(f)))
                    .map(element_json)
                    .collect();
                reply(rid, Ok(json!(list)));
            });
            Err(String::from("\u{0}pending"))
        }
        "control.input" => {
            let events = match v.get("events") {
                Some(Value::Array(list)) => list.clone(),
                _ => Vec::new(),
            };
            #[cfg(all(target_os = "linux", feature = "webview"))]
            let events = crate::webview_input::route(s.node, events);
            if events.is_empty() {
                return Ok(Value::Null);
            }
            let handle = engine::read(|e| e.windows.get(&s.node).and_then(|w| w.handle.clone())).ok_or("window not open")?;
            handle.inject_script(Value::Array(events)).map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "control.tree" => Ok(engine::read(|e| tree_json(e, s.node))),
        "control.screenshot" => {
            let path = std::path::PathBuf::from(v.get("path").and_then(|p| p.as_str()).ok_or("control.screenshot: needs a path")?);
            let handle = engine::read(|e| e.windows.get(&s.node).and_then(|w| w.handle.clone())).ok_or("window not open")?;
            tx.wake_after(Duration::ZERO);
            let joined: Arc<Mutex<Joined>> = Arc::new(Mutex::new((None, None)));
            let finish = move |j: &mut Joined| {
                if let (Some(_), Some(_)) = (&j.0, &j.1) {
                    let (frame, shots) = (j.0.take().unwrap_or_else(|| Err(String::new())), j.1.take().unwrap_or_default());
                    let path = path.clone();
                    std::thread::spawn(move || engine::reply_any_thread(rid, frame.and_then(|mut f| {
                        composite(&mut f, &shots);
                        write_png(&path, &f)
                    })));
                }
            };
            let finish = Arc::new(Mutex::new(finish));
            let (j, f) = (joined.clone(), finish.clone());
            handle.capture_frame(move |frame| {
                let mut j = j.lock().unwrap_or_else(|e| e.into_inner());
                j.0 = Some(frame);
                (f.lock().unwrap_or_else(|e| e.into_inner()))(&mut j);
            });
            snapshots(s.node, Box::new(move |shots| {
                let mut j = joined.lock().unwrap_or_else(|e| e.into_inner());
                j.1 = Some(shots);
                (finish.lock().unwrap_or_else(|e| e.into_inner()))(&mut j);
            }));
            Err(String::from("\u{0}pending"))
        }
        "control.record" => {
            let dir = std::path::PathBuf::from(v.get("dir").and_then(|p| p.as_str()).ok_or("control.record: needs a dir")?);
            let fps = v.get("fps").and_then(|x| x.as_f64()).unwrap_or(30.0).clamp(1.0, 120.0);
            let seconds = v.get("seconds").and_then(|x| x.as_f64()).unwrap_or(3.0).clamp(0.05, 120.0);
            let handle = engine::read(|e| e.windows.get(&s.node).and_then(|w| w.handle.clone())).ok_or("window not open")?;
            std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
            let shots = Arc::new(Mutex::new(Arc::new(Vec::new())));
            RECORDING.with(|r| r.borrow_mut().insert(s.node, Recording { every: Duration::from_secs_f64(1.0 / fps), last: None, busy: Arc::new(Mutex::new(false)), shots: shots.clone() }));
            record(handle, s.node, dir, fps, seconds, shots, rid);
            Err(String::from("\u{0}pending"))
        }
        other => Err(format!("unknown command {other}")),
    }
}

type Joined = (Option<Result<rune::CapturedFrame, String>>, Option<Vec<Shot>>);

struct Recording {
    every: Duration,
    last: Option<Instant>,
    busy: Arc<Mutex<bool>>,
    shots: Arc<Mutex<Arc<Vec<Shot>>>>,
}

thread_local! {
    static RECORDING: RefCell<std::collections::HashMap<u32, Recording>> = RefCell::new(std::collections::HashMap::new());
}
static STOP_RECORDING: Mutex<Vec<u32>> = Mutex::new(Vec::new());

/// Keeps a recording window's webview snapshots fresh, at most once per recorded frame.
pub fn refresh_recording(window: u32) {
    let stopped = std::mem::take(&mut *STOP_RECORDING.lock().unwrap_or_else(|e| e.into_inner()));
    let due = RECORDING.with(|r| {
        let mut r = r.borrow_mut();
        for w in stopped {
            r.remove(&w);
        }
        let rec = r.get_mut(&window)?;
        let mut busy = rec.busy.lock().unwrap_or_else(|e| e.into_inner());
        if *busy || rec.last.is_some_and(|t| t.elapsed() < rec.every) {
            return None;
        }
        *busy = true;
        rec.last = Some(Instant::now());
        Some((rec.busy.clone(), rec.shots.clone()))
    });
    if let Some((busy, shots)) = due {
        snapshots(window, Box::new(move |s| {
            *shots.lock().unwrap_or_else(|e| e.into_inner()) = Arc::new(s);
            *busy.lock().unwrap_or_else(|e| e.into_inner()) = false;
        }));
    }
}

#[cfg(feature = "webview")]
use crate::webview::{Shot, snapshots};

#[cfg(not(feature = "webview"))]
pub struct Shot {
    rect: [f32; 4],
    corners: [f32; 4],
    clip: Option<[f32; 4]>,
    cuts: Vec<([f32; 4], [f32; 4])>,
    image: image::RgbaImage,
}

#[cfg(not(feature = "webview"))]
fn snapshots(_window: u32, done: Box<dyn FnOnce(Vec<Shot>) + Send>) {
    done(Vec::new());
}

/// Draws each webview snapshot over the frame at its rect, inside its scroll viewport, rounded
/// by its corner radii, and outside the elements drawn over it.
fn composite(f: &mut rune::CapturedFrame, shots: &[Shot]) {
    let k = f.scale as f32;
    let (fw, fh) = (f.width as i64, f.height as i64);
    for shot in shots {
        let [x, y, w, h] = shot.rect.map(|v| v * k);
        let (pw, ph) = (w.round().max(1.0) as u32, h.round().max(1.0) as u32);
        let img = if shot.image.dimensions() == (pw, ph) {
            std::borrow::Cow::Borrowed(&shot.image)
        } else {
            std::borrow::Cow::Owned(image::imageops::resize(&shot.image, pw, ph, image::imageops::FilterType::Triangle))
        };
        let clip = shot.clip.map(|c| c.map(|v| v * k)).unwrap_or([0.0, 0.0, fw as f32, fh as f32]);
        let radii = shot.corners.map(|r| (r * k).min(w / 2.0).min(h / 2.0));
        let cuts: Vec<([f32; 4], [f32; 4])> = shot.cuts.iter().map(|(c, r)| (c.map(|v| v * k), r.map(|v| (v * k).min(c[2] * k / 2.0).min(c[3] * k / 2.0)))).collect();
        let (x0, y0) = (x.round() as i64, y.round() as i64);
        for py in 0..ph as i64 {
            let gy = y0 + py;
            if gy < 0 || gy >= fh || (gy as f32) < clip[1] || (gy as f32) >= clip[1] + clip[3] {
                continue;
            }
            for px in 0..pw as i64 {
                let gx = x0 + px;
                if gx < 0 || gx >= fw || (gx as f32) < clip[0] || (gx as f32) >= clip[0] + clip[2] {
                    continue;
                }
                let mut cover = corner_cover(px as f32 + 0.5, py as f32 + 0.5, w, h, radii);
                for (c, r) in &cuts {
                    let (cx, cy) = (gx as f32 + 0.5 - c[0], gy as f32 + 0.5 - c[1]);
                    if cx >= 0.0 && cy >= 0.0 && cx < c[2] && cy < c[3] {
                        cover *= 1.0 - corner_cover(cx, cy, c[2], c[3], *r);
                    }
                }
                if cover <= 0.0 {
                    continue;
                }
                let src = img.get_pixel(px as u32, py as u32).0;
                let a = f32::from(src[3]) / 255.0 * cover;
                let i = ((gy * fw + gx) * 4) as usize;
                let dst = &mut f.rgba[i..i + 4];
                let da = f32::from(dst[3]) / 255.0;
                let oa = a + da * (1.0 - a);
                for c in 0..3 {
                    let v = if oa > 0.0 { (f32::from(src[c]) * a + f32::from(dst[c]) * da * (1.0 - a)) / oa } else { 0.0 };
                    dst[c] = v.round().clamp(0.0, 255.0) as u8;
                }
                dst[3] = (oa * 255.0).round() as u8;
            }
        }
    }
}

/// How much of the pixel centred at (x, y) lies inside a w×h box with corner radii
/// (top-left, top-right, bottom-right, bottom-left).
fn corner_cover(x: f32, y: f32, w: f32, h: f32, r: [f32; 4]) -> f32 {
    let (r, cx, cy) = if x < r[0] && y < r[0] {
        (r[0], r[0], r[0])
    } else if x > w - r[1] && y < r[1] {
        (r[1], w - r[1], r[1])
    } else if x > w - r[2] && y > h - r[2] {
        (r[2], w - r[2], h - r[2])
    } else if x < r[3] && y > h - r[3] {
        (r[3], r[3], h - r[3])
    } else {
        return 1.0;
    };
    let d = ((x - cx).powi(2) + (y - cy).powi(2)).sqrt();
    (r - d + 0.5).clamp(0.0, 1.0)
}

/// The engine's mirrored tree under a window (what TS committed), for debugging.
fn tree_json(e: &engine::Engine, n: u32) -> Value {
    let Some(node) = e.tree.get(n) else { return Value::Null };
    let children: Vec<Value> = node.children.iter().map(|c| tree_json(e, *c)).collect();
    json!({ "n": n, "kind": format!("{:?}", node.kind), "id": node.props.id, "content": node.props.content, "children": children })
}

fn write_png(path: &std::path::Path, f: &rune::CapturedFrame) -> Result<Value, String> {
    let png = f.png().ok_or("the frame couldn't be encoded")?;
    if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    std::fs::write(path, png).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(json!({ "path": path.to_string_lossy(), "width": f.width, "height": f.height, "scale": f.scale }))
}

/// Frames a recording reads back and encodes at once; a tick that finds this many still going
/// is dropped, so encodes that fall behind cost frames instead of piling onto the host's and
/// WebKit's CPU.
const MAX_IN_FLIGHT: usize = 8;

fn write_png_fast(path: &std::path::Path, f: &rune::CapturedFrame) -> Result<(), String> {
    use image::ImageEncoder;
    let file = std::fs::File::create(path).map_err(|e| format!("{}: {e}", path.display()))?;
    image::codecs::png::PngEncoder::new_with_quality(std::io::BufWriter::new(file), image::codecs::png::CompressionType::Fast, image::codecs::png::FilterType::Sub)
        .write_image(&f.rgba, f.width, f.height, image::ExtendedColorType::Rgba8)
        .map_err(|e| format!("{}: {e}", path.display()))
}

/// Captures the window's presented frames at `fps` for `seconds` into `dir/frame-NNNNN.png`
/// (numbered without gaps; `dropped` counts ticks skipped while encodes were behind), then
/// replies with how many were written.
#[allow(clippy::too_many_arguments)]
fn record(handle: rune::WindowHandle, window: u32, dir: std::path::PathBuf, fps: f64, seconds: f64, shots: Arc<Mutex<Arc<Vec<Shot>>>>, rid: Option<u64>) {
    let spawned = std::thread::Builder::new().name("stella-record".into()).spawn(move || {
        let start = Instant::now();
        let step = Duration::from_secs_f64(1.0 / fps);
        let (done_tx, done_rx) = std::sync::mpsc::channel::<Result<(), String>>();
        let in_flight = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let (mut asked, mut dropped, mut tick) = (0usize, 0usize, 0u32);
        while start.elapsed().as_secs_f64() < seconds {
            let at = start + step * tick;
            tick += 1;
            if let Some(wait) = at.checked_duration_since(Instant::now()) {
                std::thread::sleep(wait);
            }
            if in_flight.load(std::sync::atomic::Ordering::Acquire) >= MAX_IN_FLIGHT {
                dropped += 1;
                continue;
            }
            in_flight.fetch_add(1, std::sync::atomic::Ordering::AcqRel);
            let path = dir.join(format!("frame-{asked:05}.png"));
            let (done, shots, in_flight) = (done_tx.clone(), shots.clone(), in_flight.clone());
            handle.capture_frame(move |frame| {
                let shots = shots.lock().unwrap_or_else(|e| e.into_inner()).clone();
                let _ = done.send(frame.and_then(|mut f| {
                    composite(&mut f, &shots);
                    write_png_fast(&path, &f)
                }));
                in_flight.fetch_sub(1, std::sync::atomic::Ordering::AcqRel);
            });
            crate::windows::wake_all();
            asked += 1;
        }
        drop(done_tx);
        STOP_RECORDING.lock().unwrap_or_else(|e| e.into_inner()).push(window);
        let mut written = 0usize;
        let mut errors = Vec::new();
        while let Ok(r) = done_rx.recv_timeout(Duration::from_secs(5)) {
            match r {
                Ok(()) => written += 1,
                Err(e) if errors.len() < 3 => errors.push(e),
                Err(_) => {}
            }
        }
        engine::reply_any_thread(rid, Ok(json!({ "dir": dir.to_string_lossy(), "frames": written, "asked": asked, "dropped": dropped, "fps": fps, "errors": errors })));
    });
    if let Err(e) = spawned {
        engine::reply_any_thread(rid, Err(e.to_string()));
    }
}
