// show_panel: Show Stella's clickable surfaces on macOS, as panels that never
// bring Stella forward. Electron's own "panel" windows are plain windows that
// activate the app (and raise its windows) on any click, so the parts of Show
// Stella that take clicks while another app is in front live here:
//
//   - a catch layer over the recorded display while ⇧ alone is held, so pin
//     clicks and ⇧-drags never reach the app below. The helper watches ⇧
//     itself, so the layer is up before a quick ⇧-click lands;
//   - click areas over the recording bar's buttons (Done);
//   - the finish card: thumbnail, length, a note field, Send, Open in Stella,
//     and discard. Typing in its note field doesn't activate Stella either.
//
// Protocol: one JSON object per line on stdin, one per line on stdout.
// Rects are Electron screen points (top-left origin of the primary display).
//
//   in:  {"cmd":"arm","rect":{x,y,width,height}|null}  (null disarms)
//        {"cmd":"hit","id":"done","rect":{...}|null}
//        {"cmd":"card","card":{"x":centerX,"y":top,"title":"…","status":"…"|null,
//          "image":"/path.png"|null,"sendEnabled":true,
//          "strings":{"note":"…","send":"…","open":"…","discard":"…"}}}
//        {"cmd":"hideCard"}  {"cmd":"quit"}
//   out: {"event":"ready"}  {"event":"hit","id":"done"}
//        {"event":"card","action":"send"|"open"|"discard","note":"…"}
//        {"event":"engaged","on":true,"typing":false}

import AppKit

// MARK: - Output

let outLock = NSLock()
func emit(_ object: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: object),
    let line = String(data: data, encoding: .utf8)
  else { return }
  outLock.lock()
  FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
  outLock.unlock()
}

// MARK: - Geometry

func appKitRect(_ rect: [String: Any]) -> NSRect? {
  guard let x = (rect["x"] as? NSNumber)?.doubleValue,
    let y = (rect["y"] as? NSNumber)?.doubleValue,
    let w = (rect["width"] as? NSNumber)?.doubleValue,
    let h = (rect["height"] as? NSNumber)?.doubleValue
  else { return nil }
  let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
  return NSRect(x: x, y: primaryHeight - y - h, width: w, height: h)
}

// MARK: - Panels

/// A borderless panel that takes clicks (and, for the card, keys) without
/// activating this app or Stella. Never captured.
final class StellaPanel: NSPanel {
  var keyable = false
  override var canBecomeKey: Bool { keyable }
  override var canBecomeMain: Bool { false }

  init(frame: NSRect) {
    super.init(
      contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered,
      defer: false)
    isFloatingPanel = true
    level = .screenSaver
    hidesOnDeactivate = false
    isReleasedWhenClosed = false
    backgroundColor = .clear
    isOpaque = false
    hasShadow = false
    sharingType = .none
    collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
  }
}

/// Swallows every click (the catch layer) or reports it (a hit area).
final class ClickView: NSView {
  var onClick: (() -> Void)?
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override func mouseDown(with event: NSEvent) { onClick?() }
  override func rightMouseDown(with event: NSEvent) {}
  override func otherMouseDown(with event: NSEvent) {}
  override func mouseDragged(with event: NSEvent) {}
  override func mouseUp(with event: NSEvent) {}
}

/// Nearly invisible: a fully clear window lets clicks through.
func clickPanel(_ frame: NSRect, onClick: (() -> Void)?) -> StellaPanel {
  let panel = StellaPanel(frame: frame)
  panel.backgroundColor = NSColor(white: 0, alpha: 0.01)
  let view = ClickView(frame: NSRect(origin: .zero, size: frame.size))
  view.onClick = onClick
  view.autoresizingMask = [.width, .height]
  panel.contentView = view
  return panel
}

var catchPanel: StellaPanel?
var hitPanels: [String: StellaPanel] = [:]

var armedFrame: NSRect?
var watcher: Timer?
var catching = false

/// Armed area in Quartz (top-left origin) coordinates, for the event tap.
var armedQuartz: CGRect?
var tap: CFMachPort?

