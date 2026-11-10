use crate::model::*;
use std::f32::consts::PI;

pub fn bounds(points: &[[f32; 2]]) -> [f32; 4] {
    let Some(&[x, y]) = points.first() else {
        return [0.0; 4];
    };
    points.iter().fold([x, y, x, y], |b, p| {
        [
            b[0].min(p[0]),
            b[1].min(p[1]),
            b[2].max(p[0]),
            b[3].max(p[1]),
        ]
    })
}

fn distance(a: [f32; 2], b: [f32; 2]) -> f32 {
    (a[0] - b[0]).hypot(a[1] - b[1])
}

#[cfg(test)]
pub fn shape_of(stroke: &Stroke) -> Shape {
    ink_of(stroke).shape
}

/// One stroke's shape and what a mark needs from it, in normalized coordinates.
struct Ink {
    shape: Shape,
    /// What the stroke covers: a circle's loop without its lead-in or tail, else the whole stroke.
    region: [f32; 4],
    /// A one-stroke arrow's shaft start and tip.
    ends: Option<([f32; 2], [f32; 2])>,
}

fn ink_of(stroke: &Stroke) -> Ink {
    let norm = stroke.normalized_points();
    let region = bounds(&norm);
    let plain = |shape| Ink {
        shape,
        region,
        ends: None,
    };
    if stroke.pin.is_some() {
        return plain(Shape::Pin);
    }
    let points: Vec<_> = norm
        .iter()
        .map(|p| [p[0] * stroke.fw as f32, p[1] * stroke.fh as f32])
        .collect();
    let Some(&first) = points.first() else {
        return plain(Shape::Tap);
    };
    let b = bounds(&points);
    let (w, h) = (b[2] - b[0], b[3] - b[1]);
    let len: f32 = points.windows(2).map(|p| distance(p[0], p[1])).sum();
    let last = *points.last().unwrap();
    let chord = distance(first, last);
    let shoelace = points
        .windows(2)
        .map(|p| p[0][0] * p[1][1] - p[1][0] * p[0][1])
        .sum::<f32>()
        + last[0] * first[1]
        - first[0] * last[1];
    let loop_box = || loop_in(&points).map(|(i, j)| bounds(&norm[i..=j]));
    if w.hypot(h) < 14.0 {
        plain(Shape::Tap)
    } else if encloses(chord, 0.35, len, b, 0.5 * shoelace.abs()) {
        // A short tail or lead-in can still end close enough to count; what was circled is the
        // loop inside it. A stroke that goes round more than once keeps its whole box.
        Ink {
            shape: Shape::Circle,
            region: (len <= 1.5 * round(b))
                .then(loop_box)
                .flatten()
                .unwrap_or(region),
            ends: None,
        }
    } else if chord > 0.88 * len {
        plain(if w > 2.5 * h {
            Shape::Underline
        } else {
            Shape::Line
        })
    } else if let Some(region) = loop_box() {
        Ink {
            shape: Shape::Circle,
            region,
            ends: None,
        }
    } else if let Some(tip) = arrow_tip(&points, w.max(h)) {
        Ink {
            shape: Shape::Arrow,
            region,
            ends: Some((norm[0], norm[tip])),
        }
    } else {
        plain(Shape::Mark)
    }
}

/// The most points [`loop_in`] tries as a loop's ends.
const MAX_LOOP_POINTS: usize = 512;

/// Ramanujan's approximation of the perimeter of the ellipse filling box `b`.
fn round(b: [f32; 4]) -> f32 {
    let (w, h) = (b[2] - b[0], b[3] - b[1]);
    PI / 2.0 * (3.0 * (w + h) - ((3.0 * w + h) * (w + 3.0 * h)).sqrt())
}

/// Whether a path (pixels) with these measures goes round something: it ends within `max_gap` of
/// its long side of where it began, is longer than twice its long side, fills a third of its box,
/// and the box's short side is over 0.42 of its long side. Flatter loops, to 5:1, count too (a
/// wide cell or a line of text is circled with a flat loop) when they also close well within
/// their short side, so a flat C doesn't, and go round at most three times (with slack for
/// jitter), so a scribble over a line of text, which closes on itself and fills its box too,
/// doesn't either.
fn encloses(gap: f32, max_gap: f32, len: f32, b: [f32; 4], area: f32) -> bool {
    let (w, h) = (b[2] - b[0], b[3] - b[1]);
    let (big, small) = (w.max(h), w.min(h));
    gap < max_gap * big
        && len > 2.0 * big
        && small >= 18.0
        && area > 0.32 * w * h
        && (small > 0.42 * big || (small > 0.2 * big && gap < 0.6 * small && len <= 3.5 * round(b)))
}

/// The loop inside a stroke (pixels) that circles something once before or after a lead-in,
/// tail or overshoot: the stretch `i..=j`, at least 0.6 of the stroke's length, whose ends meet
/// (within 0.15 of its size), that [`encloses`] its box and goes round it at most one and a half
/// times. Of several, the one whose ends meet closest.
///
/// Trying every pair of ends is quadratic and imported strokes have no point cap, so the ends
/// are tried at every `step`th point only, but each stretch is judged by the recorded path's own
/// length and area (prefix sums over every point), so sampling can't hide backtracking or turns.
fn loop_in(points: &[[f32; 2]]) -> Option<(usize, usize)> {
    let n = points.len();
    if n < 3 {
        return None;
    }
    // Length along the path, and twice the shoelace area, up to each point (f64: pixel products
    // are too big to subtract precisely in f32, and long strokes add up many segments).
    let mut run = Vec::with_capacity(n);
    let mut twice_area = Vec::with_capacity(n);
    run.push(0.0f64);
    twice_area.push(0.0f64);
    for p in points.windows(2) {
        run.push(run.last().unwrap() + distance(p[0], p[1]) as f64);
        twice_area.push(
            twice_area.last().unwrap() + p[0][0] as f64 * p[1][1] as f64
                - p[1][0] as f64 * p[0][1] as f64,
        );
    }
    let total = run[n - 1];
    let step = n.div_ceil(MAX_LOOP_POINTS);
    let mut ends: Vec<usize> = (0..n).step_by(step).collect();
    if ends.last() != Some(&(n - 1)) {
        ends.push(n - 1);
    }
    let mut best: Option<(f32, usize, usize)> = None;
    for (k, &i) in ends.iter().enumerate() {
        let a = points[i];
        let mut b = [a[0], a[1], a[0], a[1]];
        for &j in &ends[k + 1..] {
            let z = points[j];
            b = [
                b[0].min(z[0]),
                b[1].min(z[1]),
                b[2].max(z[0]),
                b[3].max(z[1]),
            ];
            let len = run[j] - run[i];
            if len < 0.6 * total {
                continue;
            }
            let gap = distance(a, z);
            let closeness = gap / (b[2] - b[0]).max(b[3] - b[1]);
            if best.is_some_and(|(c, ..)| closeness >= c) {
                continue;
            }
            let len = len as f32;
            let twice = twice_area[j] - twice_area[i] + z[0] as f64 * a[1] as f64
                - a[0] as f64 * z[1] as f64;
            if len <= 1.5 * round(b) && encloses(gap, 0.15, len, b, 0.5 * twice.abs() as f32) {
                best = Some((closeness, i, j));
            }
        }
    }
    best.map(|(_, i, j)| (i, j))
}

