// speech_transcriber - On-device speech recognition for Stella (macOS).
//
// Usage:
//   speech_transcriber probe [--locale ID]...
//   speech_transcriber stream [--locale ID]... [--prompt]
//   speech_transcriber file <audio-file> [--locale ID]... [--prompt]
//
// The first `--locale` whose language the engine supports wins; none given
// means the system's locale. Another language is never substituted. Recognition never leaves the Mac: macOS 26+ uses
// SpeechAnalyzer (no Speech Recognition permission), older versions use
// SFSpeechRecognizer with `requiresOnDeviceRecognition`, which needs that
// permission. Without `--prompt` an undetermined permission is reported, never
// requested, because TCC charges the request to the responsible app.
//
// `stream` reads 16 kHz mono signed 16-bit little-endian PCM on stdin until
// EOF. Output is NDJSON on stdout:
//   {"type":"ready","engine":"analyzer"|"sfspeech","locale":"en-US"}
//   {"type":"partial","text":"..."}
//   {"type":"final","text":"...","words":[{"w":"Hello","s":0.42,"e":0.71}]}
//   {"type":"error","code":"...","message":"..."}
// `probe` prints one object:
//   {"available":true,"engine":"...","locale":"...","authorization":"...",
//    "reason":"...","locales":["en-US",...]}

@preconcurrency import AVFoundation
import Foundation
import Speech

let sampleRate = 16_000.0
let stdoutLock = NSLock()

func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: []) else { return }
    stdoutLock.lock()
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0A]))
    stdoutLock.unlock()
}

func fail(_ code: String, _ message: String) -> Never {
    emit(["type": "error", "code": code, "message": message])
    exit(1)
}

struct Options {
    var command = ""
    var locales: [String] = []
    var prompt = false
    var file: String?
}

func parseOptions() -> Options {
    var options = Options()
    var args = Array(CommandLine.arguments.dropFirst())
    guard !args.isEmpty else { fail("usage", "speech_transcriber probe|stream|file [--locale ID] [--prompt]") }
    options.command = args.removeFirst()
    while !args.isEmpty {
        let arg = args.removeFirst()
        switch arg {
        case "--locale":
            if let value = args.first { options.locales.append(value); args.removeFirst() }
        case "--prompt":
            options.prompt = true
        default:
            if options.command == "file" && options.file == nil { options.file = arg }
        }
    }
    return options
}

func bcp47(_ locale: Locale) -> String {
    locale.identifier(.bcp47)
}

func candidateLocales(_ requested: [String]) -> [Locale] {
    var out: [Locale] = []
    for id in requested where !id.isEmpty && id != "auto" {
        out.append(Locale(identifier: id))
    }
    if out.isEmpty { out.append(Locale.current) }
    return out
}

func sameLanguage(_ a: Locale, _ b: Locale) -> Bool {
    a.language.languageCode == b.language.languageCode
}

func sameRegion(_ a: Locale, _ b: Locale) -> Bool {
    sameLanguage(a, b) && a.region == b.region
}

/// The best supported locale for the first candidate that has one: exact
/// region first, then the language with the system's region, then any.
func pickLocale(_ candidates: [Locale], supported: [Locale]) -> Locale? {
    for candidate in candidates {
        if let exact = supported.first(where: { sameRegion($0, candidate) }) { return exact }
        let languageMatches = supported.filter { sameLanguage($0, candidate) }
        if languageMatches.isEmpty { continue }
        if let regional = languageMatches.first(where: { $0.region == Locale.current.region }) { return regional }
        if let us = languageMatches.first(where: { $0.region?.identifier == "US" }) { return us }
        return languageMatches.first
    }
    return nil
}

func authorizationName(_ status: SFSpeechRecognizerAuthorizationStatus) -> String {
    switch status {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "notDetermined"
    @unknown default: return "unknown"
    }
}

func requestAuthorization() -> SFSpeechRecognizerAuthorizationStatus {
    let semaphore = DispatchSemaphore(value: 0)
    var result = SFSpeechRecognizer.authorizationStatus()
    SFSpeechRecognizer.requestAuthorization { status in
        result = status
        semaphore.signal()
    }
    semaphore.wait()
    return result
}

final class PcmInput {
    private let lock = NSLock()
    private var chunks: [Data] = []
    private var ended = false
    private var consumer: ((Data?) -> Void)?