/// Drops ⇧-clicks and ⇧-drags inside the armed area before any app sees
/// them. Stella's own listener (earlier in the chain) has already recorded
/// them as pins and ink. Needs Accessibility, which ink needs anyway.
func startTap() -> Bool {
  if tap != nil { return true }
  let types: [CGEventType] = [
    .leftMouseDown, .leftMouseUp, .leftMouseDragged, .rightMouseDown, .rightMouseUp,
    .rightMouseDragged, .otherMouseDown, .otherMouseUp, .otherMouseDragged,
  ]
  let mask = types.reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << $1.rawValue) }
  guard
    let port = CGEvent.tapCreate(
      tap: .cgSessionEventTap, place: .tailAppendEventTap, options: .defaultTap,
      eventsOfInterest: mask,
      callback: { _, type, event, _ in
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
          if let tap = tap { CGEvent.tapEnable(tap: tap, enable: true) }
          return Unmanaged.passUnretained(event)
        }
        guard let area = armedQuartz else { return Unmanaged.passUnretained(event) }
        let flags = event.flags.intersection([.maskShift, .maskCommand, .maskAlternate, .maskControl])
        if flags == .maskShift && area.contains(event.location) { return nil }
        return Unmanaged.passUnretained(event)
      }, userInfo: nil)
  else { return false }
  tap = port
  let source = CFMachPortCreateRunLoopSource(nil, port, 0)
  CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
  CGEvent.tapEnable(tap: port, enable: true)
  return true
}

/// While armed, ⇧-clicks inside the area never reach the app below: an
/// event tap drops them, or (without one) a catch layer goes up while ⇧ is held.
func setArmed(_ rect: [String: Any]?) {
  armedFrame = rect.flatMap(appKitRect)
  armedQuartz = rect.flatMap { r -> CGRect? in
    guard let x = (r["x"] as? NSNumber)?.doubleValue, let y = (r["y"] as? NSNumber)?.doubleValue,
      let w = (r["width"] as? NSNumber)?.doubleValue, let h = (r["height"] as? NSNumber)?.doubleValue
    else { return nil }
    return CGRect(x: x, y: y, width: w, height: h)
  }
  watcher?.invalidate()
  watcher = nil
  setCatching(false)
  guard let frame = armedFrame else { return }
  if startTap() { return }
  if catchPanel == nil { catchPanel = clickPanel(frame, onClick: nil) }
  catchPanel?.setFrame(frame, display: false)
  let timer = Timer(timeInterval: 0.008, repeats: true) { _ in
    let flags = NSEvent.modifierFlags.intersection([.shift, .command, .option, .control])
    setCatching(flags == .shift)
  }
  RunLoop.main.add(timer, forMode: .common)
  watcher = timer
}

func setCatching(_ on: Bool) {
  if on == catching { return }
  catching = on
  if on { catchPanel?.orderFrontRegardless() } else { catchPanel?.orderOut(nil) }
}

func setHit(_ id: String, _ rect: [String: Any]?) {
  guard let rect = rect, let frame = appKitRect(rect) else {
    hitPanels[id]?.orderOut(nil)
    hitPanels[id] = nil
    return
  }
  let panel = hitPanels[id] ?? clickPanel(frame, onClick: { emit(["event": "hit", "id": id]) })
  hitPanels[id] = panel
  panel.setFrame(frame, display: false)
  panel.level = NSWindow.Level(rawValue: NSWindow.Level.screenSaver.rawValue + 1)
  panel.orderFrontRegardless()
}

// MARK: - Finish card

let ink = NSColor(srgbRed: 0xf4 / 255, green: 0xf2 / 255, blue: 0xec / 255, alpha: 1)
let muted = NSColor(srgbRed: 0xa9 / 255, green: 0xa7 / 255, blue: 0xa0 / 255, alpha: 1)
let surface = NSColor(srgbRed: 22 / 255, green: 22 / 255, blue: 26 / 255, alpha: 0.96)
let dark = NSColor(srgbRed: 0x16 / 255, green: 0x16 / 255, blue: 0x1a / 255, alpha: 1)

func uiFont(_ size: CGFloat, _ weight: NSFont.Weight) -> NSFont { .systemFont(ofSize: size, weight: weight) }

/// The contact sheet, filling its box from the top-left like `object-fit: cover`.
/// The record glyph shown with Record screen everywhere: a ring around a filled dot.
final class RecordGlyph: NSView {
  override var intrinsicContentSize: NSSize { NSSize(width: 13, height: 13) }
  override func draw(_ dirtyRect: NSRect) {
    let red = NSColor(srgbRed: 0.898, green: 0.216, blue: 0.169, alpha: 1)
    red.set()
    let ring = NSBezierPath(ovalIn: bounds.insetBy(dx: 1.4, dy: 1.4))
    ring.lineWidth = 1.2
    ring.stroke()
    let dot = bounds.width * 0.36
    NSBezierPath(ovalIn: NSRect(
      x: bounds.midX - dot / 2, y: bounds.midY - dot / 2, width: dot, height: dot)).fill()
  }
}

