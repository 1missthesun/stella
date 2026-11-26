//! Screen capture behind Electron's `desktopCapturer` and the Show Stella recorder:
//! ScreenCaptureKit on macOS.
//!
//! - `capture.sources {types, thumbnailSize}`: Electron `DesktopCapturerSource`s; `thumbnail` is a
//!   PNG path (null when the size is 0).
//! - `capture.start {id, sourceId, width, height, fps, file, framesDir, frameIntervalMs, frameEdge,
//!   jpegQuality, microphone}`: records an H.264 MP4 (with the microphone as AAC where
//!   ScreenCaptureKit can capture it), writes a JPEG of the latest picture every
//!   `frameIntervalMs` (`{t:"capture", id, kind:"frame", at, path}`), and keeps the microphone as
//!   16 kHz mono PCM.
//! - `capture.stop {id}`: finishes the file; replies `{file, frames, pcm, pcmStartAt}`.

use serde_json::Value;

pub fn command(cmd: &str, rid: Option<u64>, v: &Value) {
    #[cfg(target_os = "macos")]
    mac::command(cmd, rid, v);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = v;
        crate::engine::reply(rid, Err(format!("{cmd}: screen capture is not available on this platform")));
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use std::cell::Cell;
    use std::collections::HashMap;
    use std::path::{Path, PathBuf};
    use std::ptr::{NonNull, null_mut};
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use std::sync::{Arc, LazyLock, Mutex};
    use std::time::Duration;

    use block2::RcBlock;
    use dispatch2::DispatchQueue;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, NSObject, ProtocolObject};
    use objc2::{AnyThread, DefinedClass, Message, available, define_class, msg_send};
    use objc2_av_foundation::{
        AVAssetWriter, AVAssetWriterInput, AVAssetWriterStatus, AVFileTypeMPEG4, AVMediaTypeAudio, AVMediaTypeVideo,
        AVVideoAverageBitRateKey, AVVideoCodecKey, AVVideoCodecTypeH264, AVVideoCompressionPropertiesKey, AVVideoHeightKey,
        AVVideoWidthKey,
    };
    use objc2_core_audio_types::{AudioBuffer, AudioBufferList};
    use objc2_core_foundation::CFRetained;
    use objc2_core_media::{CMAudioFormatDescriptionGetStreamBasicDescription, CMBlockBuffer, CMSampleBuffer, CMTime};
    use objc2_core_video::{
        CVPixelBuffer, CVPixelBufferGetBaseAddress, CVPixelBufferGetBytesPerRow, CVPixelBufferGetHeight, CVPixelBufferGetWidth,
        CVPixelBufferLockBaseAddress, CVPixelBufferLockFlags, CVPixelBufferUnlockBaseAddress,
    };
    use objc2_foundation::{NSCopying, NSDictionary, NSError, NSNumber, NSObjectProtocol, NSString, NSURL};
    use objc2_screen_capture_kit::{
        SCContentFilter, SCShareableContent, SCStream, SCStreamConfiguration, SCStreamOutput, SCStreamOutputType, SCWindow,
    };
    use serde_json::{Value, json};

    use crate::engine::reply_any_thread as reply;
    use crate::metrics::epoch_ms;

    const BGRA: u32 = u32::from_be_bytes(*b"BGRA");
    const AAC: u32 = u32::from_be_bytes(*b"aac ");
    const PCM_RATE: f64 = 16_000.0;
    /// The largest frame Apple's H.264 encoders take.
    const MAX_VIDEO: (f64, f64) = (4096.0, 2304.0);

    /// ScreenCaptureKit, AVFoundation and CoreVideo objects are thread-safe to message; objc2 marks
    /// them neither Send nor Sync.
    struct Shared<T>(T);
    unsafe impl<T> Send for Shared<T> {}
    unsafe impl<T> Sync for Shared<T> {}

    type Sink = Box<dyn Fn(&CMSampleBuffer, SCStreamOutputType) + Send + Sync>;

    struct OutputIvars {
        sink: Sink,
    }

    define_class!(
        #[unsafe(super(NSObject))]
        #[name = "StellaEngineCaptureOutput"]
        #[ivars = OutputIvars]
        struct CaptureOutput;

        unsafe impl NSObjectProtocol for CaptureOutput {}

        unsafe impl SCStreamOutput for CaptureOutput {
            #[unsafe(method(stream:didOutputSampleBuffer:ofType:))]
            fn did_output(&self, _stream: &SCStream, buffer: &CMSampleBuffer, kind: SCStreamOutputType) {
                (self.ivars().sink)(buffer, kind);
            }
        }
    );

    impl CaptureOutput {
        fn new(sink: Sink) -> Retained<Self> {
            let this = Self::alloc().set_ivars(OutputIvars { sink });
            unsafe { msg_send![super(this), init] }
        }
    }

    pub fn command(cmd: &str, rid: Option<u64>, v: &Value) {
        match cmd {
            "capture.sources" => sources(rid, v),
            "capture.start" => start(rid, v),
            "capture.stop" => stop(rid, v),
            _ => reply(rid, Err(format!("{cmd}: unknown capture command"))),
        }
    }

    fn error_text(error: *mut NSError, fallback: &str) -> String {
        unsafe { error.as_ref() }.map(|e| e.localizedDescription().to_string()).unwrap_or_else(|| fallback.to_owned())
    }

    fn shareable(done: impl FnOnce(Result<Retained<SCShareableContent>, String>) + 'static) {
        let done = Cell::new(Some(done));
        let block = RcBlock::new(move |content: *mut SCShareableContent, error: *mut NSError| {
            let Some(done) = done.take() else { return };
            done(unsafe { Retained::retain(content) }.ok_or_else(|| error_text(error, "Screen capture isn't allowed")));
        });
        unsafe { SCShareableContent::getShareableContentExcludingDesktopWindows_onScreenWindowsOnly_completionHandler(true, true, &block) };
    }

    /// The engine's display ids (Electron `display.id`) by CGDirectDisplayID.
    fn engine_display_ids() -> HashMap<u32, u32> {
        rune::displays()
            .into_iter()
            .filter_map(|d| match d.native_id() {
                Some(rune::NativeDisplayId::MacOS(cg)) => Some((cg, crate::commands::display_id(d.name.as_deref().unwrap_or(""), d.position))),
                _ => None,
            })
            .collect()
    }

    fn size_of(v: &Value, k: &str) -> f64 {
        v.get("thumbnailSize").and_then(|s| s.get(k)).and_then(|x| x.as_f64()).unwrap_or(0.0)
    }

    fn fit(w: f64, h: f64, max_w: f64, max_h: f64) -> (usize, usize) {
        let k = (max_w / w.max(1.0)).min(max_h / h.max(1.0));
        ((w * k).round().max(1.0) as usize, (h * k).round().max(1.0) as usize)
    }

    fn filter_for_display(display: &objc2_screen_capture_kit::SCDisplay) -> Retained<SCContentFilter> {
        let none = objc2_foundation::NSArray::<SCWindow>::new();
        unsafe { SCContentFilter::initWithDisplay_excludingWindows(SCContentFilter::alloc(), display, &none) }
    }

    fn filter_for_window(window: &SCWindow) -> Retained<SCContentFilter> {
        unsafe { SCContentFilter::initWithDesktopIndependentWindow(SCContentFilter::alloc(), window) }
    }

    fn sources(rid: Option<u64>, v: &Value) {
        let types: Vec<String> = v.get("types").and_then(|t| t.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_owned)).collect()).unwrap_or_else(|| vec!["screen".into()]);
        let (tw, th) = (size_of(v, "width"), size_of(v, "height"));
        let ids = engine_display_ids();
        let me = std::process::id() as i32;
        shareable(move |content| {
            let content = match content {
                Ok(c) => c,
                Err(e) => return reply(rid, Err(e)),
            };
            let mut list: Vec<Value> = Vec::new();
            let mut shots: Vec<(usize, Retained<SCContentFilter>, (usize, usize))> = Vec::new();
            if types.iter().any(|t| t == "screen") {
                let displays = unsafe { content.displays() };
                let count = displays.count();
                for (i, d) in displays.iter().enumerate() {
                    let cg = unsafe { d.displayID() };
                    let frame = unsafe { d.frame() };
                    let name = if count == 1 { "Entire Screen".to_owned() } else { format!("Screen {}", i + 1) };
                    let display_id = ids.get(&cg).map(|id| id.to_string()).unwrap_or_default();
                    list.push(json!({ "id": format!("screen:{cg}:0"), "name": name, "display_id": display_id, "thumbnail": null }));
                    if tw > 0.0 && th > 0.0 {
                        shots.push((list.len() - 1, filter_for_display(&d), fit(frame.size.width, frame.size.height, tw, th)));
                    }
                }
            }
            if types.iter().any(|t| t == "window") {
                for w in unsafe { content.windows() }.iter() {
                    let title = unsafe { w.title() }.map(|t| t.to_string()).unwrap_or_default();
                    let owner = unsafe { w.owningApplication() };
                    if title.is_empty() || unsafe { w.windowLayer() } != 0 || owner.as_ref().is_some_and(|a| unsafe { a.processID() } == me) {
                        continue;
                    }
                    let id = unsafe { w.windowID() };
                    let frame = unsafe { w.frame() };
                    list.push(json!({ "id": format!("window:{id}:0"), "name": title, "display_id": "", "thumbnail": null }));
                    if tw > 0.0 && th > 0.0 {
                        shots.push((list.len() - 1, filter_for_window(&w), fit(frame.size.width, frame.size.height, tw, th)));
                    }
                }
            }
            if shots.is_empty() {
                return reply(rid, Ok(json!(list)));
            }
            let dir = std::env::temp_dir().join("stella-rune-capture");
            let _ = std::fs::create_dir_all(&dir);
            let left = Arc::new(Mutex::new((list, shots.len())));
            for (index, filter, (w, h)) in shots {
                let left = left.clone();
                let path = dir.join(format!("thumb-{}-{}-{index}.png", std::process::id(), epoch_ms() as u64));
                grab(&filter, w, h, move |image| {
                    let saved = image.ok().and_then(|img| img.save_with_format(&path, image::ImageFormat::Png).ok().map(|_| path.to_string_lossy().into_owned()));
                    let mut left = left.lock().unwrap_or_else(|e| e.into_inner());
                    left.0[index]["thumbnail"] = saved.map_or(Value::Null, Value::String);
                    left.1 -= 1;
                    if left.1 == 0 {
                        reply(rid, Ok(json!(std::mem::take(&mut left.0))));
                    }
                });
            }
        });
    }

    fn configuration(width: usize, height: usize, fps: f64, cursor: bool) -> Retained<SCStreamConfiguration> {
        unsafe {
            let config = SCStreamConfiguration::new();
            config.setWidth(width);
            config.setHeight(height);
            config.setPixelFormat(BGRA);
            config.setShowsCursor(cursor);
            config.setQueueDepth(6);
            config.setMinimumFrameInterval(CMTime { value: 1, timescale: fps.round().max(1.0) as i32, flags: objc2_core_media::CMTimeFlags::Valid, epoch: 0 });
            config
        }
    }

    fn new_stream(filter: &SCContentFilter, config: &SCStreamConfiguration, sink: Sink, microphone: bool) -> Result<(Retained<SCStream>, Retained<CaptureOutput>), String> {
        let output = CaptureOutput::new(sink);
        let stream = unsafe { SCStream::initWithFilter_configuration_delegate(SCStream::alloc(), filter, config, None) };
        let queue = DispatchQueue::new("stella.engine.capture", None);
        let proto = ProtocolObject::from_ref(&*output);
        unsafe { stream.addStreamOutput_type_sampleHandlerQueue_error(proto, SCStreamOutputType::Screen, Some(&queue)) }.map_err(|e| e.localizedDescription().to_string())?;
        if microphone {
            unsafe { stream.addStreamOutput_type_sampleHandlerQueue_error(proto, SCStreamOutputType::Microphone, Some(&queue)) }.map_err(|e| e.localizedDescription().to_string())?;
        }
        Ok((stream, output))
    }

    fn start_stream(stream: &SCStream, done: impl FnOnce(Result<(), String>) + 'static) {
        let done = Cell::new(Some(done));
        let block = RcBlock::new(move |error: *mut NSError| {
            if let Some(done) = done.take() {
                done(if error.is_null() { Ok(()) } else { Err(error_text(error, "capture failed to start")) });
            }
        });
        unsafe { stream.startCaptureWithCompletionHandler(Some(&block)) };
    }

    /// Stops `stream`, keeping it and its output alive until ScreenCaptureKit is done with them.
    fn stop_stream(stream: Retained<SCStream>, output: Retained<CaptureOutput>, then: impl FnOnce() + 'static) {
        let keep = Cell::new(Some((stream.clone(), output, then)));
        let block = RcBlock::new(move |_error: *mut NSError| {
            if let Some((_stream, _output, then)) = keep.take() {
                then();
            }
        });
        unsafe { stream.stopCaptureWithCompletionHandler(Some(&block)) };
    }

    struct Pixels {
        width: usize,
        height: usize,
        bgra: Vec<u8>,
    }

    fn pixels_of(buffer: &CVPixelBuffer) -> Option<Pixels> {
        unsafe {
            if CVPixelBufferLockBaseAddress(buffer, CVPixelBufferLockFlags::ReadOnly) != 0 {
                return None;
            }
        }
        let (width, height, stride) = (CVPixelBufferGetWidth(buffer), CVPixelBufferGetHeight(buffer), CVPixelBufferGetBytesPerRow(buffer));
        let base = CVPixelBufferGetBaseAddress(buffer) as *const u8;
        let out = (!base.is_null() && width > 0 && height > 0).then(|| {
            let mut bgra = Vec::with_capacity(width * height * 4);
            for y in 0..height {
                bgra.extend_from_slice(unsafe { std::slice::from_raw_parts(base.add(y * stride), width * 4) });
            }
            Pixels { width, height, bgra }
        });
        unsafe { CVPixelBufferUnlockBaseAddress(buffer, CVPixelBufferLockFlags::ReadOnly) };
        out
    }

    fn rgba(p: &Pixels) -> Option<image::RgbaImage> {
        let mut data = p.bgra.clone();
        for px in data.chunks_exact_mut(4) {
            px.swap(0, 2);
            px[3] = 255;
        }
        image::RgbaImage::from_raw(p.width as u32, p.height as u32, data)
    }

    fn rgb(p: &Pixels) -> Option<image::RgbImage> {
        let mut data = Vec::with_capacity(p.width * p.height * 3);
        for px in p.bgra.chunks_exact(4) {
            data.extend_from_slice(&[px[2], px[1], px[0]]);
        }
        image::RgbImage::from_raw(p.width as u32, p.height as u32, data)
    }

    /// One picture of `filter` at `width`×`height` pixels.
    fn grab(filter: &SCContentFilter, width: usize, height: usize, done: impl FnOnce(Result<image::RgbaImage, String>) + Send + 'static) {
        type Done = Box<dyn FnOnce(Result<image::RgbaImage, String>) + Send>;
        let done: Arc<Mutex<Option<Done>>> = Arc::new(Mutex::new(Some(Box::new(done))));
        let held: Arc<Mutex<Option<Shared<(Retained<SCStream>, Retained<CaptureOutput>)>>>> = Arc::new(Mutex::new(None));
        let finish = {
            let (done, held) = (done.clone(), held.clone());
            Arc::new(move |result: Result<image::RgbaImage, String>| {
                let Some(done) = done.lock().unwrap_or_else(|e| e.into_inner()).take() else { return };
                done(result);
                if let Some(Shared((stream, output))) = held.lock().unwrap_or_else(|e| e.into_inner()).take() {
                    stop_stream(stream, output, || {});
                }
            })
        };
        let on_frame = finish.clone();
        let sink: Sink = Box::new(move |buffer, kind| {
            if kind != SCStreamOutputType::Screen {
                return;
            }
            if let Some(image) = unsafe { buffer.image_buffer() }.and_then(|b| pixels_of(&b)).and_then(|p| rgba(&p)) {
                on_frame(Ok(image));
            }
        });
        let config = configuration(width, height, 30.0, false);
        let (stream, output) = match new_stream(filter, &config, sink, false) {
            Ok(s) => s,
            Err(e) => return finish(Err(e)),
        };
        *held.lock().unwrap_or_else(|e| e.into_inner()) = Some(Shared((stream.clone(), output)));
        let on_start = finish.clone();
        start_stream(&stream, move |r| {
            if let Err(e) = r {
                on_start(Err(e));
            }
        });
        let timeout = Shared(finish);
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(5));
            (timeout.0)(Err("no picture from the screen".into()));
        });
    }

    struct Writer {
        asset: Retained<AVAssetWriter>,
        video: Retained<AVAssetWriterInput>,
        audio: Option<Retained<AVAssetWriterInput>>,
        session_start: Option<f64>,
        failed: bool,
    }

    /// The microphone as 16 kHz mono, box-filtered down from the device rate.
    #[derive(Default)]
    struct Pcm {
        samples: Vec<i16>,
        carry: Vec<f32>,
        pos: f64,
        started_at: Option<f64>,
    }

    impl Pcm {
        fn push(&mut self, rate: f64, mono: &[f32], at: f64) {
            if self.started_at.is_none() {
                self.started_at = Some(at - mono.len() as f64 * 1000.0 / rate);
            }
            self.carry.extend_from_slice(mono);
            let step = rate / PCM_RATE;
            while self.pos + step <= self.carry.len() as f64 {
                let (a, b) = (self.pos.floor() as usize, ((self.pos + step).floor() as usize).max(self.pos.floor() as usize + 1));
                let span = &self.carry[a..b.min(self.carry.len())];
                let v = span.iter().sum::<f32>() / span.len().max(1) as f32;
                self.samples.push((v.clamp(-1.0, 1.0) * 32767.0) as i16);
                self.pos += step;
            }
            let used = self.pos.floor() as usize;
            self.carry.drain(..used.min(self.carry.len()));
            self.pos -= used as f64;
        }
    }

    struct Recording {
        stream: Retained<SCStream>,
        output: Retained<CaptureOutput>,
        writer: Arc<Mutex<Shared<Writer>>>,
        pcm: Arc<Mutex<Pcm>>,
        stopped: Arc<AtomicBool>,
        frames: Arc<AtomicU32>,
        file: String,
        microphone: bool,
    }

    static RECORDINGS: LazyLock<Mutex<HashMap<String, Shared<Recording>>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

    fn any<T: Message>(object: Retained<T>) -> Retained<AnyObject> {
        unsafe { Retained::cast_unchecked(object) }
    }

    fn settings(pairs: &[(&NSString, Retained<AnyObject>)]) -> Retained<NSDictionary<NSString, AnyObject>> {
        let keys: Vec<&NSString> = pairs.iter().map(|(k, _)| *k).collect();
        let values: Vec<Retained<AnyObject>> = pairs.iter().map(|(_, v)| v.clone()).collect();
        NSDictionary::from_retained_objects(&keys, &values)
    }

    fn writer(file: &str, width: usize, height: usize, audio: bool) -> Result<Writer, String> {
        let _ = std::fs::remove_file(file);
        let url = NSURL::fileURLWithPath(&NSString::from_str(file));
        let types = unsafe { (AVFileTypeMPEG4, AVMediaTypeVideo, AVMediaTypeAudio) };
        let (Some(mp4), Some(video_type), Some(audio_type)) = types else {
            return Err("AVFoundation constants are missing".into());
        };
        let asset = unsafe { AVAssetWriter::assetWriterWithURL_fileType_error(&url, mp4) }.map_err(|e| e.localizedDescription().to_string())?;
        let keys = unsafe { (AVVideoCodecKey, AVVideoCodecTypeH264, AVVideoWidthKey, AVVideoHeightKey, AVVideoCompressionPropertiesKey, AVVideoAverageBitRateKey) };
        let (Some(codec_key), Some(codec), Some(w_key), Some(h_key), Some(props_key), Some(rate_key)) = keys else {
            return Err("AVFoundation video keys are missing".into());
        };
        let props = settings(&[(rate_key, any(NSNumber::new_u32(4_000_000)))]);
        let video_settings = settings(&[
            (codec_key, any(codec.copy())),
            (w_key, any(NSNumber::new_usize(width))),
            (h_key, any(NSNumber::new_usize(height))),
            (props_key, any(props)),
        ]);
        let video = unsafe { AVAssetWriterInput::assetWriterInputWithMediaType_outputSettings(video_type, Some(&video_settings)) };
        unsafe { video.setExpectsMediaDataInRealTime(true) };
        if !unsafe { asset.canAddInput(&video) } {
            return Err("the video track can't be added".into());
        }
        unsafe { asset.addInput(&video) };
        let audio = audio
            .then(|| {
                let key = |s: &str| NSString::from_str(s);
                let (format, rate, channels, bitrate) = (key("AVFormatIDKey"), key("AVSampleRateKey"), key("AVNumberOfChannelsKey"), key("AVEncoderBitRateKey"));
                let audio_settings = settings(&[
                    (&format, any(NSNumber::new_u32(AAC))),
                    (&rate, any(NSNumber::new_f64(48_000.0))),
                    (&channels, any(NSNumber::new_u32(1))),
                    (&bitrate, any(NSNumber::new_u32(96_000))),
                ]);
                let input = unsafe { AVAssetWriterInput::assetWriterInputWithMediaType_outputSettings(audio_type, Some(&audio_settings)) };
                unsafe { input.setExpectsMediaDataInRealTime(true) };
                unsafe { asset.canAddInput(&input) }.then(|| {
                    unsafe { asset.addInput(&input) };
                    input
                })
            })
            .flatten();
        Ok(Writer { asset, video, audio, session_start: None, failed: false })
    }

    fn seconds(t: CMTime) -> f64 {
        if t.timescale == 0 { 0.0 } else { t.value as f64 / t.timescale as f64 }
    }

    /// The buffer's audio as mono f32 at the device rate.
    fn mono_of(buffer: &CMSampleBuffer) -> Option<(f64, Vec<f32>)> {
        let desc = unsafe { buffer.format_description() }?;
        let asbd = unsafe { CMAudioFormatDescriptionGetStreamBasicDescription(&desc).as_ref() }?;
        let mut needed = 0usize;
        unsafe { buffer.audio_buffer_list_with_retained_block_buffer(&mut needed, null_mut(), 0, None, None, 0, null_mut()) };
        if needed == 0 {
            return None;
        }
        let mut storage = vec![0u64; needed.div_ceil(8)];
        let list = storage.as_mut_ptr() as *mut AudioBufferList;
        let mut block: *mut CMBlockBuffer = null_mut();
        let status = unsafe { buffer.audio_buffer_list_with_retained_block_buffer(null_mut(), list, needed, None, None, 1, &mut block) };
        if status != 0 {
            return None;
        }
        let _block = NonNull::new(block).map(|b| unsafe { CFRetained::from_raw(b) });
        let float = asbd.mFormatFlags & 1 != 0;
        let bytes = (asbd.mBitsPerChannel / 8).max(1) as usize;
        let count = unsafe { (*list).mNumberBuffers } as usize;
        let buffers = unsafe { std::slice::from_raw_parts(std::ptr::addr_of!((*list).mBuffers) as *const AudioBuffer, count) };
        let channels: usize = buffers.iter().map(|b| b.mNumberChannels.max(1) as usize).sum();
        let frames = buffers.first().map(|b| b.mDataByteSize as usize / (bytes * b.mNumberChannels.max(1) as usize)).unwrap_or(0);
        let mut mono = vec![0f32; frames];
        for b in buffers {
            let per = b.mNumberChannels.max(1) as usize;
            if b.mData.is_null() {
                continue;
            }
            for (i, out) in mono.iter_mut().enumerate() {
                for c in 0..per {
                    let at = (i * per + c) * bytes;
                    if at + bytes > b.mDataByteSize as usize {
                        break;
                    }
                    let p = unsafe { (b.mData as *const u8).add(at) };
                    *out += match (float, bytes) {
                        (true, 4) => unsafe { (p as *const f32).read_unaligned() },
                        (false, 2) => f32::from(unsafe { (p as *const i16).read_unaligned() }) / 32768.0,
                        (false, 4) => (unsafe { (p as *const i32).read_unaligned() }) as f32 / 2_147_483_648.0,
                        _ => 0.0,
                    };
                }
            }
        }
        let k = 1.0 / channels.max(1) as f32;
        mono.iter_mut().for_each(|s| *s *= k);
        Some((asbd.mSampleRate, mono))
    }

    fn even(v: f64) -> usize {
        ((v / 2.0).round() * 2.0).max(2.0) as usize
    }

    fn start(rid: Option<u64>, v: &Value) {
        let s = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_owned();
        let n = |k: &str, d: f64| v.get(k).and_then(|x| x.as_f64()).unwrap_or(d);
        let (id, source, file, frames_dir) = (s("id"), s("sourceId"), s("file"), s("framesDir"));
        let (fps, interval, edge, quality) = (n("fps", 30.0), n("frameIntervalMs", 1000.0).max(50.0), n("frameEdge", 1280.0), n("jpegQuality", 0.8));
        let (want_w, want_h) = (n("width", 1920.0).max(2.0), n("height", 1080.0).max(2.0));
        let k = (MAX_VIDEO.0 / want_w).min(MAX_VIDEO.1 / want_h).min(1.0);
        let (w, h) = (even(want_w * k), even(want_h * k));
        let microphone = v.get("microphone").and_then(|m| m.as_bool()).unwrap_or(false) && available!(macos = 15.0);
        if id.is_empty() || file.is_empty() || frames_dir.is_empty() {
            return reply(rid, Err("capture.start needs id, file and framesDir".into()));
        }
        if RECORDINGS.lock().unwrap_or_else(|e| e.into_inner()).contains_key(&id) {
            return reply(rid, Err(format!("capture {id} is already recording")));
        }
        let mut parts = source.split(':');
        let (kind, native) = (parts.next().unwrap_or(""), parts.next().and_then(|x| x.parse::<u32>().ok()));
        let Some(native) = native else { return reply(rid, Err(format!("unknown capture source {source}"))) };
        let kind = kind.to_owned();
        shareable(move |content| {
            let content = match content {
                Ok(c) => c,
                Err(e) => return reply(rid, Err(e)),
            };
            let filter = if kind == "window" {
                unsafe { content.windows() }.iter().find(|w| unsafe { w.windowID() } == native).map(|w| filter_for_window(&w))
            } else {
                unsafe { content.displays() }.iter().find(|d| unsafe { d.displayID() } == native).map(|d| filter_for_display(&d))
            };
            let Some(filter) = filter else { return reply(rid, Err(format!("the capture source {kind}:{native} is gone"))) };
            let _ = std::fs::create_dir_all(&frames_dir);
            let writer = match writer(&file, w, h, microphone) {
                Ok(w) => Arc::new(Mutex::new(Shared(w))),
                Err(e) => return reply(rid, Err(e)),
            };
            let latest: Arc<Mutex<Option<Shared<CFRetained<CVPixelBuffer>>>>> = Arc::new(Mutex::new(None));
            let pcm = Arc::new(Mutex::new(Pcm::default()));
            let sink: Sink = {
                let (writer, latest, pcm) = (writer.clone(), latest.clone(), pcm.clone());
                Box::new(move |buffer, kind| {
                    let pts = seconds(unsafe { buffer.presentation_time_stamp() });
                    let mut guard = writer.lock().unwrap_or_else(|e| e.into_inner());
                    let w = &mut guard.0;
                    if kind == SCStreamOutputType::Screen {
                        let Some(image) = (unsafe { buffer.image_buffer() }) else { return };
                        *latest.lock().unwrap_or_else(|e| e.into_inner()) = Some(Shared(image));
                        if w.failed {
                            return;
                        }
                        if w.session_start.is_none() {
                            if !unsafe { w.asset.startWriting() } {
                                w.failed = true;
                                eprintln!("stella-engine: capture writer: {:?}", unsafe { w.asset.error() }.map(|e| e.localizedDescription().to_string()));
                                return;
                            }
                            unsafe { w.asset.startSessionAtSourceTime(buffer.presentation_time_stamp()) };
                            w.session_start = Some(pts);
                        }
                        if unsafe { w.video.isReadyForMoreMediaData() } {
                            unsafe { w.video.appendSampleBuffer(buffer) };
                        }
                    } else if kind == SCStreamOutputType::Microphone {
                        if let Some((rate, mono)) = mono_of(buffer) {
                            pcm.lock().unwrap_or_else(|e| e.into_inner()).push(rate, &mono, epoch_ms());
                        }
                        if let (Some(start), Some(audio), false) = (w.session_start, w.audio.as_ref(), w.failed) {
                            if pts >= start && unsafe { audio.isReadyForMoreMediaData() } {
                                unsafe { audio.appendSampleBuffer(buffer) };
                            }
                        }
                    }
                })
            };
            let config = configuration(w, h, fps, true);
            if microphone {
                unsafe { config.setCaptureMicrophone(true) };
            }
            let (stream, output) = match new_stream(&filter, &config, sink, microphone) {
                Ok(s) => s,
                Err(e) => return reply(rid, Err(e)),
            };
            let stopped = Arc::new(AtomicBool::new(false));
            let frames = Arc::new(AtomicU32::new(0));
            let recording = Recording { stream: stream.clone(), output, writer, pcm, stopped: stopped.clone(), frames: frames.clone(), file: file.clone(), microphone };
            let id2 = id.clone();
            start_stream(&stream, move |r| {
                if let Err(e) = r {
                    return reply(rid, Err(e));
                }
                RECORDINGS.lock().unwrap_or_else(|e| e.into_inner()).insert(id2.clone(), Shared(recording));
                let started_at = epoch_ms();
                spawn_frames(id2.clone(), latest, stopped, frames, PathBuf::from(frames_dir), Duration::from_millis(interval as u64), edge, quality);
                reply(rid, Ok(json!({ "startedAt": started_at, "microphone": microphone, "width": w, "height": h })));
            });
        });
    }

    #[allow(clippy::too_many_arguments)]
    fn spawn_frames(id: String, latest: Arc<Mutex<Option<Shared<CFRetained<CVPixelBuffer>>>>>, stopped: Arc<AtomicBool>, frames: Arc<AtomicU32>, dir: PathBuf, every: Duration, edge: f64, quality: f64) {
        std::thread::spawn(move || {
            let mut next = std::time::Instant::now();
            while !stopped.load(Ordering::Relaxed) {
                let buffer = latest.lock().unwrap_or_else(|e| e.into_inner()).as_ref().map(|b| Shared(b.0.clone()));
                if let Some(buffer) = buffer {
                    let at = epoch_ms();
                    if let Some(path) = pixels_of(&buffer.0).and_then(|p| jpeg(&p, edge, quality, &dir, frames.load(Ordering::Relaxed))) {
                        frames.fetch_add(1, Ordering::Relaxed);
                        crate::windows::send_any_thread(json!({ "t": "capture", "id": id, "kind": "frame", "at": at, "path": path }));
                    }
                }
                next += every;
                let now = std::time::Instant::now();
                if next > now {
                    std::thread::sleep(next - now);
                } else {
                    next = now;
                }
            }
        });
    }

    fn jpeg(p: &Pixels, edge: f64, quality: f64, dir: &Path, n: u32) -> Option<String> {
        let full = rgb(p)?;
        let k = (edge / p.width.max(p.height).max(1) as f64).min(1.0);
        let (w, h) = (((p.width as f64 * k).round() as u32).max(1), ((p.height as f64 * k).round() as u32).max(1));
        let img = if k < 1.0 { image::imageops::resize(&full, w, h, image::imageops::FilterType::Triangle) } else { full };
        let path = dir.join(format!("frame-{n:05}.jpg"));
        let mut out = std::io::BufWriter::new(std::fs::File::create(&path).ok()?);
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, (quality * 100.0).round().clamp(1.0, 100.0) as u8).encode_image(&img).ok()?;
        Some(path.to_string_lossy().into_owned())
    }

    fn stop(rid: Option<u64>, v: &Value) {
        let id = v.get("id").and_then(|x| x.as_str()).unwrap_or("").to_owned();
        let Some(Shared(recording)) = RECORDINGS.lock().unwrap_or_else(|e| e.into_inner()).remove(&id) else {
            return reply(rid, Err(format!("capture {id} isn't recording")));
        };
        recording.stopped.store(true, Ordering::Relaxed);
        let Recording { stream, output, writer, pcm, frames, file, microphone, .. } = recording;
        stop_stream(stream, output, move || {
            let pcm_path = format!("{file}.pcm");
            let (samples, pcm_start) = {
                let p = pcm.lock().unwrap_or_else(|e| e.into_inner());
                (p.samples.iter().flat_map(|s| s.to_le_bytes()).collect::<Vec<u8>>(), p.started_at)
            };
            let pcm_saved = microphone && !samples.is_empty() && std::fs::write(&pcm_path, &samples).is_ok();
            let result = move |file: Option<String>| {
                json!({
                    "file": file,
                    "frames": frames.load(Ordering::Relaxed),
                    "pcm": if pcm_saved { Value::String(pcm_path.clone()) } else { Value::Null },
                    "pcmStartAt": pcm_start,
                    "pcmRate": PCM_RATE,
                })
            };
            let guard = writer.lock().unwrap_or_else(|e| e.into_inner());
            let w = &guard.0;
            if w.session_start.is_none() || w.failed {
                let _ = std::fs::remove_file(&file);
                return reply(rid, Ok(result(None)));
            }
            unsafe { w.video.markAsFinished() };
            if let Some(audio) = &w.audio {
                unsafe { audio.markAsFinished() };
            }
            let asset = w.asset.clone();
            let done = Cell::new(Some((result, file, asset.clone())));
            let block = RcBlock::new(move || {
                let Some((result, file, asset)) = done.take() else { return };
                let ok = unsafe { asset.status() } == AVAssetWriterStatus::Completed;
                if !ok {
                    eprintln!("stella-engine: capture writer: {:?}", unsafe { asset.error() }.map(|e| e.localizedDescription().to_string()));
                }
                reply(rid, Ok(result(ok.then_some(file))));
            });
            unsafe { asset.finishWritingWithCompletionHandler(&block) };
        });
    }
}