    func startReading() {
        Thread.detachNewThread { [self] in
            let handle = FileHandle.standardInput
            while true {
                let data = handle.availableData
                if data.isEmpty { break }
                deliver(data)
            }
            deliver(nil)
        }
    }

    func attach(_ consumer: @escaping (Data?) -> Void) {
        lock.lock()
        let pending = chunks
        let wasEnded = ended
        chunks = []
        self.consumer = consumer
        lock.unlock()
        for chunk in pending { consumer(chunk) }
        if wasEnded { consumer(nil) }
    }

    private func deliver(_ data: Data?) {
        lock.lock()
        if let consumer {
            lock.unlock()
            consumer(data)
            return
        }
        if let data { chunks.append(data) } else { ended = true }
        lock.unlock()
    }
}

let inputFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false)!

final class PcmFramer {
    private var carry = Data()

    func buffer(from data: Data) -> AVAudioPCMBuffer? {
        carry.append(data)
        let frames = carry.count / 2
        if frames == 0 { return nil }
        let byteCount = frames * 2
        guard let buffer = AVAudioPCMBuffer(pcmFormat: inputFormat, frameCapacity: AVAudioFrameCount(frames)) else { return nil }
        buffer.frameLength = AVAudioFrameCount(frames)
        let out = buffer.floatChannelData![0]
        carry.withUnsafeBytes { raw in
            let samples = raw.bindMemory(to: Int16.self)
            for i in 0..<frames { out[i] = Float(Int16(littleEndian: samples[i])) / 32768.0 }
        }
        carry.removeFirst(byteCount)
        return buffer
    }
}

func fileBuffers(_ path: String) throws -> [AVAudioPCMBuffer] {
    let file = try AVAudioFile(forReading: URL(fileURLWithPath: path))
    guard let source = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length)) else { return [] }
    try file.read(into: source)
    guard let converter = AVAudioConverter(from: file.processingFormat, to: inputFormat) else { return [] }
    let capacity = AVAudioFrameCount(Double(source.frameLength) * sampleRate / file.processingFormat.sampleRate) + 1024
    guard let out = AVAudioPCMBuffer(pcmFormat: inputFormat, frameCapacity: capacity) else { return [] }
    var consumed = false
    var error: NSError?
    converter.convert(to: out, error: &error) { _, status in
        if consumed { status.pointee = .endOfStream; return nil }
        consumed = true
        status.pointee = .haveData
        return source
    }
    if let error { throw error }
    var buffers: [AVAudioPCMBuffer] = []
    let step = AVAudioFrameCount(sampleRate / 10)
    var offset: AVAudioFrameCount = 0
    while offset < out.frameLength {
        let count = min(step, out.frameLength - offset)
        let slice = AVAudioPCMBuffer(pcmFormat: inputFormat, frameCapacity: count)!
        slice.frameLength = count
        memcpy(slice.floatChannelData![0], out.floatChannelData![0] + Int(offset), Int(count) * 4)
        buffers.append(slice)
        offset += count
    }
    return buffers
}

/// Feeds audio from stdin or a file into `push`, then calls `end`.
func feedAudio(_ options: Options, push: @escaping (AVAudioPCMBuffer) -> Void, end: @escaping () -> Void) {
    if let path = options.file {
        DispatchQueue.global().async {
            do {
                for buffer in try fileBuffers(path) { push(buffer) }
            } catch {
                fail("file", "Could not read \(path): \(error.localizedDescription)")
            }
            end()
        }
        return
    }
    let input = PcmInput()
    let framer = PcmFramer()
    input.attach { data in
        guard let data else { end(); return }
        if let buffer = framer.buffer(from: data) { push(buffer) }
    }
    input.startReading()
}

// MARK: - SFSpeechRecognizer (macOS 14-15, and 26 when SpeechTranscriber is unavailable)

func legacyLocale(_ candidates: [Locale]) -> Locale? {
    let supported = SFSpeechRecognizer.supportedLocales().filter {
        SFSpeechRecognizer(locale: $0)?.supportsOnDeviceRecognition == true
    }
    return pickLocale(candidates, supported: Array(supported))
}

/// Before macOS 26 the recognizer refuses to run ("Siri and Dictation are
/// disabled") unless Dictation is on in System Settings › Keyboard.
func systemDictationEnabled() -> Bool {
    let value = CFPreferencesCopyAppValue("Dictation Enabled" as CFString, "com.apple.assistant.support" as CFString)
    return (value as? Bool) ?? ((value as? NSNumber)?.boolValue ?? false)
}