/// How far `p` is from the line through `a` and `b`.
fn off_line(p: [f32; 2], a: [f32; 2], b: [f32; 2]) -> f32 {
    ((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])).abs() / distance(a, b)
}

/// The tip of an arrow drawn in one stroke (pixels, `big` its box's long side): a straight shaft
/// from the first point to the tip, where the stroke turns back into one or two straight barbs
/// that end behind the tip, and the head reaches both sides of the shaft. Two barbs (out, back
/// and out again) are each at most 0.9 of the shaft; a lone barb, which must then run on across
/// the shaft, is at most 0.6 of it and clearly off it. An underline whose end hooks back to one
/// side, check marks, V's and zigzags fail.
fn arrow_tip(points: &[[f32; 2]], big: f32) -> Option<usize> {
    let start = points[0];
    // The tip is where the stroke first heads back toward its start, once half its size away.
    let mut tip = 0;
    let mut turned = false;
    for (i, &p) in points.iter().enumerate() {
        let (d, far) = (distance(start, p), distance(start, points[tip]));
        if d >= far {
            tip = i;
        } else if far >= 0.5 * big && d < 0.85 * far {
            turned = true;
            break;
        }
    }
    let t = points[tip];
    let shaft = distance(start, t);
    if !turned
        || points[..tip]
            .iter()
            .any(|&p| off_line(p, start, t) > 0.1 * shaft)
    {
        return None;
    }
    // The direction the shaft arrives in, over its last 30%.
    let arc: f32 = points[..=tip]
        .windows(2)
        .map(|p| distance(p[0], p[1]))
        .sum();
    let mut run = 0.0;
    let back = (0..tip)
        .find(|&i| {
            run += distance(points[i], points[i + 1]);
            run >= 0.7 * arc
        })
        .unwrap_or(0);
    let along = distance(points[back], t);
    if along < 1.0 {
        return None;
    }
    let dir = [
        (t[0] - points[back][0]) / along,
        (t[1] - points[back][1]) / along,
    ];
    // Barbs: runs away from the tip by at least `slack`, each from the nearest point before it.
    let slack = 0.15 * shaft;
    let mut barbs: Vec<(usize, usize)> = Vec::new();
    let (mut out, mut near, mut rising) = (tip, tip, true);
    for (i, &p) in points.iter().enumerate().skip(tip + 1) {
        if (p[0] - t[0]) * dir[0] + (p[1] - t[1]) * dir[1] > slack {
            return None;
        }
        let d = distance(t, p);
        if rising {
            if d >= distance(t, points[out]) {
                out = i;
            } else if d < distance(t, points[out]) - slack {
                barbs.push((near, out));
                (near, rising) = (i, false);
            }
        } else if d <= distance(t, points[near]) {
            near = i;
        } else if d > distance(t, points[near]) + slack {
            (out, rising) = (i, true);
        }
    }
    if rising && distance(t, points[out]) >= slack {
        barbs.push((near, out));
    }
    let cos = |deg: f32| deg.to_radians().cos();
    // Each barb's length and the cosine of its angle to the shaft pointing back.
    let mut measured = Vec::with_capacity(barbs.len());
    for (from, end) in barbs {
        let (a, z) = (points[from], points[end]);
        let span = distance(a, z);
        if points[from..=end]
            .iter()
            .any(|&p| off_line(p, a, z) > 0.15 * span)
        {
            return None;
        }
        let e = [z[0] - t[0], z[1] - t[1]];
        let d = e[0].hypot(e[1]);
        let c = -(e[0] * dir[0] + e[1] * dir[1]) / d;
        if d > 0.9 * shaft || c < cos(75.0) {
            return None;
        }
        measured.push((d, c));
    }
    let head = match measured[..] {
        [(d, c)] => d <= 0.6 * shaft && c <= cos(15.0),
        [(_, c0), (_, c1)] => c0.max(c1) <= cos(5.0),
        _ => false,
    };
    // The head spreads to both sides of the shaft; an underline that hooks back doesn't.
    let side = |p: [f32; 2]| dir[0] * (p[1] - t[1]) - dir[1] * (p[0] - t[0]);
    let reach = |sign: f32| {
        points[tip..]
            .iter()
            .map(|&p| sign * side(p))
            .fold(0.0, f32::max)
    };
    let (left, right) = (reach(1.0), reach(-1.0));
    (head && left.min(right) > 0.3 * left.max(right)).then_some(tip)
}

