import ExpoModulesCore
import GameController
import UIKit

/// A view's `useKey` chords from a hardware keyboard (iPad, or a keyboard paired with a phone).
/// Chords arrive canonical from JS (`mod+shift+alt+ctrl+key`, mod being ⌘); a press that matches
/// one fires `onChord` and is consumed, anything else goes on up the responder chain. Presses a
/// focused text field inside doesn't handle (⌘ shortcuts, Escape) reach it here too.
final class StellaKeyView: ExpoView {
  let onChord = EventDispatcher()
  var chords: Set<String> = []
  var autoFocus = false {
    didSet { if autoFocus { focusSoon() } }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    let tap = UITapGestureRecognizer(target: self, action: #selector(tapped))
    tap.cancelsTouchesInView = false
    tap.delaysTouchesEnded = false
    addGestureRecognizer(tap)
  }

  override var canBecomeFirstResponder: Bool { true }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil && autoFocus { focusSoon() }
  }

  private func focusSoon() {
    DispatchQueue.main.async { [weak self] in
      guard let self, self.window != nil, !self.isFirstResponder else { return }
      self.becomeFirstResponder()
    }
  }

  /// Only with a hardware keyboard: taking focus would otherwise just close the on-screen one.
  @objc private func tapped() {
    if GCKeyboard.coalesced != nil, !isFirstResponder { becomeFirstResponder() }
  }

  private var consumed = Set<UIKeyboardHIDUsage>()

  override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    var rest = Set<UIPress>()
    for press in presses {
      if let key = press.key, let chord = Self.chord(key), chords.contains(chord) {
        consumed.insert(key.keyCode)
        onChord(["chord": chord])
      } else {
        rest.insert(press)
      }
    }
    if !rest.isEmpty { super.pressesBegan(rest, with: event) }
  }

  override func pressesEnded(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    let rest = presses.filter { press in
      guard let code = press.key?.keyCode else { return true }
      return consumed.remove(code) == nil
    }
    if !rest.isEmpty { super.pressesEnded(rest, with: event) }
  }

  override func pressesCancelled(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    for press in presses { if let code = press.key?.keyCode { consumed.remove(code) } }
    super.pressesCancelled(presses, with: event)
  }

  private static let named: [UIKeyboardHIDUsage: String] = [
    .keyboardReturnOrEnter: "enter", .keypadEnter: "enter", .keyboardEscape: "escape",
    .keyboardTab: "tab", .keyboardDeleteOrBackspace: "backspace", .keyboardDeleteForward: "delete",
    .keyboardSpacebar: " ", .keyboardUpArrow: "arrowup", .keyboardDownArrow: "arrowdown",
    .keyboardLeftArrow: "arrowleft", .keyboardRightArrow: "arrowright", .keyboardHome: "home",
    .keyboardEnd: "end", .keyboardPageUp: "pageup", .keyboardPageDown: "pagedown",
    .keyboardF1: "f1", .keyboardF2: "f2", .keyboardF3: "f3", .keyboardF4: "f4", .keyboardF5: "f5",
    .keyboardF6: "f6", .keyboardF7: "f7", .keyboardF8: "f8", .keyboardF9: "f9", .keyboardF10: "f10",
    .keyboardF11: "f11", .keyboardF12: "f12",
  ]

  static func chord(_ key: UIKey) -> String? {
    let name = named[key.keyCode] ?? key.charactersIgnoringModifiers.lowercased()
    guard !name.isEmpty else { return nil }
    let flags = key.modifierFlags
    var parts: [String] = []
    if flags.contains(.command) { parts.append("mod") }
    if flags.contains(.shift) { parts.append("shift") }
    if flags.contains(.alternate) { parts.append("alt") }
    if flags.contains(.control) { parts.append("ctrl") }
    parts.append(name)
    return parts.joined(separator: "+")
  }
}

/// Keeps the export sheet's answer: the copy's URL, or nil when cancelled.
final class SaveDelegate: NSObject, UIDocumentPickerDelegate {
  private var done: ((URL?) -> Void)?

  init(_ done: @escaping (URL?) -> Void) {
    self.done = done
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    done?(urls.first)
    done = nil
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    done?(nil)
    done = nil
  }
}
