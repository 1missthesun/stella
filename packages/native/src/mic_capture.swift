// mic_capture - Low-latency microphone capture for dictation (macOS).
//
// Runs for as long as Stella does with no audio device open, so the microphone
// indicator stays off, and opens the default input when told to. Opening it
// here takes about 35 ms; getUserMedia takes 80-200 ms, which is long enough to
// lose the first word.
//
// stdin, one command per line:
//   start <generation>
//   stop <generation>     ends at the command's own time: audio spoken before
//                         it is still delivered
// Exits when stdin closes.
//
// stdout, binary frames: u32 LE payload length, u8 type, u32 LE generation,
// payload.
//   type 1: 16 kHz mono signed 16-bit little-endian PCM
//   type 2: JSON event: {"event":"live","ms":..}, {"event":"ended"},
//           {"event":"failed","message":".."}

import CoreAudio
import Foundation

let targetRate = 16_000.0
let frameSamples = 160

let outputQueue = DispatchQueue(label: "mic-capture.output")

func writeFrame(type: UInt8, generation: UInt32, payload: Data) {
    var frame = Data(capacity: 9 + payload.count)
    withUnsafeBytes(of: UInt32(payload.count).littleEndian) { frame.append(contentsOf: $0) }
    frame.append(type)
    withUnsafeBytes(of: generation.littleEndian) { frame.append(contentsOf: $0) }
    frame.append(payload)
    outputQueue.async {
        frame.withUnsafeBytes { raw in
            var offset = 0
            while offset < raw.count {
                let written = write(STDOUT_FILENO, raw.baseAddress! + offset, raw.count - offset)
                if written < 0 {
                    if errno == EINTR { continue }
                    exit(0)
                }
                offset += written
            }
        }
    }
}

func emit(_ generation: UInt32, _ event: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: event) else { return }
    writeFrame(type: 2, generation: generation, payload: data)
}

let timebase: mach_timebase_info_data_t = {
    var info = mach_timebase_info_data_t()
    mach_timebase_info(&info)
    return info
}()

func milliseconds(_ hostTime: UInt64) -> Double {
    Double(hostTime) * Double(timebase.numer) / Double(timebase.denom) / 1_000_000
}

func property(
    _ selector: AudioObjectPropertySelector,
    _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal
) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
}

func defaultInputDevice() -> AudioDeviceID? {
    var address = property(kAudioHardwarePropertyDefaultInputDevice)
    var device = AudioDeviceID(0)
    var size = UInt32(MemoryLayout<AudioDeviceID>.size)
    let status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &device)
    return status == noErr && device != kAudioObjectUnknown ? device : nil
}

func nominalRate(_ device: AudioDeviceID) -> Double {
    var address = property(kAudioDevicePropertyNominalSampleRate)
    var rate = Float64(0)
    var size = UInt32(MemoryLayout<Float64>.size)
    let status = AudioObjectGetPropertyData(device, &address, 0, nil, &size, &rate)
    return status == noErr && rate > 0 ? rate : 48_000
}

/// Band-limited resampling to 16 kHz with a short windowed sinc, so nothing
/// above 8 kHz folds back into the speech band.
final class Resampler {
    private let step: Double
    private let cutoff: Double
    private let reach: Int
    private var history: [Float]
    private var position: Double

    init(inputRate: Double) {
        step = inputRate / targetRate
        cutoff = min(1, 1 / step) * 0.94
        reach = Int((8 * max(1, step)).rounded(.up))
        history = [Float](repeating: 0, count: reach)
        position = Double(reach)
    }

    func process(_ input: [Float]) -> [Float] {
        history.append(contentsOf: input)
        var out: [Float] = []
        out.reserveCapacity(Int(Double(input.count) / step) + 2)
        while Int(position) + reach < history.count {
            let center = Int(position)
            var sum = 0.0
            var weight = 0.0
            for index in (center - reach + 1)...(center + reach) {
                let distance = Double(index) - position
                let window = 0.5 + 0.5 * cos(.pi * distance / Double(reach + 1))
                let x = .pi * distance * cutoff
                let tap = (abs(x) < 1e-9 ? 1 : sin(x) / x) * window
                sum += Double(history[index]) * tap
                weight += tap
            }
            out.append(Float(sum / weight))
            position += step
        }
        let drop = max(0, Int(position) - reach)
        if drop > 0 {
            history.removeFirst(drop)
            position -= Double(drop)
        }
        return out
    }

