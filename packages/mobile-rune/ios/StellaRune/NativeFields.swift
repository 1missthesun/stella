import UIKit

/// Stella's text fields on iOS are UIKit's own: a `UITextView` (multi-line, the composer) or a
/// `UITextField` (single-line, so AutoFill and secure entry work), placed over the box Rune
/// lays out and paints for the `<input>` element. Rune draws the box (fill, border, glass); the
/// text, caret, selection handles, loupe, autocorrect, dictation, IME and the space-bar
/// trackpad are UIKit's. Engine messages: field / place / hideField / fieldGone / setText /
/// select / focusField / blurField (engine/src/mobile/native.rs).
final class NativeFields: NSObject, UITextViewDelegate, UITextFieldDelegate {
  static let shared = NativeFields()

  weak var container: UIView?
  /// When a finger last lifted. The keyboard comes up only for what the person just did: a
  /// focus request (the desktop UI focuses its composer whenever a conversation opens) without a
  /// tap just before it leaves the keyboard down, as iOS apps do on launch.
  var lastTouchEnd: CFTimeInterval = 0

  private final class Field {
    let n: UInt32
    var view: UIView
    var look: [String: Any] = [:]
    var placeholder = UILabel()
    var lastHeight: CGFloat = -1
    var applying = false
    init(n: UInt32, view: UIView) { self.n = n; self.view = view }
    var textView: UITextView? { view as? UITextView }
    var textField: UITextField? { view as? UITextField }
    var text: String {
      get { textView?.text ?? textField?.text ?? "" }
      set { if let tv = textView { tv.text = newValue } else { textField?.text = newValue } }
    }
  }

  private var fields: [UInt32: Field] = [:]
  /// Whether one of the fields is being edited (has the keyboard).
  var editing: Bool { fields.values.contains { $0.view.isFirstResponder } }
  /// The focused field's bottom edge (points), as placed for the frame being drawn.
  var focusedBottom: CGFloat? { fields.values.first { $0.view.isFirstResponder }?.view.frame.maxY }
  private var byView: [ObjectIdentifier: UInt32] = [:]

  func handle(_ m: [String: Any]) {
    guard let t = m["t"] as? String else { return }
    let n = (m["n"] as? NSNumber)?.uint32Value ?? 0
    switch t {
    case "field": configure(n, m)
    case "place":
      guard let f = fields[n], let r = m["rect"] as? [NSNumber], r.count == 4 else { return }
      let frame = CGRect(x: CGFloat(r[0].doubleValue), y: CGFloat(r[1].doubleValue), width: CGFloat(r[2].doubleValue), height: CGFloat(r[3].doubleValue))
      if f.view.frame != frame {
        // Exactly where this frame drew the box, with no implicit animation of its own (a place
        // can land inside the keyboard's animation block).
        UIView.performWithoutAnimation {
          f.view.frame = frame
          layoutPlaceholder(f)
          if let tv = f.textView { settleOffset(tv) }
        }
      }
      f.view.isHidden = false
    case "hideField":
      // Covered by something Rune draws (a page, a drawer, a dialog): out of sight, and done editing.
      guard let f = fields[n] else { return }
      if f.view.isFirstResponder { f.view.resignFirstResponder() }
      f.view.isHidden = true
    case "fieldGone":
      if let f = fields.removeValue(forKey: n) {
        byView.removeValue(forKey: ObjectIdentifier(f.view))
        f.view.removeFromSuperview()
      }
    case "setText":
      guard let f = fields[n] else { return }
      let v = m["value"] as? String ?? ""
      if f.text != v {
        f.applying = true
        f.text = v
        f.applying = false
        refreshPlaceholder(f)
        reportHeight(f)
      }
    case "select":
      guard let f = fields[n] else { return }
      let a = (m["start"] as? NSNumber)?.intValue ?? 0
      let b = (m["end"] as? NSNumber)?.intValue ?? a
      select(f, a, b)
    case "focusField":
      guard let f = fields[n], CACurrentMediaTime() - lastTouchEnd < 1.5 else { return }
      f.view.becomeFirstResponder()
    case "blurField":
      container?.endEditing(true)
    default: break
    }
  }

