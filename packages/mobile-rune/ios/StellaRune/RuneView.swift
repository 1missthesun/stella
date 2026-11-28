import QuartzCore
import UIKit

/// The Metal layer Rune draws the whole app into, at the display's rate (120 Hz on ProMotion).
/// Touches go to Rune's own touch handling (scroll physics, presses, drags); text fields are
/// real `UITextView`s placed over Rune's boxes (`NativeFields`).
final class RuneView: UIView {
  override class var layerClass: AnyClass { CAMetalLayer.self }

  private(set) var host: OpaquePointer?
  private var link: CADisplayLink?
  private var wakeTimer: Timer?
  private var lastSize: CGSize = .zero
  private var lastScale: CGFloat = 0
  var onFirstFrame: (() -> Void)?
  private var drewFirst = false
  /// Frames presented and their CPU cost, for the perf overlay and measurements.
  private(set) var frames = 0
  /// Display link ticks (drawn or not).
  private(set) var ticks = 0
  private(set) var frameCpuUs: [UInt64] = []
  private(set) var frameTimes: [CFTimeInterval] = []
  /// Per recorded frame: the keyboard overlap drawn, the focused field's bottom, the real keyboard's top.
  private(set) var frameKb: [[Double]] = []
  var recording = false
  /// The app is in the background: Metal refuses drawables and command buffers there (a frame
  /// submitted after `didEnterBackground` fails, its drawable never comes back, and the next
  /// `nextDrawable` waits for it forever, freezing the app when it returns). No frame is drawn
  /// until the app is back in the foreground.
  private(set) var backgrounded = false

  override init(frame: CGRect) {
    super.init(frame: frame)
    watchAppearance()
    isMultipleTouchEnabled = true
    backgroundColor = .black
    let layer = self.layer as! CAMetalLayer
    layer.pixelFormat = .bgra8Unorm
    layer.framebufferOnly = true
    // A frame shows in the Core Animation transaction it was drawn in, the one that moves the
    // native text fields to where it drew their boxes (NativeFields `place`), so a field never
    // trails its box while the keyboard or a growing composer moves it.
    layer.presentsWithTransaction = true
    layer.isOpaque = true
    contentScaleFactor = UIScreen.main.scale
  }

  required init?(coder: NSCoder) { fatalError() }

