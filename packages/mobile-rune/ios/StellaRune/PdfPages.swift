import PDFKit
import UIKit

/// A PDF's pages as pictures for the phone's PDF viewer (`ui/native/pdf.ts`): the engine has no
/// web view to run pdf.js in, so the app renders each page itself (PDFKit) as the viewer scrolls
/// to it, and the viewer shows them as images. `pdf.open {path}` replies `{pages: [[w, h], …]}`
/// (points, as the page is shown, rotation applied); `pdf.render {path, page, width, out}` writes
/// page `page` (1-based) `width` pixels wide as a JPEG on white to `out` and replies `{path}`.
final class PdfPages {
  static let shared = PdfPages()
  private let queue = DispatchQueue(label: "stella.pdf", qos: .userInitiated)
  private var open: [String: PDFDocument] = [:]
  private var order: [String] = []

  func handle(_ m: [String: Any]) -> Bool {
    let cmd = m["cmd"] as? String
    guard cmd == "pdf.open" || cmd == "pdf.render" else { return false }
    guard let path = m["path"] as? String else {
      PhoneRequests.fail(m, "No PDF to open.")
      return true
    }
    queue.async {
      guard let doc = self.document(path) else {
        DispatchQueue.main.async { PhoneRequests.fail(m, "This PDF can't be opened.", code: "unreadable") }
        return
      }
      if cmd == "pdf.open" {
        var pages: [[Double]] = []
        for i in 0..<doc.pageCount {
          guard let page = doc.page(at: i) else { pages.append([612, 792]); continue }
          let box = page.bounds(for: .cropBox)
          let turned = page.rotation % 180 != 0
          pages.append(turned ? [Double(box.height), Double(box.width)] : [Double(box.width), Double(box.height)])
        }
        DispatchQueue.main.async { PhoneRequests.reply(m, ["pages": pages]) }
        return
      }
      let index = (m["page"] as? Int ?? 1) - 1
      let width = CGFloat(m["width"] as? Double ?? 1000)
      guard let out = m["out"] as? String, let page = doc.page(at: index), width > 0 else {
        DispatchQueue.main.async { PhoneRequests.fail(m, "No such page.") }
        return
      }
      let box = page.bounds(for: .cropBox)
      let turned = page.rotation % 180 != 0
      let aspect = turned ? box.width / box.height : box.height / box.width
      let size = CGSize(width: width, height: (width * aspect).rounded())
      let format = UIGraphicsImageRendererFormat()
      format.scale = 1
      format.opaque = true
      let image = UIGraphicsImageRenderer(size: size, format: format).image { ctx in
        UIColor.white.setFill()
        ctx.fill(CGRect(origin: .zero, size: size))
        let cg = ctx.cgContext
        cg.translateBy(x: 0, y: size.height)
        cg.scaleBy(x: 1, y: -1)
        // Scale the page's display box (rotation applied by PDFKit's transform) to the picture.
        let drawn = turned ? CGSize(width: box.height, height: box.width) : box.size
        cg.scaleBy(x: size.width / drawn.width, y: size.height / drawn.height)
        page.draw(with: .cropBox, to: cg)
      }
      do {
        guard let jpeg = image.jpegData(compressionQuality: 0.86) else { throw CocoaError(.fileWriteUnknown) }
        try FileManager.default.createDirectory(at: URL(fileURLWithPath: out).deletingLastPathComponent(), withIntermediateDirectories: true)
        try jpeg.write(to: URL(fileURLWithPath: out), options: .atomic)
        DispatchQueue.main.async { PhoneRequests.reply(m, ["path": out]) }
      } catch {
        DispatchQueue.main.async { PhoneRequests.fail(m, "The page couldn't be drawn.") }
      }
    }
    return true
  }

  /// Keeps the last few documents open, so a viewer's pages don't each reopen the file.
  private func document(_ path: String) -> PDFDocument? {
    if let doc = open[path] { return doc }
    guard let doc = PDFDocument(url: URL(fileURLWithPath: path)) else { return nil }
    open[path] = doc
    order.append(path)
    while order.count > 3 { open.removeValue(forKey: order.removeFirst()) }
    return doc
  }
}
