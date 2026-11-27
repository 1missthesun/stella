import AVFoundation
import UIKit

/// Dictation's microphone: AVAudioEngine's input, converted to the 16 kHz mono s16le frames
/// desktop dictation records (the desktop's `mic` events, per generation). `mic.start` answers
/// once the engine runs (after the permission prompt the first time) or with why it can't;
/// audio then arrives as `phone.mic {gen, kind:"audio", pcm}` (base64), and `mic.stop` ends
/// the generation with `kind:"ended"`.
final class Mic {
  static let shared = Mic()
  private let engine = AVAudioEngine()
  private let target = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16_000, channels: 1, interleaved: true)!
  private var converter: AVAudioConverter?
  private var gen = 0
  private var running = false
  private var live = false
  private var observers: [NSObjectProtocol] = []
  #if STELLA_DEV
  /// Dev builds can stand a recording in for the room (`STELLA_MIC_FILE`): the engine still
  /// captures, and its frames are swapped for the file's at the same pace.
  private var stand: (samples: [Int16], at: Int)?
  #endif

  func handle(_ m: [String: Any]) -> Bool {
    switch m["cmd"] as? String {
    case "mic.start":
      start(m, gen: (m["gen"] as? NSNumber)?.intValue ?? 0)
    case "mic.stop":
      stop(gen: (m["gen"] as? NSNumber)?.intValue ?? 0)
      PhoneRequests.reply(m, nil)
    case "mic.permission":
      PhoneRequests.reply(m, ["status": Mic.permission()])
    default:
      return false
    }
    return true
  }

  static func permission() -> String {
    switch AVAudioApplication.shared.recordPermission {
    case .granted: return "granted"
    case .denied: return "denied"
    default: return "undetermined"
    }
  }

  private func start(_ m: [String: Any], gen: Int) {
    if running { finish(reason: "ended") }
    self.gen = gen
    AVAudioApplication.requestRecordPermission { granted in
      DispatchQueue.main.async {
        guard self.gen == gen else { return PhoneRequests.fail(m, "Another dictation started.", code: "superseded") }
        guard granted else {
          return PhoneRequests.fail(m, "Stella can't use the microphone. Turn it on in Settings › Stella.", code: "denied")
        }
        do {
          try self.open()
          PhoneRequests.reply(m, ["sampleRate": 16_000])
        } catch {
          self.teardown()
          PhoneRequests.fail(m, "The microphone could not be opened: \(error.localizedDescription)", code: "failed")
        }
      }
    }
  }

  private func open() throws {
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetoothHFP, .mixWithOthers])
    try session.setActive(true)
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else {
      throw NSError(domain: "StellaMic", code: 1, userInfo: [NSLocalizedDescriptionKey: "There's no microphone."])
    }
    converter = AVAudioConverter(from: format, to: target)
    let g = gen
    input.installTap(onBus: 0, bufferSize: 2048, format: format) { [weak self] buffer, _ in
      self?.frame(buffer, gen: g)
    }
    #if STELLA_DEV
    stand = nil
    if let path = ProcessInfo.processInfo.environment["STELLA_MIC_FILE"], let samples = Mic.readFile(path) {
      stand = (samples, 0)
    }
    #endif
    engine.prepare()
    try engine.start()
    running = true
    live = false
    observers.append(NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] n in
      guard let self, self.running, (n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt) == AVAudioSession.InterruptionType.began.rawValue else { return }
      self.finish(reason: "failed", message: "The microphone was interrupted.")
    })
    observers.append(NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
      guard let self, self.running else { return }
      self.finish(reason: "ended")
    })
  }

  /// One tap buffer → 16 kHz mono s16le → TS. Runs on the audio thread.
  private func frame(_ buffer: AVAudioPCMBuffer, gen g: Int) {
    guard let converter, g == gen else { return }
    let ratio = target.sampleRate / buffer.format.sampleRate
    let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio + 32)
    guard let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return }
    var fed = false
    var error: NSError?
    converter.convert(to: out, error: &error) { _, status in
      if fed { status.pointee = .noDataNow; return nil }
      fed = true
      status.pointee = .haveData
      return buffer
    }
    guard error == nil, out.frameLength > 0, let ch = out.int16ChannelData else { return }
    var data = Data(bytes: ch[0], count: Int(out.frameLength) * 2)
    #if STELLA_DEV
    if var s = stand {
      let n = Int(out.frameLength)
      var chunk = [Int16](repeating: 0, count: n)
      for i in 0..<n where s.at + i < s.samples.count { chunk[i] = s.samples[s.at + i] }
      s.at += n
      stand = s
      data = chunk.withUnsafeBufferPointer { Data(buffer: $0) }
    }
    #endif
    let pcm = data.base64EncodedString()
    DispatchQueue.main.async {
      guard self.running, g == self.gen else { return }
      if !self.live {
        self.live = true
        PhoneRequests.event("mic", ["gen": g, "kind": "live"])
      }
      PhoneRequests.event("mic", ["gen": g, "kind": "audio", "pcm": pcm])
    }
  }

  private func stop(gen g: Int) {
    guard running, g == gen else { return }
    finish(reason: "ended")
  }

  private func finish(reason: String, message: String? = nil) {
    let g = gen
    teardown()
    var ev: [String: Any] = ["gen": g, "kind": reason]
    if let message { ev["message"] = message }
    PhoneRequests.event("mic", ev)
  }

  private func teardown() {
    for o in observers { NotificationCenter.default.removeObserver(o) }
    observers = []
    if running {
      engine.inputNode.removeTap(onBus: 0)
      engine.stop()
    }
    running = false
    converter = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  #if STELLA_DEV
  /// A WAV or other audio file as 16 kHz mono s16le.
  private static func readFile(_ path: String) -> [Int16]? {
    guard let file = try? AVAudioFile(forReading: URL(fileURLWithPath: path)),
          let src = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length)),
          (try? file.read(into: src)) != nil else { return nil }
    let target = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16_000, channels: 1, interleaved: true)!
    guard let conv = AVAudioConverter(from: file.processingFormat, to: target),
          let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: AVAudioFrameCount(Double(src.frameLength) * 16_000 / file.processingFormat.sampleRate + 64)) else { return nil }
    var fed = false
    var error: NSError?
    conv.convert(to: out, error: &error) { _, status in
      if fed { status.pointee = .endOfStream; return nil }
      fed = true
      status.pointee = .haveData
      return src
    }
    guard error == nil, let ch = out.int16ChannelData else { return nil }
    return Array(UnsafeBufferPointer(start: ch[0], count: Int(out.frameLength)))
  }
  #endif
}