final class ThumbView: NSView {
  var image: NSImage? { didSet { needsDisplay = true } }
  override var isFlipped: Bool { true }
  override func draw(_ dirtyRect: NSRect) {
    NSColor(white: 1, alpha: 0.06).setFill()
    bounds.fill()
    guard let image = image, image.size.width > 0, image.size.height > 0 else { return }
    let scale = max(bounds.width / image.size.width, bounds.height / image.size.height)
    let size = NSSize(width: image.size.width * scale, height: image.size.height * scale)
    image.draw(
      in: NSRect(origin: .zero, size: size), from: .zero, operation: .sourceOver, fraction: 1,
      respectFlipped: true, hints: [.interpolation: NSImageInterpolation.high])
  }
}

/// A flat button drawn to match the recording bar.
final class FlatButton: NSButton {
  enum Style { case primary, outline, icon }
  let style: Style
  var hovering = false { didSet { refresh() } }

  init(title: String, style: Style, target: AnyObject, action: Selector) {
    self.style = style
    super.init(frame: .zero)
    self.target = target
    self.action = action
    isBordered = false
    wantsLayer = true
    layer?.cornerRadius = style == .icon ? 6 : 8
    setButtonType(.momentaryChange)
    if style == .icon {
      image = NSImage(systemSymbolName: "xmark", accessibilityDescription: title)?
        .withSymbolConfiguration(.init(pointSize: 11, weight: .semibold))
      imagePosition = .imageOnly
      toolTip = title
      setAccessibilityLabel(title)
    }
    self.title = style == .icon ? "" : title
    refresh()
    addTrackingArea(
      NSTrackingArea(
        rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
  }
  required init?(coder: NSCoder) { fatalError() }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override func mouseEntered(with event: NSEvent) { hovering = true }
  override func mouseExited(with event: NSEvent) { hovering = false }

  func refresh() {
    let color: NSColor
    switch style {
    case .primary:
      layer?.backgroundColor = (isEnabled ? (hovering ? NSColor.white : ink) : ink.withAlphaComponent(0.4)).cgColor
      color = dark
    case .outline:
      layer?.backgroundColor = NSColor(white: 1, alpha: hovering ? 0.06 : 0).cgColor
      layer?.borderWidth = 1
      layer?.borderColor = NSColor(white: 1, alpha: 0.14).cgColor
      color = ink
    case .icon:
      layer?.backgroundColor = NSColor(white: 1, alpha: hovering ? 0.08 : 0).cgColor
      contentTintColor = hovering ? ink : muted
      return
    }
    attributedTitle = NSAttributedString(
      string: title, attributes: [.foregroundColor: color, .font: uiFont(12.5, .semibold)])
  }
  override var isEnabled: Bool { didSet { refresh() } }
  override var intrinsicContentSize: NSSize {
    if style == .icon { return NSSize(width: 24, height: 24) }
    let width = attributedTitle.size().width
    return NSSize(width: ceil(width) + 24, height: 28)
  }
}

final class NoteField: NSTextField {
  var onFocus: ((Bool) -> Void)?
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override func becomeFirstResponder() -> Bool {
    let ok = super.becomeFirstResponder()
    if ok { onFocus?(true) }
    return ok
  }
}

final class Card: NSObject, NSTextFieldDelegate {
  static let width: CGFloat = 360
  let panel = StellaPanel(frame: NSRect(x: 0, y: 0, width: Card.width, height: 150))
  let thumb = ThumbView()
  let glyph = RecordGlyph()
  let title = NSTextField(labelWithString: "")
  let status = NSTextField(labelWithString: "")
  let note = NoteField()
  let noteBox = NSView()
  var send: FlatButton!
  var open: FlatButton!
  var discard: FlatButton!
  var hovered = false
  var focused = false
  var lastEngaged = false
  var lastTyping = false
  var imagePath: String?
  var answered = false

  override init() {
    super.init()
    panel.keyable = true
    panel.becomesKeyOnlyIfNeeded = true
    for name in [NSWindow.didBecomeKeyNotification, NSWindow.didResignKeyNotification] {
      NotificationCenter.default.addObserver(forName: name, object: panel, queue: .main) { [weak self] _ in
        self?.reportEngaged()
      }
    }
    // Shown after the recording has ended, so it can appear in screenshots.
    panel.sharingType = .readOnly
    panel.hasShadow = true
    send = FlatButton(title: "Send", style: .primary, target: self, action: #selector(sendClicked))
    open = FlatButton(title: "Open", style: .outline, target: self, action: #selector(openClicked))
    discard = FlatButton(title: "Discard", style: .icon, target: self, action: #selector(discardClicked))

    let root = HoverView()
    root.onHover = { [weak self] on in
      self?.hovered = on
      self?.reportEngaged()
    }
    root.wantsLayer = true
    root.layer?.backgroundColor = surface.cgColor
    root.layer?.cornerRadius = 12
    root.layer?.borderWidth = 1
    root.layer?.borderColor = NSColor(white: 1, alpha: 0.06).cgColor
    panel.contentView = root

    thumb.wantsLayer = true
    thumb.layer?.cornerRadius = 6
    thumb.layer?.masksToBounds = true
    title.font = uiFont(12.5, .semibold)
    title.textColor = ink
    title.lineBreakMode = .byTruncatingTail
    status.font = uiFont(12.5, .medium)
    status.textColor = muted
    status.lineBreakMode = .byTruncatingTail

    noteBox.wantsLayer = true
    noteBox.layer?.cornerRadius = 8
    noteBox.layer?.borderWidth = 1
    noteBox.layer?.borderColor = NSColor(white: 1, alpha: 0.12).cgColor
    noteBox.layer?.backgroundColor = NSColor(white: 1, alpha: 0.04).cgColor
    note.isBordered = false
    note.drawsBackground = false
    note.focusRingType = .none
    note.font = uiFont(12.5, .medium)
    note.textColor = ink
    note.cell?.usesSingleLineMode = true
    note.cell?.isScrollable = true
    note.delegate = self
    note.target = self
    note.action = #selector(sendClicked)
    note.onFocus = { [weak self] on in
      self?.focused = on
      self?.noteBox.layer?.borderColor = NSColor(white: 1, alpha: on ? 0.28 : 0.12).cgColor
      self?.reportEngaged()
    }

    for view in [thumb, glyph, title, status, discard!, noteBox, note, open!, send!] as [NSView] {
      view.translatesAutoresizingMaskIntoConstraints = false
      if view === note { noteBox.addSubview(view) } else { root.addSubview(view) }
    }
    NSLayoutConstraint.activate([
      thumb.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 10),
      thumb.topAnchor.constraint(equalTo: root.topAnchor, constant: 10),
      thumb.widthAnchor.constraint(equalToConstant: 88),
      thumb.heightAnchor.constraint(equalToConstant: 56),
      discard.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -10),
      discard.topAnchor.constraint(equalTo: root.topAnchor, constant: 10),
      glyph.leadingAnchor.constraint(equalTo: thumb.trailingAnchor, constant: 10),
      glyph.centerYAnchor.constraint(equalTo: title.centerYAnchor),
      glyph.widthAnchor.constraint(equalToConstant: 13),
      glyph.heightAnchor.constraint(equalToConstant: 13),
      title.leadingAnchor.constraint(equalTo: glyph.trailingAnchor, constant: 6),
      title.trailingAnchor.constraint(lessThanOrEqualTo: discard.leadingAnchor, constant: -8),
      title.bottomAnchor.constraint(equalTo: thumb.centerYAnchor, constant: -1),
      status.leadingAnchor.constraint(equalTo: glyph.leadingAnchor),
      status.trailingAnchor.constraint(lessThanOrEqualTo: discard.leadingAnchor, constant: -8),
      status.topAnchor.constraint(equalTo: thumb.centerYAnchor, constant: 2),
      noteBox.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 10),
      noteBox.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -10),
      noteBox.topAnchor.constraint(equalTo: thumb.bottomAnchor, constant: 10),
      noteBox.heightAnchor.constraint(equalToConstant: 32),
      note.leadingAnchor.constraint(equalTo: noteBox.leadingAnchor, constant: 10),
      note.trailingAnchor.constraint(equalTo: noteBox.trailingAnchor, constant: -10),
      note.centerYAnchor.constraint(equalTo: noteBox.centerYAnchor),
      send.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -10),
      send.topAnchor.constraint(equalTo: noteBox.bottomAnchor, constant: 10),
      open.trailingAnchor.constraint(equalTo: send.leadingAnchor, constant: -6),
      open.centerYAnchor.constraint(equalTo: send.centerYAnchor),
    ])
  }