  func start(dark: Bool) {
    guard host == nil else { return }
    let size = bounds.size
    let scale = Float(window?.screen.scale ?? UIScreen.main.scale)
    let me = Unmanaged.passUnretained(self).toOpaque()
    host = sme_create(Unmanaged.passUnretained(layer).toOpaque(), Float(size.width), Float(size.height), scale, dark, { ctx in
      guard let ctx else { return }
      let view = Unmanaged<RuneView>.fromOpaque(ctx).takeUnretainedValue()
      if Thread.isMainThread { view.wake() } else { DispatchQueue.main.async { view.wake() } }
    }, me)
    lastSize = size
    lastScale = CGFloat(scale)
    pushInsets()
    pushAccessibility()
    for name in [UIAccessibility.reduceTransparencyStatusDidChangeNotification, UIAccessibility.darkerSystemColorsStatusDidChangeNotification, UIAccessibility.reduceMotionStatusDidChangeNotification] {
      NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in self?.pushAccessibility() }
    }
    let link = CADisplayLink(target: self, selector: #selector(tick))
    if #available(iOS 15.0, *) {
      link.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 120, preferred: 120)
    }
    link.add(to: .main, forMode: .common)
    self.link = link
    allowDrawableTimeout()
    let nc = NotificationCenter.default
    nc.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in self?.enterBackground() }
    nc.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in self?.enterForeground() }
    // Also on becoming active: the app can start or come back without a willEnterForeground.
    nc.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.enterForeground() }
  }

  func wake() {
    wakeTimer?.invalidate()
    wakeTimer = nil
    guard !backgrounded else { return }
    link?.isPaused = false
  }

  private func enterBackground() {
    guard !backgrounded else { return }
    backgrounded = true
    wakeTimer?.invalidate()
    wakeTimer = nil
    link?.isPaused = true
    downAt.removeAll()
    App.shared.js.deliver(line: #"{"t":"app.visible","visible":false}"#)
  }

  private func enterForeground() {
    guard backgrounded else { return }
    backgrounded = false
    downAt.removeAll()
    if let host {
      // Whatever changed while away (size, safe area, appearance) and a whole fresh frame.
      let size = bounds.size
      let scale = window?.screen.scale ?? UIScreen.main.scale
      lastSize = size
      lastScale = scale
      sme_resize(host, Float(size.width), Float(size.height), Float(scale))
      allowDrawableTimeout()
      pushInsets()
      sme_set_dark(host, traitCollection.userInterfaceStyle == .dark)
    }
    App.shared.js.deliver(line: #"{"t":"app.visible","visible":true}"#)
    wake()
  }

  /// wgpu configures the layer to wait for a drawable forever. A drawable lost anyway (the system
  /// reclaiming them around a background transition) would then hang the main thread for good;
  /// with the timeout, `nextDrawable` gives up after a second and the frame is skipped.
  private func allowDrawableTimeout() {
    (layer as! CAMetalLayer).allowsNextDrawableTimeout = true
  }

  @objc private func tick(_ l: CADisplayLink) {
    guard let host else { return }
    if backgrounded {
      l.isPaused = true
      return
    }
    ticks += 1
    KeyboardWatch.shared.frameDuration = l.targetTimestamp - l.timestamp
    KeyboardWatch.shared.frame(host)
    let f = sme_frame(host)
    if f.drew {
      frames += 1
      if recording {
        frameCpuUs.append(f.cpu_us)
        frameTimes.append(l.timestamp)
        #if STELLA_DEV
        frameKb.append([Double(KeyboardWatch.shared.liveValue), Double(NativeFields.shared.focusedBottom ?? -1), Double(KeyboardWatch.shared.realKeyboardTop())])
        #endif
      }
      if !drewFirst {
        drewFirst = true
        onFirstFrame?()
      }
    }
    if !f.animating && !recording && !KeyboardWatch.shared.moving {
      l.isPaused = true
      if f.wake_after >= 0 {
        wakeTimer?.invalidate()
        wakeTimer = Timer.scheduledTimer(withTimeInterval: max(0.001, f.wake_after), repeats: false) { [weak self] _ in self?.wake() }
      }
    }
  }

  func resetRecording() {
    frameCpuUs.removeAll()
    frameTimes.removeAll()
    frameKb.removeAll()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let size = bounds.size
    let scale = window?.screen.scale ?? UIScreen.main.scale
    (layer as! CAMetalLayer).drawableSize = CGSize(width: size.width * scale, height: size.height * scale)
    if let host, size != lastSize || scale != lastScale {
      lastSize = size
      lastScale = scale
      sme_resize(host, Float(size.width), Float(size.height), Float(scale))
      allowDrawableTimeout()
      wake()
    }
  }

  override func safeAreaInsetsDidChange() {
    super.safeAreaInsetsDidChange()
    pushInsets()
  }

  /// Reduce Transparency turns Rune's glass solid; Increase Contrast strengthens its edges.
  private func pushAccessibility() {
    guard let host else { return }
    sme_accessibility(host, UIAccessibility.isReduceTransparencyEnabled, UIAccessibility.isDarkerSystemColorsEnabled, UIAccessibility.isReduceMotionEnabled)
    wake()
  }

  private func pushInsets() {
    guard let host else { return }
    let i = safeAreaInsets
    sme_safe_area(host, Float(i.top), Float(i.right), Float(i.bottom), Float(i.left))
  }

  /// Follows light and dark mode (the system's, or the window's override).
  private func watchAppearance() {
    registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (view: RuneView, _: UITraitCollection) in
      guard let host = view.host else { return }
      sme_set_dark(host, view.traitCollection.userInterfaceStyle == .dark)
    }
  }

  // MARK: touches

  private func send(_ touches: Set<UITouch>, _ phase: UInt32) {
    guard let host else { return }
    for t in touches {
      let p = t.location(in: self)
      let id = UInt64(UInt(bitPattern: ObjectIdentifier(t).hashValue))
      sme_touch(host, id, phase, Float(p.x), Float(p.y), t.timestamp)
    }
    wake()
  }

  private var downAt: [ObjectIdentifier: CGPoint] = [:]

  /// A synthetic finger (the dev debug driver): phase 0 began, 1 moved, 2 ended, 3 cancelled.
  /// `time`: when the finger was there (a scripted gesture's own timeline), else now.
  func inject(id: UInt64, phase: UInt32, at p: CGPoint, time: Double? = nil) {
    guard let host else { return }
    if phase == 2 { NativeFields.shared.lastTouchEnd = CACurrentMediaTime() }
    sme_touch(host, id, phase, Float(p.x), Float(p.y), time ?? CACurrentMediaTime())
    wake()
  }

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
    for t in touches { downAt[ObjectIdentifier(t)] = t.location(in: self) }
    send(touches, 0)
  }
  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) { send(touches, 1) }
  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
    NativeFields.shared.lastTouchEnd = CACurrentMediaTime()
    send(touches, 2)
    // A tap (not a scroll) outside the native fields ends editing, as a web page's blur does.
    for t in touches {
      if let d = downAt.removeValue(forKey: ObjectIdentifier(t)), hypot(t.location(in: self).x - d.x, t.location(in: self).y - d.y) < 10 {
        NativeFields.shared.tapOutside(at: t.location(in: self))
      }
    }
  }
  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
    for t in touches { downAt.removeValue(forKey: ObjectIdentifier(t)) }
    send(touches, 3)
  }
}
