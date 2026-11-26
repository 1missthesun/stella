//! Screen capture behind Electron's `desktopCapturer` and the Show Stella recorder:
//! ScreenCaptureKit on macOS; on Windows, Windows.Graphics.Capture into Media Foundation's H.264
//! and AAC encoders, with the microphone from WASAPI (cpal). Linux has none: Electron Stella offers
//! Show Stella only on macOS and Windows and asks desktopCapturer for nothing else there.
//!
//! - `capture.sources {types, thumbnailSize}`: Electron `DesktopCapturerSource`s; `thumbnail` is a
//!   PNG path (null when the size is 0).
//! - `capture.start {id, sourceId, width, height, fps, file, framesDir, frameIntervalMs, frameEdge,
//!   jpegQuality, microphone}`: records an H.264 MP4 (with the microphone as AAC where
//!   ScreenCaptureKit can capture it), writes a JPEG of the latest picture every
//!   `frameIntervalMs` (`{t:"capture", id, kind:"frame", at, path}`), and keeps the microphone as
//!   16 kHz mono PCM.
//! - `capture.stop {id}`: finishes the file; replies `{file, mimeType, frames, pcm, pcmStartAt}`.

use serde_json::Value;

pub fn command(cmd: &str, rid: Option<u64>, v: &Value) {
    #[cfg(target_os = "macos")]
    mac::command(cmd, rid, v);
    #[cfg(windows)]
    win::command(cmd, rid, v);
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = v;
        crate::engine::reply(rid, Err(format!("{cmd}: screen capture is not available on this platform")));
    }
}

/// What the platform recorders share: the 16 kHz microphone track, pictures and JPEG frames.
#[cfg(any(target_os = "macos", windows))]
mod common {
    use std::path::Path;

    pub const PCM_RATE: f64 = 16_000.0;
    /// The largest frame the platforms' H.264 encoders take.
    pub const MAX_VIDEO: (f64, f64) = (4096.0, 2304.0);

    pub fn fit(w: f64, h: f64, max_w: f64, max_h: f64) -> (usize, usize) {
        let k = (max_w / w.max(1.0)).min(max_h / h.max(1.0));
        ((w * k).round().max(1.0) as usize, (h * k).round().max(1.0) as usize)
    }

    pub struct Pixels {
        pub width: usize,
        pub height: usize,
        pub bgra: Vec<u8>,
    }

    pub fn rgba(p: &Pixels) -> Option<image::RgbaImage> {
        let mut data = p.bgra.clone();
        for px in data.as_chunks_mut::<4>().0 {
            px.swap(0, 2);
            px[3] = 255;
        }
        image::RgbaImage::from_raw(p.width as u32, p.height as u32, data)
    }

    pub fn rgb(p: &Pixels) -> Option<image::RgbImage> {
        let mut data = Vec::with_capacity(p.width * p.height * 3);
        for px in p.bgra.as_chunks::<4>().0 {
            data.extend_from_slice(&[px[2], px[1], px[0]]);
        }
        image::RgbImage::from_raw(p.width as u32, p.height as u32, data)
    }

    /// The microphone as 16 kHz mono, box-filtered down from the device rate.
    #[derive(Default)]
    pub struct Pcm {
        pub samples: Vec<i16>,
        carry: Vec<f32>,
        pos: f64,
        pub started_at: Option<f64>,
    }

