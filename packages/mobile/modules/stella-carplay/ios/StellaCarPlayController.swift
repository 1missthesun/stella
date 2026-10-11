import CarPlay
import UIKit

struct CarHomeRow {
  let id: String
  let title: String
  let detail: String?
  let icon: String?
  let playing: Bool
  let enabled: Bool
}

struct CarHomeSection {
  let header: String?
  let rows: [CarHomeRow]
}

final class StellaCarPlayConnectionState: @unchecked Sendable {
  static let shared = StellaCarPlayConnectionState()

  private let lock = NSLock()
  private var connected = false

  var isConnected: Bool {
    lock.lock()
    defer { lock.unlock() }
    return connected
  }

  func set(connected next: Bool) {
    lock.lock()
    connected = next
    lock.unlock()
  }
}

@MainActor
final class StellaCarPlayController: NSObject, CPInterfaceControllerDelegate {
  static let shared = StellaCarPlayController()

  nonisolated static let listeningState = "listening"

  nonisolated static var supportsVoiceControl: Bool {
    let category = Bundle.main.object(forInfoDictionaryKey: "StellaCarPlayCategory") as? String
    if category == "voice" {
      if #available(iOS 26.4, *) { return true }
      return false
    }
    if #available(iOS 27.0, *) { return true }
    return false
  }

  var emit: ((String, [String: Any]) -> Void)?
  var jsObserving = false

  private var interfaceController: CPInterfaceController?
  private var listTemplate: CPListTemplate?
  private var renderedItems: [(id: String, enabled: Bool, icon: String?, item: CPListItem)] = []
  private var renderedHeaders: [String?] = []
  private var voiceTemplate: CPVoiceControlTemplate?
  private var dismissingVoice = false
  private var desiredVoiceState: String?
  private var startingRowId: String?
  private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
  private var sections: [CarHomeSection] = [
    CarHomeSection(header: nil, rows: [
      CarHomeRow(id: "talk", title: "Talk to Stella", detail: "Starting…", icon: "mic", playing: false, enabled: true)
    ])
  ]

  private let accent = UIColor(red: 52 / 255, green: 199 / 255, blue: 89 / 255, alpha: 1)

  nonisolated static var connectedNow: Bool {
    StellaCarPlayConnectionState.shared.isConnected
  }

  private func setConnected(_ value: Bool) {
    StellaCarPlayConnectionState.shared.set(connected: value)
    StellaTimerKeeper.shared.update(
      carPlayConnected: value,
      phoneForeground: StellaPhoneSceneState.shared.isForeground
    )
  }

  func connect(_ controller: CPInterfaceController) {
    interfaceController = controller
    controller.delegate = self
    let template = CPListTemplate(title: "Stella", sections: buildSections())
    listTemplate = template
    controller.setRootTemplate(template, animated: false, completion: nil)
    setConnected(true)
    emit?("onConnectionChange", ["connected": true])
    if desiredVoiceState != nil {
      applyVoiceState()
    }
  }

  func disconnect() {
    interfaceController?.delegate = nil
    interfaceController = nil
    listTemplate = nil
    renderedItems = []
    renderedHeaders = []
    voiceTemplate = nil
    desiredVoiceState = nil
    startingRowId = nil
    setConnected(false)
    holdBackground(false)
    emit?("onConnectionChange", ["connected": false])
  }

  func setHome(_ next: [CarHomeSection]) {
    sections = next
    startingRowId = nil
    render()
  }

  private func render() {
    guard let template = listTemplate else { return }
    let rows = sections.flatMap { $0.rows }
    let sameShape =
      sections.map { $0.header } == renderedHeaders &&
      rows.count == renderedItems.count &&
      zip(rows, renderedItems).allSatisfy { pair in
        pair.0.id == pair.1.id && pair.0.enabled == pair.1.enabled
      }
    guard sameShape else {
      template.updateSections(buildSections())
      return
    }
    for (index, row) in rows.enumerated() {
      let item = renderedItems[index].item
      let detail = row.id == startingRowId ? "Starting Stella…" : row.detail
      if item.text != row.title { item.setText(row.title) }
      if item.detailText != detail { item.setDetailText(detail) }
      if renderedItems[index].icon != row.icon {
        item.setImage(row.icon.flatMap { symbol($0) })
        renderedItems[index].icon = row.icon
      }
      if item.isPlaying != row.playing { item.isPlaying = row.playing }
    }
  }

