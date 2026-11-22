//! Input the way a person produces it, for tabs driven over CDP (Stella's
//! in-app browser). Pointer paths follow a bowed cubic Bezier with a
//! minimum-jerk velocity profile, ~60-110 Hz samples, slight tremor and an
//! occasional overshoot; presses land a little off centre after a short
//! settle and are held 45-110 ms; text is typed as a keystroke timeline with
//! 55-120 ms holds that may overlap the next key; wheel scrolls glide in eased
//! ~60 Hz frames.
//!
//! Adapted from OpenCode Browse (github.com/anomalyco/browse, MIT),
//! rust/crates/browse-page/src/human.rs.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::cdp::client::CdpClient;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Copy)]
struct Aim {
    x: f64,
    y: f64,
    dx: f64,
    dy: f64,
}

#[derive(Debug, Default, Clone)]
struct InputState {
    pointer: Option<Point>,
    document: Option<String>,
    aim: Option<Aim>,
    arrived_at: Option<Instant>,
    pressed_at: Option<Instant>,
    released_at: Option<Instant>,
    last_key_at: Option<Instant>,
    modifiers: i64,
}

static STATES: LazyLock<Mutex<HashMap<String, InputState>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn with_state<R>(session_id: &str, f: impl FnOnce(&mut InputState) -> R) -> R {
    let mut states = STATES.lock().unwrap_or_else(|e| e.into_inner());
    f(states.entry(session_id.to_string()).or_default())
}

fn next_u64() -> u64 {
    use std::cell::Cell;
    thread_local! {
        static STATE: Cell<u64> = Cell::new({
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos() as u64)
                .unwrap_or(0x9e37_79b9);
            (nanos ^ 0x2545_f491_4f6c_dd1d) | 1
        });
    }
    STATE.with(|state| {
        let mut x = state.get();
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        state.set(x);
        x
    })
}

fn unit() -> f64 {
    (next_u64() >> 11) as f64 / (1u64 << 53) as f64
}

/// Timing of the input model, in ms: a quick, practised user (the extension's
/// `PACE` in `extension/lib/human-input.js` uses the same values). Typing
/// comes out around 150-160 wpm with natural variation.
pub mod pace {
    pub const MOVE_BASE: f64 = 45.0;
    pub const MOVE_PER_DOUBLING: f64 = 65.0;
    pub const MOVE_MAX: f64 = 420.0;
    pub const SETTLE: (f64, f64) = (25.0, 70.0);
    pub const HOLD: (f64, f64) = (40.0, 90.0);
    pub const AFTER_KEYS: (f64, f64) = (90.0, 220.0);
    pub const TYPING_LEAD: (f64, f64) = (110.0, 260.0);
    pub const TYPING_INTERVAL: f64 = 85.0;
    pub const KEY_DWELL: (f64, f64) = (45.0, 100.0);
}

fn between(range: (f64, f64)) -> f64 {
    random(range.0, range.1)
}

pub fn random(min: f64, max: f64) -> f64 {
    min + unit() * (max - min)
}

fn noise(scale: f64) -> f64 {
    (unit() + unit() + unit() - 1.5) * scale
}

fn minimum_jerk(t: f64) -> f64 {
    t * t * t * (10.0 - 15.0 * t + 6.0 * t * t)
}

fn bezier(p0: Point, p1: Point, p2: Point, p3: Point, t: f64) -> Point {
    let u = 1.0 - t;
    Point {
        x: u * u * u * p0.x + 3.0 * u * u * t * p1.x + 3.0 * u * t * t * p2.x + t * t * t * p3.x,
        y: u * u * u * p0.y + 3.0 * u * u * t * p1.y + 3.0 * u * t * t * p2.y + t * t * t * p3.y,
    }
}

