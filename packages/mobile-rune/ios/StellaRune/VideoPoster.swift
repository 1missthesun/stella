import AVFoundation
import UIKit

/// `media.videoPoster` (`ui/native/video-poster.ts`): a frame of a video at a URL (a Drive file's
/// signed link, streamed: only what the frame needs is read), written as a JPEG at most
/// `width`×`height` points (at the screen's scale) to `out`, for the chat's video cards, as RN
/// takes one with expo-video-thumbnails and a computer with ffmpeg. Replies
/// `{path, durationMs, width, height}`; fails when the video has no frame to give.
final class VideoPoster {
  static let shared = VideoPoster()

  func handle(_ m: [String: Any]) -> Bool {
    guard m["cmd"] as? String == "media.videoPoster" else { return false }
    guard let s = m["url"] as? String, let url = URL(string: s), let out = m["out"] as? String else {
      PhoneRequests.fail(m, "No video to read.")
      return true
    }
    let scale = UIScreen.main.scale
    let box = CGSize(width: (m["width"] as? Double ?? 176) * scale, height: (m["height"] as? Double ?? 132) * scale)
    Task.detached(priority: .utility) {
      let asset = AVURLAsset(url: url)
      let generator = AVAssetImageGenerator(asset: asset)
      generator.appliesPreferredTrackTransform = true
      // Cover the box: the frame's shorter side fills it, as the card crops to fill.
      let side = max(box.width, box.height) * 1.5
      generator.maximumSize = CGSize(width: side, height: side)
      generator.requestedTimeToleranceBefore = CMTime(seconds: 0.5, preferredTimescale: 600)
      generator.requestedTimeToleranceAfter = CMTime(seconds: 0.5, preferredTimescale: 600)
      do {
        let duration = try await asset.load(.duration)
        let seconds = duration.isNumeric ? CMTimeGetSeconds(duration) : 0
        let at = CMTime(seconds: seconds > 0 ? min(1, seconds * 0.1) : 0, preferredTimescale: 600)
        let (frame, _) = try await generator.image(at: at)
        let image = UIImage(cgImage: frame)
        guard let jpeg = image.jpegData(compressionQuality: 0.82) else { throw CocoaError(.fileWriteUnknown) }
        try FileManager.default.createDirectory(at: URL(fileURLWithPath: out).deletingLastPathComponent(), withIntermediateDirectories: true)
        try jpeg.write(to: URL(fileURLWithPath: out), options: .atomic)
        let ms = seconds > 0 ? Int((seconds * 1000).rounded()) : 0
        await MainActor.run { PhoneRequests.reply(m, ["path": out, "durationMs": ms, "width": frame.width, "height": frame.height]) }
      } catch {
        await MainActor.run { PhoneRequests.fail(m, "The video has no frame to show.") }
      }
    }
    return true
  }
}