  func reportEngaged() {
    // The window hands the note field focus by itself when it first shows;
    // only focus in a card the user made key (by clicking it) counts.
    let typing = (focused && panel.isKeyWindow)
      || !note.stringValue.trimmingCharacters(in: .whitespaces).isEmpty
    let engaged = hovered || typing
    if engaged == lastEngaged && typing == lastTyping { return }
    lastEngaged = engaged
    lastTyping = typing
    emit(["event": "engaged", "on": engaged, "typing": typing])
  }

  func controlTextDidChange(_ obj: Notification) { reportEngaged() }
  func controlTextDidEndEditing(_ obj: Notification) {
    focused = false
    noteBox.layer?.borderColor = NSColor(white: 1, alpha: 0.12).cgColor
    reportEngaged()
  }

  func show(_ card: [String: Any]) {
    let strings = card["strings"] as? [String: String] ?? [:]
    title.stringValue = card["title"] as? String ?? ""
    let statusText = card["status"] as? String
    status.stringValue = statusText ?? ""
    status.isHidden = statusText == nil
    note.placeholderAttributedString = NSAttributedString(
      string: strings["note"] ?? "",
      attributes: [
        .foregroundColor: NSColor(srgbRed: 0x7d / 255, green: 0x7b / 255, blue: 0x75 / 255, alpha: 1),
        .font: uiFont(12.5, .medium),
      ])
    send.title = (strings["send"] ?? "Send") + "  ↑"
    open.title = strings["open"] ?? "Open"
    discard.toolTip = strings["discard"]
    discard.setAccessibilityLabel(strings["discard"])
    send.isEnabled = card["sendEnabled"] as? Bool ?? true
    send.refresh()
    open.refresh()
    send.invalidateIntrinsicContentSize()
    open.invalidateIntrinsicContentSize()
    if let path = card["image"] as? String, path != imagePath {
      imagePath = path
      thumb.image = NSImage(contentsOfFile: path)
    }
    let height: CGFloat = 10 + 56 + 10 + 32 + 10 + 28 + 10
    let centerX = (card["x"] as? NSNumber)?.doubleValue ?? 0
    let top = (card["y"] as? NSNumber)?.doubleValue ?? 0
    if let frame = appKitRect([
      "x": centerX - Card.width / 2, "y": top, "width": Card.width, "height": height,
    ]) {
      let wasVisible = panel.isVisible
      panel.setFrame(frame, display: true)
      if !wasVisible {
        answered = false
        note.stringValue = ""
        panel.alphaValue = 0
        panel.orderFrontRegardless()
        panel.makeFirstResponder(nil)
        focused = false
        NSAnimationContext.runAnimationGroup { context in
          context.duration = 0.18
          panel.animator().alphaValue = 1
        }
      }
    }
  }

