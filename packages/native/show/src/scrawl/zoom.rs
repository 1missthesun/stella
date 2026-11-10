//! From Scrawl's `zoom.rs`: picking the window and times of a zoom sheet. Stella reads the
//! frames from the capture's own frame stream instead of decoding a movie.
use anyhow::{Context, Result};

use crate::model::{InteractionEvent, ScrawlBundle, parse_clock_ms};


fn normalize(text: &str) -> String {
    text.chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .to_lowercase()
}

/// Where `phrase` starts in the narration: the first run of transcript words matching it, else
/// the segment containing it.
pub fn find_phrase_ms(bundle: &ScrawlBundle, phrase: &str) -> Option<u64> {
    let needle: Vec<String> = normalize(phrase)
        .split_whitespace()
        .map(str::to_owned)
        .collect();
    if needle.is_empty() {
        return None;
    }
    let words = &bundle.transcript.words;
    let tokens: Vec<String> = words
        .iter()
        .map(|w| normalize(&w.text).replace(' ', ""))
        .collect();
    let matched = (0..tokens.len()).find(|&i| {
        needle
            .iter()
            .enumerate()
            .all(|(j, n)| tokens.get(i + j).is_some_and(|t| t == n))
    });
    if let Some(i) = matched {
        return Some(words[i].t0);
    }
    let joined = needle.join(" ");
    bundle
        .transcript
        .segments
        .iter()
        .find(|s| {
            normalize(&s.text)
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .contains(&joined)
        })
        .map(|s| s.t0)
}

/// Resolves `--at`: a time (`0:12`, `12.5`) or a phrase from the narration.
pub fn resolve_moment(bundle: &ScrawlBundle, at: &str) -> Result<u64> {
    parse_clock_ms(at)
        .or_else(|| find_phrase_ms(bundle, at))
        .with_context(|| format!("“{at}” is neither a time nor a phrase in the narration"))
}

/// The window around `at_ms`: a quarter before, the rest after, since what the narration points
/// at usually happens as or just after it is said. Clamped to the recording.
pub fn window(at_ms: u64, span_ms: u64, duration_ms: u64) -> (u64, u64) {
    let span = span_ms.clamp(200, duration_ms.max(200));
    let mut from = at_ms.saturating_sub(span / 4);
    let mut to = from + span;
    if to > duration_ms {
        to = duration_ms;
        from = to.saturating_sub(span);
    }
    (from, to)
}

/// The window centred on a mark drawn over `[t0, t1]`: at least `span_ms`, and the whole mark
/// with half a second either side. Clamped to the recording.
pub fn mark_window(t0: u64, t1: u64, span_ms: u64, duration_ms: u64) -> (u64, u64) {
    let span = span_ms
        .max(t1.saturating_sub(t0) + 1_000)
        .clamp(200, duration_ms.max(200));
    let mut from = ((t0 + t1) / 2).saturating_sub(span / 2);
    let mut to = from + span;
    if to > duration_ms {
        to = duration_ms;
        from = to.saturating_sub(span);
    }
    (from, to)
}


/// Evenly spaced times across `[from, to]`, both ends included.
pub fn sample_times(from: u64, to: u64, count: usize) -> Vec<u64> {
    let count = count.clamp(1, 48);
    if count == 1 || to <= from {
        return vec![from];
    }
    (0..count)
        .map(|i| from + (to - from) * i as u64 / (count - 1) as u64)
        .collect()
}

/// How much of a gesture still under way a cell shows: the finger now and its recent path.
const TRAIL_MS: u64 = 350;

/// The interactions as they stood at `t`. A drag still under way is cut to its last
/// `TRAIL_MS`, so the cell shows where the finger is rather than the whole gesture to come
/// (its samples are evenly spaced in time, so a point's index gives its time).
pub fn events_at(events: &[InteractionEvent], t: u64) -> Vec<InteractionEvent> {
    events
        .iter()
        .map(|event| match event {
            InteractionEvent::Drag {
                t: t0,
                t1,
                path,
                label,
                button,
                ..
            } if *t0 <= t && t < *t1 && path.len() >= 2 => {
                let n = path.len() as u64;
                let at = |i: usize| t0 + (t1 - t0) * i as u64 / (n - 1);
                let done: Vec<usize> = (0..path.len()).filter(|&i| at(i) <= t).collect();
                let last = *done.last().unwrap_or(&0);
                let mut kept: Vec<[f32; 2]> = done
                    .into_iter()
                    .filter(|&i| at(i) + TRAIL_MS >= t)
                    .map(|i| path[i])
                    .collect();
                if kept.is_empty() {
                    kept.push(path[last]);
                }
                let [x0, y0] = kept[0];
                let [x1, y1] = kept[kept.len() - 1];
                InteractionEvent::Drag {
                    t: t.saturating_sub(TRAIL_MS).max(*t0),
                    t1: t,
                    x0,
                    y0,
                    x1,
                    y1,
                    label: label.clone(),
                    button: button.clone(),
                    path: kept,
                }
            }
            other => other.clone(),
        })
        .collect()
}

pub fn clock(ms: u64) -> String {
    format!("{}:{:02}.{:03}", ms / 60_000, ms / 1_000 % 60, ms % 1_000)
}

pub fn said_between(bundle: &ScrawlBundle, from: u64, to: u64) -> String {
    let words: Vec<&str> = bundle
        .transcript
        .words
        .iter()
        .filter(|w| w.t1 >= from && w.t0 <= to)
        .map(|w| w.text.as_str())
        .collect();
    if !words.is_empty() {
        return words.join(" ");
    }
    bundle
        .transcript
        .segments
        .iter()
        .filter(|s| s.t1 >= from && s.t0 <= to)
        .map(|s| s.text.trim())
        .collect::<Vec<_>>()
        .join(" ")
}

/// The auto-crop of the keyframe nearest `t` (keyframe crops meet halfway between keyframes).
pub fn crop_at(bundle: &ScrawlBundle, t: u64) -> Option<crate::autocrop::Rect> {
    let (k, _) = bundle
        .keyframes
        .iter()
        .enumerate()
        .min_by_key(|(_, kf)| kf.t.abs_diff(t))?;
    crop_of(bundle, k)
}

/// The auto-crop of the `k`th keyframe (0-based).
pub fn crop_of(bundle: &ScrawlBundle, k: usize) -> Option<crate::autocrop::Rect> {
    let crop = bundle.autocrop.as_ref()?.crops.get(k)?;
    (crop.kind != crate::autocrop::CropKind::Full).then(|| crop.rect(&bundle.target.frame))
}