pub fn marks_of(strokes: &[Stroke]) -> Vec<Mark> {
    let mut groups: Vec<Vec<usize>> = Vec::new();
    for (i, stroke) in strokes.iter().enumerate().filter(|(_, s)| !s.laser) {
        if let Some(group) = groups.last_mut() {
            let prev = &strokes[*group.last().unwrap()];
            if prev.pin.is_none()
                && stroke.pin.is_none()
                && stroke.t0.saturating_sub(prev.t1) <= MARK_GAP_MS
                && group.len() < MAX_MARK_STROKES
            {
                group.push(i);
                continue;
            }
        }
        groups.push(vec![i]);
    }
    groups
        .into_iter()
        .enumerate()
        .map(|(i, group)| {
            let first = &strokes[group[0]];
            let all: Vec<_> = group
                .iter()
                .flat_map(|&j| strokes[j].normalized_points())
                .collect();
            let mut mark = Mark {
                id: format!("m{}", i + 1),
                t0: first.t0,
                t1: group
                    .iter()
                    .map(|&j| strokes[j].t1)
                    .max()
                    .unwrap_or(first.t1),
                box_norm: bounds(&all),
                shape: Shape::Mark,
                from: None,
                to: None,
                pin: first.pin,
                on: group.iter().find_map(|&j| strokes[j].on.clone()),
                strokes: group.clone(),
                description: String::new(),
                frame: None,
            };
            if first.pin.is_some() {
                let [x, y] = first
                    .normalized_points()
                    .first()
                    .copied()
                    .unwrap_or([0.0; 2]);
                mark.box_norm = [x, y, x, y];
                mark.shape = Shape::Pin;
            } else {
                let mut sized: Vec<_> = group
                    .iter()
                    .map(|&j| {
                        let s = &strokes[j];
                        let pts = s.normalized_points();
                        let b = bounds(&pts);
                        let size = (b[2] - b[0]) * s.fw as f32 + (b[3] - b[1]) * s.fh as f32;
                        (s, ink_of(s), b, pts, size)
                    })
                    .collect();
                sized.sort_by(|a, b| b.4.total_cmp(&a.4));
                let (main, ink, _, pts, _) = &sized[0];
                let shape = &ink.shape;
                let rest = &sized[1..];
                let a = pts.first().copied().unwrap_or([0.0; 2]);
                let z = pts.last().copied().unwrap_or(a);
                if matches!(shape, Shape::Line | Shape::Underline) && (1..=2).contains(&rest.len())
                {
                    let px = |p: [f32; 2]| [p[0] * main.fw as f32, p[1] * main.fh as f32];
                    let len = distance(px(a), px(z));
                    let near = |p| {
                        rest.iter().all(|r| {
                            distance(
                                px([(r.2[0] + r.2[2]) / 2.0, (r.2[1] + r.2[3]) / 2.0]),
                                px(p),
                            ) < 0.35 * len
                        })
                    };
                    if near(z) || near(a) {
                        mark.shape = Shape::Arrow;
                        mark.from = Some(if near(z) { a } else { z });
                        mark.to = Some(if near(z) { z } else { a });
                    }
                }
                if mark.shape != Shape::Arrow
                    && (rest.iter().all(|r| r.1.shape == *shape) || *shape == Shape::Circle)
                {
                    match shape {
                        Shape::Circle => {
                            mark.shape = Shape::Circle;
                            // What was circled: the loops, without any lead-in or tail.
                            mark.box_norm = if rest.iter().all(|r| r.1.shape == Shape::Circle) {
                                bounds(
                                    &sized
                                        .iter()
                                        .flat_map(|r| {
                                            let [x0, y0, x1, y1] = r.1.region;
                                            [[x0, y0], [x1, y1]]
                                        })
                                        .collect::<Vec<_>>(),
                                )
                            } else {
                                ink.region
                            };
                        }
                        Shape::Line if rest.is_empty() => {
                            mark.shape = Shape::Line;
                            mark.from = Some(a);
                            mark.to = Some(z);
                        }
                        Shape::Arrow if rest.is_empty() => {
                            mark.shape = Shape::Arrow;
                            mark.from = ink.ends.map(|e| e.0);
                            mark.to = ink.ends.map(|e| e.1);
                        }
                        Shape::Tap | Shape::Underline => mark.shape = *shape,
                        _ => {}
                    }
                }
            }
            mark.description = describe_mark(&mark);
            mark
        })
        .collect()
}

fn at([x, y]: [f32; 2]) -> String {
    format!("x {x:.2}, y {y:.2}")
}

pub fn describe_mark(mark: &Mark) -> String {
    let [x0, y0, x1, y1] = mark.box_norm;
    let region = format!("x {x0:.2}–{x1:.2}, y {y0:.2}–{y1:.2}");
    let many = if mark.strokes.len() > 1 {
        format!(" ({} strokes)", mark.strokes.len())
    } else {
        String::new()
    };
    let mut text = match mark.shape {
        Shape::Circle => format!("circled region {region}{many}"),
        Shape::Underline => format!(
            "underlined x {x0:.2}–{x1:.2} at y {:.2}{many}",
            (y0 + y1) / 2.0
        ),
        Shape::Line => format!(
            "drew a line from {} to {}",
            at(mark.from.unwrap_or([x0, y0])),
            at(mark.to.unwrap_or([x1, y1]))
        ),
        Shape::Arrow => format!(
            "drew an arrow from {} pointing to {}",
            at(mark.from.unwrap_or([x0, y0])),
            at(mark.to.unwrap_or([x1, y1]))
        ),
        Shape::Pin => format!("pin {} at {}", mark.pin.unwrap_or(1), at([x0, y0])),
        Shape::Tap => format!("tapped {}{many}", at([(x0 + x1) / 2.0, (y0 + y1) / 2.0])),
        Shape::Mark => format!("marked region {region}{many}"),
        Shape::Flag => "flagged this moment".into(),
    };
    if let Some(on) = &mark.on {
        text.push_str(&format!(" over {}", quote_label(on)));
    }
    text
}

/// A label in curly quotes, unless it already quotes its own parts (`button “Area” #area` from
/// `crate::ax`, `<div.capsule> in Pill (src/Pill.tsx:42)` from `crate::page`).
pub(crate) fn quote_label(label: &str) -> String {
    if label.contains('“') || label.starts_with('<') {
        label.to_owned()
    } else {
        format!("“{label}”")
    }
}

/// Whether `mark` belongs to `keyframe` (by `mark_id` or shared `frame` file).
pub fn mark_on_keyframe(mark: &Mark, keyframe: &Keyframe) -> bool {
    keyframe.mark_id.as_ref() == Some(&mark.id)
        || (!keyframe.file.is_empty() && mark.frame.as_ref() == Some(&keyframe.file))
}

/// The inked marks a keyframe draws (every mark of its screen's group), in drawing order.
pub fn marks_on<'a>(keyframe: &Keyframe, marks: &'a [Mark]) -> Vec<&'a Mark> {
    let mut shown: Vec<&Mark> = marks
        .iter()
        .filter(|m| !m.strokes.is_empty() && mark_on_keyframe(m, keyframe))
        .collect();
    shown.sort_by_key(|m| m.t0);
    shown
}

