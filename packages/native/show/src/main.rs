#![allow(dead_code)]
//! `stella_show`: turns a Show Stella recording into a capture tasks can read, and zooms into
//! moments of it. The selection, marks, auto-crop and rendering are Scrawl's
//! (https://github.com/kitlangton/scrawl, MIT, see LICENSE-scrawl).
//!
//! A recording folder holds `timeline.json` (what Stella saw while recording: target, ink,
//! clicks, keys, cursor and the transcript) and `stream/<ms>.jpg` (the screen a few times a
//! second). `build` writes `capture.json`, `summary.md`, `contact-sheet.png` and `frames/`.

#[path = "scrawl/agent_context.rs"]
mod agent_context;
#[path = "scrawl/autocrop.rs"]
mod autocrop;
#[path = "scrawl/handoff.rs"]
mod handoff;
#[path = "scrawl/keyframes.rs"]
mod keyframes;
#[path = "scrawl/model.rs"]
mod model;
#[path = "scrawl/render.rs"]
mod render;
#[path = "scrawl/sketch.rs"]
mod sketch;
#[path = "scrawl/windows.rs"]
mod windows;
#[path = "scrawl/zoom.rs"]
mod zoom;

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Serialize};

use model::{
    CursorSample, InteractionEvent, Keyframe, KeyframeReason, RgbaFrame, ScrawlBundle, Stroke,
    TargetInfo, TranscriptData, WindowSnapshot,
};

const STREAM_DIR: &str = "stream";
const CANDIDATE_EDGE: u32 = 480;
const KEYFRAME_EDGE: u32 = 1600;
const ZOOM_EDGE: u32 = 900;
const ZOOM_CROPPED_EDGE: u32 = 1280;
const MAX_CANDIDATES: usize = 700;
const MANIFEST: &str = "capture.json";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Timeline {
    id: String,
    created_at_ms: u64,
    duration_ms: u64,
    target: TargetInfo,
    #[serde(default)]
    transcript: TranscriptData,
    #[serde(default)]
    strokes: Vec<Stroke>,
    #[serde(default)]
    events: Vec<InteractionEvent>,
    #[serde(default)]
    cursor: Vec<CursorSample>,
    #[serde(default)]
    windows: Vec<WindowSnapshot>,
    #[serde(default)]
    note: Option<String>,
    #[serde(default)]
    video: Option<String>,
    #[serde(default)]
    audio: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BuildResult<'a> {
    summary: &'a str,
    manifest: String,
    contact_sheet: String,
    contact_sheet_width: u32,
    contact_sheet_height: u32,
    frames: Vec<String>,
    duration_ms: u64,
}

fn usage() -> ! {
    eprintln!(
        "usage:\n  stella_show build <capture folder>\n  stella_show zoom <capture folder> (--at <time or phrase> | --mark <n> | --pin <n>) [--span <seconds>] [--count <n>] [--full]"
    );
    std::process::exit(2)
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("build") => args.get(1).map(PathBuf::from).map(|dir| build(&dir)),
        Some("zoom") => args.get(1).map(PathBuf::from).map(|dir| zoom_cmd(&dir, &args[2..])),
        _ => None,
    };
    match result {
        None => usage(),
        Some(Ok(())) => {}
        Some(Err(error)) => {
            eprintln!("{error:#}");
            std::process::exit(1);
        }
    }
}

/// The stream's frames as `(ms, path)`, in time order.
fn stream_frames(dir: &Path) -> Result<Vec<(u64, PathBuf)>> {
    let stream = dir.join(STREAM_DIR);
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&stream)
        .with_context(|| format!("No frames in {}", stream.display()))?
    {
        let path = entry?.path();
        let Some(t) = path
            .file_stem()
            .and_then(|s| s.to_str())
            .and_then(|s| s.parse::<u64>().ok())
        else {
            continue;
        };
        if path.extension().and_then(|e| e.to_str()) == Some("jpg") {
            out.push((t, path));
        }
    }
    out.sort_by_key(|(t, _)| *t);
    Ok(out)
}

