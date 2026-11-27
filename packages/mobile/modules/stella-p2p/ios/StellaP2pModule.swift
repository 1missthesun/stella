import ExpoModulesCore
import Foundation
import StellaP2pFFI

/// The phone's side of Stella's direct device link (crate stella-p2p over its C API). JS starts one
/// node, runs `command`s (JSON in, `{ok, value}` / `{ok:false, error}` out) and gets the node's events
/// as `onEvent`. See `src/index.ts` and the crate's `src/lib.rs` for the commands and events.
public final class StellaP2pModule: Module {
  private let lock = NSLock()
  private var node: OpaquePointer?
  private var replies: [UInt64: Promise] = [:]
  private var nextToken: UInt64 = 1
  private var startError: String?

  public func definition() -> ModuleDefinition {
    Name("StellaP2p")

    Events("onEvent")

    OnDestroy {
      self.stopNode()
    }

    /// Starts the node (once; later calls return the same). `config` is the crate's JSON config;
    /// `dataDir` defaults to the app's private Application Support folder.
    AsyncFunction("start") { (configJson: String) throws in
      if self.lock.withLock({ self.node != nil }) { return }
      var config = (try? JSONSerialization.jsonObject(with: Data(configJson.utf8))) as? [String: Any] ?? [:]
      if (config["dataDir"] as? String ?? "").isEmpty {
        config["dataDir"] = try Self.defaultDataDir().path
      }
      if config["platform"] == nil { config["platform"] = "ios" }
      let data = try JSONSerialization.data(withJSONObject: config)
      let json = String(decoding: data, as: UTF8.self)
      let ctx = Unmanaged.passUnretained(self).toOpaque()
      self.lock.withLock { self.startError = nil }
      let started = json.withCString { stella_p2p_start($0, stellaP2pOnEvent, ctx) }
      guard let started else {
        throw StellaP2pError(self.lock.withLock { self.startError } ?? "The device link didn't start.")
      }
      let raced = self.lock.withLock { () -> Bool in
        if self.node != nil { return true }
        self.node = started
        return false
      }
      if raced { stella_p2p_stop(started) }
    }

    /// Runs one command; resolves with the reply JSON (`{ok, value}` or `{ok:false, error}`).
    AsyncFunction("command") { (name: String, argsJson: String, promise: Promise) in
      let (node, token) = self.lock.withLock { () -> (OpaquePointer?, UInt64) in
        let token = self.nextToken
        self.nextToken += 1
        if self.node != nil { self.replies[token] = promise }
        return (self.node, token)
      }
      guard let node else {
        promise.resolve("{\"ok\":false,\"error\":\"The device link isn't running.\"}")
        return
      }
      let ctx = Unmanaged.passUnretained(self).toOpaque()
      name.withCString { cmd in
        argsJson.withCString { args in
          stella_p2p_command(node, cmd, args, token, stellaP2pOnReply, ctx)
        }
      }
    }

    AsyncFunction("stop") {
      self.stopNode()
    }
  }

  fileprivate func deliver(event json: String) {
    if let data = json.data(using: .utf8),
       let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
       object["kind"] as? String == "error" {
      lock.withLock { startError = object["error"] as? String }
    }
    sendEvent("onEvent", ["json": json])
  }

  fileprivate func deliver(reply json: String, token: UInt64) {
    let promise = lock.withLock { replies.removeValue(forKey: token) }
    promise?.resolve(json)
  }

  private func stopNode() {
    let (node, pending) = lock.withLock { () -> (OpaquePointer?, [Promise]) in
      let node = self.node
      self.node = nil
      let pending = Array(self.replies.values)
      self.replies = [:]
      return (node, pending)
    }
    if let node { stella_p2p_stop(node) }
    for promise in pending { promise.resolve("{\"ok\":false,\"error\":\"The device link stopped.\"}") }
  }

  /// Holds the device's secret key: private to the app and kept out of backups, so a restored
  /// phone pairs again instead of posing as this one.
  private static func defaultDataDir() throws -> URL {
    var dir = try FileManager.default
      .url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
      .appendingPathComponent("stella-p2p", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try? dir.setResourceValues(values)
    return dir
  }
}

private func stellaP2pOnEvent(ctx: UnsafeMutableRawPointer?, json: UnsafePointer<CChar>?) {
  guard let ctx, let json else { return }
  let text = String(cString: json)
  Unmanaged<StellaP2pModule>.fromOpaque(ctx).takeUnretainedValue().deliver(event: text)
}

private func stellaP2pOnReply(ctx: UnsafeMutableRawPointer?, token: UInt64, json: UnsafePointer<CChar>?) {
  guard let ctx else { return }
  let text = json.map { String(cString: $0) } ?? "{\"ok\":false,\"error\":\"no reply\"}"
  Unmanaged<StellaP2pModule>.fromOpaque(ctx).takeUnretainedValue().deliver(reply: text, token: token)
}

struct StellaP2pError: Error, CustomStringConvertible {
  let message: String
  init(_ message: String) { self.message = message }
  var description: String { message }
}
