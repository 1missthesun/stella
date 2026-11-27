import StoreKit

/// The App Store storefront (StoreKit 2), as the RN app's `stella-storefront` module reads it:
/// paid plans are offered through Stripe checkout only where the App Store allows that (the US
/// storefront), so the billing screen asks `storefront.country`, and `phone.storefront` events
/// follow the person switching App Store accounts.
final class Store {
  static let shared = Store()
  private var updates: Task<Void, Never>?

  func start() {
    guard updates == nil else { return }
    updates = Task {
      AppLog.shared.write("info", "[store] App Store storefront: \(await Storefront.current?.countryCode ?? "none")")
      for await s in Storefront.updates {
        PhoneRequests.event("storefront", ["countryCode": s.countryCode])
      }
    }
  }

  func handle(_ m: [String: Any]) -> Bool {
    guard m["cmd"] as? String == "storefront.country" else { return false }
    Task {
      let code = await Storefront.current?.countryCode
      PhoneRequests.reply(m, ["countryCode": code.map { $0 as Any } ?? NSNull()])
    }
    return true
  }
}