fn decode_jpeg(path: &Path, t_ms: u64) -> Result<RgbaFrame> {
    use zune_jpeg::JpegDecoder;
    use zune_jpeg::zune_core::colorspace::ColorSpace;
    use zune_jpeg::zune_core::options::DecoderOptions;
    let data = std::fs::read(path).with_context(|| format!("could not read {}", path.display()))?;
    let options = DecoderOptions::default().jpeg_set_out_colorspace(ColorSpace::RGBA);
    let mut decoder = JpegDecoder::new_with_options(&data, options);
    let rgba = decoder
        .decode()
        .map_err(|e| anyhow::anyhow!("could not decode {}: {e:?}", path.display()))?;
    let (w, h) = decoder.dimensions().context("JPEG without dimensions")?;
    ensure!(rgba.len() == w * h * 4, "unexpected JPEG layout in {}", path.display());
    Ok(RgbaFrame::new(t_ms, w as u32, h as u32, rgba))
}

/// Box-filtered copy whose longer edge is at most `edge`.
fn downscale(frame: &RgbaFrame, edge: u32) -> RgbaFrame {
    let long = frame.width.max(frame.height);
    if long <= edge || long == 0 {
        return frame.clone();
    }
    let scale = edge as f64 / long as f64;
    let w = ((frame.width as f64 * scale).round() as u32).max(1);
    let h = ((frame.height as f64 * scale).round() as u32).max(1);
    let (sw, sh) = (frame.width as usize, frame.height as usize);
    let mut out = vec![0u8; (w * h * 4) as usize];
    for y in 0..h as usize {
        let y0 = y * sh / h as usize;
        let y1 = ((y + 1) * sh / h as usize).max(y0 + 1).min(sh);
        for x in 0..w as usize {
            let x0 = x * sw / w as usize;
            let x1 = ((x + 1) * sw / w as usize).max(x0 + 1).min(sw);
            let mut acc = [0u32; 4];
            for yy in y0..y1 {
                let row = yy * sw * 4;
                for xx in x0..x1 {
                    let i = row + xx * 4;
                    for c in 0..4 {
                        acc[c] += frame.rgba[i + c] as u32;
                    }
                }
            }
            let n = ((y1 - y0) * (x1 - x0)) as u32;
            let o = (y * w as usize + x) * 4;
            for c in 0..4 {
                out[o + c] = (acc[c] / n) as u8;
            }
        }
    }
    let mut scaled = RgbaFrame::new(frame.t_ms, w, h, out);
    scaled.badge_top_right = frame.badge_top_right;
    scaled
}

