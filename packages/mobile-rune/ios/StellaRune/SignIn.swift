import AuthenticationServices
import UIKit

/// Account sign-in the system way: `auth.webSession` runs a provider's web sign-in in
/// ASWebAuthenticationSession and answers with the URL it ends on (the app's callback, which
/// carries the one-time token); `auth.apple` is Sign in with Apple's own sheet, answering with
/// the identity token the backend verifies. A person closing either answers `code: "canceled"`.
final class SignIn: NSObject, ASWebAuthenticationPresentationContextProviding, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
  static let shared = SignIn()
  private var web: ASWebAuthenticationSession?
  private var apple: (request: [String: Any], controller: ASAuthorizationController)?

  func handle(_ m: [String: Any]) -> Bool {
    switch m["cmd"] as? String {
    case "auth.webSession": webSession(m)
    case "auth.apple": appleSignIn(m)
    case "auth.cancel":
      web?.cancel()
      web = nil
      PhoneRequests.reply(m, nil)
    default: return false
    }
    return true
  }

  private var anchor: ASPresentationAnchor { App.shared.window ?? UIWindow() }
  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { anchor }
  func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor { anchor }

  private func webSession(_ m: [String: Any]) {
    guard let s = m["url"] as? String, let url = URL(string: s), let scheme = m["callbackScheme"] as? String, !scheme.isEmpty else {
      return PhoneRequests.fail(m, "auth.webSession needs a url and a callbackScheme")
    }
    web?.cancel()
    open(m, url: url, scheme: scheme, attempt: 0)
  }

  /// A system sheet that is still going away (Sign in with Apple's, when this is its web
  /// fallback) keeps a new one from presenting (`presentationContextInvalid`): try again a few
  /// times while it goes.
  private func open(_ m: [String: Any], url: URL, scheme: String, attempt: Int) {
    var session: ASWebAuthenticationSession!
    let done: (URL?, Error?) -> Void = { [weak self] callback, error in
      DispatchQueue.main.async {
        // Replaced or cancelled (`auth.cancel`, a newer sign-in): it ends as cancelled.
        guard let self, self.web === session else { return PhoneRequests.fail(m, "canceled", code: "canceled") }
        self.web = nil
        if let callback { return PhoneRequests.reply(m, ["url": callback.absoluteString]) }
        let e = error as NSError?
        let web = e?.domain == ASWebAuthenticationSessionErrorDomain
        if web, e?.code == ASWebAuthenticationSessionError.canceledLogin.rawValue {
          return PhoneRequests.fail(m, "canceled", code: "canceled")
        }
        if web, e?.code == ASWebAuthenticationSessionError.presentationContextInvalid.rawValue, attempt < 6 {
          return DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self.open(m, url: url, scheme: scheme, attempt: attempt + 1) }
        }
        AppLog.shared.write("warn", "web sign-in: \(e?.domain ?? "-") \(e?.code ?? 0) \(e?.localizedDescription ?? "")")
        PhoneRequests.fail(m, "Sign-in couldn't open.", code: "failed")
      }
    }
    if #available(iOS 17.4, *) {
      session = ASWebAuthenticationSession(url: url, callback: .customScheme(scheme), completionHandler: done)
    } else {
      session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme, completionHandler: done)
    }
    session.presentationContextProvider = self
    session.prefersEphemeralWebBrowserSession = (m["ephemeral"] as? Bool) ?? false
    web = session
    if session.start() { return }
    web = nil
    if attempt < 6 {
      return DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in self?.open(m, url: url, scheme: scheme, attempt: attempt + 1) }
    }
    AppLog.shared.write("warn", "web sign-in: the session didn't start")
    PhoneRequests.fail(m, "Sign-in couldn't open.", code: "failed")
  }

  private func appleSignIn(_ m: [String: Any]) {
    let request = ASAuthorizationAppleIDProvider().createRequest()
    request.requestedScopes = [.fullName, .email]
    if let nonce = m["nonce"] as? String { request.nonce = nonce }
    let controller = ASAuthorizationController(authorizationRequests: [request])
    controller.delegate = self
    controller.presentationContextProvider = self
    if let pending = apple { PhoneRequests.fail(pending.request, "canceled", code: "canceled") }
    apple = (m, controller)
    controller.performRequests()
  }

  func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
    guard let pending = apple, pending.controller === controller else { return }
    apple = nil
    guard let cred = authorization.credential as? ASAuthorizationAppleIDCredential,
          let tokenData = cred.identityToken, let token = String(data: tokenData, encoding: .utf8) else {
      return PhoneRequests.fail(pending.request, "Apple returned no identity token.", code: "no-token")
    }
    var value: [String: Any] = ["identityToken": token, "user": cred.user]
    if let code = cred.authorizationCode.flatMap({ String(data: $0, encoding: .utf8) }) { value["authorizationCode"] = code }
    if let email = cred.email { value["email"] = email }
    if let n = cred.fullName {
      if let g = n.givenName { value["givenName"] = g }
      if let f = n.familyName { value["familyName"] = f }
    }
    PhoneRequests.reply(pending.request, value)
  }

  func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
    guard let pending = apple, pending.controller === controller else { return }
    apple = nil
    let e = error as NSError
    if e.domain == ASAuthorizationError.errorDomain, e.code == ASAuthorizationError.canceled.rawValue {
      return PhoneRequests.fail(pending.request, "canceled", code: "canceled")
    }
    // `unknown` (1000) is what an app without the Sign in with Apple entitlement, or a device without an Apple Account, gets.
    let code = e.domain == ASAuthorizationError.errorDomain && e.code == ASAuthorizationError.unknown.rawValue ? "unavailable" : "failed"
    AppLog.shared.write("warn", "apple sign-in: \(e.domain) \(e.code) \(e.localizedDescription)")
    PhoneRequests.fail(pending.request, e.localizedDescription, code: code)
  }
}
