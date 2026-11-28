#if STELLA_DEV
import JavaScriptCore
import UIKit

/// Drives the app from the outside in dev builds, so the Simulator can be exercised without the
/// host's mouse. Each line appended to `Documents/driver.txt` (the app's data container) is one
/// `<action>?…` command, also accepted as a `stella-rune://debug/<action>?…` deep link:
///   tap?x=&y=                    a finger tap (points), through Rune's touch handling or a native field
///   drag?x=&y=&dx=&dy=&ms=       a finger drag over ms milliseconds, released moving (flings)
///   type?text=                   text typed into the focused native field, as the keyboard does
///   key?name=return|backspace    a key in the focused native field
///   dark?on=0|1                  the app's appearance
///   perf?start=label | stop=label  frame recording (Documents/perf-<label>.json)
enum DebugDriver {
  private static var timer: Timer?

  /// Polls Documents/driver.txt: runs each line, then removes the file.
  static func start() {
    let file = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("driver.txt")
    timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in
      guard let text = try? String(contentsOf: file, encoding: .utf8), !text.isEmpty else { return }
      try? FileManager.default.removeItem(at: file)
      for line in text.split(separator: "\n") where !line.isEmpty {
        if let url = URL(string: "stella-rune://debug/" + line) { _ = handle(url) }
      }
    }
  }

  static func handle(_ url: URL) -> Bool {
    guard url.host == "debug", let app = App.shared.rune else { return false }
    let q = Dictionary(uniqueKeysWithValues: (URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []).map { ($0.name, $0.value ?? "") })
    let num = { (k: String, d: Double) in Double(q[k] ?? "") ?? d }
    switch url.path {
    case "/open":
      // Opens the URL in Documents/open-url.txt (then deletes it) the way an app does: no
      // "Open in …?" prompt, unlike `simctl openurl`. For handing another app a sign-in link.
      let file = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("open-url.txt")
      if let s = try? String(contentsOf: file, encoding: .utf8), let u = URL(string: s.trimmingCharacters(in: .whitespacesAndNewlines)) {
        try? FileManager.default.removeItem(at: file)
        UIApplication.shared.open(u)
      }
    case "/tap":
      let p = CGPoint(x: num("x", 0), y: num("y", 0))
      // A native field takes the tap itself (its hit view may be one of its own subviews).
      var hit = app.hitTest(p, with: nil)
      while let v = hit, v !== app, !(v is UITextView), !(v is UITextField) { hit = v.superview }
      if let field = hit, field !== app {
        NativeFields.shared.lastTouchEnd = CACurrentMediaTime()
        field.becomeFirstResponder()
        return true
      }
      app.inject(id: 9001, phase: 0, at: p)
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.06) {
        app.inject(id: 9001, phase: 2, at: p)
        NativeFields.shared.tapOutside(at: p)
      }
    case "/drag":
      let x = num("x", 200), y = num("y", 500), dx = num("dx", 0), dy = num("dy", -300), ms = max(16, num("ms", 250))
      let steps = max(2, Int(ms / 8))
      let t0 = CACurrentMediaTime()
      app.inject(id: 9002, phase: 0, at: CGPoint(x: x, y: y), time: t0)
      for i in 1...steps {
        let f = Double(i) / Double(steps)
        // Each event carries its moment on the gesture's timeline, as a real touch's timestamp
        // does, even when the main thread hands several over at once.
        DispatchQueue.main.asyncAfter(deadline: .now() + ms / 1000 * f) {
          app.inject(id: 9002, phase: i == steps ? 2 : 1, at: CGPoint(x: x + dx * f, y: y + dy * f), time: t0 + ms / 1000 * f)
        }
      }
    case "/pinch":
      // Two fingers about (x, y) moving from `from` to `to` points apart, horizontally.
      let x = num("x", 214), y = num("y", 400), a = num("from", 60), b = num("to", 200), ms = max(16, num("ms", 400))
      let steps = max(2, Int(ms / 8))
      app.inject(id: 9003, phase: 0, at: CGPoint(x: x - a / 2, y: y))
      app.inject(id: 9004, phase: 0, at: CGPoint(x: x + a / 2, y: y))
      for i in 1...steps {
        let f = Double(i) / Double(steps), d = a + (b - a) * f
        DispatchQueue.main.asyncAfter(deadline: .now() + ms / 1000 * f) {
          app.inject(id: 9003, phase: i == steps ? 2 : 1, at: CGPoint(x: x - d / 2, y: y))
          app.inject(id: 9004, phase: i == steps ? 2 : 1, at: CGPoint(x: x + d / 2, y: y))
        }
      }
    case "/type":
      (firstResponder(in: app) as? UIKeyInput)?.insertText(q["text"] ?? "")
    case "/paste":
      // UIKit's own paste (the edit menu's Paste), of `text` put on the pasteboard first.
      UIPasteboard.general.string = q["text"] ?? ""
      firstResponder(in: app)?.paste(nil)
    case "/key":
      guard let input = firstResponder(in: app) as? UIKeyInput else { break }
      switch q["name"] {
      case "backspace": input.deleteBackward()
      default: input.insertText("\n")
      }
    case "/menu":
      Menus.shared.debugPick(Int(num("pick", 0)))
    case "/dark":
      App.shared.window?.overrideUserInterfaceStyle = q["on"] == "1" ? .dark : .light
    case "/a11y":
      // Reduce Transparency (glass solid) as the system setting would, for measurements.
      if let h = app.host { sme_accessibility(h, q["rt"] == "1", false, false); app.wake() }
    case "/gc":
      // A full JavaScriptCore collection, then the footprint, for leak checks.
      App.shared.js.perform {
        JSGarbageCollect(App.shared.js.context.jsGlobalContextRef)
        AppLog.shared.write("info", String(format: "gc: footprint %.1f MB", Memory.residentMB()))
      }
    case "/frames":
      // Frames drawn so far (idle checks: two reads a few seconds apart, without perf recording).
      AppLog.shared.write("info", "frames: \(app.frames) ticks: \(app.ticks)")
    case "/blur":
      app.endEditing(true)
    case "/perf":
      if let label = q["start"] { App.shared.command(["cmd": "perf.start", "label": label]) }
      if let label = q["stop"] { App.shared.command(["cmd": "perf.stop", "label": label]) }
    default:
      AppLog.shared.write("warn", "debug driver: unknown \(url.path)")
    }
    return true
  }

  private static func firstResponder(in view: UIView) -> UIResponder? {
    if view.isFirstResponder { return view }
    for sub in view.subviews { if let r = firstResponder(in: sub) { return r } }
    return nil
  }
}
#endif
