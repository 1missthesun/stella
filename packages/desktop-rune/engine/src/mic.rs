//! Native microphone capture for dictation on Linux and Windows (macOS runs master's
//! `mic_capture` helper), so a dictation needs no WebView: what Electron's helper streams,
//! 16 kHz mono signed 16-bit PCM from the default input.
//!
//! - `mic.start {gen}`: opens the default input; any other capture stops first.
//! - `mic.stop {gen}`: sends what is left, then `ended`.
//!
//! Events: `{t:"mic", gen, kind:"live", ms}` once audio flows (`ms` since `mic.start`),
//! `{kind:"audio", pcm}` (base64, ~20 ms each), `{kind:"ended"}`, `{kind:"failed", message}`.

use serde_json::Value;

pub fn command(cmd: &str, rid: Option<u64>, v: &Value) {
    #[cfg(not(target_os = "macos"))]
    imp::command(cmd, v);
    #[cfg(target_os = "macos")]
    let _ = (cmd, v);
    crate::engine::reply(rid, Ok(Value::Null));
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use cpal::{FromSample, SampleFormat, SizedSample};
    use serde_json::{Value, json};
    use std::sync::mpsc::{self, RecvTimeoutError, Sender};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    const RATE: u32 = 16_000;
    const CHUNK: Duration = Duration::from_millis(20);
    /// Ten seconds of audio: a host that stops reading doesn't grow the engine.
    const MAX_PENDING: usize = RATE as usize * 10;

    static CURRENT: Mutex<Option<(u64, Sender<()>)>> = Mutex::new(None);

    pub fn command(cmd: &str, v: &Value) {
        let Some(generation) = v["gen"].as_u64() else { return };
        match cmd {
            "mic.start" => start(generation),
            "mic.stop" => {
                let current = CURRENT.lock().unwrap_or_else(|e| e.into_inner()).take_if(|(g, _)| *g == generation);
                if let Some((_, stop)) = current {
                    let _ = stop.send(());
                }
            }
            _ => {}
        }
    }

    fn emit(generation: u64, mut event: Value) {
        event["t"] = "mic".into();
        event["gen"] = generation.into();
        crate::windows::send_any_thread(event);
    }

    fn start(generation: u64) {
        let (stop, stopped) = mpsc::channel();
        if let Some((_, previous)) = CURRENT.lock().unwrap_or_else(|e| e.into_inner()).replace((generation, stop)) {
            let _ = previous.send(());
        }
        let at = Instant::now();
        let spawned = std::thread::Builder::new().name("stella-mic".into()).spawn(move || {
            let pending = Arc::new(Mutex::new(Vec::<i16>::new()));
            let failed = Arc::new(Mutex::new(None::<String>));
            let stream = match open(pending.clone(), failed.clone()) {
                Ok(stream) => stream,
                Err(message) => return emit(generation, json!({ "kind": "failed", "message": message })),
            };
            let mut live = false;
            let flush = |live: &mut bool| {
                let pcm = std::mem::take(&mut *pending.lock().unwrap_or_else(|e| e.into_inner()));
                if pcm.is_empty() {
                    return;
                }
                if !*live {
                    *live = true;
                    emit(generation, json!({ "kind": "live", "ms": at.elapsed().as_secs_f64() * 1000.0 }));
                }
                emit(generation, json!({ "kind": "audio", "pcm": base64(&pcm) }));
            };
            while let Err(RecvTimeoutError::Timeout) = stopped.recv_timeout(CHUNK) {
                flush(&mut live);
                if let Some(message) = failed.lock().unwrap_or_else(|e| e.into_inner()).take() {
                    drop(stream);
                    CURRENT.lock().unwrap_or_else(|e| e.into_inner()).take_if(|(g, _)| *g == generation);
                    return emit(generation, json!({ "kind": "failed", "message": message }));
                }
            }
            drop(stream);
            flush(&mut live);
            emit(generation, json!({ "kind": "ended" }));
        });
        if let Err(e) = spawned {
            emit(generation, json!({ "kind": "failed", "message": format!("microphone thread: {e}") }));
        }
    }

    fn open(pending: Arc<Mutex<Vec<i16>>>, failed: Arc<Mutex<Option<String>>>) -> Result<cpal::Stream, String> {
        let device = cpal::default_host().default_input_device().ok_or("No microphone is connected.")?;
        let supported = device.default_input_config().map_err(|e| format!("The microphone could not be opened: {e}"))?;
        let format = supported.sample_format();
        let config: cpal::StreamConfig = supported.into();
        let stream = match format {
            SampleFormat::F32 => build::<f32>(&device, &config, pending, failed),
            SampleFormat::I16 => build::<i16>(&device, &config, pending, failed),
            SampleFormat::U16 => build::<u16>(&device, &config, pending, failed),
            SampleFormat::I32 => build::<i32>(&device, &config, pending, failed),
            SampleFormat::U8 => build::<u8>(&device, &config, pending, failed),
            other => return Err(format!("The microphone's sample format {other} isn't supported.")),
        }
        .map_err(|e| format!("The microphone could not be opened: {e}"))?;
        stream.play().map_err(|e| format!("The microphone could not start: {e}"))?;
        Ok(stream)
    }

    fn build<T: SizedSample + Send + 'static>(
        device: &cpal::Device,
        config: &cpal::StreamConfig,
        pending: Arc<Mutex<Vec<i16>>>,
        failed: Arc<Mutex<Option<String>>>,
    ) -> Result<cpal::Stream, cpal::BuildStreamError>
    where
        f32: FromSample<T>,
    {
        let channels = config.channels.max(1) as usize;
        let mut down = Downsampler::new(config.sample_rate.0);
        let mut out = Vec::new();
        device.build_input_stream(
            config,
            move |data: &[T], _: &cpal::InputCallbackInfo| {
                out.clear();
                for frame in data.chunks(channels) {
                    let mono = frame.iter().map(|s| s.to_sample::<f32>()).sum::<f32>() / frame.len() as f32;
                    down.push(mono, &mut out);
                }
                let mut pending = pending.lock().unwrap_or_else(|e| e.into_inner());
                if pending.len() + out.len() <= MAX_PENDING {
                    pending.extend_from_slice(&out);
                }
            },
            move |e| {
                failed.lock().unwrap_or_else(|x| x.into_inner()).get_or_insert_with(|| format!("The microphone stopped: {e}"));
            },
            None,
        )
    }

    /// Averages the input over each output sample's span (a box filter, enough to keep speech
    /// above 8 kHz from folding back), or repeats samples when the input is slower.
    struct Downsampler {
        step: f64,
        edge: f64,
        sum: f32,
        count: u32,
        last: f32,
    }

    impl Downsampler {
        fn new(rate: u32) -> Self {
            let step = rate.max(1) as f64 / RATE as f64;
            Downsampler { step, edge: step, sum: 0.0, count: 0, last: 0.0 }
        }

        fn push(&mut self, sample: f32, out: &mut Vec<i16>) {
            self.sum += sample;
            self.count += 1;
            self.edge -= 1.0;
            while self.edge <= 0.0 {
                if self.count > 0 {
                    self.last = self.sum / self.count as f32;
                    self.sum = 0.0;
                    self.count = 0;
                }
                out.push((self.last.clamp(-1.0, 1.0) * i16::MAX as f32) as i16);
                self.edge += self.step;
            }
        }
    }

    fn base64(pcm: &[i16]) -> String {
        const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let bytes: Vec<u8> = pcm.iter().flat_map(|s| s.to_le_bytes()).collect();
        let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
        for chunk in bytes.chunks(3) {
            let n = (chunk[0] as u32) << 16 | (*chunk.get(1).unwrap_or(&0) as u32) << 8 | *chunk.get(2).unwrap_or(&0) as u32;
            out.push(TABLE[(n >> 18) as usize & 63] as char);
            out.push(TABLE[(n >> 12) as usize & 63] as char);
            out.push(if chunk.len() > 1 { TABLE[(n >> 6) as usize & 63] as char } else { '=' });
            out.push(if chunk.len() > 2 { TABLE[n as usize & 63] as char } else { '=' });
        }
        out
    }
}