/// Coalesce each label independently, even when other events occur during a burst.
pub fn settled_events(events: &[InteractionEvent]) -> Vec<InteractionEvent> {
    let mut sorted = events.to_vec();
    sorted.sort_by_key(InteractionEvent::timestamp_ms);
    let mut out: Vec<InteractionEvent> = Vec::new();
    for mut event in sorted {
        let prior = out.iter().rposition(|prev| match (prev, &event) {
            (
                InteractionEvent::Click {
                    t: a,
                    x: x0,
                    y: y0,
                    button: b0,
                    label: l0,
                    ..
                },
                InteractionEvent::Click {
                    t: b,
                    x: x1,
                    y: y1,
                    button: b1,
                    label: l1,
                    ..
                },
            ) => {
                b0 == b1
                    && l0 == l1
                    && b.saturating_sub(*a) <= 650
                    && (x1 - x0).hypot(y1 - y0) <= 0.03
            }
            (
                InteractionEvent::Scroll { t: a, label: x, .. },
                InteractionEvent::Scroll { t: b, label: y, .. },
            ) => x == y && b.saturating_sub(*a) < 1500,
            (
                InteractionEvent::Point { t: a, label: x, .. },
                InteractionEvent::Point { t: b, label: y, .. },
            ) => x == y && b.saturating_sub(*a) < 1000,
            _ => false,
        });
        if let Some(i) = prior {
            if let (
                InteractionEvent::Scroll { dx, dy, .. },
                InteractionEvent::Scroll { dx: px, dy: py, .. },
            ) = (&mut event, &out[i])
            {
                *dx += px;
                *dy += py;
            }
            out.remove(i);
        }
        out.push(event);
    }
    out
}

pub(crate) fn direction(dx: f32, dy: f32, threshold: f32) -> String {
    let h = if dx.abs() > threshold {
        if dx > 0.0 { "right" } else { "left" }
    } else {
        ""
    };
    let v = if dy.abs() > threshold {
        if dy > 0.0 { "down" } else { "up" }
    } else {
        ""
    };
    let parts = if dx.abs() > 2.0 * dy.abs() {
        vec![h]
    } else if dy.abs() > 2.0 * dx.abs() {
        vec![v]
    } else {
        vec![v, h]
    };
    let text = parts
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" and ");
    if text.is_empty() {
        "a little".into()
    } else {
        text
    }
}

pub fn describe_event(event: &InteractionEvent) -> String {
    match event {
        InteractionEvent::Click {
            x,
            y,
            label,
            button,
            role,
            ..
        } => {
            let verb = if button.as_deref() == Some("touch") {
                "tapped"
            } else {
                "clicked"
            };
            let role = role
                .as_deref()
                .filter(|r| !r.is_empty())
                .map(|r| format!(" {r}"))
                .unwrap_or_default();
            match label.as_deref() {
                Some(l) if !l.is_empty() => {
                    format!("{verb}{role} {} ({})", quote_label(l), at([*x, *y]))
                }
                _ => format!("{verb}{role} ({})", at([*x, *y])),
            }
        }
        InteractionEvent::Drag {
            x0,
            y0,
            x1,
            y1,
            label,
            button,
            ..
        } => {
            if label.as_deref() == Some("long press") {
                format!("long-pressed ({})", at([*x0, *y0]))
            } else if let Some(target) = label
                .as_deref()
                .and_then(|l| l.strip_prefix("long press:"))
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                format!("long-pressed “{target}” ({})", at([*x0, *y0]))
            } else {
                format!(
                    "{}{} {} ({} → {})",
                    if button.as_deref() == Some("touch") {
                        "swiped"
                    } else {
                        "dragged"
                    },
                    label
                        .as_ref()
                        .filter(|s| !s.is_empty())
                        .map(|s| format!(" {}", quote_label(s)))
                        .unwrap_or_default(),
                    direction(x1 - x0, y1 - y0, 0.04),
                    at([*x0, *y0]),
                    at([*x1, *y1])
                )
            }
        }
        InteractionEvent::Scroll { dx, dy, label, .. } => match label.as_deref() {
            Some(l) if !l.is_empty() => format!("scrolled “{l}” {}", direction(*dx, *dy, 0.0)),
            _ => format!("scrolled {}", direction(*dx, *dy, 0.0)),
        },
        InteractionEvent::Point { x, y, label, .. } => match label.as_deref() {
            Some(l) if !l.is_empty() => format!("pointed at “{l}” ({})", at([*x, *y])),
            _ => format!("pointed at ({})", at([*x, *y])),
        },
        InteractionEvent::Key { shortcut, .. } => format!("pressed {shortcut}"),
        InteractionEvent::AppEvent { label, .. } => format!("app: {label}"),
        InteractionEvent::AppChange {
            app, window_title, ..
        } => format!(
            "switched to {app}{}",
            window_title
                .as_ref()
                .map(|s| format!(" — “{s}”"))
                .unwrap_or_default()
        ),
    }
}

pub fn timeline(bundle: &ScrawlBundle) -> Vec<String> {
    let mut items: Vec<(u64, String)> = bundle
        .transcript
        .segments
        .iter()
        .map(|s| (s.t0, format!("{} “{}”", format_clock(s.t0), s.text)))
        .collect();
    for mark in &bundle.marks {
        let frame = bundle.keyframes.iter().find(|k| mark_on_keyframe(mark, k));
        let suffix = frame
            .map(|k| format!(" — frame #{}", k.index))
            .unwrap_or_default();
        items.push((
            mark.t0,
            format!(
                "{} ✎ {}{suffix}",
                format_clock(mark.t0),
                describe_mark(mark)
            ),
        ));
    }
    for event in settled_events(&bundle.events) {
        items.push((
            event.timestamp_ms(),
            format!(
                "{} · {}",
                format_clock(event.timestamp_ms()),
                describe_event(&event)
            ),
        ));
    }
    items.sort_by_key(|item| item.0);
    items.into_iter().map(|item| item.1).collect()
}

/// Longest app-provided screen name or context value shown in the summary.
const CONTEXT_VALUE_CHARS: usize = 60;

/// An app-provided string on one line, cut to `CONTEXT_VALUE_CHARS`.
fn context_value(raw: &str) -> String {
    let compact = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.chars().count() <= CONTEXT_VALUE_CHARS {
        compact
    } else {
        let cut: String = compact.chars().take(CONTEXT_VALUE_CHARS - 1).collect();
        format!("{}…", cut.trim_end())
    }
}

/// Agents given only the text fix what was said and skip the pictures, missing what only shows there.
pub const LOOK_AT_IMAGES: &str = "Open contact-sheet.png and frames/ in that folder before changing anything: the marks and words only make sense on the images, which can show more than the text does.";

pub fn summary_markdown(bundle: &ScrawlBundle, bundle_dir: &std::path::Path) -> String {
    let agent_context = crate::handoff::experiment(crate::handoff::AGENT_CONTEXT);
    summary_markdown_with(bundle, bundle_dir, agent_context)
}