    impl Pcm {
        pub fn push(&mut self, rate: f64, mono: &[f32], at: f64) {
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

    pub fn even(v: f64) -> usize {
        ((v / 2.0).round() * 2.0).max(2.0) as usize
    }

    pub fn jpeg(p: &Pixels, edge: f64, quality: f64, dir: &Path, n: u32) -> Option<String> {
        let full = rgb(p)?;
        let k = (edge / p.width.max(p.height).max(1) as f64).min(1.0);
        let (w, h) = (((p.width as f64 * k).round() as u32).max(1), ((p.height as f64 * k).round() as u32).max(1));
        let img = if k < 1.0 { image::imageops::resize(&full, w, h, image::imageops::FilterType::Triangle) } else { full };
        let path = dir.join(format!("frame-{n:05}.jpg"));
        let mut out = std::io::BufWriter::new(std::fs::File::create(&path).ok()?);
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, (quality * 100.0).round().clamp(1.0, 100.0) as u8).encode_image(&img).ok()?;
        Some(path.to_string_lossy().into_owned())
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use std::cell::Cell;
    use std::collections::HashMap;
    use std::path::PathBuf;
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

    use super::common::{MAX_VIDEO, PCM_RATE, Pcm, Pixels, even, fit, jpeg, rgba};
    use crate::engine::reply_any_thread as reply;
    use crate::metrics::epoch_ms;

    const BGRA: u32 = u32::from_be_bytes(*b"BGRA");
    const AAC: u32 = u32::from_be_bytes(*b"aac ");

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

    /// One picture of `filter` at `width`×`height` pixels.
    fn grab(filter: &SCContentFilter, width: usize, height: usize, done: impl FnOnce(Result<image::RgbaImage, String>) + Send + 'static) {
        type Done = Box<dyn FnOnce(Result<image::RgbaImage, String>) + Send>;
        let done: Arc<Mutex<Option<Done>>> = Arc::new(Mutex::new(Some(Box::new(done))));
        type Held = Option<Shared<(Retained<SCStream>, Retained<CaptureOutput>)>>;
        let held: Arc<Mutex<Held>> = Arc::new(Mutex::new(None));
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
                        if let (Some(start), Some(audio), false) = (w.session_start, w.audio.as_ref(), w.failed)
                            && pts >= start
                            && unsafe { audio.isReadyForMoreMediaData() }
                        {
                            unsafe { audio.appendSampleBuffer(buffer) };
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
                    "mimeType": "video/mp4",
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

#[cfg(windows)]
mod win {
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use std::sync::{Arc, LazyLock, Mutex};
    use std::time::{Duration, Instant};

    use serde_json::{Value, json};
    use windows::Foundation::TypedEventHandler;
    use windows::Graphics::Capture::{Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession};
    use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
    use windows::Graphics::DirectX::DirectXPixelFormat;
    use windows::Graphics::SizeInt32;
    use windows::Win32::Foundation::{HMODULE, HWND, LPARAM, RECT};
    use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE, D3D_DRIVER_TYPE_HARDWARE, D3D_DRIVER_TYPE_WARP};
    use windows::Win32::Graphics::Direct3D11::{
        D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAP_READ, D3D11_MAPPED_SUBRESOURCE, D3D11_SDK_VERSION,
        D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING, D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D,
    };
    use windows::Win32::Graphics::Dxgi::IDXGIDevice;
    use windows::Win32::Graphics::Gdi::{
        BI_RGB, BITMAPINFO, BITMAPINFOHEADER, BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DIB_RGB_COLORS, DeleteDC, DeleteObject,
        EnumDisplayMonitors, GetDC, GetDIBits, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO, ReleaseDC, SRCCOPY, SelectObject,
    };
    use windows::Win32::Media::MediaFoundation::{
        IMFAttributes, IMFMediaType, IMFSinkWriter, MF_MT_AUDIO_AVG_BYTES_PER_SECOND, MF_MT_AUDIO_BITS_PER_SAMPLE, MF_MT_AUDIO_BLOCK_ALIGNMENT,
        MF_MT_AUDIO_NUM_CHANNELS, MF_MT_AUDIO_SAMPLES_PER_SECOND, MF_MT_AVG_BITRATE, MF_MT_DEFAULT_STRIDE, MF_MT_FRAME_RATE, MF_MT_FRAME_SIZE,
        MF_MT_INTERLACE_MODE, MF_MT_MAJOR_TYPE, MF_MT_PIXEL_ASPECT_RATIO, MF_MT_SUBTYPE, MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS,
        MF_SINK_WRITER_DISABLE_THROTTLING, MF_VERSION, MFAudioFormat_AAC, MFAudioFormat_PCM, MFCreateAttributes, MFCreateMediaType,
        MFCreateMemoryBuffer, MFCreateSample, MFCreateSinkWriterFromURL, MFMediaType_Audio, MFMediaType_Video, MFSTARTUP_FULL, MFStartup,
        MFVideoFormat_H264, MFVideoFormat_NV12, MFVideoFormat_RGB32, MFVideoInterlace_Progressive,
    };
    use windows::Win32::Storage::Xps::{PRINT_WINDOW_FLAGS, PrintWindow};
    use windows::Win32::System::WinRT::Direct3D11::{CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess};
    use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
    use windows::Win32::System::WinRT::{RO_INIT_MULTITHREADED, RoInitialize};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GWL_EXSTYLE, GetWindowLongW, GetWindowRect, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, IsIconic,
        IsWindowVisible, WS_EX_TOOLWINDOW,
    };
    use windows::core::{BOOL, HSTRING, Interface};

    use super::common::{MAX_VIDEO, PCM_RATE, Pcm, Pixels, even, fit, jpeg, rgba};
    use crate::engine::reply_any_thread as reply;
    use crate::metrics::epoch_ms;

    const AUDIO_RATE: u32 = 48_000;
    const PW_RENDERFULLCONTENT: u32 = 2;
    const HNS: f64 = 10_000_000.0;

    pub fn command(cmd: &str, rid: Option<u64>, v: &Value) {
        let v = v.clone();
        let cmd = cmd.to_owned();
        let work = move || {
            let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };
            match cmd.as_str() {
                "capture.sources" => reply(rid, sources(&v)),
                "capture.start" => reply(rid, start(&v)),
                "capture.stop" => reply(rid, stop(&v)),
                _ => reply(rid, Err(format!("{cmd}: unknown capture command"))),
            }
        };
        if let Err(e) = std::thread::Builder::new().name("capture".into()).spawn(work) {
            crate::engine::reply(rid, Err(format!("capture thread: {e}")));
        }
    }

    fn text(e: windows::core::Error) -> String {
        e.message()
    }

    struct Monitor {
        handle: HMONITOR,
        rect: RECT,
        primary: bool,
    }

    fn monitors() -> Vec<Monitor> {
        unsafe extern "system" fn each(handle: HMONITOR, _dc: HDC, _rect: *mut RECT, data: LPARAM) -> BOOL {
            let list = unsafe { &mut *(data.0 as *mut Vec<Monitor>) };
            let mut info = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, ..Default::default() };
            if unsafe { GetMonitorInfoW(handle, &mut info) }.as_bool() {
                list.push(Monitor { handle, rect: info.rcMonitor, primary: info.dwFlags & 1 != 0 });
            }
            true.into()
        }
        let mut list: Vec<Monitor> = Vec::new();
        let _ = unsafe { EnumDisplayMonitors(None, None, Some(each), LPARAM(&mut list as *mut _ as isize)) };
        list.sort_by_key(|m| !m.primary);
        list
    }