func legacyOnDeviceLocales() -> [Locale] {
    SFSpeechRecognizer.supportedLocales()
        .filter { SFSpeechRecognizer(locale: $0)?.supportsOnDeviceRecognition == true }
        .sorted { bcp47($0) < bcp47($1) }
}

final class LegacySession {
    private let recognizer: SFSpeechRecognizer
    private let request = SFSpeechAudioBufferRecognitionRequest()
    private var task: SFSpeechRecognitionTask?
    private var committed = ""
    private var committedWords: [[String: Any]] = []
    private var current = ""
    private var currentWords: [[String: Any]] = []
    private var finished = false

    init(recognizer: SFSpeechRecognizer) {
        self.recognizer = recognizer
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = true
        request.addsPunctuation = true
        request.taskHint = .dictation
    }

    func start() {
        recognizer.queue = OperationQueue()
        task = recognizer.recognitionTask(with: request) { [self] result, error in
            if let result {
                let transcription = result.bestTranscription
                current = transcription.formattedString
                currentWords = transcription.segments.map {
                    ["w": $0.substring, "s": round3($0.timestamp), "e": round3($0.timestamp + $0.duration)]
                }
                if result.isFinal {
                    finish()
                    return
                }
                if result.speechRecognitionMetadata != nil {
                    commitCurrent()
                }
                emit(["type": "partial", "text": joined(committed, current)])
            }
            if let error, !finished {
                let nsError = error as NSError
                // "No speech detected" ends a silent recording without a transcript.
                if nsError.domain == "kAFAssistantErrorDomain" && nsError.code == 1110 {
                    finish()
                    return
                }
                fail("recognition", error.localizedDescription)
            }
        }
    }

    func append(_ buffer: AVAudioPCMBuffer) { request.append(buffer) }

    func endAudio() { request.endAudio() }

    private func commitCurrent() {
        committed = joined(committed, current)
        committedWords += currentWords
        current = ""
        currentWords = []
    }

    private func finish() {
        if finished { return }
        finished = true
        commitCurrent()
        emit(["type": "final", "text": committed, "words": committedWords])
        exit(0)
    }
}

func round3(_ value: Double) -> Double { (value * 1000).rounded() / 1000 }

func joined(_ a: String, _ b: String) -> String {
    if a.isEmpty { return b }
    if b.isEmpty { return a }
    return a + " " + b
}

func runLegacy(_ options: Options, candidates: [Locale]) -> Never {
    guard let locale = legacyLocale(candidates), let recognizer = SFSpeechRecognizer(locale: locale) else {
        fail("unsupported", "On-device speech recognition isn't available for this language on this Mac.")
    }
    guard systemDictationEnabled() else {
        fail("dictation-off", "Turn on Dictation in System Settings › Keyboard to dictate on this Mac without a key.")
    }
    var status = SFSpeechRecognizer.authorizationStatus()
    if status == .notDetermined && options.prompt {
        status = requestAuthorization()
    }
    guard status == .authorized else {
        fail("speech-\(authorizationName(status))", "Speech Recognition isn't allowed for Stella.")
    }
    let session = LegacySession(recognizer: recognizer)
    session.start()
    emit(["type": "ready", "engine": "sfspeech", "locale": bcp47(locale)])
    feedAudio(options, push: { session.append($0) }, end: { session.endAudio() })
    dispatchMain()
}

// MARK: - SpeechAnalyzer (macOS 26+)

@available(macOS 26.0, *)
func analyzerLocale(_ candidates: [Locale]) async -> Locale? {
    let supported = await SpeechTranscriber.supportedLocales
    return pickLocale(candidates, supported: supported)
}

