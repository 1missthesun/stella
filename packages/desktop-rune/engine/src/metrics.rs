//! Timing truth for the PoC: frame intervals, hot-swap latency, input-to-frame latency.
//! Everything is logged as JSON lines to `$STELLA_RUNE_METRICS` (and the interesting lines to
//! stderr) in epoch milliseconds, so TS-side and engine-side stamps line up.

use std::collections::HashMap;
use std::io::Write;
use std::sync::{LazyLock, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use rune::{FrameEncoded, FrameOutcome};

static BASE: LazyLock<(Instant, f64)> = LazyLock::new(|| {
    let sys = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64() * 1000.0).unwrap_or(0.0);
    (Instant::now(), sys)
});

pub fn mark_process_start() {
    LazyLock::force(&BASE);
}

pub fn epoch_of(at: Instant) -> f64 {
    let (i, s) = *BASE;
    if at >= i { s + (at - i).as_secs_f64() * 1000.0 } else { s - (i - at).as_secs_f64() * 1000.0 }
}

pub fn epoch_ms() -> f64 {
    epoch_of(Instant::now())
}

pub static METRICS: LazyLock<Mutex<Metrics>> = LazyLock::new(|| Mutex::new(Metrics::new()));

/// A drawn frame: epoch ms, update ms, encode ms.
type FrameRow = (f64, f64, f64);

struct Pending {
    generation: u32,
    ack: u32,
    t0: f64,
    kind: u8,
    received: f64,
    applied: f64,
}

pub struct Metrics {
    file: Option<std::fs::File>,
    pub event_seq: u32,
    /// seq → (input time, sent time, kind)
    pub pending_events: HashMap<u32, (f64, f64, String)>,
    pending: Vec<Pending>,
    pub typing_input: Option<f64>,
    /// Frame seq → (input, frame start, submit, targeted vsync), for the frames that drew a
    /// keystroke, until they present.
    typing_frames: HashMap<u64, [f64; 4]>,
    first_content: bool,
    commits_seen: u32,
    rec: Option<(String, Vec<FrameRow>)>,
    frames_total: u64,
    unchanged: u64,
    skipped: u64,
}

impl Metrics {
    fn new() -> Self {
        let file = std::env::var("STELLA_RUNE_METRICS").ok().and_then(|p| {
            std::fs::OpenOptions::new().create(true).append(true).open(p).ok()
        });
        Metrics {
            file,
            event_seq: 0,
            pending_events: HashMap::new(),
            pending: Vec::new(),
            typing_input: None,
            typing_frames: HashMap::new(),
            first_content: false,
            commits_seen: 0,
            rec: None,
            frames_total: 0,
            unchanged: 0,
            skipped: 0,
        }
    }

    pub fn log(&self, v: serde_json::Value) {
        if let Some(mut f) = self.file.as_ref() {
            let _ = writeln!(f, "{v}");
        }
    }

    fn say(&self, v: serde_json::Value) {
        eprintln!("stella-engine metric {v}");
        self.log(v);
    }

    pub fn on_commit(&mut self, generation: u32, ack: u32, t0: f64, kind: u8, received: f64, applied: f64) {
        self.commits_seen += 1;
        self.pending.push(Pending { generation, ack, t0, kind, received, applied });
    }

