import Foundation
import ObjectiveC
import UIKit

/**
 React Native drives short JS timers from a display link, and the iPhone's
 display link stops when Stella runs only on the CarPlay screen. Without a
 phone scene in front, the timing module is switched to its background mode,
 which drives every timer from run-loop timers instead.
 */
final class StellaTimerKeeper: @unchecked Sendable {
  static let shared = StellaTimerKeeper()

  private let lock = NSLock()
  private let instances = NSHashTable<AnyObject>.weakObjects()
  private var displayless = false
  private var installed = false

  func install() {
    lock.lock()
    if installed {
      lock.unlock()
      return
    }
    installed = true
    lock.unlock()

    guard let timingClass = NSClassFromString("RCTTiming") else { return }
    let selector = NSSelectorFromString("createTimerForNextFrame:duration:jsSchedulingTime:repeats:")
    guard let method = class_getInstanceMethod(timingClass, selector) else { return }
    typealias Original = @convention(c) (AnyObject, Selector, NSNumber, Double, NSDate?, Bool) -> Void
    let original = unsafeBitCast(method_getImplementation(method), to: Original.self)
    let replacement: @convention(block) (AnyObject, NSNumber, Double, NSDate?, Bool) -> Void = {
      timing, callbackID, duration, scheduledAt, repeats in
      original(timing, selector, callbackID, duration, scheduledAt, repeats)
      StellaTimerKeeper.shared.register(timing)
    }
    method_setImplementation(method, imp_implementationWithBlock(replacement))

    for name in [UIApplication.didBecomeActiveNotification, UIApplication.willEnterForegroundNotification] {
      NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { _ in
        DispatchQueue.main.async {
          StellaTimerKeeper.shared.reapply()
        }
      }
    }
  }

  func update(carPlayConnected: Bool, phoneForeground: Bool) {
    let next = carPlayConnected && !phoneForeground
    lock.lock()
    let changed = next != displayless
    displayless = next
    let targets = instances.allObjects
    lock.unlock()
    guard changed else { return }
    DispatchQueue.main.async {
      for timing in targets {
        StellaTimerKeeper.apply(next, to: timing)
      }
    }
  }

  private func register(_ timing: AnyObject) {
    lock.lock()
    let isNew = !instances.contains(timing)
    if isNew {
      instances.add(timing)
    }
    let current = displayless
    lock.unlock()
    guard isNew, current else { return }
    DispatchQueue.main.async {
      StellaTimerKeeper.apply(true, to: timing)
    }
  }

  private func reapply() {
    lock.lock()
    let current = displayless
    let targets = instances.allObjects
    lock.unlock()
    guard current else { return }
    for timing in targets {
      StellaTimerKeeper.apply(true, to: timing)
    }
  }

  private static func apply(_ displayless: Bool, to timing: AnyObject) {
    let selector = NSSelectorFromString(displayless ? "appDidMoveToBackground" : "appDidMoveToForeground")
    guard let object = timing as? NSObject, object.responds(to: selector) else { return }
    _ = object.perform(selector)
  }
}