    /// The last few input samples, which need silence after them to come out.
    func flush() -> [Float] {
        process([Float](repeating: 0, count: reach + 1))
    }
}

/// Laptop microphones hand over speech around -40 dBFS. This lifts it to the
/// level the waveform and the recognizers expect and never clips a loud voice.
final class MakeupGain {
    private static let full: Float = 4
    private static let ceiling: Float = 0.8
    private static let recoveryPerSecond: Float = 1.3
    private var gain: Float = MakeupGain.full

    func process(_ samples: [Float]) -> Data {
        var data = Data(capacity: samples.count * 2)
        var peak: Float = 0
        for sample in samples { peak = max(peak, abs(sample)) }
        let start = gain
        var end = min(
            MakeupGain.full,
            gain * powf(MakeupGain.recoveryPerSecond, Float(samples.count) / Float(targetRate))
        )
        if peak * end > MakeupGain.ceiling { end = MakeupGain.ceiling / peak }
        gain = end
        for (index, sample) in samples.enumerated() {
            let blend = Float(index + 1) / Float(samples.count)
            let scaled = sample * (start + (end - start) * blend)
            let limited = min(1, max(-1, scaled))
            let value = Int16(limited < 0 ? limited * 32768 : limited * 32767)
            withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) }
        }
        return data
    }
}

final class Capture {
    let generation: UInt32
    private let startedAt: UInt64
    private let audioQueue = DispatchQueue(label: "mic-capture.audio", qos: .userInteractive)
    private let onEnd: () -> Void
    private var device = AudioDeviceID(0)
    private var ioProc: AudioDeviceIOProcID?
    private var resampler = Resampler(inputRate: 48_000)
    private var rate = 48_000.0
    private let gain = MakeupGain()
    private var pending: [Float] = []
    private var live = false
    private var stopAt: UInt64?
    private var ended = false
    private var listeners: [(AudioObjectID, AudioObjectPropertyAddress, AudioObjectPropertyListenerBlock)] = []

    init(generation: UInt32, startedAt: UInt64, onEnd: @escaping () -> Void) {
        self.generation = generation
        self.startedAt = startedAt
        self.onEnd = onEnd
    }

    func open() {
        guard let next = defaultInputDevice() else {
            fail("No microphone is connected.")
            return
        }
        device = next
        rate = nominalRate(next)
        resampler = Resampler(inputRate: rate)
        var frames = UInt32(128)
        var bufferSize = property(kAudioDevicePropertyBufferFrameSize)
        AudioObjectSetPropertyData(next, &bufferSize, 0, nil, UInt32(MemoryLayout<UInt32>.size), &frames)
        var proc: AudioDeviceIOProcID?
        let created = AudioDeviceCreateIOProcIDWithBlock(&proc, next, audioQueue) { [weak self] _, input, inputTime, _, _ in
            self?.receive(input, inputTime.pointee)
        }
        guard created == noErr, let proc else {
            fail("The microphone could not be opened (\(created)).")
            return
        }
        ioProc = proc
        let started = AudioDeviceStart(next, proc)
        guard started == noErr else {
            close()
            fail("The microphone could not be started (\(started)).")
            return
        }
        listen(next, kAudioDevicePropertyDeviceIsAlive)
        listen(next, kAudioDevicePropertyNominalSampleRate)
        listen(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDefaultInputDevice)
    }

    func stop(at hostTime: UInt64) {
        audioQueue.async { [self] in
            if ended { return }
            stopAt = hostTime
            if !live { finish() }
        }
        audioQueue.asyncAfter(deadline: .now() + 0.25) { [self] in finish() }
    }

    func abandon() {
        audioQueue.async { [self] in
            ended = true
            close()
        }
    }