/// Decodes `picks` on every core, downscaled to `edge`.
fn decode_many(picks: &[(u64, PathBuf)], edge: u32) -> Vec<RgbaFrame> {
    let workers = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .clamp(1, 8);
    let chunk = picks.len().div_ceil(workers).max(1);
    let mut out: Vec<RgbaFrame> = std::thread::scope(|scope| {
        let handles: Vec<_> = picks
            .chunks(chunk)
            .map(|part| {
                scope.spawn(move || {
                    part.iter()
                        .filter_map(|(t, path)| decode_jpeg(path, *t).ok())
                        .map(|frame| downscale(&frame, edge))
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        handles
            .into_iter()
            .flat_map(|h| h.join().unwrap_or_default())
            .collect()
    });
    out.sort_by_key(|f| f.t_ms);
    out
}

/// At most `MAX_CANDIDATES` frames, evenly thinned, always keeping the frames nearest to ink and
/// clicks.
fn thin_candidates(
    frames: &[(u64, PathBuf)],
    strokes: &[Stroke],
    events: &[InteractionEvent],
) -> Vec<(u64, PathBuf)> {
    if frames.len() <= MAX_CANDIDATES {
        return frames.to_vec();
    }
    let mut keep = vec![false; frames.len()];
    let nearest = |t: u64| {
        frames
            .binary_search_by_key(&t, |(ft, _)| *ft)
            .unwrap_or_else(|i| {
                if i == 0 {
                    0
                } else if i >= frames.len() {
                    frames.len() - 1
                } else if t - frames[i - 1].0 <= frames[i].0 - t {
                    i - 1
                } else {
                    i
                }
            })
    };
    for stroke in strokes {
        keep[nearest(stroke.t1)] = true;
    }
    for event in events {
        let i = nearest(event.timestamp_ms());
        keep[i] = true;
        if i + 1 < frames.len() {
            keep[i + 1] = true;
        }
    }
    let step = frames.len().div_ceil(MAX_CANDIDATES).max(1);
    for i in (0..frames.len()).step_by(step) {
        keep[i] = true;
    }
    frames
        .iter()
        .zip(keep)
        .filter_map(|(f, k)| k.then(|| f.clone()))
        .collect()
}

fn nearest_frame(frames: &[(u64, PathBuf)], t: u64) -> Option<&(u64, PathBuf)> {
    frames.iter().min_by_key(|(ft, _)| ft.abs_diff(t))
}

fn read_timeline(dir: &Path) -> Result<Timeline> {
    let path = dir.join("timeline.json");
    let bytes =
        std::fs::read(&path).with_context(|| format!("could not read {}", path.display()))?;
    let mut timeline: Timeline = serde_json::from_slice(&bytes)
        .with_context(|| format!("{} is not a Show Stella timeline", path.display()))?;
    let transcript = dir.join("transcript.json");
    if transcript.is_file() {
        let bytes = std::fs::read(&transcript)?;
        timeline.transcript = serde_json::from_slice(&bytes)
            .with_context(|| format!("{} is not a transcript", transcript.display()))?;
    }
    Ok(timeline)
}

fn zoom_hint(dir: &Path) -> String {
    let exe = std::env::current_exe()
        .ok()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| "stella_show".into());
    format!(
        "To look closer at a moment (motion, or something between the numbered frames), run: \"{exe}\" zoom \"{}\" --at <time like 0:12, or words that were said> (or --mark <n>, --pin <n>)\n",
        dir.display()
    )
}

fn build(dir: &Path) -> Result<()> {
    let timeline = read_timeline(dir)?;
    let stream = stream_frames(dir)?;
    ensure!(!stream.is_empty(), "The recording has no frames");
    let duration_ms = timeline.duration_ms;

    let picks = thin_candidates(&stream, &timeline.strokes, &timeline.events);
    let candidates = decode_many(&picks, CANDIDATE_EDGE);
    ensure!(!candidates.is_empty(), "No frame of the recording could be read");

    let mut marks = sketch::marks_of(&timeline.strokes);
    let selected = keyframes::select_keyframes(
        &candidates,
        &timeline.strokes,
        &mut marks,
        &timeline.events,
        &timeline.transcript,
        model::keyframe_budget(duration_ms),
    );
    let baseline = candidates.first().cloned();
    drop(candidates);

    // Keyframes at full size: the stream frame each candidate came from.
    let full_picks: Vec<(u64, PathBuf)> = selected
        .iter()
        .filter_map(|(kf, _)| nearest_frame(&stream, kf.t).cloned())
        .collect();
    let full = decode_many(&full_picks, KEYFRAME_EDGE);
    let selected: Vec<(Keyframe, RgbaFrame)> = selected
        .into_iter()
        .map(|(kf, small)| {
            let found = nearest_frame(&stream, kf.t)
                .and_then(|(t, _)| full.iter().find(|f| f.t_ms == *t))
                .cloned();
            match found {
                Some(mut frame) => {
                    frame.t_ms = kf.t;
                    frame.badge_top_right = small.badge_top_right;
                    (kf, frame)
                }
                None => (kf, small),
            }
        })
        .collect();

    let settings = autocrop::Settings::configured();
    let (mut annotated, mut cropped) = autocrop::annotate_and_crop(
        selected,
        baseline.as_ref(),
        settings.as_ref(),
        &timeline.target,
        duration_ms,
        &timeline.strokes,
        &marks,
        &timeline.events,
        &timeline.windows,
        &timeline.cursor,
    );
    let keyframes: Vec<Keyframe> = annotated.iter().map(|(kf, _)| kf.clone()).collect();
    let (full_sheet, contact_sheet) = std::thread::scope(|scope| {
        let full_handle = cropped.as_ref().map(|(_, full)| {
            scope.spawn(|| render::render_contact_sheet_for_duration(duration_ms, full))
        });
        let sheet = render::render_contact_sheet_for_duration(duration_ms, &annotated);
        (full_handle.map(|h| h.join().unwrap()), sheet)
    });
    render::stamp_keyframe_badges(&mut annotated);
    if let Some((_, full)) = &mut cropped {
        render::stamp_keyframe_badges(full);
    }
    let autocrop_info = cropped.as_ref().map(|(info, _)| info.clone());

    let bundle = ScrawlBundle {
        version: 1,
        id: timeline.id,
        created_at_ms: timeline.created_at_ms,
        duration_ms,
        target: timeline.target,
        transcript: timeline.transcript,
        note: timeline.note,
        strokes: timeline.strokes,
        marks,
        events: timeline.events,
        keyframes,
        contact_sheet: "contact-sheet.png".into(),
        video: timeline.video.filter(|v| dir.join(v).is_file()),
        video_offset_ms: 0,
        audio: timeline.audio.filter(|a| dir.join(a).is_file()),
        source: None,
        device: None,
        context: Default::default(),
        context_changes: Vec::new(),
        screens: Vec::new(),
        windows: timeline.windows,
        cursor: timeline.cursor,
        autocrop: autocrop_info,
        destination: None,
    };
    let mut summary = sketch::summary_markdown(&bundle, dir);
    summary.push_str(&zoom_hint(dir));

    std::fs::create_dir_all(dir.join("frames"))?;
    std::thread::scope(|scope| -> Result<()> {
        let mut workers = Vec::new();
        for (kf, frame) in &annotated {
            let path = dir.join(&kf.file);
            workers.push(scope.spawn(move || render::save_png(frame, &path)));
        }
        if let (Some((info, full)), Some(sheet)) = (&cropped, &full_sheet) {
            workers.push(scope.spawn(move || autocrop::write_full_frames(dir, info, full, sheet)));
        }
        render::save_png(&contact_sheet, &dir.join(&bundle.contact_sheet))?;
        for worker in workers {
            worker
                .join()
                .map_err(|_| anyhow::anyhow!("A frame writer stopped"))??;
        }
        Ok(())
    })?;
    std::fs::write(dir.join(MANIFEST), serde_json::to_vec_pretty(&bundle)?)?;
    std::fs::write(dir.join("summary.md"), summary.as_bytes())?;

    let result = BuildResult {
        summary: &summary,
        manifest: dir.join(MANIFEST).display().to_string(),
        contact_sheet: dir.join(&bundle.contact_sheet).display().to_string(),
        contact_sheet_width: contact_sheet.width,
        contact_sheet_height: contact_sheet.height,
        frames: bundle
            .keyframes
            .iter()
            .map(|k| dir.join(&k.file).display().to_string())
            .collect(),
        duration_ms,
    };
    println!("{}", serde_json::to_string(&result)?);
    Ok(())
}

fn flag<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .map(String::as_str)
}

fn zoom_cmd(dir: &Path, args: &[String]) -> Result<()> {
    let manifest = dir.join(MANIFEST);
    let bundle: ScrawlBundle = serde_json::from_slice(
        &std::fs::read(&manifest)
            .with_context(|| format!("{} is not a Show Stella capture", dir.display()))?,
    )?;
    let stream = stream_frames(dir).map_err(|_| {
        anyhow::anyhow!(
            "This capture's recording was cleared to save space; only the numbered frames are left"
        )
    })?;
    ensure!(!stream.is_empty(), "This capture has no recording left to zoom into");
    let span_ms = flag(args, "--span")
        .and_then(|s| s.trim_end_matches('s').parse::<f64>().ok())
        .map(|s| (s * 1000.0).round() as u64)
        .unwrap_or(2_000);
    let count = flag(args, "--count")
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(12);
    let cropped = !args.iter().any(|a| a == "--full");

    let mark = if let Some(n) = flag(args, "--pin") {
        let n: u32 = n.trim_start_matches('#').parse().context("--pin takes a number")?;
        Some(
            bundle
                .marks
                .iter()
                .find(|m| m.pin == Some(n))
                .with_context(|| format!("There is no pin {n}"))?,
        )
    } else if let Some(id) = flag(args, "--mark") {
        let id = id.trim_start_matches('#');
        let wanted = if id.chars().all(|c| c.is_ascii_digit()) {
            format!("m{id}")
        } else {
            id.to_owned()
        };
        Some(
            bundle
                .marks
                .iter()
                .find(|m| m.id == wanted)
                .with_context(|| format!("There is no mark {id}"))?,
        )
    } else {
        None
    };
    let (from_ms, to_ms) = match (mark, flag(args, "--at")) {
        (Some(mark), _) => zoom::mark_window(mark.t0, mark.t1, span_ms, bundle.duration_ms),
        (None, Some(at)) => {
            let at_ms = zoom::resolve_moment(&bundle, at)?;
            ensure!(
                at_ms <= bundle.duration_ms,
                "{} is past the end ({})",
                zoom::clock(at_ms),
                zoom::clock(bundle.duration_ms)
            );
            zoom::window(at_ms, span_ms, bundle.duration_ms)
        }
        (None, None) => bail!("Say where to zoom: --at <time or phrase>, --mark <n> or --pin <n>"),
    };
    let mark_crop = mark
        .and_then(|m| bundle.keyframes.iter().position(|k| k.mark_id.as_deref() == Some(&m.id)))
        .map(|k| zoom::crop_of(&bundle, k));

    let mut picks: Vec<(u64, PathBuf)> = Vec::new();
    for t in zoom::sample_times(from_ms, to_ms, count) {
        if let Some(found) = nearest_frame(&stream, t)
            && !picks.iter().any(|(pt, _)| *pt == found.0)
        {
            picks.push(found.clone());
        }
    }
    let crops: Vec<Option<autocrop::Rect>> = picks
        .iter()
        .map(|(t, _)| {
            mark_crop
                .unwrap_or_else(|| zoom::crop_at(&bundle, *t))
                .filter(|_| cropped)
        })
        .collect();
    let mut frames: Vec<RgbaFrame> = Vec::with_capacity(picks.len());
    for ((t, path), rect) in picks.iter().zip(&crops) {
        let frame = decode_jpeg(path, *t)?;
        frames.push(match rect {
            Some(r) => downscale(&autocrop::crop_frame(&frame, *r), ZOOM_CROPPED_EDGE),
            None => downscale(&frame, ZOOM_EDGE),
        });
    }
    ensure!(!frames.is_empty(), "No frames could be read");
    let mut cells = Vec::new();
    for (i, frame) in frames.iter_mut().enumerate() {
        let t = frame.t_ms;
        let events = zoom::events_at(&bundle.events, t);
        let rect = crops.get(i).copied().flatten().unwrap_or(autocrop::FULL);
        let cell_width = if frame.height > frame.width { 300.0 } else { 480.0 };
        let label_scale = frame.width as f32 / cell_width;
        let keyframe = Keyframe {
            index: i + 1,
            t,
            reason: KeyframeReason::Speech,
            file: String::new(),
            event: String::new(),
            said: None,
            mark_id: mark.filter(|m| t >= m.t0).map(|m| m.id.clone()),
            cursor: None,
        };
        let view = autocrop::crop_view(rect, &keyframe, &bundle.strokes, &bundle.marks, &events);
        render::annotate_keyframe_in_place(frame, &view.keyframe, &view.strokes, &view.marks, &view.events);
        render::draw_time_label(frame, &zoom::clock(t), label_scale);
        cells.push(format!("{} {}", i + 1, zoom::clock(t)));
    }
    let sheet = render::render_zoom_sheet(&frames);
    let out_dir = dir.join("zoom");
    std::fs::create_dir_all(&out_dir)?;
    let path = out_dir.join(format!("zoom-{from_ms}-{to_ms}.png"));
    render::save_png(&sheet, &path)?;
    println!("{}", path.display());
    println!(
        "{} frames from {} to {}: {}",
        cells.len(),
        zoom::clock(from_ms),
        zoom::clock(to_ms),
        cells.join(" · ")
    );
    let said = zoom::said_between(&bundle, from_ms, to_ms);
    if !said.trim().is_empty() {
        println!("Said: “{}”", said.trim());
    }
    Ok(())
}
