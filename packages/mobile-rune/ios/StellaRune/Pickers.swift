import PhotosUI
import UIKit
import UniformTypeIdentifiers

/// The phone's answers to the engine's `dialog.openFile` (the composer's add button) and
/// `clipboard.readText`: an action sheet offering the photo library or Files, the picks copied
/// into the app's tmp folder, and their paths sent back to TS as the command's reply.
final class Pickers: NSObject, PHPickerViewControllerDelegate, UIDocumentPickerDelegate {
  static let shared = Pickers()
  private var pending: UInt64?

  static func reply(_ rid: UInt64?, ok: Bool = true, _ value: Any?) {
    guard let rid else { return }
    var obj: [String: Any] = ["t": "reply", "rid": rid, "ok": ok]
    obj[ok ? "value" : "error"] = value ?? NSNull()
    if let d = try? JSONSerialization.data(withJSONObject: obj), let line = String(data: d, encoding: .utf8) {
      App.shared.js.deliver(line: line)
    }
  }

  func handle(_ m: [String: Any]) -> Bool {
    let rid = (m["rid"] as? NSNumber)?.uint64Value
    switch m["cmd"] as? String {
    case "clipboard.readText":
      Pickers.reply(rid, UIPasteboard.general.string ?? "")
      return true
    case "dialog.openFile":
      openFile(rid: rid, multi: (m["multi"] as? Bool) ?? false)
      return true
    default:
      return false
    }
  }

  private var root: UIViewController? {
    var top = App.shared.window?.rootViewController
    while let p = top?.presentedViewController { top = p }
    return top
  }

  private func finish(_ urls: [URL]) {
    let rid = pending
    pending = nil
    Pickers.reply(rid, urls.isEmpty ? NSNull() : urls.map(\.path))
  }

  private func openFile(rid: UInt64?, multi: Bool) {
    if pending != nil { finish([]) }
    pending = rid
    let sheet = UIAlertController(title: nil, message: nil, preferredStyle: .actionSheet)
    sheet.addAction(UIAlertAction(title: "Photo Library", style: .default) { [weak self] _ in self?.photos(multi: multi) })
    sheet.addAction(UIAlertAction(title: "Choose Files", style: .default) { [weak self] _ in self?.files(multi: multi) })
    sheet.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in self?.finish([]) })
    sheet.popoverPresentationController?.sourceView = root?.view
    root?.present(sheet, animated: true)
  }

  private func photos(multi: Bool) {
    var config = PHPickerConfiguration()
    config.selectionLimit = multi ? 10 : 1
    config.filter = .any(of: [.images, .videos])
    let picker = PHPickerViewController(configuration: config)
    picker.delegate = self
    root?.present(picker, animated: true)
  }

  private func files(multi: Bool) {
    let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)
    picker.allowsMultipleSelection = multi
    picker.delegate = self
    root?.present(picker, animated: true)
  }

  private static func inbox() -> URL {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("picked/\(UUID().uuidString)", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
  }

  func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
    picker.dismiss(animated: true)
    guard !results.isEmpty else { return finish([]) }
    let dir = Pickers.inbox()
    let group = DispatchGroup()
    var out: [URL] = []
    let lock = NSLock()
    for r in results {
      let provider = r.itemProvider
      // Photos as JPEG (HEIC isn't something every model reads), videos as they are.
      let type = provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier) ? UTType.movie : UTType.jpeg
      group.enter()
      provider.loadFileRepresentation(forTypeIdentifier: type == .jpeg && !provider.hasItemConformingToTypeIdentifier(UTType.jpeg.identifier) ? UTType.image.identifier : type.identifier) { url, _ in
        defer { group.leave() }
        guard let url else { return }
        var dest = dir.appendingPathComponent(provider.suggestedName ?? UUID().uuidString)
        if type == .jpeg, url.pathExtension.lowercased() != "jpg", url.pathExtension.lowercased() != "jpeg",
           let image = UIImage(contentsOfFile: url.path), let jpeg = image.jpegData(compressionQuality: 0.9) {
          dest.appendPathExtension("jpg")
          try? jpeg.write(to: dest)
        } else {
          if dest.pathExtension.isEmpty { dest.appendPathExtension(url.pathExtension) }
          try? FileManager.default.copyItem(at: url, to: dest)
        }
        lock.lock(); out.append(dest); lock.unlock()
      }
    }
    group.notify(queue: .main) { [weak self] in self?.finish(out) }
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    let dir = Pickers.inbox()
    var out: [URL] = []
    for url in urls {
      let dest = dir.appendingPathComponent(url.lastPathComponent)
      if (try? FileManager.default.moveItem(at: url, to: dest)) != nil || (try? FileManager.default.copyItem(at: url, to: dest)) != nil {
        out.append(dest)
      }
    }
    finish(out)
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { finish([]) }
}
