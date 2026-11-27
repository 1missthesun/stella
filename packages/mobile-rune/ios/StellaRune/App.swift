import CoreText
import QuartzCore
import SafariServices
import UIKit
import UserNotifications

let processStart = CACurrentMediaTime()

/// The whole app: one Rune view (Metal), the JS runtime driving it, and UIKit's text fields.
final class App {
  static let shared = App()
  var rune: RuneView?
  let js = JSRuntime()
  var window: UIWindow?
  var firstFrameMs: Double = 0
  var firstContentMs: Double = 0

  func boot(in window: UIWindow) {
    self.window = window
    #if STELLA_DEV
    // The engine reports to stderr (`stella-engine: …`); dev builds keep it in Documents/engine.log.
    let engineLog = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("engine.log").path
    freopen(engineLog, "w", stderr)
    setvbuf(stderr, nil, _IOLBF, 0)
    #endif
    AppFonts.registerBundled()
    let vc = RootController()
    window.rootViewController = vc
    window.makeKeyAndVisible()
    let rune = vc.rune
    self.rune = rune
    NativeFields.shared.container = rune
    let me = Unmanaged.passUnretained(self).toOpaque()
    sme_init({ ctx, ptr, len in
      guard let ptr else { return }
      let line = String(decoding: UnsafeBufferPointer(start: ptr, count: len), as: UTF8.self)
      App.shared.js.deliver(line: line)
    }, { ctx, ptr, len in
      guard let ptr else { return }
      let data = Data(bytes: ptr, count: len)
      guard let m = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
      App.shared.native(m)
    }, me)
    let dark = window.traitCollection.userInterfaceStyle == .dark
    rune.onFirstFrame = { [weak self] in
      self?.firstFrameMs = (CACurrentMediaTime() - processStart) * 1000
      AppLog.shared.write("info", String(format: "first frame %.1f ms after process start", self?.firstFrameMs ?? 0))
    }
    rune.start(dark: dark)
    js.onAppCommand = { [weak self] m in self?.command(m) }
    let res = Bundle.main.resourceURL!
    let env: [String: Any] = [
      "resources": res.path,
      "documents": FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].path,
      "caches": FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].path,
      "tmp": NSTemporaryDirectory(),
      "platform": "ios",
      "osVersion": UIDevice.current.systemVersion,
      "model": UIDevice.current.model,
      "scale": UIScreen.main.scale,
      "width": window.bounds.width,
      "height": window.bounds.height,
      "dark": dark,
      "processStartMs": processStart * 1000,
      "locale": Locale.preferredLanguages.first ?? "en",
      "args": ProcessInfo.processInfo.arguments,
      "env": ProcessInfo.processInfo.environment.filter { $0.key.hasPrefix("STELLA_") },
    ]
    js.start(bundle: res.appendingPathComponent("app.js"), env: env)
    KeyboardWatch.shared.start()
    #if STELLA_DEV
    DebugDriver.start()
    #endif
  }

  /// Messages from the engine for the native side.
  func native(_ m: [String: Any]) {
    switch m["t"] as? String {
    case "field", "place", "hideField", "fieldGone", "setText", "select", "focusField", "blurField":
      NativeFields.shared.handle(m)
    case "haptic":
      Haptics.play(m["kind"] as? String ?? "")
    case "cmd":
      command(m)
    case "colorScheme":
      if let d = m["dark"] as? Bool {
        window?.overrideUserInterfaceStyle = d ? .dark : .light
      } else {
        window?.overrideUserInterfaceStyle = .unspecified
      }
    case "selection":
      break
    default:
      break
    }
  }

  /// Commands from TS (through the engine's `native` commands or `__native.post`).
  func command(_ m: [String: Any]) {
    let cmd = (m["cmd"] as? String) ?? (m["t"] as? String) ?? ""
    switch cmd {
    case "clipboard.writeText", "clipboard.writeHTML":
      UIPasteboard.general.string = m["text"] as? String
    case "shell.openExternal", "openURL":
      if let s = m["url"] as? String, let u = URL(string: s) {
        if u.scheme == "http" || u.scheme == "https", (m["inApp"] as? Bool) == true {
          window?.rootViewController?.present(SFSafariViewController(url: u), animated: true)
        } else {
          UIApplication.shared.open(u)
        }
      }
    case "share":
      var items: [Any] = []
      if let t = m["text"] as? String { items.append(t) }
      if let s = m["url"] as? String, let u = URL(string: s) { items.append(u) }
      if let p = m["path"] as? String { items.append(URL(fileURLWithPath: p)) }
      guard !items.isEmpty, let root = window?.rootViewController else { return }
      let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
      sheet.popoverPresentationController?.sourceView = root.view
      root.present(sheet, animated: true)
    case "haptic":
      Haptics.play(m["kind"] as? String ?? m["style"] as? String ?? "")
    case "app.setBadge":
      if #available(iOS 16.0, *) {
        UNUserNotificationCenter.current().setBadgeCount(Int(m["label"] as? String ?? "") ?? 0)
      }
    case "firstContent":
      if firstContentMs == 0 {
        firstContentMs = (CACurrentMediaTime() - processStart) * 1000
        AppLog.shared.write("info", String(format: "first content %.1f ms after process start", firstContentMs))
      }
    case "perf.start":
      rune?.resetRecording()
      rune?.recording = true
      rune?.wake()
    case "perf.stop":
      rune?.recording = false
      writePerf(label: m["label"] as? String ?? "run")
    default:
      AppLog.shared.write("warn", "unknown app command \(cmd)")
    }
  }

  private func writePerf(label: String) {
    guard let r = rune else { return }
    let times = r.frameTimes
    var gaps: [Double] = []
    for i in 1..<max(1, times.count) { gaps.append((times[i] - times[i - 1]) * 1000) }
    let cpu = r.frameCpuUs.map { Double($0) / 1000 }
    let obj: [String: Any] = ["label": label, "frames": times.count, "gapsMs": gaps, "cpuMs": cpu, "rssMB": Memory.residentMB()]
    if let d = try? JSONSerialization.data(withJSONObject: obj) {
      let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("perf-\(label).json")
      try? d.write(to: url)
      AppLog.shared.write("info", "perf \(label): \(times.count) frames → \(url.lastPathComponent)")
    }
  }
}

