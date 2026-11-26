//! Audio file playback behind the host's `HTMLMediaElement` on Linux and Windows (macOS plays
//! through AVFoundation in the host): symphonia decodes, cpal plays.
//!
//! - `audio.play {id, path, volume, device}`: starts `path` on the output named `device` (null,
//!   "" or "default": the system default); replies `{device, sampleRate, channels, duration}`
//!   once it is playing. With no usable output it plays into a silent real-time sink, as
//!   Chromium does, so `ended` still comes when the audio would have finished.
//! - `audio.control {id, op: pause|resume|stop|volume|output, value}`.
//! - `audio.devices`: `MediaDeviceInfo`s (inputs and outputs, `default` entries first).
//!
//! Events: `{t:"audio", id, kind:"ended"}` and `{t:"audio", id, kind:"error", message}`.

use serde_json::Value;

pub fn command(cmd: &str, rid: Option<u64>, v: &Value) {
    #[cfg(not(target_os = "macos"))]
    imp::command(cmd, rid, v);
    #[cfg(target_os = "macos")]
    {
        let _ = v;
        crate::engine::reply(rid, Err(format!("{cmd}: macOS plays audio through AVFoundation in the host")));
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use cpal::{FromSample, SizedSample};
    use serde_json::{Value, json};
    use std::collections::{HashMap, VecDeque};
    use std::fs::File;
    use std::path::Path;
    use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
    use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};
    use symphonia::core::audio::SampleBuffer;
    use symphonia::core::codecs::{CODEC_TYPE_NULL, Decoder, DecoderOptions};
    use symphonia::core::errors::Error as DecodeError;
    use symphonia::core::formats::{FormatOptions, FormatReader};
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    const BUFFER_SECONDS: f32 = 0.5;
    const NULL_RATE: u32 = 48_000;
    const NULL_CHANNELS: u16 = 2;
    const TICK: Duration = Duration::from_millis(10);

    enum Control {
        Pause,
        Resume,
        Stop,
        Volume(f32),
        Output(Option<String>),
    }

    static PLAYERS: Mutex<Option<HashMap<String, (u64, Sender<Control>)>>> = Mutex::new(None);
    static NEXT_TOKEN: AtomicU64 = AtomicU64::new(1);

    fn players<R>(f: impl FnOnce(&mut HashMap<String, (u64, Sender<Control>)>) -> R) -> R {
        let mut guard = PLAYERS.lock().unwrap_or_else(|e| e.into_inner());
        f(guard.get_or_insert_with(HashMap::new))
    }

    pub fn command(cmd: &str, rid: Option<u64>, v: &Value) {
        match cmd {
            "audio.play" => play(rid, v),
            "audio.control" => control(rid, v),
            "audio.devices" => crate::engine::reply(rid, Ok(devices())),
            _ => crate::engine::reply(rid, Err(format!("{cmd}: unknown audio command"))),
        }
    }

    fn emit(id: &str, kind: &str, message: Option<String>) {
        let mut event = json!({ "t": "audio", "id": id, "kind": kind });
        if let Some(message) = message {
            event["message"] = message.into();
        }
        crate::windows::send_any_thread(event);
    }

    fn requested_device(v: &Value) -> Option<String> {
        v.as_str().filter(|d| !d.is_empty() && *d != "default").map(str::to_owned)
    }

    fn play(rid: Option<u64>, v: &Value) {
        let (Some(id), Some(path)) = (v["id"].as_str(), v["path"].as_str()) else {
            return crate::engine::reply(rid, Err("audio.play needs id and path".into()));
        };
        let id = id.to_owned();
        let path = path.to_owned();
        let volume = v["volume"].as_f64().unwrap_or(1.0).clamp(0.0, 1.0) as f32;
        let device = requested_device(&v["device"]);
        let (tx, rx) = mpsc::channel();
        let token = NEXT_TOKEN.fetch_add(1, Ordering::Relaxed);
        if let Some((_, previous)) = players(|p| p.insert(id.clone(), (token, tx))) {
            let _ = previous.send(Control::Stop);
        }
        let thread_id = id.clone();
        let spawned = std::thread::Builder::new()
            .name(format!("audio-{id}"))
            .spawn(move || run(thread_id, token, path, volume, device, rid, rx));
        if let Err(e) = spawned {
            players(|p| p.remove(&id));
            crate::engine::reply(rid, Err(format!("audio thread: {e}")));
        }
    }

    fn control(rid: Option<u64>, v: &Value) {
        let Some(id) = v["id"].as_str() else {
            return crate::engine::reply(rid, Err("audio.control needs id".into()));
        };
        let message = match v["op"].as_str().unwrap_or("") {
            "pause" => Control::Pause,
            "resume" => Control::Resume,
            "stop" => Control::Stop,
            "volume" => Control::Volume(v["value"].as_f64().unwrap_or(1.0).clamp(0.0, 1.0) as f32),
            "output" => {
                let device = requested_device(&v["value"]);
                if let Some(name) = &device {
                    if find_output(name).is_none() {
                        return crate::engine::reply(rid, Err(format!("Requested device not found: {name}")));
                    }
                }
                Control::Output(device)
            }
            op => return crate::engine::reply(rid, Err(format!("audio.control: unknown op {op}"))),
        };
        let sent = players(|p| p.get(id).map(|(_, tx)| tx.send(message).is_ok())).unwrap_or(false);
        crate::engine::reply(rid, Ok(json!({ "playing": sent })));
    }

    fn group_of(name: &str) -> String {
        let mut h: u64 = 0xcbf2_9ce4_8422_2325;
        for b in name.bytes() {
            h = (h ^ b as u64).wrapping_mul(0x100_0000_01b3);
        }
        format!("{h:016x}")
    }

    fn devices() -> Value {
        let host = cpal::default_host();
        let mut out = Vec::new();
        let kinds: [(&str, Option<cpal::Device>, Vec<cpal::Device>); 2] = [
            ("audioinput", host.default_input_device(), host.input_devices().map(|d| d.collect()).unwrap_or_default()),
            ("audiooutput", host.default_output_device(), host.output_devices().map(|d| d.collect()).unwrap_or_default()),
        ];
        for (kind, default, all) in kinds {
            if let Some(name) = default.and_then(|d| d.name().ok()) {
                out.push(json!({ "deviceId": "default", "kind": kind, "label": format!("Default - {name}"), "groupId": group_of(&name) }));
            }
            for name in all.iter().filter_map(|d| d.name().ok()) {
                out.push(json!({ "deviceId": name, "kind": kind, "label": name, "groupId": group_of(&name) }));
            }
        }
        Value::Array(out)
    }

    fn find_output(name: &str) -> Option<cpal::Device> {
        cpal::default_host()
            .output_devices()
            .ok()?
            .find(|d| d.name().map(|n| n == name).unwrap_or(false))
    }

    struct Shared {
        samples: Mutex<VecDeque<f32>>,
        volume: AtomicU32,
        paused: AtomicBool,
        failed: Mutex<Option<String>>,
    }

    impl Shared {
        fn volume(&self) -> f32 {
            f32::from_bits(self.volume.load(Ordering::Relaxed))
        }

        fn pull(&self, out: &mut [f32]) {
            if self.paused.load(Ordering::Relaxed) {
                out.fill(0.0);
                return;
            }
            let volume = self.volume();
            let mut samples = self.samples.lock().unwrap_or_else(|e| e.into_inner());
            for slot in out.iter_mut() {
                *slot = samples.pop_front().unwrap_or(0.0) * volume;
            }
        }
    }

    enum Output {
        Device { _stream: cpal::Stream, name: String },
        Null { stop: Arc<AtomicBool> },
    }

    impl Drop for Output {
        fn drop(&mut self) {
            if let Output::Null { stop } = self {
                stop.store(true, Ordering::Relaxed);
            }
        }
    }

    struct Opened {
        output: Output,
        rate: u32,
        channels: u16,
    }

    fn open_output(device: Option<&str>, shared: &Arc<Shared>) -> Result<Opened, String> {
        let chosen = match device {
            Some(name) => Some(find_output(name).ok_or_else(|| format!("Requested device not found: {name}"))?),
            None => cpal::default_host().default_output_device(),
        };
        if let Some(output) = chosen {
            match open_device(&output, shared) {
                Ok(opened) => return Ok(opened),
                Err(e) if device.is_some() => return Err(e),
                Err(e) => eprintln!("stella-engine: audio output unavailable ({e}); playing silently"),
            }
        }
        Ok(open_null(shared))
    }

    fn device_name(device: &cpal::Device) -> String {
        device.name().unwrap_or_default()
    }

    fn open_device(device: &cpal::Device, shared: &Arc<Shared>) -> Result<Opened, String> {
        let supported = device.default_output_config().map_err(|e| e.to_string())?;
        let config: cpal::StreamConfig = supported.config();
        let stream = match supported.sample_format() {
            cpal::SampleFormat::F32 => build::<f32>(device, &config, shared),
            cpal::SampleFormat::I16 => build::<i16>(device, &config, shared),
            cpal::SampleFormat::U16 => build::<u16>(device, &config, shared),
            cpal::SampleFormat::I32 => build::<i32>(device, &config, shared),
            cpal::SampleFormat::U8 => build::<u8>(device, &config, shared),
            other => return Err(format!("unsupported output sample format {other:?}")),
        }?;
        stream.play().map_err(|e| e.to_string())?;
        Ok(Opened {
            output: Output::Device { _stream: stream, name: device_name(device) },
            rate: config.sample_rate.0,
            channels: config.channels,
        })
    }

    fn build<T: SizedSample + FromSample<f32>>(
        device: &cpal::Device,
        config: &cpal::StreamConfig,
        shared: &Arc<Shared>,
    ) -> Result<cpal::Stream, String> {
        let data = shared.clone();
        let errors = shared.clone();
        let mut scratch: Vec<f32> = Vec::new();
        device
            .build_output_stream(
                config,
                move |out: &mut [T], _| {
                    scratch.resize(out.len(), 0.0);
                    data.pull(&mut scratch);
                    for (slot, sample) in out.iter_mut().zip(&scratch) {
                        *slot = T::from_sample(*sample);
                    }
                },
                move |e| {
                    *errors.failed.lock().unwrap_or_else(|e| e.into_inner()) = Some(e.to_string());
                },
                None,
            )
            .map_err(|e| e.to_string())
    }

    fn open_null(shared: &Arc<Shared>) -> Opened {
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let data = shared.clone();
        std::thread::spawn(move || {
            let per_second = (NULL_RATE * NULL_CHANNELS as u32) as f64;
            let mut last = Instant::now();
            let mut owed = 0.0f64;
            let mut scratch = Vec::new();
            while !flag.load(Ordering::Relaxed) {
                std::thread::sleep(TICK);
                let now = Instant::now();
                owed += now.duration_since(last).as_secs_f64() * per_second;
                last = now;
                let whole = (owed as usize) / NULL_CHANNELS as usize * NULL_CHANNELS as usize;
                owed -= whole as f64;
                scratch.resize(whole, 0.0);
                data.pull(&mut scratch);
            }
        });
        Opened { output: Output::Null { stop }, rate: NULL_RATE, channels: NULL_CHANNELS }
    }

    struct Source {
        format: Box<dyn FormatReader>,
        decoder: Box<dyn Decoder>,
        track: u32,
        rate: u32,
        channels: usize,
        duration: Option<f64>,
    }

    fn open_source(path: &str) -> Result<Source, String> {
        let file = File::open(path).map_err(|e| format!("{path}: {e}"))?;
        let stream = MediaSourceStream::new(Box::new(file), Default::default());
        let mut hint = Hint::new();
        if let Some(ext) = Path::new(path).extension().and_then(|e| e.to_str()) {
            hint.with_extension(ext);
        }
        let probed = symphonia::default::get_probe()
            .format(&hint, stream, &FormatOptions::default(), &MetadataOptions::default())
            .map_err(|e| format!("unsupported audio: {e}"))?;
        let format = probed.format;
        let track = format
            .tracks()
            .iter()
            .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
            .ok_or("no audio track")?;
        let params = &track.codec_params;
        let rate = params.sample_rate.ok_or("unknown sample rate")?;
        let channels = params.channels.map(|c| c.count()).unwrap_or(2).max(1);
        let duration = params.n_frames.map(|n| n as f64 / rate as f64);
        let decoder = symphonia::default::get_codecs()
            .make(params, &DecoderOptions::default())
            .map_err(|e| format!("unsupported codec: {e}"))?;
        let track = track.id;
        Ok(Source { format, decoder, track, rate, channels, duration })
    }

    impl Source {
        /// The next interleaved samples, or None at the end.
        fn next(&mut self) -> Result<Option<(Vec<f32>, usize)>, String> {
            loop {
                let packet = match self.format.next_packet() {
                    Ok(packet) => packet,
                    Err(DecodeError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
                    Err(DecodeError::ResetRequired) => return Ok(None),
                    Err(e) => return Err(e.to_string()),
                };
                if packet.track_id() != self.track {
                    continue;
                }
                match self.decoder.decode(&packet) {
                    Ok(decoded) => {
                        let spec = *decoded.spec();
                        let mut buffer = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
                        buffer.copy_interleaved_ref(decoded);
                        return Ok(Some((buffer.samples().to_vec(), spec.channels.count().max(1))));
                    }
                    Err(DecodeError::DecodeError(_)) => continue,
                    Err(e) => return Err(e.to_string()),
                }
            }
        }
    }

    /// Linear-interpolation rate conversion and channel mapping onto the output's format.
    struct Converter {
        from_rate: u32,
        to_rate: u32,
        to_channels: usize,
        pending: Vec<f32>,
        pending_channels: usize,
        position: f64,
    }

    impl Converter {
        fn new(from_rate: u32, from_channels: usize, to_rate: u32, to_channels: u16) -> Self {
            Converter { from_rate, to_rate, to_channels: to_channels as usize, pending: Vec::new(), pending_channels: from_channels, position: 0.0 }
        }

        fn retarget(&mut self, to_rate: u32, to_channels: u16) {
            self.to_rate = to_rate;
            self.to_channels = to_channels as usize;
        }

        fn map(&self, frame: &[f32], out: &mut VecDeque<f32>) {
            let n = frame.len();
            for c in 0..self.to_channels {
                let sample = if n == 1 {
                    frame[0]
                } else if self.to_channels == 1 {
                    frame.iter().sum::<f32>() / n as f32
                } else if c < n {
                    frame[c]
                } else {
                    0.0
                };
                out.push_back(sample);
            }
        }

        fn push(&mut self, samples: &[f32], channels: usize, out: &mut VecDeque<f32>) {
            if channels != self.pending_channels {
                self.pending.clear();
                self.position = 0.0;
                self.pending_channels = channels;
            }
            self.pending.extend_from_slice(samples);
            self.drain(out, false);
        }

        fn finish(&mut self, out: &mut VecDeque<f32>) {
            self.drain(out, true);
        }

        fn drain(&mut self, out: &mut VecDeque<f32>, last: bool) {
            let ch = self.pending_channels;
            let frames = self.pending.len() / ch;
            let step = self.from_rate as f64 / self.to_rate as f64;
            let mut frame = vec![0.0f32; ch];
            loop {
                let i = self.position.floor() as usize;
                if i + 1 >= frames && !(last && i < frames) {
                    break;
                }
                let t = (self.position - i as f64) as f32;
                for c in 0..ch {
                    let a = self.pending[i * ch + c];
                    let b = if i + 1 < frames { self.pending[(i + 1) * ch + c] } else { a };
                    frame[c] = a + (b - a) * t;
                }
                self.map(&frame, out);
                self.position += step;
            }
            let used = (self.position.floor() as usize).min(frames);
            self.pending.drain(..used * ch);
            self.position -= used as f64;
        }
    }

    fn run(id: String, token: u64, path: String, volume: f32, device: Option<String>, rid: Option<u64>, rx: Receiver<Control>) {
        let result = play_until_done(&path, volume, device, rid, &rx);
        players(|p| {
            if p.get(&id).is_some_and(|(t, _)| *t == token) {
                p.remove(&id);
            }
        });
        match result {
            Ok(Finish::Ended) => emit(&id, "ended", None),
            Ok(Finish::Stopped) => {}
            Err(e) => emit(&id, "error", Some(e)),
        }
    }

    enum Finish {
        Ended,
        Stopped,
    }

    fn play_until_done(
        path: &str,
        volume: f32,
        device: Option<String>,
        rid: Option<u64>,
        rx: &Receiver<Control>,
    ) -> Result<Finish, String> {
        let mut source = match open_source(path) {
            Ok(source) => source,
            Err(e) => {
                crate::engine::reply_any_thread(rid, Err(e));
                return Ok(Finish::Stopped);
            }
        };
        let shared = Arc::new(Shared {
            samples: Mutex::new(VecDeque::new()),
            volume: AtomicU32::new(volume.to_bits()),
            paused: AtomicBool::new(false),
            failed: Mutex::new(None),
        });
        let mut opened = match open_output(device.as_deref(), &shared) {
            Ok(opened) => opened,
            Err(e) => {
                crate::engine::reply_any_thread(rid, Err(e));
                return Ok(Finish::Stopped);
            }
        };
        let mut converter = Converter::new(source.rate, source.channels, opened.rate, opened.channels);
        let device_label = match &opened.output {
            Output::Device { name, .. } => Value::from(name.clone()),
            Output::Null { .. } => Value::Null,
        };
        crate::engine::reply_any_thread(
            rid,
            Ok(json!({ "device": device_label, "sampleRate": opened.rate, "channels": opened.channels, "duration": source.duration })),
        );
        let mut decoded_all = false;
        loop {
            let target = (opened.rate as f32 * opened.channels as f32 * BUFFER_SECONDS) as usize;
            while !decoded_all && shared.samples.lock().unwrap_or_else(|e| e.into_inner()).len() < target {
                let mut converted = VecDeque::new();
                match source.next()? {
                    Some((samples, channels)) => converter.push(&samples, channels, &mut converted),
                    None => {
                        converter.finish(&mut converted);
                        decoded_all = true;
                    }
                }
                shared.samples.lock().unwrap_or_else(|e| e.into_inner()).extend(converted);
            }
            match rx.recv_timeout(TICK) {
                Ok(Control::Stop) | Err(RecvTimeoutError::Disconnected) => return Ok(Finish::Stopped),
                Ok(Control::Pause) => shared.paused.store(true, Ordering::Relaxed),
                Ok(Control::Resume) => shared.paused.store(false, Ordering::Relaxed),
                Ok(Control::Volume(v)) => shared.volume.store(v.to_bits(), Ordering::Relaxed),
                Ok(Control::Output(next)) => {
                    let reopened = open_output(next.as_deref(), &shared)?;
                    if reopened.rate != opened.rate || reopened.channels != opened.channels {
                        shared.samples.lock().unwrap_or_else(|e| e.into_inner()).clear();
                        converter.retarget(reopened.rate, reopened.channels);
                    }
                    opened = reopened;
                }
                Err(RecvTimeoutError::Timeout) => {}
            }
            if let Some(e) = shared.failed.lock().unwrap_or_else(|e| e.into_inner()).take() {
                return Err(e);
            }
            if decoded_all && shared.samples.lock().unwrap_or_else(|e| e.into_inner()).is_empty() {
                std::thread::sleep(Duration::from_millis(60));
                return Ok(Finish::Ended);
            }
        }
    }
}
