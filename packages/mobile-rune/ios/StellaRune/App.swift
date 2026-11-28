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
      // Once launch has settled, and only if nothing has taken focus by then.
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
        guard let w = self?.window, !NativeFields.shared.editing else { return }
        KeyboardWatch.shared.prewarm(in: w)
      }
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
    if Pickers.shared.handle(m) || Menus.shared.handle(m) || Push.shared.handle(m) || Mic.shared.handle(m) || SignIn.shared.handle(m) || Store.shared.handle(m) || QRScanner.shared.handle(m) || VideoPoster.shared.handle(m) { return }
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
    let obj: [String: Any] = ["label": label, "frames": times.count, "gapsMs": gaps, "cpuMs": cpu, "kb": r.frameKb, "rssMB": Memory.residentMB()]
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
    Push.shared.setUp()
    let w = UIWindow(frame: UIScreen.main.bounds)
    window = w
    App.shared.boot(in: w)
    Store.shared.start()
    return true
  }

  func application(_ app: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken token: Data) {
    Push.shared.didRegister(token)
  }

  func application(_ app: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
    Push.shared.didFail(error)
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

/// The keyboard's overlap with the window, for the composer to sit on it, moving in lockstep with
/// the keyboard. A hidden probe view runs UIKit's own keyboard animation (its duration and curve);
/// Rune's display link reads the probe on every tick, right before it draws, and hands the engine
/// where the keyboard will be when that frame reaches the screen (`sme_keyboard_frame`). Elements
/// riding the keyboard (`keyboard` props) move within that same frame, with no TS round trip,
/// so nothing trails the keyboard by a frame or two. TS hears where the keyboard is headed once
/// per move (`sme_keyboard`), as it starts.
final class KeyboardWatch {
  static let shared = KeyboardWatch()
  private let probe = UIView(frame: .zero)
  private var target: CGFloat = 0
  private var live: CGFloat = 0
  private var until: CFTimeInterval = 0
  /// Seconds between Rune's frames, for how far ahead of now the probe runs.
  var frameDuration: CFTimeInterval = 1.0 / 120

  /// Whether a keyboard move is in flight (Rune's display link keeps ticking until it lands).
  var moving: Bool { CACurrentMediaTime() < until }

  func start() {
    probe.isHidden = true
    probe.isUserInteractionEnabled = false
    NotificationCenter.default.addObserver(forName: UIResponder.keyboardWillChangeFrameNotification, object: nil, queue: .main) { [weak self] n in
      guard let self, !self.warming, let end = (n.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue, let w = App.shared.window else { return }
      self.move(to: max(0, w.bounds.maxY - end.minY), n.userInfo, in: w)
    }
    NotificationCenter.default.addObserver(forName: UIResponder.keyboardWillHideNotification, object: nil, queue: .main) { [weak self] n in
      guard let self, !self.warming, let w = App.shared.window else { return }
      self.move(to: 0, n.userInfo, in: w)
    }
  }

  private var warming = false

  /// UIKit builds the keyboard (its window, layouts and key views, ~100 ms on the main thread)
  /// the first time anything takes focus, which held the first tap on the composer back that
  /// long. Built once while the app sits idle after launch, by focusing a field that is never
  /// seen and letting go in the same turn, before anything is drawn.
  func prewarm(in window: UIWindow) {
    let field = UITextField(frame: CGRect(x: -100, y: -100, width: 10, height: 10))
    field.autocorrectionType = .no
    window.addSubview(field)
    warming = true
    UIView.performWithoutAnimation {
      field.becomeFirstResponder()
      field.resignFirstResponder()
    }
    field.removeFromSuperview()
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self.warming = false }
  }

  private func move(to overlap: CGFloat, _ info: [AnyHashable: Any]?, in window: UIWindow) {
    if probe.superview !== window { window.addSubview(probe) }
    let end = max(0, overlap.rounded())
    if end != target, let h = App.shared.rune?.host {
      target = end
      sme_keyboard(h, Float(end))
    }
    let dur = (info?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double) ?? 0
    let curve = (info?[UIResponder.keyboardAnimationCurveUserInfoKey] as? UInt) ?? 7
    guard dur > 0 else {
      probe.layer.removeAllAnimations()
      probe.frame = CGRect(x: 0, y: end, width: 1, height: 1)
      until = CACurrentMediaTime() + 0.05
      App.shared.rune?.wake()
      return
    }
    UIView.animate(withDuration: dur, delay: 0, options: [UIView.AnimationOptions(rawValue: curve << 16), .beginFromCurrentState]) {
      self.probe.frame = CGRect(x: 0, y: end, width: 1, height: 1)
    }
    // A frame drawn on a tick is committed then, composited by the render server on the next
    // refresh and shown on the one after: two frames on, which is when the keyboard's own
    // animation (evaluated by the render server for the frame it shows) will be where we draw. So
    // the probe runs the keyboard's animation two frames ahead. It starts in the keyboard's own
    // transaction (begin time left to the commit, which can land tens of milliseconds after this
    // notification while UIKit sets the keyboard up) and only its local clock is ahead.
    let lead = 2 * max(frameDuration, 1.0 / 120)
    for key in probe.layer.animationKeys() ?? [] {
      guard let a = probe.layer.animation(forKey: key)?.mutableCopy() as? CAAnimation else { continue }
      a.timeOffset = lead
      probe.layer.add(a, forKey: key)
    }
    until = CACurrentMediaTime() + dur + 0.05
    App.shared.rune?.wake()
  }

  /// Rune's display link, right before `sme_frame`: where the keyboard will be when this frame shows.
  func frame(_ host: OpaquePointer) {
    let y: CGFloat
    if moving {
      // Until the animation is committed there is no presentation layer; the model value then is
      // where the keyboard ends up, not where it is: keep the last value for that tick.
      guard let p = probe.layer.presentation()?.frame.minY else { return }
      // An animation run ahead by `timeOffset` wraps back to its start for its last `timeOffset`
      // (Core Animation plays offset → end, then start → offset): past its end, it has landed.
      if landed() { y = probe.frame.minY } else { y = p }
    } else {
      y = probe.frame.minY
    }
    let v = max(0, y.rounded())
    guard v != live else { return }
    live = v
    sme_keyboard_frame(host, Float(v))
  }

  private func landed() -> Bool {
    let now = probe.layer.convertTime(CACurrentMediaTime(), from: nil)
    for key in probe.layer.animationKeys() ?? [] {
      // Not yet given its start by the commit: still to run.
      guard let a = probe.layer.animation(forKey: key), a.beginTime > 0 else { return false }
      if now - a.beginTime + a.timeOffset < a.duration { return false }
    }
    return true
  }
  var liveValue: CGFloat { live }

  #if STELLA_DEV
  private weak var keyboardHost: UIView?
  /// The system keyboard's top edge on screen right now (its in-process host view's presentation), for sync measurements.
  func realKeyboardTop() -> CGFloat {
    if keyboardHost?.window == nil {
      keyboardHost = nil
      var all: [UIWindow] = []
      for scene in UIApplication.shared.connectedScenes {
        guard let ws = scene as? UIWindowScene else { continue }
        all += ws.windows
      }
      all += UIApplication.shared.windows
      for w in all where w !== App.shared.window {
        if let v = Self.find(in: w) { keyboardHost = v; break }
      }
    }
    guard let v = keyboardHost, let w = v.window else { return -1 }
    let f = v.layer.presentation()?.frame ?? v.frame
    let r = (v.superview ?? w).convert(f, to: nil)
    return r.minY
  }

  private static func find(in v: UIView) -> UIView? {
    let name = NSStringFromClass(type(of: v))
    if name.contains("UIKeyboardItemContainerView") { return v }
    for s in v.subviews { if let f = find(in: s) { return f } }
    return nil
  }
  #endif
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
