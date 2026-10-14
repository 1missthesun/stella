import ExpoModulesCore
import StoreKit

// Surfaces the device's current App Store storefront country code to
// JavaScript. This is Apple's own determination of which App Store the
// signed-in Apple Account belongs to (StoreKit `Storefront`), which is the
// App-Review-defensible signal Apple and Stripe direct apps to use for
// region-gated external purchase behavior. It is deliberately NOT device
// locale, Apple ID region guesses, or IP geolocation.
public final class StellaStorefrontModule: Module {
  private var storefrontObserver: Task<Void, Never>?

  public func definition() -> ModuleDefinition {
    Name("StellaStorefront")

    Events("onStorefrontChange")

    AsyncFunction("getStorefrontCountryCode") { () async -> String? in
      if #available(iOS 15.0, *) {
        let storefront = await Storefront.current
        return storefront?.countryCode
      }
      return SKPaymentQueue.default().storefront?.countryCode
    }

    OnStartObserving {
      guard #available(iOS 15.0, *) else { return }
      self.storefrontObserver?.cancel()
      self.storefrontObserver = Task { [weak self] in
        for await storefront in Storefront.updates {
          self?.sendEvent("onStorefrontChange", [
            "countryCode": storefront.countryCode
          ])
        }
      }
    }

    OnStopObserving {
      self.storefrontObserver?.cancel()
      self.storefrontObserver = nil
    }
  }
}
