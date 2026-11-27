import UIKit
import UserNotifications

/// Push notifications: permission, the APNs device token (TS turns it into the Expo push token
/// the backend sends through, as expo-notifications does), the notification categories, and
/// taps on a notification, which go to TS as `phone.push` events. A notification that arrives
/// while the app is in front shows nothing, as in the RN app: the chat is already on screen.
final class Push: NSObject, UNUserNotificationCenterDelegate {
  static let shared = Push()
  private var tokenWaiters: [(Result<String, Error>) -> Void] = []
  private var token: String?
  /// A tap that arrived before TS asked for it (the app launched from a notification).
  private var pending: [[String: Any]] = []

  func setUp() {
    UNUserNotificationCenter.current().delegate = self
  }

  func handle(_ m: [String: Any]) -> Bool {
    switch m["cmd"] as? String {
    case "push.status":
      UNUserNotificationCenter.current().getNotificationSettings { s in
        PhoneRequests.reply(m, ["status": Push.statusName(s.authorizationStatus)])
      }
    case "push.register":
      register(m)
    case "push.categories":
      setCategories(m["categories"] as? [[String: Any]] ?? [])
      PhoneRequests.reply(m, nil)
    case "push.takeLaunch":
      let out = pending
      pending = []
      PhoneRequests.reply(m, out)
    case "push.clear":
      UNUserNotificationCenter.current().removeAllDeliveredNotifications()
      UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
      if #available(iOS 16.0, *) { UNUserNotificationCenter.current().setBadgeCount(0) }
      PhoneRequests.reply(m, nil)
    default:
      return false
    }
    return true
  }

  static func statusName(_ s: UNAuthorizationStatus) -> String {
    switch s {
    case .authorized, .provisional, .ephemeral: return "granted"
    case .denied: return "denied"
    default: return "undetermined"
    }
  }

  /// Asks for permission (once; iOS remembers the answer), then for the APNs token.
  private func register(_ m: [String: Any]) {
    let center = UNUserNotificationCenter.current()
    center.getNotificationSettings { s in
      let ask = s.authorizationStatus == .notDetermined && (m["prompt"] as? Bool) != false
      let proceed: (Bool) -> Void = { granted in
        guard granted else { return PhoneRequests.reply(m, ["status": ask ? "denied" : Push.statusName(s.authorizationStatus)]) }
        self.deviceToken { result in
          switch result {
          case .success(let token):
            PhoneRequests.reply(m, [
              "status": "granted",
              "deviceToken": token,
              "development": Push.apsEnvironment() == "development",
              "appId": Bundle.main.bundleIdentifier ?? "",
              "installationId": Push.installationId(),
            ])
          case .failure(let error):
            PhoneRequests.fail(m, error.localizedDescription, code: "no-token")
          }
        }
      }
      if ask {
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in proceed(granted) }
      } else {
        proceed(Push.statusName(s.authorizationStatus) == "granted")
      }
    }
  }

  private func deviceToken(_ done: @escaping (Result<String, Error>) -> Void) {
    DispatchQueue.main.async {
      if let t = self.token { return done(.success(t)) }
      self.tokenWaiters.append(done)
      if self.tokenWaiters.count == 1 { UIApplication.shared.registerForRemoteNotifications() }
      DispatchQueue.main.asyncAfter(deadline: .now() + 15) {
        guard !self.tokenWaiters.isEmpty else { return }
        self.finishToken(.failure(NSError(domain: "StellaPush", code: 1, userInfo: [NSLocalizedDescriptionKey: "APNs gave no device token."])))
      }
    }
  }

  func didRegister(_ data: Data) {
    let hex = data.map { String(format: "%02x", $0) }.joined()
    token = hex
    finishToken(.success(hex))
  }

  func didFail(_ error: Error) {
    AppLog.shared.write("warn", "push: no APNs token: \(error.localizedDescription)")
    finishToken(.failure(error))
  }

  private func finishToken(_ r: Result<String, Error>) {
    let waiters = tokenWaiters
    tokenWaiters = []
    for w in waiters { w(r) }
  }

  private func setCategories(_ list: [[String: Any]]) {
    var out = Set<UNNotificationCategory>()
    for c in list {
      guard let id = c["id"] as? String else { continue }
      let actions = (c["actions"] as? [[String: Any]] ?? []).compactMap { a -> UNNotificationAction? in
        guard let aid = a["id"] as? String, let title = a["title"] as? String else { return nil }
        var opts: UNNotificationActionOptions = []
        if (a["foreground"] as? Bool) == true { opts.insert(.foreground) }
        if (a["destructive"] as? Bool) == true { opts.insert(.destructive) }
        return UNNotificationAction(identifier: aid, title: title, options: opts)
      }
      out.insert(UNNotificationCategory(identifier: id, actions: actions, intentIdentifiers: [], options: []))
    }
    UNUserNotificationCenter.current().setNotificationCategories(out)
  }

  /// `aps-environment` from the provisioning profile (expo-notifications reads it the same way); development builds without one count as development.
  static func apsEnvironment() -> String {
    if let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
       let data = try? Data(contentsOf: url), let text = String(data: data, encoding: .isoLatin1),
       let key = text.range(of: "<key>aps-environment</key>") {
      let rest = text[key.upperBound...]
      if let a = rest.range(of: "<string>"), let b = rest.range(of: "</string>"), a.upperBound < b.lowerBound {
        return String(rest[a.upperBound..<b.lowerBound])
      }
    }
    #if STELLA_DEV
    return "development"
    #else
    return "production"
    #endif
  }

  /// One id per install, as expo-notifications' `deviceId` (Expo keys its token by it).
  static func installationId() -> String {
    let key = "stella-push-installation-id"
    if let id = UserDefaults.standard.string(forKey: key) { return id }
    let id = UUID().uuidString.lowercased()
    UserDefaults.standard.set(id, forKey: key)
    return id
  }

  // MARK: delegate

  func userNotificationCenter(_ c: UNUserNotificationCenter, willPresent n: UNNotification, withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
    PhoneRequests.event("push", ["kind": "received", "notification": Push.describe(n)])
    done(UIApplication.shared.applicationState == .active ? [] : [.banner, .list, .sound])
  }

  func userNotificationCenter(_ c: UNUserNotificationCenter, didReceive r: UNNotificationResponse, withCompletionHandler done: @escaping () -> Void) {
    var tap: [String: Any] = ["notification": Push.describe(r.notification), "action": r.actionIdentifier == UNNotificationDefaultActionIdentifier ? "default" : r.actionIdentifier]
    if let t = r as? UNTextInputNotificationResponse { tap["text"] = t.userText }
    pending.append(tap)
    if pending.count > 8 { pending.removeFirst() }
    var ev = tap
    ev["kind"] = "response"
    PhoneRequests.event("push", ev)
    done()
  }

  /// The notification as TS reads it: Expo puts a message's `data` under the payload's `body` key.
  static func describe(_ n: UNNotification) -> [String: Any] {
    let content = n.request.content
    var data: Any = NSNull()
    if let body = content.userInfo["body"] as? [String: Any] { data = body }
    else if let d = content.userInfo["data"] as? [String: Any] { data = d }
    return [
      "id": n.request.identifier,
      "title": content.title,
      "body": content.body,
      "category": content.categoryIdentifier,
      "thread": content.threadIdentifier,
      "data": data,
    ]
  }
}