    /// The engine's display ids (Electron `display.id`) by HMONITOR.
    fn engine_display_ids() -> HashMap<isize, u32> {
        rune::displays()
            .into_iter()
            .filter_map(|d| match d.native_id() {
                Some(rune::NativeDisplayId::Windows(h)) => Some((h, crate::commands::display_id(d.name.as_deref().unwrap_or(""), d.position))),
                _ => None,
            })
            .collect()
    }

    fn windows_list() -> Vec<(HWND, String, RECT)> {
        unsafe extern "system" fn each(hwnd: HWND, data: LPARAM) -> BOOL {
            let list = unsafe { &mut *(data.0 as *mut Vec<(HWND, String, RECT)>) };
            let visible = unsafe { IsWindowVisible(hwnd) }.as_bool() && !unsafe { IsIconic(hwnd) }.as_bool();
            let tool = unsafe { GetWindowLongW(hwnd, GWL_EXSTYLE) } as u32 & WS_EX_TOOLWINDOW.0 != 0;
            let mut pid = 0u32;
            unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
            let len = unsafe { GetWindowTextLengthW(hwnd) };
            if visible && !tool && len > 0 && pid != std::process::id() {
                let mut buf = vec![0u16; len as usize + 1];
                let n = unsafe { GetWindowTextW(hwnd, &mut buf) };
                let mut rect = RECT::default();
                if unsafe { GetWindowRect(hwnd, &mut rect) }.is_ok() && rect.right > rect.left && rect.bottom > rect.top {
                    list.push((hwnd, String::from_utf16_lossy(&buf[..n.max(0) as usize]), rect));
                }
            }
            true.into()
        }
        let mut list: Vec<(HWND, String, RECT)> = Vec::new();
        let _ = unsafe { EnumWindows(Some(each), LPARAM(&mut list as *mut _ as isize)) };
        list
    }

    /// A GDI picture of the screen area `rect`, or of the window `hwnd` (drawn by PrintWindow).
    fn gdi_picture(rect: RECT, hwnd: Option<HWND>) -> Option<Pixels> {
        let (w, h) = (rect.right - rect.left, rect.bottom - rect.top);
        if w <= 0 || h <= 0 {
            return None;
        }
        unsafe {
            let screen = GetDC(None);
            let mem = CreateCompatibleDC(Some(screen));
            let bitmap = CreateCompatibleBitmap(screen, w, h);
            let old = SelectObject(mem, bitmap.into());
            let drawn = match hwnd {
                Some(hwnd) => PrintWindow(hwnd, mem, PRINT_WINDOW_FLAGS(PW_RENDERFULLCONTENT)).as_bool(),
                None => BitBlt(mem, 0, 0, w, h, Some(screen), rect.left, rect.top, SRCCOPY).is_ok(),
            };
            let mut info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: w,
                    biHeight: -h,
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut bgra = vec![0u8; (w * h * 4) as usize];
            let rows = if drawn { GetDIBits(mem, bitmap, 0, h as u32, Some(bgra.as_mut_ptr().cast()), &mut info, DIB_RGB_COLORS) } else { 0 };
            SelectObject(mem, old);
            let _ = DeleteObject(bitmap.into());
            let _ = DeleteDC(mem);
            ReleaseDC(None, screen);
            (rows == h).then_some(Pixels { width: w as usize, height: h as usize, bgra })
        }
    }

    fn thumbnail(rect: RECT, hwnd: Option<HWND>, max: (f64, f64), index: usize) -> Value {
        let Some(picture) = gdi_picture(rect, hwnd) else { return Value::Null };
        let (tw, th) = fit(picture.width as f64, picture.height as f64, max.0, max.1);
        let Some(full) = rgba(&picture) else { return Value::Null };
        let img = image::imageops::resize(&full, tw as u32, th as u32, image::imageops::FilterType::Triangle);
        let dir = std::env::temp_dir().join("stella-rune-capture");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join(format!("thumb-{}-{}-{index}.png", std::process::id(), epoch_ms() as u64));
        img.save_with_format(&path, image::ImageFormat::Png).ok().map_or(Value::Null, |_| Value::String(path.to_string_lossy().into_owned()))
    }

