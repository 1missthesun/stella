//! The `backdrop` element event: what a glass element sees behind it (rune-fx's
//! `BackdropStats`), read back from the frames that draw it and sent to TS only when it changes
//! by a meaningful step, at most every `GAP` per element (a held reading goes out once the gap
//! has passed). A window at rest draws nothing, so nothing is read or sent.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use rune_fx::BackdropStats;

const STEP: f32 = 0.04;
const GAP: Duration = Duration::from_millis(120);
/// How long the poller waits on one frame's readback before giving up on it.
const PATIENCE: Duration = Duration::from_secs(1);

struct Seen {
    sent: BackdropStats,
    at: Instant,
    held: Option<BackdropStats>,
}

static SEEN: Mutex<Option<HashMap<u32, Seen>>> = Mutex::new(None);

fn send(node: u32, s: BackdropStats) {
    let round = |v: f32| (f64::from(v.clamp(0.0, 1.0)) * 1000.0).round() / 1000.0;
    crate::windows::send_any_thread(serde_json::json!({
        "t": "ev", "n": node, "e": "backdrop", "seq": 0, "at": crate::metrics::epoch_ms(),
        "lum": round(s.luminance), "contrast": round(s.contrast),
    }));
}

fn moved(a: BackdropStats, b: BackdropStats) -> bool {
    (a.luminance - b.luminance).abs() >= STEP || (a.contrast - b.contrast).abs() >= STEP
}

/// One frame's readings, by element node.
pub fn report(readings: impl IntoIterator<Item = (u32, BackdropStats)>) {
    let now = Instant::now();
    let mut seen = SEEN.lock().unwrap_or_else(|e| e.into_inner());
    let seen = seen.get_or_insert_with(HashMap::new);
    for (node, s) in readings {
        if !s.luminance.is_finite() || !s.contrast.is_finite() || s.coverage < 0.5 {
            continue;
        }
        match seen.get_mut(&node) {
            None => {
                seen.insert(node, Seen { sent: s, at: now, held: None });
                send(node, s);
            }
            Some(e) if !moved(e.sent, s) => e.held = None,
            Some(e) if now.duration_since(e.at) >= GAP => {
                *e = Seen { sent: s, at: now, held: None };
                send(node, s);
            }
            Some(e) => e.held = Some(s),
        }
    }
}

/// Sends the held readings whose gap has passed; returns how long until the next one is due.
fn flush_held() -> Option<Duration> {
    let now = Instant::now();
    let mut seen = SEEN.lock().unwrap_or_else(|e| e.into_inner());
    let mut next: Option<Duration> = None;
    for (&node, e) in seen.get_or_insert_with(HashMap::new).iter_mut() {
        let Some(s) = e.held else { continue };
        let since = now.duration_since(e.at);
        if since >= GAP {
            *e = Seen { sent: s, at: now, held: None };
            send(node, s);
        } else {
            next = Some(next.map_or(GAP - since, |n| n.min(GAP - since)));
        }
    }
    next
}

/// Forgets elements that are gone, so a node id is never compared with an old element's reading.
pub fn forget(alive: impl Fn(u32) -> bool) {
    if let Some(seen) = SEEN.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
        seen.retain(|&n, _| alive(n));
    }
}

struct Wait {
    device: wgpu::Device,
    done: Arc<AtomicBool>,
    since: Instant,
}

/// Polls `device` until a readback recorded this frame has landed (`done`), so a window that
/// goes idle right after still gets its last reading.
pub fn await_readback(device: &wgpu::Device, done: Arc<AtomicBool>) {
    static POLLER: OnceLock<Option<Mutex<Sender<Wait>>>> = OnceLock::new();
    let poller = POLLER.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<Wait>();
        let spawned = std::thread::Builder::new().name("stella-backdrop".into()).spawn(move || {
            let mut waits: Vec<Wait> = Vec::new();
            let mut due: Option<Duration> = None;
            loop {
                let timeout = if waits.is_empty() { due } else { Some(due.map_or(Duration::from_millis(4), |d| d.min(Duration::from_millis(4)))) };
                let got = match timeout {
                    None => rx.recv().map_err(|_| RecvTimeoutError::Disconnected),
                    Some(t) => rx.recv_timeout(t),
                };
                match got {
                    Ok(w) => waits.push(w),
                    Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => return,
                }
                waits.retain(|w| {
                    if !w.done.load(Ordering::Acquire) {
                        let _ = w.device.poll(wgpu::PollType::Poll);
                    }
                    !w.done.load(Ordering::Acquire) && w.since.elapsed() < PATIENCE
                });
                due = flush_held();
            }
        });
        spawned.ok().map(|_| Mutex::new(tx))
    });
    if let Some(tx) = poller {
        let _ = tx.lock().unwrap_or_else(|e| e.into_inner()).send(Wait { device: device.clone(), done, since: Instant::now() });
    }
}
