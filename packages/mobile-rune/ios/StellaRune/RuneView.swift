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
  private(set) var frameCpuUs: [UInt64] = []
  private(set) var frameTimes: [CFTimeInterval] = []
  var recording = false

  override init(frame: CGRect) {
    super.init(frame: frame)
    isMultipleTouchEnabled = true
    backgroundColor = .black
    let layer = self.layer as! CAMetalLayer
    layer.pixelFormat = .bgra8Unorm
    layer.framebufferOnly = true
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
  }

  func wake() {
    wakeTimer?.invalidate()
    wakeTimer = nil
    link?.isPaused = false
  }

  @objc private func tick(_ l: CADisplayLink) {
    guard let host else { return }
    let f = sme_frame(host)
    if f.drew {
      frames += 1
      if recording {
        frameCpuUs.append(f.cpu_us)
        frameTimes.append(l.timestamp)
      }
      if !drewFirst {
        drewFirst = true
        onFirstFrame?()
      }
    }
    if !f.animating && !recording {
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

  override func traitCollectionDidChange(_ previous: UITraitCollection?) {
    super.traitCollectionDidChange(previous)
    if let host, traitCollection.userInterfaceStyle != previous?.userInterfaceStyle {
      sme_set_dark(host, traitCollection.userInterfaceStyle == .dark)
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
  func inject(id: UInt64, phase: UInt32, at p: CGPoint) {
    guard let host else { return }
    if phase == 2 { NativeFields.shared.lastTouchEnd = CACurrentMediaTime() }
    sme_touch(host, id, phase, Float(p.x), Float(p.y), CACurrentMediaTime())
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