/// `agent_context` is the `agentContext` experiment (`agent_context::keyframe_texts`).
pub fn summary_markdown_with(
    bundle: &ScrawlBundle,
    bundle_dir: &std::path::Path,
    agent_context: bool,
) -> String {
    let mut target = bundle
        .target
        .app
        .clone()
        .unwrap_or_else(|| "Display".into());
    if let Some(title) = &bundle.target.window_title
        && !title.is_empty()
        && Some(title.as_str()) != bundle.target.app.as_deref()
    {
        target.push_str(&format!(" “{title}”"));
    }
    if let Some(device) = &bundle.device {
        target = device.name.clone();
        if let Some(app) = &device.app {
            target.push_str(&format!(" · {app}"));
            let short = device
                .app_short_version
                .as_deref()
                .filter(|v| !v.is_empty());
            let build = device.app_version.as_deref().filter(|v| !v.is_empty());
            match (short, build) {
                (Some(short), Some(build)) if short != build => {
                    target.push_str(&format!(" {short} ({build})"));
                }
                (Some(short), _) => target.push_str(&format!(" {short}")),
                (None, Some(build)) => target.push_str(&format!(" ({build})")),
                (None, None) => {}
            }
        }
    }
    let mut out = format!(
        "[Screen recording {} · {target} · {}]\n",
        format_clock(bundle.duration_ms),
        bundle_dir.display()
    );
    if let Some(dest) = &bundle.destination {
        let title = if dest.title.is_empty() {
            &dest.session
        } else {
            &dest.title
        };
        out.push_str(&format!("For session: {title} ({})", dest.session));
        if let Some(url) = &dest.url {
            out.push_str(&format!(" · page {url}"));
        }
        out.push('\n');
    }
    if !bundle.keyframes.is_empty() {
        out.push_str(LOOK_AT_IMAGES);
        out.push('\n');
    }
    // The screen at the start and the app's own values, on one line.
    let start_screen = bundle.screen_at(0);
    let context: Vec<String> = start_screen
        .map(|screen| format!("Screen: {}", context_value(screen)))
        .into_iter()
        .chain(
            bundle
                .context
                .iter()
                .map(|(key, value)| format!("{}: {}", context_value(key), context_value(value))),
        )
        .collect();
    if !context.is_empty() {
        out.push_str(&context.join(" · "));
        out.push('\n');
    }
    if let Some(note) = &bundle.note
        && !note.trim().is_empty()
    {
        out.push_str(&format!("Note: {}\n", note.trim()));
    }
    if let Some(crop) = &bundle.autocrop {
        out.push_str(&format!(
            "Cropped to: {} (full frames in {}/)\n",
            crop.label, crop.full_frames
        ));
    }
    if let Some(missing) = &bundle.transcript.missing
        && bundle.transcript.text.trim().is_empty()
    {
        out.push_str(&format!("No transcript: {}\n", missing.reason));
    }
    // App events and context changes nest under the keyframe on screen when they happened.
    let mut app_events: Vec<(u64, String)> = bundle
        .events
        .iter()
        .filter_map(|event| match event {
            InteractionEvent::AppEvent { t, label } => Some((*t, format!("app: {label}"))),
            _ => None,
        })
        .collect();
    app_events.extend(bundle.context_changes.iter().map(|change| {
        let key = context_value(&change.key);
        let text = match &change.value {
            Some(value) => format!("{key} → {}", context_value(value)),
            None => format!("{key} cleared"),
        };
        (change.t, text)
    }));
    app_events.sort_by_key(|(t, _)| *t);
    if agent_context && !bundle.keyframes.is_empty() {
        let texts = crate::agent_context::keyframe_texts(bundle);
        let mut shown_screen = start_screen;
        for (frame, text) in bundle.keyframes.iter().zip(texts) {
            let screen = bundle.screen_at(frame.t);
            let screen_marker = match screen {
                Some(name) if screen != shown_screen => format!(" ⟨{}⟩", context_value(name)),
                _ => String::new(),
            };
            shown_screen = screen;
            let flag = frame
                .mark_id
                .as_ref()
                .and_then(|id| bundle.marks.iter().find(|m| &m.id == id))
                .is_some_and(|m| m.shape == Shape::Flag);
            let flag_marker = if flag { " ⚑" } else { "" };
            let head = if text.head.is_empty() {
                String::new()
            } else {
                format!(" {}", text.head)
            };
            out.push_str(&format!(
                "- #{} ({}){screen_marker}{flag_marker}{head}\n",
                frame.index,
                format_clock(frame.t)
            ));
            for line in text.lines {
                out.push_str(&format!("  {line}\n"));
            }
        }
    } else if !bundle.keyframes.is_empty() {
        let first_t = bundle.keyframes[0].t;
        for (t, label) in &app_events {
            if *t < first_t {
                out.push_str(&format!("  · {} {label}\n", format_clock(*t)));
            }
        }
        let mut shown_screen = start_screen;
        for (i, frame) in bundle.keyframes.iter().enumerate() {
            let clock = format_clock(frame.t);
            let screen = bundle.screen_at(frame.t);
            let screen_marker = match screen {
                Some(name) if screen != shown_screen => format!(" ⟨{}⟩", context_value(name)),
                _ => String::new(),
            };
            shown_screen = screen;
            let flag = frame
                .mark_id
                .as_ref()
                .and_then(|id| bundle.marks.iter().find(|m| &m.id == id))
                .is_some_and(|m| m.shape == Shape::Flag);
            let flag_marker = if flag { " ⚑" } else { "" };
            match frame
                .said
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                Some(said) => {
                    let action_marker = if flag {
                        " ⚑".to_owned()
                    } else if frame.reason == KeyframeReason::Click {
                        let compact = frame
                            .event
                            .split(" (")
                            .next()
                            .unwrap_or(&frame.event)
                            .trim();
                        if compact.is_empty() {
                            String::new()
                        } else {
                            format!(" [{compact}]")
                        }
                    } else {
                        String::new()
                    };
                    out.push_str(&format!(
                        "- #{} ({clock}){screen_marker}{action_marker} “{said}”\n",
                        frame.index
                    ));
                }
                None => out.push_str(&format!(
                    "- #{} ({clock}){screen_marker}{flag_marker} {}\n",
                    frame.index, frame.event
                )),
            }
            let next = bundle.keyframes.get(i + 1).map_or(u64::MAX, |k| k.t);
            for (t, label) in &app_events {
                if (*t < next || i + 1 == bundle.keyframes.len()) && *t >= frame.t {
                    out.push_str(&format!("  · {} {label}\n", format_clock(*t)));
                }
            }
        }
    } else if !app_events.is_empty() {
        for (t, label) in &app_events {
            out.push_str(&format!("· {} {label}\n", format_clock(*t)));
        }
    } else if !bundle.transcript.text.trim().is_empty() {
        out.push_str(&format!("“{}”\n", bundle.transcript.text.trim()));
    }
    out
}