  func hide() {
    panel.orderOut(nil)
    hovered = false
    focused = false
    lastEngaged = false
    lastTyping = false
  }

  func answer(_ action: String) {
    if answered { return }
    answered = true
    emit(["event": "card", "action": action, "note": note.stringValue])
    hide()
  }

  @objc func sendClicked() { if send.isEnabled { answer("send") } }
  @objc func openClicked() { answer("open") }
  @objc func discardClicked() { answer("discard") }
}

final class HoverView: NSView {
  var onHover: ((Bool) -> Void)?
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    trackingAreas.forEach(removeTrackingArea)
    addTrackingArea(
      NSTrackingArea(
        rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
  }
  override func mouseEntered(with event: NSEvent) { onHover?(true) }
  override func mouseExited(with event: NSEvent) { onHover?(false) }
}

// MARK: - Input

var card: Card?

func process(_ line: String) {
  guard let data = line.data(using: .utf8),
    let message = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
    let cmd = message["cmd"] as? String
  else { return }
  switch cmd {
  case "arm":
    setArmed(message["rect"] as? [String: Any])
  case "hit":
    if let id = message["id"] as? String { setHit(id, message["rect"] as? [String: Any]) }
  case "card":
    if card == nil { card = Card() }
    if let body = message["card"] as? [String: Any] { card?.show(body) }
  case "hideCard":
    card?.hide()
  case "quit":
    exit(0)
  default:
    break
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

var buffer = Data()
FileHandle.standardInput.readabilityHandler = { handle in
  let chunk = handle.availableData
  if chunk.isEmpty {
    // Stella went away.
    DispatchQueue.main.async { exit(0) }
    return
  }
  buffer.append(chunk)
  while let newline = buffer.firstIndex(of: 0x0A) {
    let lineData = buffer.subdata(in: buffer.startIndex..<newline)
    buffer.removeSubrange(buffer.startIndex...newline)
    if let line = String(data: lineData, encoding: .utf8) {
      DispatchQueue.main.async { process(line) }
    }
  }
}

emit(["event": "ready"])
app.run()
