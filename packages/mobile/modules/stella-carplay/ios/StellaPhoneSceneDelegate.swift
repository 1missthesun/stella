import UIKit

final class StellaPhoneSceneState: @unchecked Sendable {
  static let shared = StellaPhoneSceneState()

  private let lock = NSLock()
  private var foreground = false

  var isForeground: Bool {
    lock.lock()
    defer { lock.unlock() }
    return foreground
  }

  func set(foreground next: Bool) {
    lock.lock()
    foreground = next
    lock.unlock()
  }
}

@MainActor
enum StellaWindowAppearance {
  static var style: UIUserInterfaceStyle = .unspecified

  static func apply(_ next: UIUserInterfaceStyle) {
    style = next
    var windows: [UIWindow] = []
    for scene in UIApplication.shared.connectedScenes {
      guard let windowScene = scene as? UIWindowScene else { continue }
      windows.append(contentsOf: windowScene.windows)
    }
    if let appWindow = UIApplication.shared.delegate?.window ?? nil,
       !windows.contains(where: { $0 === appWindow }) {
      windows.append(appWindow)
    }
    for window in windows {
      window.overrideUserInterfaceStyle = next
    }
  }
}

@objc(StellaPhoneSceneDelegate)
public final class StellaPhoneSceneDelegate: UIResponder, UIWindowSceneDelegate {
  public var window: UIWindow?

  public func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let appWindow = UIApplication.shared.delegate?.window ?? nil
    else { return }
    appWindow.windowScene = windowScene
    appWindow.overrideUserInterfaceStyle = StellaWindowAppearance.style
    window = appWindow
    appWindow.makeKeyAndVisible()

    for context in connectionOptions.urlContexts {
      forwardOpenURL(context)
    }
    for activity in connectionOptions.userActivities {
      forwardUserActivity(activity)
    }
    if let shortcutItem = connectionOptions.shortcutItem {
      forwardShortcut(shortcutItem) { _ in }
    }
  }

  public func sceneDidBecomeActive(_ scene: UIScene) {
    StellaPhoneSceneState.shared.set(foreground: true)
  }

  public func sceneWillResignActive(_ scene: UIScene) {
    StellaPhoneSceneState.shared.set(foreground: false)
  }

  public func sceneDidEnterBackground(_ scene: UIScene) {
    StellaPhoneSceneState.shared.set(foreground: false)
  }

  public func sceneDidDisconnect(_ scene: UIScene) {
    StellaPhoneSceneState.shared.set(foreground: false)
  }

  public func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    forwardUserActivity(userActivity)
  }

  public func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts {
      forwardOpenURL(context)
    }
  }

  public func windowScene(
    _ windowScene: UIWindowScene,
    performActionFor shortcutItem: UIApplicationShortcutItem,
    completionHandler: @escaping (Bool) -> Void
  ) {
    forwardShortcut(shortcutItem, completionHandler: completionHandler)
  }

  private func forwardOpenURL(_ context: UIOpenURLContext) {
    var options: [UIApplication.OpenURLOptionsKey: Any] = [
      .openInPlace: context.options.openInPlace
    ]
    if let sourceApplication = context.options.sourceApplication {
      options[.sourceApplication] = sourceApplication
    }
    if let annotation = context.options.annotation {
      options[.annotation] = annotation
    }
    _ = UIApplication.shared.delegate?.application?(
      UIApplication.shared,
      open: context.url,
      options: options
    )
  }

  private func forwardUserActivity(_ activity: NSUserActivity) {
    _ = UIApplication.shared.delegate?.application?(
      UIApplication.shared,
      continue: activity,
      restorationHandler: { _ in }
    )
  }

  private func forwardShortcut(
    _ item: UIApplicationShortcutItem,
    completionHandler: @escaping (Bool) -> Void
  ) {
    guard let delegate = UIApplication.shared.delegate,
          delegate.responds(to: #selector(UIApplicationDelegate.application(_:performActionFor:completionHandler:)))
    else {
      completionHandler(false)
      return
    }
    delegate.application?(
      UIApplication.shared,
      performActionFor: item,
      completionHandler: completionHandler
    )
  }
}