/// A ⇧-click pin shows live only as a brief ring at the click, gone in this long; the pin itself
/// stays data (keyframes, summary). Ordinary clicks draw nothing live.
pub const PIN_PULSE_MS: u64 = 350;

/// The live pulse for a pin dropped `age_ms` ago: a thin ring's radius (points) and opacity. It
/// grows out fast and slows (ease-out cubic) while it fades to nothing.
pub fn pin_pulse(age_ms: u64) -> Option<(f32, f32)> {
    if age_ms >= PIN_PULSE_MS {
        return None;
    }
    let p = age_ms as f32 / PIN_PULSE_MS as f32;
    let grow = 1.0 - (1.0 - p).powi(3);
    Some((4.0 + 10.0 * grow, 0.55 * (1.0 - p) * (1.0 - p)))
}

/// Extracts the active `[now_ms - tail_ms, now_ms]` window of a timed laser stroke,
/// linearly interpolating the exact tail cutoff point at `t_cutoff` so the tail
/// glides continuously along the path at 120Hz instead of snapping vertex-by-vertex.
pub fn slice_laser_window(
    timed_points: &[(f32, f32, u64)],
    now_ms: u64,
    tail_ms: u64,
    to_screen: impl Fn(f32, f32) -> [f32; 2],
) -> Vec<([f32; 2], f32)> {
    if timed_points.is_empty() || tail_ms == 0 {
        return Vec::new();
    }
    let cutoff = now_ms.saturating_sub(tail_ms);
    let mut out = Vec::with_capacity(timed_points.len() + 1);

    for (idx, &(nx, ny, t)) in timed_points.iter().enumerate() {
        if t > now_ms.saturating_add(50) {
            break;
        }
        if t < cutoff {
            if let Some(&(nx1, ny1, t1)) = timed_points.get(idx + 1)
                && t1 >= cutoff
                && t1 > t
            {
                let frac = ((cutoff - t) as f32 / (t1 - t) as f32).clamp(0.0, 1.0);
                let p0 = to_screen(nx, ny);
                let p1 = to_screen(nx1, ny1);
                out.push((lerp(p0, p1, frac), 0.0));
            }
            continue;
        }
        let age_ms = now_ms.saturating_sub(t);
        let life = (1.0 - age_ms as f32 / tail_ms as f32).clamp(0.0, 1.0);
        out.push((to_screen(nx, ny), life));
    }
    out
}

/// Smooths timed `(x, y, life_0_to_1)` laser samples using tldraw's two-stage pipeline:
/// 1. Exponential `streamline` low-pass filter to remove mouse/trackpad stairstepping.
/// 2. Midpoint Quadratic B-Spline (`quadraticCurveTo(P_i, midpoint(P_i, P_{i+1}))`) subdivision,
///    which is variation-diminishing and $C^1$-continuous (never overshoots or kinks at corners).
/// 3. Combined arc-length start taper (`u * (2 - u)`) × time-decay life (`smoothstep`) so fast
///    strokes immediately taper to a fine needle tail and stationary strokes retract smoothly.
pub fn smooth_laser_points(points: &[([f32; 2], f32)]) -> Vec<([f32; 2], f32)> {
    if points.is_empty() {
        return Vec::new();
    }
    if points.len() == 1 {
        return vec![points[0]];
    }

    // Stage 1: tldraw streamline filter (streamline = 0.62 -> alpha = 0.47)
    let streamline_alpha = 0.47_f32;
    let mut filtered = Vec::with_capacity(points.len() + 1);
    filtered.push(points[0]);
    for &(pt, life) in &points[1..] {
        let prev = filtered.last().unwrap().0;
        let next_pt = lerp(prev, pt, streamline_alpha);
        if distance(prev, next_pt) >= 0.4 {
            filtered.push((next_pt, life));
        }
    }
    if let Some(&last) = points.last() {
        let prev = filtered.last().unwrap().0;
        if distance(prev, last.0) >= 0.4 {
            filtered.push((lerp(prev, last.0, 0.65), last.1));
            filtered.push(last);
        } else if let Some(slot) = filtered.last_mut() {
            *slot = last;
        }
    }

    if filtered.len() < 2 {
        return filtered;
    }

    // Stage 2: Midpoint Quadratic B-Spline (`quadraticCurveTo(P_i, midpoint(P_i, P_{i+1}))`)
    let mut curve = Vec::with_capacity(filtered.len() * 6);
    if filtered.len() == 2 {
        let (a, la) = filtered[0];
        let (b, lb) = filtered[1];
        let steps = (distance(a, b) / 2.5).ceil().clamp(2.0, 16.0) as usize;
        for s in 0..=steps {
            let t = s as f32 / steps as f32;
            curve.push((lerp(a, b, t), la + (lb - la) * t));
        }
    } else {
        let first = filtered[0];
        let second = filtered[1];
        let m0 = (lerp(first.0, second.0, 0.5), (first.1 + second.1) * 0.5);
        let start_steps = (distance(first.0, m0.0) / 2.5).ceil().clamp(2.0, 8.0) as usize;
        for s in 0..start_steps {
            let t = s as f32 / start_steps as f32;
            curve.push((lerp(first.0, m0.0, t), first.1 + (m0.1 - first.1) * t));
        }
        for i in 1..filtered.len() - 1 {
            let prev = filtered[i - 1];
            let ctrl = filtered[i];
            let next = filtered[i + 1];
            let a = (lerp(prev.0, ctrl.0, 0.5), (prev.1 + ctrl.1) * 0.5);
            let b = if i + 1 == filtered.len() - 1 {
                next
            } else {
                (lerp(ctrl.0, next.0, 0.5), (ctrl.1 + next.1) * 0.5)
            };
            let span_len = distance(a.0, ctrl.0) + distance(ctrl.0, b.0);
            let steps = (span_len / 2.2).ceil().clamp(3.0, 14.0) as usize;
            for s in 0..steps {
                let u = s as f32 / steps as f32;
                let inv = 1.0 - u;
                let x = inv * inv * a.0[0] + 2.0 * inv * u * ctrl.0[0] + u * u * b.0[0];
                let y = inv * inv * a.0[1] + 2.0 * inv * u * ctrl.0[1] + u * u * b.0[1];
                let life = inv * inv * a.1 + 2.0 * inv * u * ctrl.1 + u * u * b.1;
                curve.push(([x, y], life));
            }
        }
        if let Some(&last) = filtered.last() {
            curve.push(last);
        }
    }

    // Stage 3: Combine tldraw's arc-length start taper (`u * (2 - u)`) with time decay (`life`).
    let mut lengths = Vec::with_capacity(curve.len());
    let mut total_len = 0.0_f32;
    lengths.push(0.0_f32);
    for pair in curve.windows(2) {
        total_len += distance(pair[0].0, pair[1].0);
        lengths.push(total_len);
    }
    let taper_dist = total_len.clamp(16.0, 140.0);
    for (idx, item) in curve.iter_mut().enumerate() {
        let s = lengths[idx];
        let u = (s / taper_dist).clamp(0.0, 1.0);
        let arc_taper = u * (2.0 - u);
        let life = item.1.clamp(0.0, 1.0);
        let time_taper = life * life * (3.0 - 2.0 * life);
        item.1 = (arc_taper * time_taper).clamp(0.0, 1.0);
    }
    curve
}