@available(macOS 26.0, *)
func runAnalyzer(_ options: Options, locale: Locale) async {
    let transcriber = SpeechTranscriber(
        locale: locale,
        transcriptionOptions: [],
        reportingOptions: [.volatileResults],
        attributeOptions: [.audioTimeRange]
    )
    do {
        if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
            emit(["type": "installing", "locale": bcp47(locale)])
            try await request.downloadAndInstall()
        }
    } catch {
        fail("assets", "Couldn't prepare on-device speech for \(bcp47(locale)): \(error.localizedDescription)")
    }
    let analyzer = SpeechAnalyzer(modules: [transcriber])
    guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]) else {
        fail("format", "On-device speech has no compatible audio format.")
    }
    guard let converter = AVAudioConverter(from: inputFormat, to: format) else {
        fail("format", "Couldn't convert audio for on-device speech.")
    }
    let (stream, continuation) = AsyncStream<AnalyzerInput>.makeStream()

    let results = Task {
        var finalized = ""
        var finalizedWords: [[String: Any]] = []
        for try await result in transcriber.results {
            let text = String(result.text.characters).trimmingCharacters(in: .whitespacesAndNewlines)
            if result.isFinal {
                finalized = joined(finalized, text)
                for run in result.text.runs {
                    guard let range = run.audioTimeRange else { continue }
                    let word = String(result.text[run.range].characters).trimmingCharacters(in: .whitespaces)
                    if word.isEmpty { continue }
                    finalizedWords.append(["w": word, "s": round3(range.start.seconds), "e": round3(range.end.seconds)])
                }
                emit(["type": "partial", "text": finalized])
            } else {
                emit(["type": "partial", "text": joined(finalized, text)])
            }
        }
        return (finalized, finalizedWords)
    }

    do {
        try await analyzer.start(inputSequence: stream)
    } catch {
        fail("analyzer", error.localizedDescription)
    }
    emit(["type": "ready", "engine": "analyzer", "locale": bcp47(locale)])

    let ended = AsyncStream<Void>.makeStream()
    feedAudio(options, push: { buffer in
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * format.sampleRate / sampleRate) + 32
        guard let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return }
        var consumed = false
        var error: NSError?
        converter.convert(to: out, error: &error) { _, status in
            if consumed { status.pointee = .noDataNow; return nil }
            consumed = true
            status.pointee = .haveData
            return buffer
        }
        if error == nil && out.frameLength > 0 { continuation.yield(AnalyzerInput(buffer: out)) }
    }, end: {
        continuation.finish()
        ended.continuation.finish()
    })
    for await _ in ended.stream {}
    do {
        try await analyzer.finalizeAndFinishThroughEndOfInput()
        let (text, words) = try await results.value
        emit(["type": "final", "text": text, "words": words])
        exit(0)
    } catch {
        fail("analyzer", error.localizedDescription)
    }
}

// MARK: - Commands

func probe(_ options: Options) async -> [String: Any] {
    let candidates = candidateLocales(options.locales)
    if #available(macOS 26.0, *), SpeechTranscriber.isAvailable {
        let supported = await SpeechTranscriber.supportedLocales
        let locale = pickLocale(candidates, supported: supported)
        return [
            "available": locale != nil,
            "engine": "analyzer",
            "locale": locale.map(bcp47) ?? NSNull(),
            "authorization": "notRequired",
            "reason": locale == nil ? "unsupported" : NSNull(),
            "locales": supported.map(bcp47).sorted(),
        ]
    }
    let supported = legacyOnDeviceLocales()
    let locale = pickLocale(candidates, supported: supported)
    let status = SFSpeechRecognizer.authorizationStatus()
    let dictationOn = systemDictationEnabled()
    let usable = dictationOn && (status == .authorized || status == .notDetermined)
    let reason: Any = locale == nil
        ? "unsupported"
        : !dictationOn ? "dictation-off" : (usable ? NSNull() : "speech-\(authorizationName(status))")
    return [
        "available": locale != nil && usable,
        "engine": "sfspeech",
        "locale": locale.map(bcp47) ?? NSNull(),
        "authorization": authorizationName(status),
        "reason": reason,
        "locales": supported.map(bcp47),
    ]
}

setvbuf(stdout, nil, _IONBF, 0)
signal(SIGPIPE, SIG_IGN)
let options = parseOptions()

switch options.command {
case "probe":
    Task {
        emit(await probe(options))
        exit(0)
    }
    dispatchMain()
case "stream", "file":
    let candidates = candidateLocales(options.locales)
    if #available(macOS 26.0, *), SpeechTranscriber.isAvailable {
        Task {
            guard let locale = await analyzerLocale(candidates) else {
                fail("unsupported", "On-device speech recognition isn't available for this language on this Mac.")
            }
            await runAnalyzer(options, locale: locale)
        }
        dispatchMain()
    }
    runLegacy(options, candidates: candidates)
default:
    fail("usage", "Unknown command \(options.command).")
}