  func tapOutside(at p: CGPoint) {
    container?.endEditing(true)
  }

  // MARK: configuration

  private func color(_ v: Any?) -> UIColor? {
    guard var s = v as? String else { return nil }
    if s.hasPrefix("#") { s.removeFirst() }
    var n: UInt64 = 0
    guard Scanner(string: s).scanHexInt64(&n) else { return nil }
    switch s.count {
    case 6: return UIColor(red: CGFloat((n >> 16) & 0xff) / 255, green: CGFloat((n >> 8) & 0xff) / 255, blue: CGFloat(n & 0xff) / 255, alpha: 1)
    case 8: return UIColor(red: CGFloat((n >> 24) & 0xff) / 255, green: CGFloat((n >> 16) & 0xff) / 255, blue: CGFloat((n >> 8) & 0xff) / 255, alpha: CGFloat(n & 0xff) / 255)
    default: return nil
    }
  }

  private func font(_ m: [String: Any]) -> UIFont {
    let size = CGFloat((m["size"] as? NSNumber)?.doubleValue ?? 16)
    let w = (m["weight"] as? NSNumber)?.doubleValue ?? 400
    let weight: UIFont.Weight = w >= 700 ? .bold : w >= 600 ? .semibold : w >= 500 ? .medium : .regular
    if let fam = (m["family"] as? String) ?? AppFonts.sans, let f = AppFonts.font(family: fam, size: size, weight: w) {
      return f
    }
    return .systemFont(ofSize: size, weight: weight)
  }