    private func listen(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) {
        var address = property(selector)
        let block: AudioObjectPropertyListenerBlock = { [weak self] _, _ in self?.deviceChanged() }
        if AudioObjectAddPropertyListenerBlock(object, &address, audioQueue, block) == noErr {
            listeners.append((object, address, block))
        }
    }

    /// The input went away or changed (a headset connecting): carry on with
    /// whatever is the default input now.
    private func deviceChanged() {
        if ended || stopAt != nil { return }
        guard let next = defaultInputDevice() else { return }
        if next == device && nominalRate(next) == rate { return }
        close()
        controlQueue.async { [self] in if !ended { open() } }
    }

    private func receive(_ input: UnsafePointer<AudioBufferList>, _ time: AudioTimeStamp) {
        if ended { return }
        let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input))
        guard let first = buffers.first(where: { $0.mData != nil && $0.mNumberChannels > 0 && $0.mDataByteSize > 0 }) else { return }
        let channels = Int(first.mNumberChannels)
        let frames = Int(first.mDataByteSize) / MemoryLayout<Float>.size / channels
        if frames == 0 { return }
        let samples = first.mData!.assumingMemoryBound(to: Float.self)
        let used = min(2, channels)
        var mono = [Float](repeating: 0, count: frames)
        for frame in 0..<frames {
            var sum: Float = 0
            for channel in 0..<used { sum += samples[frame * channels + channel] }
            mono[frame] = sum / Float(used)
        }
        if !live {
            live = true
            emit(generation, ["event": "live", "ms": max(0, milliseconds(time.mHostTime) - milliseconds(startedAt))])
        }
        send(resampler.process(mono))
        if let stopAt {
            let end = milliseconds(time.mHostTime) + Double(frames) / rate * 1_000
            if end >= milliseconds(stopAt) { finish() }
        }
    }

    private func send(_ samples: [Float]) {
        pending.append(contentsOf: samples)
        if pending.count < frameSamples && !ended { return }
        if pending.isEmpty { return }
        writeFrame(type: 1, generation: generation, payload: gain.process(pending))
        pending.removeAll(keepingCapacity: true)
    }

    private func finish() {
        if ended { return }
        ended = true
        send(resampler.flush())
        close()
        emit(generation, ["event": "ended"])
        onEnd()
    }

    private func fail(_ message: String) {
        if ended { return }
        ended = true
        close()
        emit(generation, ["event": "failed", "message": message])
        onEnd()
    }

    private func close() {
        for (object, address, block) in listeners {
            var target = address
            AudioObjectRemovePropertyListenerBlock(object, &target, audioQueue, block)
        }
        listeners = []
        guard let proc = ioProc else { return }
        ioProc = nil
        let target = device
        // Stopping waits for the callback that may be on this queue.
        controlQueue.async {
            AudioDeviceStop(target, proc)
            AudioDeviceDestroyIOProcID(target, proc)
        }
    }
}

let controlQueue = DispatchQueue(label: "mic-capture.control", qos: .userInteractive)
var current: Capture?

func handle(_ line: String, receivedAt: UInt64) {
    let parts = line.split(separator: " ")
    guard parts.count == 2, let generation = UInt32(parts[1]) else { return }
    switch parts[0] {
    case "start":
        current?.abandon()
        let capture = Capture(generation: generation, startedAt: receivedAt) {
            controlQueue.async { if current?.generation == generation { current = nil } }
        }
        current = capture
        capture.open()
    case "stop":
        guard let capture = current, capture.generation == generation else {
            emit(generation, ["event": "ended"])
            return
        }
        capture.stop(at: receivedAt)
    default:
        break
    }
}

signal(SIGPIPE, SIG_IGN)

// Loads the audio system now, so the first start only has to open the device.
if let device = defaultInputDevice() { _ = nominalRate(device) }

Thread.detachNewThread {
    while let line = readLine() {
        let receivedAt = mach_absolute_time()
        controlQueue.async { handle(line, receivedAt: receivedAt) }
    }
    exit(0)
}
dispatchMain()
