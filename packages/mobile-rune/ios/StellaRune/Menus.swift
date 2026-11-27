import UIKit

/// The engine's `menu.popup` (a message's long-press menu, and every other context menu the shared
/// UI opens) as iOS's own edit menu, the callout Messages shows over a held bubble, at the press
/// point. The picked item's id, or null when the menu closes without a pick, goes back to TS as
/// the command's reply, as a desktop menu's pick does.
final class Menus: NSObject, UIEditMenuInteractionDelegate {
  static let shared = Menus()
  private var interaction: UIEditMenuInteraction?
  private var host: UIView?
  private var pending: UInt64?
  private var menu: UIMenu?

  func handle(_ m: [String: Any]) -> Bool {
    guard m["cmd"] as? String == "menu.popup" else { return false }
    let rid = (m["rid"] as? NSNumber)?.uint64Value
    // A menu still open is closed unpicked before the next one opens.
    if pending != nil { answer(nil) }
    let items = m["items"] as? [[String: Any]] ?? []
    guard let view = App.shared.rune, !items.isEmpty else {
      Pickers.reply(rid, nil)
      return true
    }
    pending = rid
    picks = []
    menu = UIMenu(children: build(items))
    if interaction == nil || host !== view {
      if let old = interaction { host?.removeInteraction(old) }
      let i = UIEditMenuInteraction(delegate: self)
      view.addInteraction(i)
      interaction = i
      host = view
    }
    let x = (m["x"] as? NSNumber)?.doubleValue ?? Double(view.bounds.midX)
    let y = (m["y"] as? NSNumber)?.doubleValue ?? Double(view.bounds.midY)
    Haptics.play("medium")
    interaction?.presentEditMenu(with: UIEditMenuConfiguration(identifier: nil, sourcePoint: CGPoint(x: x, y: y)))
    return true
  }

  /// The dev driver's `menu?pick=N`: picks the open menu's Nth item (in reading order), as a tap would.
  func debugPick(_ n: Int) {
    func leaves(_ e: [UIMenuElement]) -> [UIAction] { e.flatMap { ($0 as? UIMenu).map { leaves($0.children) } ?? [($0 as? UIAction)].compactMap { $0 } } }
    guard let menu, n >= 0, n < leaves(menu.children).count else { return }
    let ids = picks
    interaction?.dismissMenu()
    answer(n < ids.count ? ids[n] : nil)
  }
  private var picks: [String?] = []

  private func answer(_ id: String?) {
    let rid = pending
    pending = nil
    menu = nil
    Pickers.reply(rid, id)
  }

  /// The Electron-style template (`{id, label, enabled, type, checked, submenu, visible}`); a run
  /// between separators becomes an inline group, a submenu a nested menu.
  private func build(_ items: [[String: Any]]) -> [UIMenuElement] {
    var groups: [[UIMenuElement]] = [[]]
    for it in items {
      if it["type"] as? String == "separator" {
        groups.append([])
        continue
      }
      if (it["visible"] as? Bool) == false { continue }
      let label = it["label"] as? String ?? ""
      if let sub = it["submenu"] as? [[String: Any]] {
        groups[groups.count - 1].append(UIMenu(title: label, children: build(sub)))
        continue
      }
      let id = it["id"] as? String
      picks.append(id)
      let action = UIAction(title: label) { [weak self] _ in self?.answer(id) }
      if (it["enabled"] as? Bool) == false { action.attributes.insert(.disabled) }
      if (it["checked"] as? Bool) == true { action.state = .on }
      groups[groups.count - 1].append(action)
    }
    let runs = groups.filter { !$0.isEmpty }
    if runs.count == 1 { return runs[0] }
    return runs.map { UIMenu(options: .displayInline, children: $0) }
  }

  func editMenuInteraction(_ interaction: UIEditMenuInteraction, menuFor configuration: UIEditMenuConfiguration, suggestedActions: [UIMenuElement]) -> UIMenu? {
    menu
  }

  func editMenuInteraction(_ interaction: UIEditMenuInteraction, willDismissMenuFor configuration: UIEditMenuConfiguration, animator: UIEditMenuInteractionAnimating) {
    // A pick runs its action after the menu starts closing; answer null only if none came.
    animator.addCompletion { [weak self] in
      guard let self, self.pending != nil else { return }
      self.answer(nil)
    }
  }
}
