import ExpoModulesCore
import ExpoNotifications
import UIKit
import UserNotifications

private let deviceIdDefaultsKey = "stella.askReply.deviceId"
private let actionPrefix = "ask."
private let openAction = "ask.open"
private let pushKind = "user_ask"

public class StellaAskNotificationsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("StellaAskNotifications")

    Function("setDeviceId") { (deviceId: String) in
      UserDefaults.standard.set(deviceId, forKey: deviceIdDefaultsKey)
    }
  }
}

public class StellaAskNotificationsAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    StellaAskReplyHandler.shared.install()
    return true
  }
}

final class StellaAskReplyHandler: NSObject, NotificationDelegate {
  static let shared = StellaAskReplyHandler()
  private var installed = false

  func install() {
    guard !installed else { return }
    installed = true
    NotificationCenterManager.shared.addDelegate(self)
  }

  func didReceive(_ response: UNNotificationResponse, completionHandler: @escaping () -> Void) -> Bool {
    let action = response.actionIdentifier
    guard action.hasPrefix(actionPrefix), action != openAction else { return false }
    let content = response.notification.request.content
    guard
      let data = content.userInfo["body"] as? [String: Any],
      data["kind"] as? String == pushKind,
      let askId = data["askId"] as? String,
      let urlString = data["replyUrl"] as? String,
      let url = URL(string: urlString),
      url.scheme == "https",
      let token = data["replyToken"] as? String
    else { return false }
    var body: [String: Any] = ["token": token, "action": action]
    if let text = (response as? UNTextInputNotificationResponse)?.userText,
      !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    {
      body["text"] = text
    }
    if let deviceId = UserDefaults.standard.string(forKey: deviceIdDefaultsKey), !deviceId.isEmpty {
      body["deviceId"] = deviceId
    }
    send(body: body, to: url, askId: askId, data: data)
    return true
  }

  private func send(body: [String: Any], to url: URL, askId: String, data: [String: Any]) {
    var backgroundTask = UIBackgroundTaskIdentifier.invalid
    let finish = {
      if backgroundTask != .invalid {
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
      }
    }
    backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "stella-ask-reply") {
      finish()
    }
    var request = URLRequest(url: url, timeoutInterval: 20)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    request.setValue("application/json", forHTTPHeaderField: "accept")
    request.httpBody = try? JSONSerialization.data(withJSONObject: body)
    URLSession.shared.dataTask(with: request) { payload, response, error in
      let status = (response as? HTTPURLResponse)?.statusCode ?? 0
      let result = payload.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
      if error != nil || !(200..<300).contains(status) {
        self.reportFailure(askId: askId, data: data, alreadyClosed: status == 409, completion: finish)
      } else if result?["accepted"] as? Bool == false {
        self.reportFailure(askId: askId, data: data, alreadyClosed: true, completion: finish)
      } else {
        finish()
      }
    }.resume()
  }

  private func reportFailure(
    askId: String,
    data: [String: Any],
    alreadyClosed: Bool,
    completion: @escaping () -> Void
  ) {
    let content = UNMutableNotificationContent()
    if alreadyClosed {
      content.title = "Already answered"
      content.body = "That question was answered or closed before your reply arrived."
    } else {
      content.title = "Couldn't send your answer"
      content.body = "Open Stella to answer there."
    }
    content.categoryIdentifier = pushKind
    content.threadIdentifier = pushKind
    content.userInfo = [
      "body": [
        "kind": pushKind,
        "askId": askId,
        "conversationId": data["conversationId"] as? String ?? "",
        "level": data["level"] ?? 1,
      ]
    ]
    let request = UNNotificationRequest(
      identifier: "\(pushKind):\(askId):failed",
      content: content,
      trigger: nil
    )
    UNUserNotificationCenter.current().add(request) { _ in completion() }
  }
}