    fn sources(v: &Value) -> Result<Value, String> {
        let types: Vec<String> = v.get("types").and_then(|t| t.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_owned)).collect()).unwrap_or_else(|| vec!["screen".into()]);
        let size = |k: &str| v.get("thumbnailSize").and_then(|s| s.get(k)).and_then(|x| x.as_f64()).unwrap_or(0.0);
        let max = (size("width"), size("height"));
        let thumbs = max.0 > 0.0 && max.1 > 0.0;
        let mut list = Vec::new();
        if types.iter().any(|t| t == "screen") {
            let ids = engine_display_ids();
            let all = monitors();
            for (i, m) in all.iter().enumerate() {
                let name = if all.len() == 1 { "Entire Screen".to_owned() } else { format!("Screen {}", i + 1) };
                let display_id = ids.get(&(m.handle.0 as isize)).map(|id| id.to_string()).unwrap_or_default();
                let thumbnail = if thumbs { thumbnail(m.rect, None, max, list.len()) } else { Value::Null };
                list.push(json!({ "id": format!("screen:{}:0", m.handle.0 as isize), "name": name, "display_id": display_id, "thumbnail": thumbnail }));
            }
        }
        if types.iter().any(|t| t == "window") {
            for (hwnd, title, rect) in windows_list() {
                let thumbnail = if thumbs { thumbnail(rect, Some(hwnd), max, list.len()) } else { Value::Null };
                list.push(json!({ "id": format!("window:{}:0", hwnd.0 as isize), "name": title, "display_id": "", "thumbnail": thumbnail }));
            }
        }
        Ok(json!(list))
    }

    fn capture_item(source: &str) -> Result<GraphicsCaptureItem, String> {
        let mut parts = source.split(':');
        let (kind, native) = (parts.next().unwrap_or(""), parts.next().and_then(|x| x.parse::<isize>().ok()));
        let native = native.ok_or_else(|| format!("unknown capture source {source}"))?;
        let interop = windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>().map_err(text)?;
        if kind == "window" {
            unsafe { interop.CreateForWindow::<GraphicsCaptureItem>(HWND(native as *mut _)) }.map_err(text)
        } else {
            if !monitors().iter().any(|m| m.handle.0 as isize == native) {
                return Err(format!("the capture source {source} is gone"));
            }
            unsafe { interop.CreateForMonitor::<GraphicsCaptureItem>(HMONITOR(native as *mut _)) }.map_err(text)
        }
    }

    fn d3d_device() -> Result<(ID3D11Device, ID3D11DeviceContext), String> {
        let attempt = |driver: D3D_DRIVER_TYPE| {
            let (mut device, mut context) = (None, None);
            unsafe { D3D11CreateDevice(None, driver, HMODULE::default(), D3D11_CREATE_DEVICE_BGRA_SUPPORT, None, D3D11_SDK_VERSION, Some(&mut device), None, Some(&mut context)) }
                .ok()
                .and_then(|_| device.zip(context))
        };
        attempt(D3D_DRIVER_TYPE_HARDWARE).or_else(|| attempt(D3D_DRIVER_TYPE_WARP)).ok_or_else(|| "no Direct3D 11 device".to_owned())
    }

    fn media_type(major: &windows::core::GUID, subtype: &windows::core::GUID) -> windows::core::Result<IMFMediaType> {
        let t = unsafe { MFCreateMediaType() }?;
        unsafe {
            t.SetGUID(&MF_MT_MAJOR_TYPE, major)?;
            t.SetGUID(&MF_MT_SUBTYPE, subtype)?;
        }
        Ok(t)
    }

    fn video_type(subtype: &windows::core::GUID, w: u32, h: u32, fps: u32) -> windows::core::Result<IMFMediaType> {
        let t = media_type(&MFMediaType_Video, subtype)?;
        unsafe {
            t.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
            t.SetUINT64(&MF_MT_FRAME_SIZE, (u64::from(w) << 32) | u64::from(h))?;
            t.SetUINT64(&MF_MT_FRAME_RATE, (u64::from(fps) << 32) | 1)?;
            t.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, (1u64 << 32) | 1)?;
        }
        Ok(t)
    }

    fn audio_type(subtype: &windows::core::GUID) -> windows::core::Result<IMFMediaType> {
        let t = media_type(&MFMediaType_Audio, subtype)?;
        unsafe {
            t.SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, 16)?;
            t.SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, AUDIO_RATE)?;
            t.SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, 1)?;
            if *subtype == MFAudioFormat_AAC {
                t.SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, 12_000)?;
            } else {
                t.SetUINT32(&MF_MT_AUDIO_BLOCK_ALIGNMENT, 2)?;
                t.SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, AUDIO_RATE * 2)?;
            }
        }
        Ok(t)
    }

    #[derive(Clone, Copy, PartialEq)]
    enum Input {
        Rgb32,
        Nv12,
    }

    struct Writer {
        sink: IMFSinkWriter,
        video: u32,
        audio: Option<u32>,
        input: Input,
        width: usize,
        height: usize,
        frame_hns: i64,
        last_video: Option<i64>,
        audio_written: u64,
        audio_carry: Vec<f32>,
        audio_pos: f64,
        written: u32,
        failed: bool,
    }

    // SAFETY: Media Foundation's sink writer is free-threaded; the Mutex around it serialises calls.
    unsafe impl Send for Writer {}

    fn writer(file: &str, w: usize, h: usize, fps: u32, audio: bool) -> Result<Writer, String> {
        let _ = std::fs::remove_file(file);
        unsafe { MFStartup(MF_VERSION, MFSTARTUP_FULL) }.map_err(text)?;
        let mut attrs: Option<IMFAttributes> = None;
        unsafe { MFCreateAttributes(&mut attrs, 2) }.map_err(text)?;
        let attrs = attrs.ok_or("no Media Foundation attributes")?;
        unsafe {
            attrs.SetUINT32(&MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, 1).map_err(text)?;
            attrs.SetUINT32(&MF_SINK_WRITER_DISABLE_THROTTLING, 1).map_err(text)?;
        }
        let sink = unsafe { MFCreateSinkWriterFromURL(&HSTRING::from(file), None, &attrs) }.map_err(text)?;
        let out = video_type(&MFVideoFormat_H264, w as u32, h as u32, fps).map_err(text)?;
        unsafe { out.SetUINT32(&MF_MT_AVG_BITRATE, 4_000_000) }.map_err(text)?;
        let video = unsafe { sink.AddStream(&out) }.map_err(text)?;
        let rgb32 = video_type(&MFVideoFormat_RGB32, w as u32, h as u32, fps).map_err(text)?;
        unsafe { rgb32.SetUINT32(&MF_MT_DEFAULT_STRIDE, (w * 4) as u32) }.map_err(text)?;
        let input = if unsafe { sink.SetInputMediaType(video, &rgb32, None) }.is_ok() {
            Input::Rgb32
        } else {
            let nv12 = video_type(&MFVideoFormat_NV12, w as u32, h as u32, fps).map_err(text)?;
            unsafe { sink.SetInputMediaType(video, &nv12, None) }.map_err(|e| format!("the H.264 encoder takes neither RGB32 nor NV12: {}", e.message()))?;
            Input::Nv12
        };
        let audio = audio
            .then(|| -> windows::core::Result<u32> {
                let index = unsafe { sink.AddStream(&audio_type(&MFAudioFormat_AAC)?) }?;
                unsafe { sink.SetInputMediaType(index, &audio_type(&MFAudioFormat_PCM)?, None) }?;
                Ok(index)
            })
            .and_then(|r| r.map_err(|e| eprintln!("stella-engine: capture audio track: {}", e.message())).ok());
        unsafe { sink.BeginWriting() }.map_err(text)?;
        Ok(Writer {
            sink,
            video,
            audio,
            input,
            width: w,
            height: h,
            frame_hns: (HNS / f64::from(fps.max(1))) as i64,
            last_video: None,
            audio_written: 0,
            audio_carry: Vec::new(),
            audio_pos: 0.0,
            written: 0,
            failed: false,
        })
    }

    fn nv12(p: &Pixels) -> Vec<u8> {
        let (w, h) = (p.width, p.height);
        let mut out = vec![0u8; w * h * 3 / 2];
        let (luma, chroma) = out.split_at_mut(w * h);
        for y in 0..h {
            for x in 0..w {
                let i = (y * w + x) * 4;
                let (b, g, r) = (i32::from(p.bgra[i]), i32::from(p.bgra[i + 1]), i32::from(p.bgra[i + 2]));
                luma[y * w + x] = (((66 * r + 129 * g + 25 * b + 128) >> 8) + 16).clamp(0, 255) as u8;
            }
        }
        for y in (0..h).step_by(2) {
            for x in (0..w).step_by(2) {
                let i = (y * w + x) * 4;
                let (b, g, r) = (i32::from(p.bgra[i]), i32::from(p.bgra[i + 1]), i32::from(p.bgra[i + 2]));
                let at = (y / 2) * w + x;
                chroma[at] = (((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128).clamp(0, 255) as u8;
                chroma[at + 1] = (((112 * r - 94 * g - 18 * b + 128) >> 8) + 128).clamp(0, 255) as u8;
            }
        }
        out
    }

    fn write_sample(sink: &IMFSinkWriter, stream: u32, bytes: &[u8], at: i64, duration: i64) -> windows::core::Result<()> {
        unsafe {
            let buffer = MFCreateMemoryBuffer(bytes.len() as u32)?;
            let mut data = std::ptr::null_mut::<u8>();
            buffer.Lock(&mut data, None, None)?;
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), data, bytes.len());
            buffer.Unlock()?;
            buffer.SetCurrentLength(bytes.len() as u32)?;
            let sample = MFCreateSample()?;
            sample.AddBuffer(&buffer)?;
            sample.SetSampleTime(at)?;
            sample.SetSampleDuration(duration)?;
            sink.WriteSample(stream, &sample)
        }
    }

    impl Writer {
        fn video_frame(&mut self, p: &Pixels, at: i64) {
            if self.failed || self.last_video.is_some_and(|last| at - last < self.frame_hns * 9 / 10) {
                return;
            }
            let fitted = fit_exact(p, self.width, self.height);
            let bytes = if self.input == Input::Nv12 { nv12(&fitted) } else { fitted.bgra };
            match write_sample(&self.sink, self.video, &bytes, at, self.frame_hns) {
                Ok(()) => {
                    self.last_video = Some(at);
                    self.written += 1;
                }
                Err(e) => {
                    self.failed = true;
                    eprintln!("stella-engine: capture video sample: {}", e.message());
                }
            }
        }

        /// Microphone audio (mono at `rate`), resampled to 48 kHz; `at` is where its first sample falls.
        fn audio(&mut self, rate: f64, mono: &[f32], at: i64) {
            let Some(stream) = self.audio else { return };
            if self.failed || self.last_video.is_none() {
                return;
            }
            if self.audio_written == 0 {
                self.audio_written = (at.max(0) as f64 / HNS * f64::from(AUDIO_RATE)) as u64;
            }
            self.audio_carry.extend_from_slice(mono);
            let step = rate / f64::from(AUDIO_RATE);
            let mut out: Vec<u8> = Vec::new();
            while self.audio_pos + 1.0 < self.audio_carry.len() as f64 {
                let i = self.audio_pos.floor() as usize;
                let f = (self.audio_pos - i as f64) as f32;
                let v = self.audio_carry[i] * (1.0 - f) + self.audio_carry[i + 1] * f;
                out.extend_from_slice(&((v.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes());
                self.audio_pos += step;
            }
            let used = self.audio_pos.floor() as usize;
            self.audio_carry.drain(..used.min(self.audio_carry.len()));
            self.audio_pos -= used as f64;
            if out.is_empty() {
                return;
            }
            let frames = (out.len() / 2) as u64;
            let start = (self.audio_written as f64 / f64::from(AUDIO_RATE) * HNS) as i64;
            let duration = (frames as f64 / f64::from(AUDIO_RATE) * HNS) as i64;
            if let Err(e) = write_sample(&self.sink, stream, &out, start, duration) {
                eprintln!("stella-engine: capture audio sample: {}", e.message());
                self.audio = None;
            }
            self.audio_written += frames;
        }
    }

    /// `p` at exactly `w`×`h`: cropped or padded with black (a window can change size while recorded).
    fn fit_exact(p: &Pixels, w: usize, h: usize) -> Pixels {
        if p.width == w && p.height == h {
            return Pixels { width: w, height: h, bgra: p.bgra.clone() };
        }
        let mut bgra = vec![0u8; w * h * 4];
        let (cw, ch) = (w.min(p.width), h.min(p.height));
        for y in 0..ch {
            bgra[y * w * 4..y * w * 4 + cw * 4].copy_from_slice(&p.bgra[y * p.width * 4..y * p.width * 4 + cw * 4]);
        }
        Pixels { width: w, height: h, bgra }
    }

    /// Every `k`th pixel of `p` in each direction, for pictures beyond the encoder's largest frame.
    fn downscale(p: Pixels, max: (f64, f64)) -> Pixels {
        let k = (p.width as f64 / max.0).max(p.height as f64 / max.1).ceil() as usize;
        if k <= 1 {
            return p;
        }
        let (w, h) = (p.width / k, p.height / k);
        let mut bgra = Vec::with_capacity(w * h * 4);
        for y in 0..h {
            for x in 0..w {
                let i = (y * k * p.width + x * k) * 4;
                bgra.extend_from_slice(&p.bgra[i..i + 4]);
            }
        }
        Pixels { width: w, height: h, bgra }
    }

    /// A Direct3D device, free-threaded as WinRT hands it out.
    struct Device(IDirect3DDevice);

    // SAFETY: the WinRT Direct3D device wraps a free-threaded D3D11 device.
    unsafe impl Send for Device {}
    unsafe impl Sync for Device {}

    impl Device {
        fn get(&self) -> &IDirect3DDevice {
            &self.0
        }
    }

    struct Gpu {
        device: ID3D11Device,
        context: ID3D11DeviceContext,
        staging: Option<(ID3D11Texture2D, u32, u32)>,
    }

    // SAFETY: the immediate context is only used under the recording's Mutex.
    unsafe impl Send for Gpu {}

    impl Gpu {
        fn read(&mut self, texture: &ID3D11Texture2D) -> windows::core::Result<Pixels> {
            let mut desc = D3D11_TEXTURE2D_DESC::default();
            unsafe { texture.GetDesc(&mut desc) };
            if !self.staging.as_ref().is_some_and(|(_, w, h)| *w == desc.Width && *h == desc.Height) {
                let staging_desc = D3D11_TEXTURE2D_DESC {
                    Usage: D3D11_USAGE_STAGING,
                    BindFlags: 0,
                    CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
                    MiscFlags: 0,
                    ..desc
                };
                let mut staging = None;
                unsafe { self.device.CreateTexture2D(&staging_desc, None, Some(&mut staging)) }?;
                self.staging = staging.map(|t| (t, desc.Width, desc.Height));
            }
            let Some((staging, _, _)) = &self.staging else { return Err(windows::core::Error::empty()) };
            unsafe { self.context.CopyResource(staging, texture) };
            let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
            unsafe { self.context.Map(staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped)) }?;
            let (w, h, stride) = (desc.Width as usize, desc.Height as usize, mapped.RowPitch as usize);
            let mut bgra = Vec::with_capacity(w * h * 4);
            for y in 0..h {
                bgra.extend_from_slice(unsafe { std::slice::from_raw_parts((mapped.pData as *const u8).add(y * stride), w * 4) });
            }
            unsafe { self.context.Unmap(staging, 0) };
            Ok(Pixels { width: w, height: h, bgra })
        }
    }

    struct Recording {
        session: GraphicsCaptureSession,
        pool: Direct3D11CaptureFramePool,
        writer: Arc<Mutex<Writer>>,
        pcm: Arc<Mutex<Pcm>>,
        stopped: Arc<AtomicBool>,
        frames: Arc<AtomicU32>,
        microphone: Option<std::thread::JoinHandle<()>>,
        pacer: std::thread::JoinHandle<()>,
        file: String,
    }

    // SAFETY: GraphicsCaptureSession and Direct3D11CaptureFramePool are agile WinRT objects.
    unsafe impl Send for Recording {}

    static RECORDINGS: LazyLock<Mutex<HashMap<String, Recording>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

    /// The default microphone on its own thread until `stopped`: 16 kHz PCM, and 48 kHz into the file.
    fn microphone(pcm: Arc<Mutex<Pcm>>, writer: Arc<Mutex<Writer>>, t0: Instant, stopped: Arc<AtomicBool>) -> Option<std::thread::JoinHandle<()>> {
        use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<bool>();
        let handle = std::thread::Builder::new()
            .name("capture-mic".into())
            .spawn(move || {
                let host = cpal::default_host();
                let Some(device) = host.default_input_device() else { return void(ready_tx.send(false)) };
                let Ok(config) = device.default_input_config() else { return void(ready_tx.send(false)) };
                let (rate, channels) = (f64::from(config.sample_rate().0), usize::from(config.channels().max(1)));
                let deliver = move |mono: Vec<f32>| {
                    let at = t0.elapsed().as_secs_f64() - mono.len() as f64 / rate;
                    pcm.lock().unwrap_or_else(|e| e.into_inner()).push(rate, &mono, epoch_ms());
                    writer.lock().unwrap_or_else(|e| e.into_inner()).audio(rate, &mono, (at * HNS) as i64);
                };
                let mix = move |data: &[f32]| data.chunks(channels).map(|c| c.iter().sum::<f32>() / channels as f32).collect::<Vec<f32>>();
                let error = |e: cpal::StreamError| eprintln!("stella-engine: capture microphone: {e}");
                let stream = match config.sample_format() {
                    cpal::SampleFormat::F32 => device.build_input_stream(&config.config(), move |data: &[f32], _| deliver(mix(data)), error, None),
                    cpal::SampleFormat::I16 => device.build_input_stream(
                        &config.config(),
                        move |data: &[i16], _| deliver(mix(&data.iter().map(|s| f32::from(*s) / 32768.0).collect::<Vec<f32>>())),
                        error,
                        None,
                    ),
                    other => {
                        eprintln!("stella-engine: capture microphone: unsupported sample format {other:?}");
                        return void(ready_tx.send(false));
                    }
                };
                let Ok(stream) = stream else { return void(ready_tx.send(false)) };
                if stream.play().is_err() {
                    return void(ready_tx.send(false));
                }
                let _ = ready_tx.send(true);
                while !stopped.load(Ordering::Relaxed) {
                    std::thread::sleep(Duration::from_millis(50));
                }
                drop(stream);
            })
            .ok()?;
        if ready_rx.recv_timeout(Duration::from_secs(3)).unwrap_or(false) {
            Some(handle)
        } else {
            let _ = handle.join();
            None
        }
    }

    fn void<T>(_: T) {}

    fn start(v: &Value) -> Result<Value, String> {
        let s = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_owned();
        let n = |k: &str, d: f64| v.get(k).and_then(|x| x.as_f64()).unwrap_or(d);
        let (id, source, file, frames_dir) = (s("id"), s("sourceId"), s("file"), s("framesDir"));
        let (fps, interval, edge, quality) = (n("fps", 30.0).clamp(1.0, 60.0), n("frameIntervalMs", 1000.0).max(50.0), n("frameEdge", 1280.0), n("jpegQuality", 0.8));
        let want_mic = v.get("microphone").and_then(|m| m.as_bool()).unwrap_or(false);
        if id.is_empty() || file.is_empty() || frames_dir.is_empty() {
            return Err("capture.start needs id, file and framesDir".into());
        }
        if RECORDINGS.lock().unwrap_or_else(|e| e.into_inner()).contains_key(&id) {
            return Err(format!("capture {id} is already recording"));
        }
        let item = capture_item(&source)?;
        let size = item.Size().map_err(text)?;
        let k = (MAX_VIDEO.0 / f64::from(size.Width.max(2))).min(MAX_VIDEO.1 / f64::from(size.Height.max(2))).min(1.0);
        let (w, h) = (even(f64::from(size.Width) * k), even(f64::from(size.Height) * k));
        let _ = std::fs::create_dir_all(&frames_dir);
        let (device, context) = d3d_device()?;
        let dxgi: IDXGIDevice = device.cast().map_err(text)?;
        let d3d: IDirect3DDevice = unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi) }.map_err(text)?.cast().map_err(text)?;
        let writer = Arc::new(Mutex::new(writer(&file, w, h, fps.round() as u32, want_mic)?));
        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(&d3d, DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, size).map_err(text)?;
        let session = pool.CreateCaptureSession(&item).map_err(text)?;
        let _ = session.SetIsCursorCaptureEnabled(true);
        let _ = session.SetIsBorderRequired(false);
        let gpu = Arc::new(Mutex::new(Gpu { device, context, staging: None }));
        let latest: Arc<Mutex<Option<Arc<Pixels>>>> = Arc::new(Mutex::new(None));
        let t0 = Instant::now();
        let pool_size = Arc::new(Mutex::new((size.Width, size.Height)));
        {
            let (gpu, latest, d3d, pool_size) = (gpu.clone(), latest.clone(), Device(d3d.clone()), pool_size.clone());
            let handler = TypedEventHandler::<Direct3D11CaptureFramePool, windows::core::IInspectable>::new(move |pool, _| {
                let Some(pool) = pool.as_ref() else { return Ok(()) };
                let frame = pool.TryGetNextFrame()?;
                let content = frame.ContentSize()?;
                let access = frame.Surface()?.cast::<IDirect3DDxgiInterfaceAccess>()?;
                // SAFETY: the frame surface is a DXGI-backed texture from the free-threaded pool, alive until `frame` drops.
                let texture: ID3D11Texture2D = unsafe { access.GetInterface() }?;
                let picture = gpu.lock().unwrap_or_else(|e| e.into_inner()).read(&texture);
                drop(frame);
                let mut current = pool_size.lock().unwrap_or_else(|e| e.into_inner());
                if (content.Width, content.Height) != *current && content.Width > 0 && content.Height > 0 {
                    *current = (content.Width, content.Height);
                    pool.Recreate(d3d.get(), DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, content)?;
                }
                drop(current);
                let picture = match picture {
                    Ok(p) => downscale(crop(p, content), MAX_VIDEO),
                    Err(e) => {
                        eprintln!("stella-engine: capture frame: {}", e.message());
                        return Ok(());
                    }
                };
                *latest.lock().unwrap_or_else(|e| e.into_inner()) = Some(Arc::new(picture));
                Ok(())
            });
            pool.FrameArrived(&handler).map_err(text)?;
        }
        let stopped = Arc::new(AtomicBool::new(false));
        let frames = Arc::new(AtomicU32::new(0));
        let pcm = Arc::new(Mutex::new(Pcm::default()));
        session.StartCapture().map_err(text)?;
        let mic = if want_mic { microphone(pcm.clone(), writer.clone(), t0, stopped.clone()) } else { None };
        let started_at = epoch_ms();
        let pacer = spawn_pacer(writer.clone(), latest.clone(), stopped.clone(), t0, fps);
        spawn_frames(id.clone(), latest, stopped.clone(), frames.clone(), PathBuf::from(frames_dir), Duration::from_millis(interval as u64), edge, quality);
        let has_mic = mic.is_some();
        RECORDINGS.lock().unwrap_or_else(|e| e.into_inner()).insert(id, Recording { session, pool, writer, pcm, stopped, frames, microphone: mic, pacer, file });
        Ok(json!({ "startedAt": started_at, "microphone": has_mic, "width": w, "height": h }))
    }

    /// Writes the latest picture at the recording's frame rate: Windows.Graphics.Capture delivers
    /// frames only when the screen changes, and a still screen must still fill the video's time.
    fn spawn_pacer(writer: Arc<Mutex<Writer>>, latest: Arc<Mutex<Option<Arc<Pixels>>>>, stopped: Arc<AtomicBool>, t0: Instant, fps: f64) -> std::thread::JoinHandle<()> {
        let every = Duration::from_secs_f64(1.0 / fps);
        std::thread::spawn(move || {
            let mut next = Instant::now();
            while !stopped.load(Ordering::Relaxed) {
                let picture = latest.lock().unwrap_or_else(|e| e.into_inner()).clone();
                if let Some(picture) = picture {
                    let at = (t0.elapsed().as_secs_f64() * HNS) as i64;
                    writer.lock().unwrap_or_else(|e| e.into_inner()).video_frame(&picture, at);
                }
                next += every;
                let now = Instant::now();
                if next > now {
                    std::thread::sleep(next - now);
                } else {
                    next = now;
                }
            }
        })
    }

    /// The part of the pool's texture the item fills.
    fn crop(p: Pixels, content: SizeInt32) -> Pixels {
        let (w, h) = ((content.Width.max(1) as usize).min(p.width), (content.Height.max(1) as usize).min(p.height));
        if w == p.width && h == p.height {
            return p;
        }
        let mut bgra = Vec::with_capacity(w * h * 4);
        for y in 0..h {
            bgra.extend_from_slice(&p.bgra[y * p.width * 4..y * p.width * 4 + w * 4]);
        }
        Pixels { width: w, height: h, bgra }
    }

    #[allow(clippy::too_many_arguments)]
    fn spawn_frames(id: String, latest: Arc<Mutex<Option<Arc<Pixels>>>>, stopped: Arc<AtomicBool>, frames: Arc<AtomicU32>, dir: PathBuf, every: Duration, edge: f64, quality: f64) {
        std::thread::spawn(move || {
            let mut next = Instant::now();
            while !stopped.load(Ordering::Relaxed) {
                let picture = latest.lock().unwrap_or_else(|e| e.into_inner()).clone();
                if let Some(picture) = picture {
                    let at = epoch_ms();
                    if let Some(path) = jpeg(&picture, edge, quality, &dir, frames.load(Ordering::Relaxed)) {
                        frames.fetch_add(1, Ordering::Relaxed);
                        crate::windows::send_any_thread(json!({ "t": "capture", "id": id, "kind": "frame", "at": at, "path": path }));
                    }
                }
                next += every;
                let now = Instant::now();
                if next > now {
                    std::thread::sleep(next - now);
                } else {
                    next = now;
                }
            }
        });
    }

    fn stop(v: &Value) -> Result<Value, String> {
        let id = v.get("id").and_then(|x| x.as_str()).unwrap_or("").to_owned();
        let recording = RECORDINGS.lock().unwrap_or_else(|e| e.into_inner()).remove(&id).ok_or_else(|| format!("capture {id} isn't recording"))?;
        recording.stopped.store(true, Ordering::Relaxed);
        let _ = recording.session.Close();
        let _ = recording.pool.Close();
        let _ = recording.pacer.join();
        let had_mic = recording.microphone.is_some();
        if let Some(mic) = recording.microphone {
            let _ = mic.join();
        }
        let pcm_path = format!("{}.pcm", recording.file);
        let (samples, pcm_start) = {
            let p = recording.pcm.lock().unwrap_or_else(|e| e.into_inner());
            (p.samples.iter().flat_map(|s| s.to_le_bytes()).collect::<Vec<u8>>(), p.started_at)
        };
        let pcm_saved = had_mic && !samples.is_empty() && std::fs::write(&pcm_path, &samples).is_ok();
        let writer = recording.writer.lock().unwrap_or_else(|e| e.into_inner());
        let finished = writer.written > 0 && !writer.failed && unsafe { writer.sink.Finalize() }.map_err(|e| eprintln!("stella-engine: capture writer: {}", e.message())).is_ok();
        if !finished {
            let _ = std::fs::remove_file(&recording.file);
        }
        Ok(json!({
            "file": finished.then_some(recording.file.clone()),
            "mimeType": "video/mp4",
            "frames": recording.frames.load(Ordering::Relaxed),
            "videoFrames": writer.written,
            "pcm": if pcm_saved { Value::String(pcm_path) } else { Value::Null },
            "pcmStartAt": pcm_start,
            "pcmRate": PCM_RATE,
        }))
    }
}
