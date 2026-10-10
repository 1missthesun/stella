import UserNotifications

private let pushKind = "user_ask"
private let categoryPrefix = "user_ask."
private let maxKeptCategories = 24

final class NotificationService: UNNotificationServiceExtension {
  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var bestAttempt: UNMutableNotificationContent?
  private var delivered = false

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    self.contentHandler = contentHandler
    guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
      contentHandler(request.content)
      return
    }
    bestAttempt = content
    guard
      let data = content.userInfo["body"] as? [String: Any],
      data["kind"] as? String == pushKind,
      let askId = data["askId"] as? String,
      let rawActions = data["actions"] as? [[String: Any]]
    else {
      deliver(content)
      return
    }
    let actions = rawActions.compactMap(Self.action(from:))
    guard !actions.isEmpty else {
      deliver(content)
      return
    }
    let identifier = categoryPrefix + askId
    let category = UNNotificationCategory(
      identifier: identifier,
      actions: actions,
      intentIdentifiers: [],
      options: []
    )
    let center = UNUserNotificationCenter.current()
    center.getNotificationCategories { existing in
      var kept = existing.filter { $0.identifier != identifier }
      let dynamic = kept.filter { $0.identifier.hasPrefix(categoryPrefix) }
      if dynamic.count >= maxKeptCategories {
        let stale = Set(dynamic.map(\.identifier).sorted().prefix(dynamic.count - maxKeptCategories + 1))
        kept = kept.filter { !stale.contains($0.identifier) }
      }
      kept.insert(category)
      center.setNotificationCategories(kept)
      center.getNotificationCategories { _ in
        content.categoryIdentifier = identifier
        self.deliver(content)
      }
    }
  }

  override func serviceExtensionTimeWillExpire() {
    if let content = bestAttempt { deliver(content) }
  }

  private func deliver(_ content: UNNotificationContent) {
    guard !delivered, let handler = contentHandler else { return }
    delivered = true
    handler(content)
  }

  private static func action(from raw: [String: Any]) -> UNNotificationAction? {
    guard
      let id = raw["id"] as? String, id.hasPrefix("ask."),
      let title = raw["title"] as? String, !title.isEmpty
    else { return nil }
    var options: UNNotificationActionOptions = [.authenticationRequired]
    if raw["foreground"] as? Bool == true { options.insert(.foreground) }
    if let input = raw["input"] as? [String: Any] {
      return UNTextInputNotificationAction(
        identifier: id,
        title: title,
        options: options,
        textInputButtonTitle: input["submit"] as? String ?? "Send",
        textInputPlaceholder: input["placeholder"] as? String ?? ""
      )
    }
    return UNNotificationAction(identifier: id, title: title, options: options)
  }
}