fn round1(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

fn since_ms(instant: Option<Instant>) -> f64 {
    instant
        .map(|i| i.elapsed().as_secs_f64() * 1000.0)
        .unwrap_or(f64::INFINITY)
}

pub async fn sleep_ms(ms: f64) {
    if ms > 0.0 && ms.is_finite() {
        tokio::time::sleep(Duration::from_micros((ms * 1000.0) as u64)).await;
    }
}

/// Samples (with the delay before each, in ms) of one movement, excluding `to`.
pub fn trajectory(from: Point, to: Point) -> Vec<(Point, f64)> {
    let dx = to.x - from.x;
    let dy = to.y - from.y;
    let distance = dx.hypot(dy);
    if distance < 2.0 {
        return Vec::new();
    }
    let duration = ((pace::MOVE_BASE + pace::MOVE_PER_DOUBLING * (distance / 40.0 + 1.0).log2())
        * random(0.85, 1.15))
    .min(pace::MOVE_MAX);
    let normal = Point {
        x: -dy / distance,
        y: dx / distance,
    };
    let bow = if unit() < 0.5 { -1.0 } else { 1.0 } * random(0.04, 0.16) * distance;
    let c1 = Point {
        x: from.x + dx * random(0.2, 0.35) + normal.x * bow,
        y: from.y + dy * random(0.2, 0.35) + normal.y * bow,
    };
    let c2 = Point {
        x: from.x + dx * random(0.65, 0.8) + normal.x * bow * 0.6,
        y: from.y + dy * random(0.65, 0.8) + normal.y * bow * 0.6,
    };
    let overshoot = distance > 250.0 && unit() < 0.2;
    let end = if overshoot {
        Point {
            x: to.x + (dx / distance) * random(4.0, 10.0),
            y: to.y + (dy / distance) * random(4.0, 10.0),
        }
    } else {
        to
    };
    let mut points = Vec::new();
    let mut elapsed = 0.0;
    while elapsed < duration {
        let step = random(9.0, 17.0);
        elapsed = (elapsed + step).min(duration);
        let s = minimum_jerk(elapsed / duration);
        let p = bezier(from, c1, c2, end, s);
        let tremor = (1.0 - s) * 0.9;
        points.push((
            Point {
                x: p.x + noise(tremor),
                y: p.y + noise(tremor),
            },
            step,
        ));
    }
    if overshoot {
        let back = random(3.0, 6.0).round().max(3.0) as usize;
        for i in 1..=back {
            let s = minimum_jerk(i as f64 / back as f64);
            points.push((
                Point {
                    x: end.x + (to.x - end.x) * s,
                    y: end.y + (to.y - end.y) * s,
                },
                random(10.0, 18.0),
            ));
        }
    }
    points.pop();
    points
        .into_iter()
        .map(|(p, d)| {
            (
                Point {
                    x: round1(p.x),
                    y: round1(p.y),
                },
                d,
            )
        })
        .collect()
}

/// Per-frame wheel deltas for one scroll gesture: quick start, eased stop.
pub fn glide(dx: f64, dy: f64) -> Vec<Point> {
    let distance = dx.hypot(dy);
    if distance < 40.0 {
        return vec![Point { x: dx, y: dy }];
    }
    let frames = (((120.0 + distance * 0.3).min(480.0) * random(0.85, 1.15)) / 16.7)
        .round()
        .max(4.0) as usize;
    let ease = |t: f64| 1.0 - (1.0 - t).powi(3);
    (0..frames)
        .map(|i| {
            let a = ease((i + 1) as f64 / frames as f64) - ease(i as f64 / frames as f64);
            Point {
                x: dx * a,
                y: dy * a,
            }
        })
        .collect()
}

fn clamp_point(point: Point, bounds: Option<(f64, f64)>) -> Point {
    let clamp = |value: f64, max: Option<f64>| {
        let upper = max.map(|m| (m - 1.0).max(0.0)).unwrap_or(f64::INFINITY);
        value.max(0.0).min(upper)
    };
    Point {
        x: clamp(point.x, bounds.map(|b| b.0)),
        y: clamp(point.y, bounds.map(|b| b.1)),
    }
}

async fn viewport(client: &CdpClient, session_id: &str) -> Option<(f64, f64)> {
    let metrics = client
        .send_command("Page.getLayoutMetrics", Some(json!({})), Some(session_id))
        .await
        .ok()?;
    let layout = &metrics["cssLayoutViewport"];
    match (
        layout["clientWidth"].as_f64(),
        layout["clientHeight"].as_f64(),
    ) {
        (Some(w), Some(h)) if w > 0.0 && h > 0.0 => Some((w, h)),
        _ => None,
    }
}

/// Forget the pointer when the document changed: a new page has no idea
/// where the mouse was, and the next movement starts somewhere plausible.
async fn sync_document(client: &CdpClient, session_id: &str) {
    let document = client
        .send_command("Page.getFrameTree", Some(json!({})), Some(session_id))
        .await
        .ok()
        .and_then(|tree| {
            tree["frameTree"]["frame"]["loaderId"]
                .as_str()
                .map(String::from)
        });
    with_state(session_id, |state| {
        if state.document != document {
            state.document = document;
            state.pointer = None;
            state.aim = None;
        }
    });
}

fn start_point(pointer: Option<Point>, to: Point, bounds: Option<(f64, f64)>) -> Point {
    if let Some(p) = pointer {
        return clamp_point(p, bounds);
    }
    let (w, h) = bounds.unwrap_or((1200.0, 800.0));
    for _ in 0..8 {
        let candidate = Point {
            x: w * random(0.2, 0.8),
            y: h * random(0.25, 0.75),
        };
        let distance = (candidate.x - to.x).hypot(candidate.y - to.y);
        if distance > 120.0 && distance < 520.0 {
            return candidate;
        }
    }
    clamp_point(
        Point {
            x: to.x + random(-220.0, 220.0),
            y: to.y + random(60.0, 200.0),
        },
        bounds,
    )
}

fn aim(session_id: &str, target: Point, size: Option<(f64, f64)>) -> Point {
    with_state(session_id, |state| {
        let reuse = state
            .aim
            .map(|a| (a.x - target.x).hypot(a.y - target.y) < 1.0)
            .unwrap_or(false);
        if !reuse {
            let (sx, sy) = size
                .map(|(w, h)| {
                    (
                        ((w / 2.0 - 2.0).max(0.0) / 3.0).min(2.4),
                        ((h / 2.0 - 2.0).max(0.0) / 3.0).min(1.8),
                    )
                })
                .unwrap_or((2.2, 1.6));
            state.aim = Some(Aim {
                x: target.x,
                y: target.y,
                dx: noise(sx),
                dy: noise(sy),
            });
        }
        let a = state.aim.unwrap();
        Point {
            x: round1(target.x + a.dx),
            y: round1(target.y + a.dy),
        }
    })
}

/// Sends one sample of a gesture and waits until the next is due, never
/// longer: Chrome can hold the reply to input for a tab that isn't drawing
/// until its next frame.
async fn pace(client: &CdpClient, session_id: &str, gap_ms: f64, method: &str, params: Value) {
    let started = Instant::now();
    let gap = Duration::from_micros((gap_ms.max(0.0) * 1000.0) as u64);
    let _ = tokio::time::timeout(
        gap,
        client.send_command(method, Some(params), Some(session_id)),
    )
    .await;
    sleep_ms(gap_ms - started.elapsed().as_secs_f64() * 1000.0).await;
}

/// Moves the pointer to `to` along a human path; `size` (the target's box)
/// keeps the aim offset inside small targets; `exact` skips the offset.
pub async fn move_to(
    client: &CdpClient,
    session_id: &str,
    to: Point,
    size: Option<(f64, f64)>,
    exact: bool,
) -> Result<Point, String> {
    sync_document(client, session_id).await;
    let last_key = with_state(session_id, |s| s.last_key_at);
    sleep_ms(between(pace::AFTER_KEYS) - since_ms(last_key)).await;
    let bounds = viewport(client, session_id).await;
    let target = if exact { to } else { aim(session_id, to, size) };
    let from = start_point(with_state(session_id, |s| s.pointer), target, bounds);
    let modifiers = with_state(session_id, |s| s.modifiers);
    for (point, delay) in trajectory(from, target) {
        let p = clamp_point(point, bounds);
        pace(
            client,
            session_id,
            delay,
            "Input.dispatchMouseEvent",
            json!({ "type": "mouseMoved", "x": p.x, "y": p.y, "button": "none", "buttons": 0, "modifiers": modifiers }),
        )
        .await;
    }
    client
        .send_command(
            "Input.dispatchMouseEvent",
            Some(json!({ "type": "mouseMoved", "x": target.x, "y": target.y, "button": "none", "buttons": 0, "modifiers": modifiers })),
            Some(session_id),
        )
        .await?;
    with_state(session_id, |s| {
        s.pointer = Some(target);
        s.arrived_at = Some(Instant::now());
    });
    Ok(target)
}

fn button_bit(button: &str) -> i64 {
    match button {
        "right" => 2,
        "middle" => 4,
        _ => 1,
    }
}

/// Presses and releases at the pointer: a short settle after arriving, the
/// button held 45-110 ms, and 60-120 ms between the clicks of a double click.
pub async fn press_release(
    client: &CdpClient,
    session_id: &str,
    button: &str,
    click_count: i32,
) -> Result<(), String> {
    let at = with_state(session_id, |s| s.pointer).unwrap_or(Point { x: 0.0, y: 0.0 });
    let bit = button_bit(button);
    let modifiers = with_state(session_id, |s| s.modifiers);
    for n in 1..=click_count.max(1) {
        let arrived = with_state(session_id, |s| s.arrived_at);
        if n == 1 {
            sleep_ms(between(pace::SETTLE) - since_ms(arrived).min(1000.0)).await;
        } else {
            sleep_ms(random(60.0, 120.0)).await;
        }
        client
            .send_command(
                "Input.dispatchMouseEvent",
                Some(json!({ "type": "mousePressed", "x": at.x, "y": at.y, "button": button, "buttons": bit, "clickCount": n, "modifiers": modifiers })),
                Some(session_id),
            )
            .await?;
        with_state(session_id, |s| s.pressed_at = Some(Instant::now()));
        sleep_ms(between(pace::HOLD)).await;
        client
            .send_command(
                "Input.dispatchMouseEvent",
                Some(json!({ "type": "mouseReleased", "x": at.x, "y": at.y, "button": button, "buttons": 0, "clickCount": n, "modifiers": modifiers })),
                Some(session_id),
            )
            .await?;
        with_state(session_id, |s| s.released_at = Some(Instant::now()));
    }
    Ok(())
}

/// A wheel gesture at `at`, gliding in ~60 Hz frames.
pub async fn wheel(
    client: &CdpClient,
    session_id: &str,
    at: Point,
    dx: f64,
    dy: f64,
) -> Result<(), String> {
    let has_pointer = with_state(session_id, |s| s.pointer.is_some());
    let point = move_to(client, session_id, at, None, has_pointer).await?;
    for frame in glide(dx, dy) {
        pace(
            client,
            session_id,
            random(15.5, 18.0),
            "Input.dispatchMouseEvent",
            json!({ "type": "mouseWheel", "x": point.x, "y": point.y, "deltaX": (frame.x * 100.0).round() / 100.0, "deltaY": (frame.y * 100.0).round() / 100.0 }),
        )
        .await;
    }
    Ok(())
}

/// One key of a typed character: its key, code, key code and whether it needs Shift.
pub struct TypedKey {
    pub key: String,
    pub code: String,
    pub key_code: i64,
    pub text: String,
    pub shift: bool,
}

const SHIFT_KEY: (&str, &str, i64) = ("Shift", "ShiftLeft", 16);

pub fn typed_key(c: char) -> Option<TypedKey> {
    let s = c.to_string();
    let key = |code: String, key_code: i64, shift: bool| TypedKey {
        key: s.clone(),
        code,
        key_code,
        text: s.clone(),
        shift,
    };
    if c.is_ascii_lowercase() {
        let upper = c.to_ascii_uppercase();
        return Some(key(format!("Key{upper}"), upper as i64, false));
    }
    if c.is_ascii_uppercase() {
        return Some(key(format!("Key{c}"), c as i64, true));
    }
    if c.is_ascii_digit() {
        return Some(key(format!("Digit{c}"), c as i64, false));
    }
    let shifted_digits = [
        (')', '0'),
        ('!', '1'),
        ('@', '2'),
        ('#', '3'),
        ('$', '4'),
        ('%', '5'),
        ('^', '6'),
        ('&', '7'),
        ('*', '8'),
        ('(', '9'),
    ];
    if let Some((_, digit)) = shifted_digits.iter().find(|(symbol, _)| *symbol == c) {
        return Some(key(format!("Digit{digit}"), *digit as i64, true));
    }
    let punctuation: [(char, char, &str, i64); 11] = [
        ('`', '~', "Backquote", 192),
        ('-', '_', "Minus", 189),
        ('=', '+', "Equal", 187),
        ('[', '{', "BracketLeft", 219),
        (']', '}', "BracketRight", 221),
        ('\\', '|', "Backslash", 220),
        (';', ':', "Semicolon", 186),
        ('\'', '"', "Quote", 222),
        (',', '<', "Comma", 188),
        ('.', '>', "Period", 190),
        ('/', '?', "Slash", 191),
    ];
    for (plain, shifted, code, key_code) in punctuation {
        if c == plain {
            return Some(key(code.to_string(), key_code, false));
        }
        if c == shifted {
            return Some(key(code.to_string(), key_code, true));
        }
    }
    match c {
        ' ' => Some(key("Space".into(), 32, false)),
        '\n' | '\r' => Some(TypedKey {
            key: "Enter".into(),
            code: "Enter".into(),
            key_code: 13,
            text: "\r".into(),
            shift: false,
        }),
        '\t' => Some(TypedKey {
            key: "Tab".into(),
            code: "Tab".into(),
            key_code: 9,
            text: String::new(),
            shift: false,
        }),
        _ => None,
    }
}

enum TimedEvent {
    Down {
        key: String,
        code: String,
        key_code: i64,
        text: String,
    },
    Up {
        key: String,
        code: String,
        key_code: i64,
    },
    Text(String),
}

/// Types text as a keystroke timeline: presses ~70-150 ms apart (faster for
/// long text), each held 55-120 ms so fast pairs overlap, Shift held across
/// a run of capitals. Past 160 characters the rest is inserted in word-sized
/// chunks. `mean_interval_ms` overrides the pace.
pub async fn type_text(
    client: &CdpClient,
    session_id: &str,
    text: &str,
    mean_interval_ms: Option<f64>,
) -> Result<(), String> {
    const KEYED_LIMIT: usize = 160;
    let chars: Vec<char> = text.chars().collect();
    if chars.is_empty() {
        return Ok(());
    }
    let keyed = &chars[..chars.len().min(KEYED_LIMIT)];
    let mean = mean_interval_ms.unwrap_or_else(|| {
        (pace::TYPING_INTERVAL * 30.0 / keyed.len() as f64).clamp(40.0, pace::TYPING_INTERVAL)
    });
    let mut events: Vec<(f64, TimedEvent)> = Vec::new();
    let mut t = 0.0;
    let mut shift_up: Option<usize> = None;
    let mut previous: Option<(String, f64)> = None;
    for (i, c) in keyed.iter().enumerate() {
        let interval = if i == 0 {
            0.0
        } else {
            (mean * (0.6 + noise(0.5) + unit() * 0.5)).max(mean * 0.45)
        };
        t += interval;
        let Some(k) = typed_key(*c) else {
            events.push((t, TimedEvent::Text(c.to_string())));
            previous = None;
            continue;
        };
        if !k.shift {
            if let Some(index) = shift_up.take() {
                if t < events[index].0 + 10.0 {
                    t = events[index].0 + random(10.0, 35.0);
                }
            }
        }
        if let Some((code, up_at)) = &previous {
            if *code == k.code && *up_at >= t {
                t = up_at + random(15.0, 40.0);
            }
        }
        if k.shift && shift_up.is_none() {
            events.push((
                (t - random(30.0, 70.0)).max(0.0),
                TimedEvent::Down {
                    key: SHIFT_KEY.0.into(),
                    code: SHIFT_KEY.1.into(),
                    key_code: SHIFT_KEY.2,
                    text: String::new(),
                },
            ));
            events.push((
                t,
                TimedEvent::Up {
                    key: SHIFT_KEY.0.into(),
                    code: SHIFT_KEY.1.into(),
                    key_code: SHIFT_KEY.2,
                },
            ));
            shift_up = Some(events.len() - 1);
        }
        let dwell = between(pace::KEY_DWELL) * if mean < 70.0 { 0.7 } else { 1.0 };
        let up_at = t + dwell;
        events.push((
            t,
            TimedEvent::Down {
                key: k.key.clone(),
                code: k.code.clone(),
                key_code: k.key_code,
                text: k.text.clone(),
            },
        ));
        events.push((
            up_at,
            TimedEvent::Up {
                key: k.key.clone(),
                code: k.code.clone(),
                key_code: k.key_code,
            },
        ));
        if let Some(index) = shift_up {
            events[index].0 = up_at + random(10.0, 40.0);
        }
        previous = Some((k.code, up_at));
    }
    events.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let (last_key, released) = with_state(session_id, |s| (s.last_key_at, s.released_at));
    let lead = [
        if since_ms(last_key) < 1000.0 {
            random(60.0, 140.0) - since_ms(last_key)
        } else {
            0.0
        },
        between(pace::TYPING_LEAD) - since_ms(released),
        0.0,
    ]
    .into_iter()
    .fold(0.0, f64::max);
    let start = Instant::now() + Duration::from_micros((lead * 1000.0) as u64);
    let mut shift_held = false;
    for (at, event) in events {
        let due = start + Duration::from_micros((at.max(0.0) * 1000.0) as u64);
        let now = Instant::now();
        if due > now {
            tokio::time::sleep(due - now).await;
        }
        let modifiers = |held: bool| if held { 8 } else { 0 };
        match event {
            TimedEvent::Text(text) => {
                client
                    .send_command(
                        "Input.insertText",
                        Some(json!({ "text": text })),
                        Some(session_id),
                    )
                    .await?;
            }
            TimedEvent::Down {
                key,
                code,
                key_code,
                text,
            } => {
                if key == "Shift" {
                    shift_held = true;
                }
                let kind = if text.is_empty() {
                    "rawKeyDown"
                } else {
                    "keyDown"
                };
                client
                    .send_command(
                        "Input.dispatchKeyEvent",
                        Some(json!({ "type": kind, "key": key, "code": code, "windowsVirtualKeyCode": key_code, "nativeVirtualKeyCode": key_code, "text": text, "unmodifiedText": text, "modifiers": modifiers(shift_held), "location": if key == "Shift" { 1 } else { 0 } })),
                        Some(session_id),
                    )
                    .await?;
            }
            TimedEvent::Up {
                key,
                code,
                key_code,
            } => {
                if key == "Shift" {
                    shift_held = false;
                }
                client
                    .send_command(
                        "Input.dispatchKeyEvent",
                        Some(json!({ "type": "keyUp", "key": key, "code": code, "windowsVirtualKeyCode": key_code, "nativeVirtualKeyCode": key_code, "modifiers": modifiers(shift_held), "location": if key == "Shift" { 1 } else { 0 } })),
                        Some(session_id),
                    )
                    .await?;
            }
        }
    }
    with_state(session_id, |s| s.last_key_at = Some(Instant::now()));
    let rest: String = chars[keyed.len()..].iter().collect();
    for chunk in rest.split_inclusive(char::is_whitespace) {
        sleep_ms(random(10.0, 25.0)).await;
        client
            .send_command(
                "Input.insertText",
                Some(json!({ "text": chunk })),
                Some(session_id),
            )
            .await?;
    }
    Ok(())
}

/// Holds or releases the key that adds a click to a selection (Cmd on macOS, Ctrl elsewhere).
pub async fn toggle_modifier(client: &CdpClient, session_id: &str, down: bool) -> Result<(), String> {
    let (key, code, key_code, bit) = if cfg!(target_os = "macos") {
        ("Meta", "MetaLeft", 91, 4)
    } else {
        ("Control", "ControlLeft", 17, 2)
    };
    if down {
        sleep_ms(random(40.0, 110.0)).await;
    } else {
        sleep_ms(between(pace::SETTLE)).await;
    }
    let modifiers = with_state(session_id, |s| {
        s.modifiers = if down { s.modifiers | bit } else { s.modifiers & !bit };
        s.modifiers
    });
    client
        .send_command(
            "Input.dispatchKeyEvent",
            Some(json!({ "type": if down { "rawKeyDown" } else { "keyUp" }, "key": key, "code": code, "windowsVirtualKeyCode": key_code, "nativeVirtualKeyCode": key_code, "modifiers": modifiers, "location": 1 })),
            Some(session_id),
        )
        .await?;
    Ok(())
}

/// A key press paced like a person's after other keys or a click.
pub async fn before_key(session_id: &str) {
    let (last_key, released) = with_state(session_id, |s| (s.last_key_at, s.released_at));
    let wait = [
        if since_ms(last_key) < 1000.0 {
            random(40.0, 110.0) - since_ms(last_key)
        } else {
            0.0
        },
        random(120.0, 300.0) - since_ms(released),
    ]
    .into_iter()
    .fold(0.0, f64::max);
    sleep_ms(wait).await;
    with_state(session_id, |s| s.last_key_at = Some(Instant::now()));
}

/// How long a pressed key stays down.
pub async fn key_hold() {
    sleep_ms(random(55.0, 110.0)).await;
}