  func setVoiceState(_ state: String?) {
    desiredVoiceState = state
    applyVoiceState()
  }

  func holdBackground(_ hold: Bool) {
    if hold {
      guard backgroundTask == .invalid else { return }
      backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "stella-carplay-voice") { [weak self] in
        MainActor.assumeIsolated {
          self?.holdBackground(false)
        }
      }
    } else if backgroundTask != .invalid {
      UIApplication.shared.endBackgroundTask(backgroundTask)
      backgroundTask = .invalid
    }
  }

  private func select(_ rowId: String) {
    guard jsObserving, emit != nil else {
      startingRowId = rowId
      render()
      return
    }
    emit?("onRowSelect", ["id": rowId])
  }

  private func symbol(_ name: String) -> UIImage? {
    let systemName: String
    switch name {
    case "mic": systemName = "mic.fill"
    case "waveform": systemName = "waveform"
    case "thinking": systemName = "ellipsis.circle.fill"
    case "speaker": systemName = "speaker.wave.2.fill"
    case "replay": systemName = "play.circle.fill"
    case "person": systemName = "person.crop.circle"
    default: systemName = name
    }
    return UIImage(systemName: systemName)?.withTintColor(accent, renderingMode: .alwaysOriginal)
  }

  private func buildSections() -> [CPListSection] {
    renderedItems = []
    renderedHeaders = sections.map { $0.header }
    return sections.map { section in
      let items: [CPListItem] = section.rows.map { row in
        let detail = row.id == startingRowId ? "Starting Stella…" : row.detail
        let item = CPListItem(text: row.title, detailText: detail, image: row.icon.flatMap { symbol($0) })
        item.isEnabled = row.enabled
        item.playingIndicatorLocation = .trailing
        item.isPlaying = row.playing
        if row.enabled {
          let rowId = row.id
          item.handler = { [weak self] _, completion in
            self?.select(rowId)
            completion()
          }
        }
        renderedItems.append((id: row.id, enabled: row.enabled, icon: row.icon, item: item))
        return item
      }
      return CPListSection(items: items, header: section.header, sectionIndexTitle: nil)
    }
  }

  private func applyVoiceState() {
    guard let controller = interfaceController else { return }
    guard let state = desiredVoiceState, StellaCarPlayController.supportsVoiceControl else {
      dismissVoice()
      return
    }
    if let template = voiceTemplate {
      template.activateVoiceControlState(withIdentifier: state)
      return
    }
    let template = makeVoiceTemplate()
    template.activateVoiceControlState(withIdentifier: state)
    voiceTemplate = template
    controller.presentTemplate(template, animated: true) { [weak self] presented, _ in
      guard let self, !presented, self.voiceTemplate === template else { return }
      self.voiceTemplate = nil
    }
  }

  private func dismissVoice() {
    guard let controller = interfaceController, voiceTemplate != nil else { return }
    voiceTemplate = nil
    dismissingVoice = true
    controller.dismissTemplate(animated: true) { [weak self] _, _ in
      self?.dismissingVoice = false
    }
  }

  private func makeVoiceTemplate() -> CPVoiceControlTemplate {
    let listening = CPVoiceControlState(
      identifier: StellaCarPlayController.listeningState,
      titleVariants: ["Listening… tap Send when you're done", "Listening…"],
      image: symbol("waveform"),
      repeats: true
    )
    let send = CPButton(image: symbol("paperplane.fill") ?? UIImage()) { [weak self] _ in
      self?.emit?("onVoiceControlAction", ["action": "send"])
    }
    send.title = "Send"
    let cancel = CPButton(image: UIImage(systemName: "xmark") ?? UIImage()) { [weak self] _ in
      self?.emit?("onVoiceControlAction", ["action": "cancel"])
    }
    cancel.title = "Cancel"
    if listening.responds(to: NSSelectorFromString("setActionButtons:")) {
      listening.setValue([send, cancel], forKey: "actionButtons")
    }
    return CPVoiceControlTemplate(voiceControlStates: [listening])
  }

  func templateDidDisappear(_ aTemplate: CPTemplate, animated: Bool) {
    guard !dismissingVoice, let current = voiceTemplate, aTemplate === current else { return }
    voiceTemplate = nil
    guard desiredVoiceState != nil else { return }
    desiredVoiceState = nil
    emit?("onVoiceControlAction", ["action": "dismissed"])
  }
}