/// Smooths a persistent ink stroke into `(point, pressure_scale)` samples using
/// tldraw's streamline filter + midpoint quadratic Bezier curves + simulated velocity pressure.
pub fn smooth_ink_points(points: &[[f32; 2]]) -> Vec<([f32; 2], f32)> {
    if points.is_empty() {
        return Vec::new();
    }
    if points.len() == 1 {
        return vec![(points[0], 0.85)];
    }
    let streamline_alpha = 0.45_f32;
    let mut filtered = Vec::with_capacity(points.len() + 1);
    filtered.push((points[0], 0.85_f32));
    let mut pressure = 0.85_f32;
    for &pt in &points[1..] {
        let prev = filtered.last().unwrap().0;
        let next_pt = lerp(prev, pt, streamline_alpha);
        let d = distance(prev, next_pt);
        if d >= 0.5 {
            let speed = (d / 14.0).clamp(0.0, 1.0);
            let target_w = 1.08 - 0.36 * speed;
            pressure = pressure + (target_w - pressure) * 0.32;
            filtered.push((next_pt, pressure.clamp(0.65, 1.12)));
        }
    }
    if let Some(&last) = points.last() {
        let prev = filtered.last().unwrap().0;
        if distance(prev, last) >= 0.5 {
            filtered.push((last, pressure));
        } else if let Some(slot) = filtered.last_mut() {
            slot.0 = last;
        }
    }
    if filtered.len() <= 2 {
        return filtered;
    }
    let mut curve = Vec::with_capacity(filtered.len() * 4);
    curve.push(filtered[0]);
    for i in 1..filtered.len() - 1 {
        let prev = filtered[i - 1];
        let ctrl = filtered[i];
        let next = filtered[i + 1];
        let a = (lerp(prev.0, ctrl.0, 0.5), (prev.1 + ctrl.1) * 0.5);
        let b = if i + 1 == filtered.len() - 1 {
            next
        } else {
            (lerp(ctrl.0, next.0, 0.5), (ctrl.1 + next.1) * 0.5)
        };
        let steps = ((distance(a.0, ctrl.0) + distance(ctrl.0, b.0)) / 3.0)
            .ceil()
            .clamp(2.0, 8.0) as usize;
        for s in 0..steps {
            let u = s as f32 / steps as f32;
            let inv = 1.0 - u;
            let x = inv * inv * a.0[0] + 2.0 * inv * u * ctrl.0[0] + u * u * b.0[0];
            let y = inv * inv * a.0[1] + 2.0 * inv * u * ctrl.0[1] + u * u * b.0[1];
            let w = inv * inv * a.1 + 2.0 * inv * u * ctrl.1 + u * u * b.1;
            curve.push(([x, y], w));
        }
    }
    if let Some(&last) = filtered.last() {
        curve.push(last);
    }
    curve
}

#[derive(Clone, Copy, Debug)]
pub struct FreehandOptions {
    pub size: f32,
    pub thinning: f32,
    pub smoothing: f32,
    pub streamline: f32,
    pub simulate_pressure: bool,
    pub taper_start: bool,
    pub taper_end: bool,
}

impl Default for FreehandOptions {
    fn default() -> Self {
        Self {
            size: 16.0,
            thinning: 0.5,
            smoothing: 0.5,
            streamline: 0.5,
            simulate_pressure: true,
            taper_start: false,
            taper_end: false,
        }
    }
}

fn add(a: [f32; 2], b: [f32; 2]) -> [f32; 2] {
    [a[0] + b[0], a[1] + b[1]]
}
fn sub(a: [f32; 2], b: [f32; 2]) -> [f32; 2] {
    [a[0] - b[0], a[1] - b[1]]
}
fn mul(a: [f32; 2], n: f32) -> [f32; 2] {
    [a[0] * n, a[1] * n]
}
fn lerp(a: [f32; 2], b: [f32; 2], t: f32) -> [f32; 2] {
    add(a, mul(sub(b, a), t))
}
fn dot(a: [f32; 2], b: [f32; 2]) -> f32 {
    a[0] * b[0] + a[1] * b[1]
}
fn normal(a: [f32; 2]) -> [f32; 2] {
    [a[1], -a[0]]
}
fn rotate(point: [f32; 2], center: [f32; 2], angle: f32) -> [f32; 2] {
    let p = sub(point, center);
    let (sin, cos) = angle.sin_cos();
    add(center, [p[0] * cos - p[1] * sin, p[0] * sin + p[1] * cos])
}

struct StrokePoint {
    point: [f32; 2],
    vector: [f32; 2],
    distance: f32,
    length: f32,
}