  private func configure(_ n: UInt32, _ m: [String: Any]) {
    let multiline = (m["multiline"] as? Bool) ?? false
    let secure = (m["secure"] as? Bool) ?? false
    var f = fields[n]
    let wantsTextView = multiline && !secure
    if let existing = f, (existing.textView != nil) != wantsTextView {
      existing.view.removeFromSuperview()
      byView.removeValue(forKey: ObjectIdentifier(existing.view))
      fields.removeValue(forKey: n)
      f = nil
    }
    let field: Field
    if let f { field = f } else {
      let view: UIView
      if wantsTextView {
        let tv = UITextView()
        tv.backgroundColor = .clear
        tv.textContainer.lineFragmentPadding = 0
        tv.isScrollEnabled = true
        tv.showsVerticalScrollIndicator = false
        tv.delegate = self
        tv.keyboardDismissMode = .none
        tv.alwaysBounceVertical = false
        view = tv
      } else {
        let tf = UITextField()
        tf.backgroundColor = .clear
        tf.borderStyle = .none
        tf.delegate = self
        tf.addTarget(self, action: #selector(fieldChanged(_:)), for: .editingChanged)
        view = tf
      }
      view.isHidden = true
      field = Field(n: n, view: view)
      field.placeholder.numberOfLines = multiline ? 0 : 1
      field.placeholder.isUserInteractionEnabled = false
      view.addSubview(field.placeholder)
      fields[n] = field
      byView[ObjectIdentifier(view)] = n
      container?.addSubview(view)
      if let v = m["value"] as? String { field.text = v }
    }
    field.look = m
    let font = font(m)
    let fg = color(m["color"]) ?? .label
    let pad = (m["pad"] as? [NSNumber])?.map { CGFloat($0.doubleValue) } ?? [0, 0, 0, 0]
    let lineHeight = CGFloat((m["lineHeight"] as? NSNumber)?.doubleValue ?? Double(font.lineHeight))
    let para = NSMutableParagraphStyle()
    para.minimumLineHeight = lineHeight
    para.maximumLineHeight = lineHeight
    let baselineOffset = (lineHeight - font.lineHeight) / 2
    var attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: fg, .paragraphStyle: para, .baselineOffset: baselineOffset]
    if let tr = (m["tracking"] as? NSNumber)?.doubleValue { attrs[.kern] = tr }
    let tint = color(m["caret"]) ?? container?.tintColor
    if let tv = field.textView {
      tv.typingAttributes = attrs
      if !tv.text.isEmpty {
        let sel = tv.selectedRange
        field.applying = true
        tv.attributedText = NSAttributedString(string: tv.text, attributes: attrs)
        tv.selectedRange = sel
        field.applying = false
      }
      tv.font = font
      tv.textColor = fg
      tv.textContainerInset = UIEdgeInsets(top: pad[0], left: pad[3], bottom: pad[2], right: pad[1])
      if let tint { tv.tintColor = tint }
      tv.autocorrectionType = (m["spellcheck"] as? Bool) == false ? .no : .default
      tv.isEditable = !((m["readOnly"] as? Bool) ?? false)
    } else if let tf = field.textField {
      tf.font = font
      tf.textColor = fg
      tf.defaultTextAttributes = attrs
      tf.isSecureTextEntry = secure
      if let tint { tf.tintColor = tint }
      let hint = "\(m["id"] as? String ?? "") \(m["label"] as? String ?? "") \(m["placeholder"] as? String ?? "")".lowercased()
      if secure {
        tf.textContentType = .password
      } else if hint.contains("email") || hint.contains("@") {
        tf.textContentType = .emailAddress
        tf.keyboardType = .emailAddress
        tf.autocapitalizationType = .none
        tf.autocorrectionType = .no
      } else if hint.contains("pairing") {
        // A computer's pairing code: letters and digits, typed as shown (`K7M-49PX`).
        tf.keyboardType = .asciiCapable
        tf.autocapitalizationType = .allCharacters
        tf.autocorrectionType = .no
        tf.spellCheckingType = .no
      } else if hint.contains("code") {
        tf.textContentType = .oneTimeCode
        tf.keyboardType = .numberPad
      }
      tf.returnKeyType = (m["submit"] as? Bool) == true ? .go : .default
      tf.contentVerticalAlignment = .center
      tf.isEnabled = !((m["readOnly"] as? Bool) ?? false)
    }
    field.view.semanticContentAttribute = (m["dir"] as? String) == "rtl" ? .forceRightToLeft : .unspecified
    field.placeholder.text = m["placeholder"] as? String
    field.placeholder.font = font
    field.placeholder.textColor = color(m["placeholderColor"]) ?? .placeholderText
    refreshPlaceholder(field)
    layoutPlaceholder(field)
    reportHeight(field)
    if (m["autoFocus"] as? Bool) == true, !field.view.isFirstResponder {
      DispatchQueue.main.async { field.view.becomeFirstResponder() }
    }
  }

  private func layoutPlaceholder(_ f: Field) {
    let pad = (f.look["pad"] as? [NSNumber])?.map { CGFloat($0.doubleValue) } ?? [0, 0, 0, 0]
    let b = f.view.bounds
    let lh = CGFloat((f.look["lineHeight"] as? NSNumber)?.doubleValue ?? 20)
    if f.textView != nil {
      f.placeholder.frame = CGRect(x: pad[3], y: pad[0], width: max(0, b.width - pad[1] - pad[3]), height: lh)
    } else {
      f.placeholder.frame = CGRect(x: pad[3], y: 0, width: max(0, b.width - pad[1] - pad[3]), height: b.height)
    }
  }

  /// A text view that grew (pasted lines) scrolled its text up to keep the caret in sight while it
  /// was still short. Once its box is tall enough for the text, the text comes back to the top
  /// instead of staying sliced off above it; a box at its line limit keeps the caret in view.
  private func settleOffset(_ tv: UITextView) {
    tv.layoutIfNeeded()
    let maxY = max(0, tv.contentSize.height - tv.bounds.height)
    if tv.contentOffset.y > maxY + 0.5 || (maxY < 0.5 && tv.contentOffset.y != 0) {
      tv.setContentOffset(CGPoint(x: 0, y: min(tv.contentOffset.y, maxY)), animated: false)
    }
  }

  private func refreshPlaceholder(_ f: Field) {
    f.placeholder.isHidden = !f.text.isEmpty
  }