final class RootController: UIViewController {
  let rune = RuneView(frame: UIScreen.main.bounds)
  override func loadView() { view = rune }
  override var prefersHomeIndicatorAutoHidden: Bool { false }
  override var preferredStatusBarStyle: UIStatusBarStyle { .default }
}

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?
  func application(_ app: UIApplication, didFinishLaunchingWithOptions opts: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    let w = UIWindow(frame: UIScreen.main.bounds)
    window = w
    App.shared.boot(in: w)
    return true
  }

  func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
    #if STELLA_DEV
    if DebugDriver.handle(url) { return true }
    #endif
    let json = (try? JSONSerialization.data(withJSONObject: ["t": "open-url", "url": url.absoluteString])).flatMap { String(data: $0, encoding: .utf8) } ?? ""
    App.shared.js.deliver(line: json)
    return true
  }
}

enum Haptics {
  static func play(_ kind: String) {
    let k = kind.lowercased()
    if k.contains("success") { UINotificationFeedbackGenerator().notificationOccurred(.success); return }
    if k.contains("warning") { UINotificationFeedbackGenerator().notificationOccurred(.warning); return }
    if k.contains("error") { UINotificationFeedbackGenerator().notificationOccurred(.error); return }
    if k.contains("selection") { UISelectionFeedbackGenerator().selectionChanged(); return }
    let style: UIImpactFeedbackGenerator.FeedbackStyle = k.contains("heavy") ? .heavy : k.contains("medium") ? .medium : k.contains("rigid") ? .rigid : k.contains("soft") ? .soft : .light
    UIImpactFeedbackGenerator(style: style).impactOccurred()
  }
}

/// The keyboard's overlap with the window, for the composer to sit on it.
final class KeyboardWatch {
  static let shared = KeyboardWatch()
  func start() {
    NotificationCenter.default.addObserver(forName: UIResponder.keyboardWillChangeFrameNotification, object: nil, queue: .main) { n in
      guard let end = (n.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue, let w = App.shared.window else { return }
      let overlap = max(0, w.bounds.maxY - end.minY)
      if let h = App.shared.rune?.host { sme_keyboard(h, Float(overlap)) }
      App.shared.rune?.wake()
    }
    NotificationCenter.default.addObserver(forName: UIResponder.keyboardWillHideNotification, object: nil, queue: .main) { _ in
      if let h = App.shared.rune?.host { sme_keyboard(h, 0) }
      App.shared.rune?.wake()
    }
  }
}

enum AppFonts {
  static var sans: String? = "Manrope"
  private static var names: [String: [String]] = [:]

  /// Registers the app's bundled faces with UIKit too, so native text fields use Stella's font.
  static func registerBundled() {
    guard let dir = Bundle.main.resourceURL?.appendingPathComponent("fonts"), let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) else { return }
    for f in files where f.pathExtension == "ttf" || f.pathExtension == "otf" {
      CTFontManagerRegisterFontsForURL(f as CFURL, .process, nil)
      if let descs = CTFontManagerCreateFontDescriptorsFromURL(f as CFURL) as? [CTFontDescriptor] {
        for d in descs {
          if let fam = CTFontDescriptorCopyAttribute(d, kCTFontFamilyNameAttribute) as? String, let ps = CTFontDescriptorCopyAttribute(d, kCTFontNameAttribute) as? String {
            names[fam.lowercased(), default: []].append(ps)
          }
        }
      }
    }
  }

  static func font(family: String, size: CGFloat, weight: Double) -> UIFont? {
    let fam = family.split(separator: ",").first.map { $0.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "\"'")) } ?? family
    guard let ps = names[fam.lowercased()]?.first, let base = UIFont(name: ps, size: size) else { return nil }
    // Variable faces: ask for the weight through the variation axis.
    let wght = 0x77676874 // 'wght'
    let desc = base.fontDescriptor.addingAttributes([UIFontDescriptor.AttributeName(rawValue: kCTFontVariationAttribute as String): [wght: weight]])
    return UIFont(descriptor: desc, size: size)
  }
}

enum Memory {
  static func residentMB() -> Double {
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
    let kr = withUnsafeMutablePointer(to: &info) {
      $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count) }
    }
    return kr == KERN_SUCCESS ? Double(info.phys_footprint) / 1_048_576 : 0
  }
}