/// Completed-stroke variant of perfect-freehand's streamline/pressure/outline pipeline.
/// Adapted from perfect-freehand 1.2.2, Copyright (c) 2021 Stephen Ruiz Ltd.
///
/// MIT License: Permission is hereby granted, free of charge, to any person obtaining
/// a copy of this software and associated documentation files (the "Software"), to
/// deal in the Software without restriction, including without limitation the rights
/// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
/// the Software, and to permit persons to whom the Software is furnished to do so,
/// subject to the following conditions: The above copyright notice and this
/// permission notice shall be included in all copies or substantial portions of the
/// Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
/// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
/// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
/// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
/// WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
/// CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
pub fn freehand_outline(points: &[[f32; 2]], options: &FreehandOptions) -> Vec<[f32; 2]> {
    if !options.size.is_finite() || options.size <= 0.0 {
        return Vec::new();
    }
    let mut input: Vec<_> = points
        .iter()
        .copied()
        .filter(|p| p.iter().all(|v| v.is_finite()))
        .collect();
    input.dedup();
    if input.is_empty() {
        return Vec::new();
    }
    let size = options.size;
    let thinning = options.thinning.clamp(-1.0, 1.0);
    let radius = |pressure: f32| size * (0.5 - thinning * (0.5 - pressure));
    if input.len() == 1 {
        let r = radius(0.25).max(0.01);
        let center = input[0];
        let mut circle: Vec<_> = (0..32)
            .map(|i| {
                let angle = 2.0 * PI * i as f32 / 32.0;
                add(center, [r * angle.cos(), r * angle.sin()])
            })
            .collect();
        circle.push(circle[0]);
        return circle;
    }
    if input.len() == 2 {
        let (a, b) = (input[0], input[1]);
        input = (0..=4).map(|i| lerp(a, b, i as f32 / 4.0)).collect();
    }
    let streamline = 0.15 + (1.0 - options.streamline.clamp(0.0, 1.0)) * 0.85;
    let mut samples = vec![StrokePoint {
        point: input[0],
        vector: [0.0; 2],
        distance: 0.0,
        length: 0.0,
    }];
    let mut length = 0.0;
    let mut has_minimum_length = false;
    for (i, &p) in input.iter().enumerate().skip(1) {
        let prev = samples.last().unwrap().point;
        let point = if i == input.len() - 1 {
            p
        } else {
            lerp(prev, p, streamline)
        };
        let d = distance(prev, point);
        if d <= f32::EPSILON {
            continue;
        }
        length += d;
        if i < input.len() - 1 && !has_minimum_length {
            if length < size {
                continue;
            }
            has_minimum_length = true;
        }
        samples.push(StrokePoint {
            point,
            vector: mul(sub(prev, point), d.recip()),
            distance: d,
            length,
        });
    }
    if samples.len() == 1 {
        return freehand_outline(&[samples[0].point], options);
    }
    samples[0].vector = samples[1].vector;
    let simulate = |pressure: f32, d: f32| {
        let speed = (d / size).min(1.0);
        (pressure + (1.0 - speed - pressure) * (speed * 0.275)).min(1.0)
    };
    let mut pressure = 0.25;
    for (i, sample) in samples.iter().take(10).enumerate() {
        let next = if options.simulate_pressure {
            simulate(pressure, sample.distance)
        } else if i == 0 {
            0.25
        } else {
            0.5
        };
        pressure = (pressure + next) / 2.0;
    }
    let min_distance = (size * options.smoothing.clamp(0.0, 1.0)).powi(2);
    let mut left = Vec::new();
    let mut right = Vec::new();
    let mut prev_vector = samples[0].vector;
    let mut prev_left = samples[0].point;
    let mut prev_right = prev_left;
    let mut sharp = false;
    let mut end_radius = radius(pressure);
    let taper_length = size.max(length);
    for (i, sample) in samples.iter().enumerate() {
        let last = i == samples.len() - 1;
        if !last && length - sample.length < 3.0 {
            continue;
        }
        let p = if options.simulate_pressure {
            simulate(pressure, sample.distance)
        } else if i == 0 {
            0.25
        } else {
            0.5
        };
        let start_t = (sample.length / taper_length).min(1.0);
        let end_t = ((length - sample.length) / taper_length).min(1.0);
        let start = if options.taper_start {
            start_t * (2.0 - start_t)
        } else {
            1.0
        };
        let end = if options.taper_end {
            1.0 - (1.0 - end_t).powi(3)
        } else {
            1.0
        };
        let r = (radius(p) * start.min(end)).max(0.01);
        end_radius = r;
        let next = samples.get(i + 1).unwrap_or(sample).vector;
        let turn = dot(sample.vector, next);
        let sharp_next = turn < 0.0;
        if (dot(sample.vector, prev_vector) < 0.0 && !sharp) || sharp_next {
            let offset = mul(normal(prev_vector), r);
            for step in 0..=13 {
                let angle = PI * step as f32 / 13.0;
                prev_left = rotate(sub(sample.point, offset), sample.point, angle);
                prev_right = rotate(add(sample.point, offset), sample.point, -angle);
                left.push(prev_left);
                right.push(prev_right);
            }
            sharp = sharp_next;
            continue;
        }
        sharp = false;
        let offset = mul(
            normal(if last {
                sample.vector
            } else {
                lerp(next, sample.vector, turn)
            }),
            r,
        );
        let l = sub(sample.point, offset);
        let r = add(sample.point, offset);
        if last || i <= 1 || dot(sub(prev_left, l), sub(prev_left, l)) > min_distance {
            left.push(l);
            prev_left = l;
        }
        if last || i <= 1 || dot(sub(prev_right, r), sub(prev_right, r)) > min_distance {
            right.push(r);
            prev_right = r;
        }
        pressure = p;
        prev_vector = sample.vector;
    }
    let end = samples.last().unwrap().point;
    if options.taper_end {
        left.push(end);
    } else {
        let cap = add(
            end,
            mul(
                normal(mul(samples.last().unwrap().vector, -1.0)),
                end_radius,
            ),
        );
        for step in 1..14 {
            left.push(rotate(cap, end, PI * step as f32 / 14.0));
        }
    }
    let start_right = right.first().copied();
    left.extend(right.into_iter().rev());
    if options.taper_start {
        left.push(samples[0].point);
    } else if let Some(p) = start_right {
        for step in 1..=13 {
            left.push(rotate(p, samples[0].point, PI * step as f32 / 13.0));
        }
    }
    smooth_closed_polygon(&left)
}

/// Applies tldraw's `outline()` quadratic Bezier midpoint pass (`quadraticCurveTo(P_i, midpoint(P_i, P_{i+1}))`)
/// around a closed outline polygon so freehand strokes have zero polygonal facets.
fn smooth_closed_polygon(poly: &[[f32; 2]]) -> Vec<[f32; 2]> {
    if poly.len() < 4 {
        return poly.to_vec();
    }
    let n = poly.len();
    let mut out = Vec::with_capacity(n * 4);
    for i in 0..n {
        let prev = poly[(i + n - 1) % n];
        let ctrl = poly[i];
        let next = poly[(i + 1) % n];
        let a = lerp(prev, ctrl, 0.5);
        let b = lerp(ctrl, next, 0.5);
        for s in 0..4 {
            let u = s as f32 / 4.0;
            let inv = 1.0 - u;
            out.push([
                inv * inv * a[0] + 2.0 * inv * u * ctrl[0] + u * u * b[0],
                inv * inv * a[1] + 2.0 * inv * u * ctrl[1] + u * u * b[1],
            ]);
        }
    }
    if let Some(&first) = out.first() {
        out.push(first);
    }
    out
}
