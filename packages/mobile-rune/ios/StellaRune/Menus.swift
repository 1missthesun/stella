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
    if let sheet = m["sheet"] as? [String: Any] {
      presentSheet(sheet, items, rid)
      return true
    }
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

  /// `sheet` on a `menu.popup`: the items as an action sheet or an alert (UIAlertController), the
  /// way packages/mobile asks with ActionSheetIOS and Alert: a title, a message, the items (one may be
  /// destructive) and a cancel button that answers null.
  private func presentSheet(_ sheet: [String: Any], _ items: [[String: Any]], _ rid: UInt64?) {
    var top = App.shared.window?.rootViewController
    while let next = top?.presentedViewController { top = next }
    guard let top else {
      Pickers.reply(rid, nil)
      return
    }
    let style: UIAlertController.Style = (sheet["alert"] as? Bool) == true ? .alert : .actionSheet
    let title = sheet["title"] as? String
    let message = sheet["message"] as? String
    let alert = UIAlertController(title: title?.isEmpty == false ? title : nil, message: message?.isEmpty == false ? message : nil, preferredStyle: style)
    let destructive = sheet["destructive"] as? String
    for it in items where it["type"] as? String != "separator" && (it["visible"] as? Bool) != false {
      let id = it["id"] as? String
      let action = UIAlertAction(title: it["label"] as? String ?? "", style: id != nil && id == destructive ? .destructive : .default) { _ in Pickers.reply(rid, id) }
      action.isEnabled = (it["enabled"] as? Bool) != false
      alert.addAction(action)
    }
    alert.addAction(UIAlertAction(title: sheet["cancel"] as? String ?? "Cancel", style: .cancel) { _ in Pickers.reply(rid, nil) })
    // An iPhone's sheet rises from the bottom, as ActionSheetIOS's does; only an iPad's needs a point to pop from.
    if UIDevice.current.userInterfaceIdiom == .pad {
      alert.popoverPresentationController?.sourceView = top.view
      alert.popoverPresentationController?.sourceRect = CGRect(x: top.view.bounds.midX, y: top.view.bounds.midY, width: 0, height: 0)
    }
    Haptics.play("light")
    top.present(alert, animated: true)
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
