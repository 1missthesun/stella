import ExpoModulesCore
import Security
import UIKit

public class StellaCarPlayModule: Module {
  public func definition() -> ModuleDefinition {
    Name("StellaCarPlay")

    Events("onConnectionChange", "onRowSelect", "onVoiceControlAction")

    OnCreate {
      DispatchQueue.main.async { [weak self] in
        MainActor.assumeIsolated {
          StellaCarPlayController.shared.emit = { name, body in
            self?.sendEvent(name, body)
          }
        }
      }
    }

    OnDestroy {
      DispatchQueue.main.async {
        MainActor.assumeIsolated {
          StellaCarPlayController.shared.emit = nil
          StellaCarPlayController.shared.jsObserving = false
        }
      }
    }

    OnStartObserving("onRowSelect") {
      DispatchQueue.main.async {
        MainActor.assumeIsolated {
          StellaCarPlayController.shared.jsObserving = true
        }
      }
    }

    OnStopObserving("onRowSelect") {
      DispatchQueue.main.async {
        MainActor.assumeIsolated {
          StellaCarPlayController.shared.jsObserving = false
        }
      }
    }

    Function("isConnected") { () -> Bool in
      StellaCarPlayController.connectedNow
    }

    Function("isPhoneForeground") { () -> Bool in
      StellaPhoneSceneState.shared.isForeground
    }

    Function("supportsVoiceControl") { () -> Bool in
      StellaCarPlayController.supportsVoiceControl
    }

    Function("setHome") { (sections: [[String: Any]]) in
      let parsed = sections.map { section in
        CarHomeSection(
          header: section["header"] as? String,
          rows: ((section["rows"] as? [[String: Any]]) ?? []).compactMap { row in
            guard let id = row["id"] as? String, let title = row["title"] as? String else { return nil }
            return CarHomeRow(
              id: id,
              title: title,
              detail: row["detail"] as? String,
              icon: row["icon"] as? String,
              playing: (row["playing"] as? Bool) ?? false,
              enabled: (row["enabled"] as? Bool) ?? true
            )
          }
        )
      }
      DispatchQueue.main.async {
        MainActor.assumeIsolated {
          StellaCarPlayController.shared.setHome(parsed)
        }
      }
    }

    Function("setVoiceControl") { (state: String?) in
      DispatchQueue.main.async {
        MainActor.assumeIsolated {
          StellaCarPlayController.shared.setVoiceState(state)
        }
      }
    }

    Function("setColorScheme") { (scheme: String) in
      let style: UIUserInterfaceStyle
      switch scheme {
      case "light": style = .light
      case "dark": style = .dark
      default: style = .unspecified
      }
      DispatchQueue.main.async {
        MainActor.assumeIsolated {
          StellaWindowAppearance.apply(style)
        }
      }
    }

    Function("setBackgroundActivity") { (hold: Bool) in
      DispatchQueue.main.async {
        MainActor.assumeIsolated {
          StellaCarPlayController.shared.holdBackground(hold)
        }
      }
    }

    AsyncFunction("relaxKeychainAccessibility") { () -> Int in
      var updated = 0
      for service in ["app", "app:no-auth"] {
        let query: [String: Any] = [
          kSecClass as String: kSecClassGenericPassword,
          kSecAttrService as String: service
        ]
        let attributes: [String: Any] = [
          kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock
        ]
        if SecItemUpdate(query as CFDictionary, attributes as CFDictionary) == errSecSuccess {
          updated += 1
        }
      }
      return updated
    }
  }
}