    pub fn on_frame(&mut self, f: &FrameEncoded) {
        match f.outcome() {
            FrameOutcome::Drawn => {}
            FrameOutcome::Unchanged => { self.unchanged += 1; return; }
            _ => { self.skipped += 1; return; }
        }
        self.frames_total += 1;
        let at = epoch_of(f.at());
        let started = f.started().map(epoch_of);
        if let Some((_, frames)) = self.rec.as_mut() {
            frames.push((at, f.update_ms().unwrap_or(0.0), f.encode_ms().unwrap_or(0.0)));
        }
        if !self.first_content && self.commits_seen > 0 {
            self.first_content = true;
            let t0 = std::env::var("STELLA_RUNE_T0").ok().and_then(|v| v.parse::<f64>().ok());
            self.say(serde_json::json!({
                "metric": "first_content_frame", "at": at,
                "process_start": BASE.1,
                "since_spawn_ms": t0.map(|t| at - t),
                "since_main_ms": at - BASE.1,
            }));
        }
        for p in std::mem::take(&mut self.pending) {
            let mut v = serde_json::json!({
                "metric": if p.kind == 1 { "hot_swap" } else { "commit" },
                "gen": p.generation, "frame_at": at,
                "t0_to_frame_ms": at - p.t0,
                "bridge_ms": p.received - p.t0,
                "apply_wait_ms": p.applied - p.received,
                "applied_to_frame_ms": at - p.applied,
                "frame_started": started,
            });
            if p.ack != 0
                && let Some((input, sent, kind)) = self.pending_events.remove(&p.ack)
            {
                v["event"] = serde_json::json!(kind);
                v["input_to_frame_ms"] = serde_json::json!(at - input);
                v["ts_roundtrip_ms"] = serde_json::json!(p.received - sent);
            }
            if p.kind == 1 || p.ack != 0 {
                self.say(v);
            } else {
                self.log(v);
            }
        }
        if let Some(input) = self.typing_input.take() {
            self.log(serde_json::json!({ "metric": "typing", "input_at": input, "input_to_frame_ms": at - input, "input_to_start_ms": started.map(|s| s - input) }));
            if self.typing_frames.len() >= 256 {
                self.typing_frames.clear();
            }
            let target = f.presents_at().map_or(f64::NAN, epoch_of);
            self.typing_frames.insert(f.seq(), [input, started.unwrap_or(f64::NAN), at, target]);
        }
    }

    /// A keystroke's frame on screen: from the same input time as `typing` to the moment the
    /// display showed it (macOS Metal's presented time), as Chromium's EventLatency ends.
    pub fn on_presented(&mut self, p: &rune::FramePresented) {
        let Some([input, started, submitted, target]) = self.typing_frames.remove(&p.seq()) else { return };
        let v = match p.presented_at() {
            Some(at) => serde_json::json!({
                "metric": "typing_presented", "input_to_present_ms": epoch_of(at) - input,
                "input_to_start_ms": started - input, "input_to_submit_ms": submitted - input,
                "input_to_target_ms": target - input,
            }),
            None => serde_json::json!({ "metric": "typing_presented", "skipped": true }),
        };
        self.log(v);
    }

    pub fn rec_start(&mut self, label: &str) {
        self.rec = Some((label.to_owned(), Vec::with_capacity(4096)));
        self.unchanged = 0;
        self.skipped = 0;
    }

    /// The recording's summary; `with_frames` adds each drawn frame as `[at, update_ms, encode_ms]`.
    pub fn rec_stop(&mut self, with_frames: bool) -> serde_json::Value {
        let Some((label, frames)) = self.rec.take() else { return serde_json::Value::Null };
        let listed = with_frames.then(|| serde_json::json!(frames.iter().map(|f| [f.0, f.1, f.2]).collect::<Vec<_>>()));
        let mut gaps: Vec<f64> = frames.windows(2).map(|w| w[1].0 - w[0].0).collect();
        let mut cpu: Vec<f64> = frames.iter().map(|f| f.1 + f.2).collect();
        let dur = match (frames.first(), frames.last()) {
            (Some(a), Some(b)) => b.0 - a.0,
            _ => 0.0,
        };
        gaps.sort_by(|a, b| a.total_cmp(b));
        cpu.sort_by(|a, b| a.total_cmp(b));
        let q = |v: &Vec<f64>, p: f64| if v.is_empty() { 0.0 } else { v[((v.len() - 1) as f64 * p).round() as usize] };
        let v = serde_json::json!({
            "metric": "frames", "label": label, "frames": frames.len(), "duration_ms": dur,
            "fps": if dur > 0.0 { (frames.len().saturating_sub(1)) as f64 / dur * 1000.0 } else { 0.0 },
            "interval_p50_ms": q(&gaps, 0.5), "interval_p95_ms": q(&gaps, 0.95), "interval_p99_ms": q(&gaps, 0.99),
            "interval_max_ms": gaps.last().copied().unwrap_or(0.0),
            "over_8_3ms": gaps.iter().filter(|g| **g > 8.34 * 1.5).count(),
            "unchanged": self.unchanged, "skipped": self.skipped,
            "frame_cpu_p50_ms": q(&cpu, 0.5), "frame_cpu_p95_ms": q(&cpu, 0.95), "frame_cpu_max_ms": cpu.last().copied().unwrap_or(0.0),
        });
        self.say(v.clone());
        let mut v = v;
        if let Some(list) = listed {
            v["frame_list"] = list;
        }
        v
    }
}