  /// A growing field's box follows its text: the text height (without the box's padding).
  private func reportHeight(_ f: Field) {
    guard let tv = f.textView else { return }
    let w = tv.bounds.width > 0 ? tv.bounds.width : 300
    let inner = w - tv.textContainerInset.left - tv.textContainerInset.right
    let size = tv.attributedText.length > 0
      ? tv.attributedText.boundingRect(with: CGSize(width: inner, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil).size
      : .zero
    let lh = CGFloat((f.look["lineHeight"] as? NSNumber)?.doubleValue ?? 20)
    var h = max(lh, ceil(size.height))
    if tv.text.hasSuffix("\n") { h += lh }
    if abs(h - f.lastHeight) > 0.25 {
      f.lastHeight = h
      send(f.n, ["e": "height", "height": h])
    }
  }

  private func select(_ f: Field, _ a: Int, _ b: Int) {
    if let tv = f.textView {
      tv.selectedRange = NSRange(location: a, length: max(0, b - a))
    } else if let tf = f.textField, let s = tf.position(from: tf.beginningOfDocument, offset: a), let e = tf.position(from: tf.beginningOfDocument, offset: b) {
      tf.selectedTextRange = tf.textRange(from: s, to: e)
    }
  }

  private func send(_ n: UInt32, _ v: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: v) else { return }
    data.withUnsafeBytes { buf in
      sme_field_event(n, buf.bindMemory(to: UInt8.self).baseAddress, buf.count)
    }
    App.shared.rune?.wake()
  }

  private func reportInput(_ f: Field) {
    guard !f.applying else { return }
    var start = 0, end = 0
    if let tv = f.textView {
      start = tv.selectedRange.location
      end = start + tv.selectedRange.length
    } else if let tf = f.textField, let r = tf.selectedTextRange {
      start = tf.offset(from: tf.beginningOfDocument, to: r.start)
      end = tf.offset(from: tf.beginningOfDocument, to: r.end)
    }
    send(f.n, ["e": "input", "value": f.text, "start": start, "end": end])
    refreshPlaceholder(f)
    reportHeight(f)
  }

  private func field(for v: UIView) -> Field? {
    byView[ObjectIdentifier(v)].flatMap { fields[$0] }
  }

  // MARK: UITextViewDelegate

  func textViewDidChange(_ tv: UITextView) {
    if let f = field(for: tv) { reportInput(f) }
  }

  func textViewDidChangeSelection(_ tv: UITextView) {
    guard let f = field(for: tv), !f.applying else { return }
    let a = tv.selectedRange.location
    send(f.n, ["e": "selection", "start": a, "end": a + tv.selectedRange.length])
  }

  func textViewDidBeginEditing(_ tv: UITextView) {
    if let f = field(for: tv) { send(f.n, ["e": "focus", "focused": true]) }
  }

  func textViewDidEndEditing(_ tv: UITextView) {
    if let f = field(for: tv) { send(f.n, ["e": "focus", "focused": false]) }
  }

  // MARK: UITextFieldDelegate

  @objc private func fieldChanged(_ tf: UITextField) {
    if let f = field(for: tf) { reportInput(f) }
  }

  func textFieldDidBeginEditing(_ tf: UITextField) {
    if let f = field(for: tf) { send(f.n, ["e": "focus", "focused": true]) }
  }

  func textFieldDidEndEditing(_ tf: UITextField) {
    if let f = field(for: tf) { send(f.n, ["e": "focus", "focused": false]) }
  }

  func textFieldShouldReturn(_ tf: UITextField) -> Bool {
    guard let f = field(for: tf) else { return true }
    let len = f.text.utf16.count
    send(f.n, ["e": "key", "key": "Enter", "chord": "Enter", "mods": ["mod": false, "shift": false, "alt": false, "ctrl": false, "meta": false], "value": f.text, "start": len, "end": len, "length": len])
    if (f.look["submit"] as? Bool) == true { send(f.n, ["e": "submit"]) }
    return false
  }
}
