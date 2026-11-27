import CryptoKit
import Foundation
import JavaScriptCore
import Security
import UIKit

/// Stella's TS/JSX app runs in the system's JavaScriptCore (no extra runtime) on its own
/// thread, as React Native runs JS off the main thread: React renders and commits there, and
/// the main thread only draws. `__native` is the whole surface the JS side reaches
/// (js/natives.d.ts): the engine bridge (`push`), timers, fetch, WebSocket, storage, crypto,
/// logging and app commands. Polyfills for the web APIs are JS (js/polyfills.ts).
final class JSRuntime: NSObject, URLSessionDataDelegate, URLSessionWebSocketDelegate {
  private var thread: Thread!
  private var runLoop: CFRunLoop?
  private let ready = DispatchSemaphore(value: 0)
  private(set) var context: JSContext!
  private var timers: [Int: Timer] = [:]
  private lazy var session: URLSession = {
    let q = OperationQueue()
    q.maxConcurrentOperationCount = 1
    let cfg = URLSessionConfiguration.default
    cfg.httpCookieStorage = .shared
    cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
    return URLSession(configuration: cfg, delegate: self, delegateQueue: q)
  }()
  /// Task ids → JS ids, read on the session's queue and written on the JS thread.
  private let lock = NSLock()
  private var _fetchIds: [Int: Int] = [:]
  private var _socketIds: [Int: Int] = [:]
  private var fetchIds: [Int: Int] {
    get { lock.lock(); defer { lock.unlock() }; return _fetchIds }
    set { lock.lock(); _fetchIds = newValue; lock.unlock() }
  }
  private var socketIds: [Int: Int] {
    get { lock.lock(); defer { lock.unlock() }; return _socketIds }
    set { lock.lock(); _socketIds = newValue; lock.unlock() }
  }
  private var sockets: [Int: URLSessionWebSocketTask] = [:]
  private let storage = UserDefaults(suiteName: "stella-rune-storage")!
  var onAppCommand: (([String: Any]) -> Void)?
  let log = AppLog.shared
  /// When JS started and when the bundle finished evaluating (ms since process start).
  private(set) var evalMs: Double = 0

  func start(bundle: URL, env: [String: Any]) {
    thread = Thread { [weak self] in self?.main(bundle: bundle, env: env) }
    thread.name = "stella-js"
    thread.qualityOfService = .userInteractive
    thread.stackSize = 8 << 20
    thread.start()
    ready.wait()
  }

  /// Runs `block` on the JS thread.
  func perform(_ block: @escaping () -> Void) {
    guard let rl = runLoop else { return }
    CFRunLoopPerformBlock(rl, CFRunLoopMode.defaultMode.rawValue, block)
    CFRunLoopWakeUp(rl)
  }

  private func main(bundle: URL, env: [String: Any]) {
    runLoop = CFRunLoopGetCurrent()
    // A source keeps the run loop alive while nothing else is scheduled.
    var ctxSrc = CFRunLoopSourceContext()
    ctxSrc.perform = { _ in }
    let keep = CFRunLoopSourceCreate(nil, 0, &ctxSrc)
    CFRunLoopAddSource(runLoop, keep, .defaultMode)
    let ctx = JSContext()!
    context = ctx
    ctx.name = "Stella"
    ctx.isInspectable = true
    ctx.exceptionHandler = { [weak self] _, ex in
      let stack = ex?.objectForKeyedSubscript("stack")?.toString() ?? ""
      self?.log.write("error", "uncaught: \(ex?.toString() ?? "?")\n\(stack)")
    }
    install(ctx, env: env)
    ready.signal()
    let t0 = CACurrentMediaTime()
    do {
      let src = try String(contentsOf: bundle, encoding: .utf8)
      ctx.evaluateScript(src, withSourceURL: bundle)
      evalMs = (CACurrentMediaTime() - t0) * 1000
      log.write("info", String(format: "bundle evaluated in %.1f ms (%d KB)", evalMs, src.utf8.count / 1024))
    } catch {
      log.write("error", "no bundle at \(bundle.path): \(error)")
    }
    while true {
      autoreleasepool { _ = CFRunLoopRunInMode(.defaultMode, 1e9, false) }
    }
  }

  // MARK: natives

  private func bytes(of v: JSValue) -> Data? {
    guard let ctxRef = v.context?.jsGlobalContextRef, let obj = v.jsValueRef, v.isObject else {
      if v.isString { return v.toString().data(using: .utf8) }
      return nil
    }
    let o = JSValueToObject(ctxRef, obj, nil)
    let type = JSValueGetTypedArrayType(ctxRef, obj, nil)
    if type == kJSTypedArrayTypeArrayBuffer {
      guard let p = JSObjectGetArrayBufferBytesPtr(ctxRef, o, nil) else { return Data() }
      return Data(bytes: p, count: JSObjectGetArrayBufferByteLength(ctxRef, o, nil))
    }
    if type == kJSTypedArrayTypeNone { return nil }
    guard let p = JSObjectGetTypedArrayBytesPtr(ctxRef, o, nil) else { return Data() }
    let off = JSObjectGetTypedArrayByteOffset(ctxRef, o, nil)
    let len = JSObjectGetTypedArrayByteLength(ctxRef, o, nil)
    return Data(bytes: p.advanced(by: off), count: len)
  }

  /// A Uint8Array copy of `data` in the JS context.
  func u8(_ data: Data) -> JSValue {
    let ctxRef = context.jsGlobalContextRef!
    let arr = JSObjectMakeTypedArray(ctxRef, kJSTypedArrayTypeUint8Array, data.count, nil)!
    if data.count > 0, let p = JSObjectGetTypedArrayBytesPtr(ctxRef, arr, nil) {
      data.copyBytes(to: p.assumingMemoryBound(to: UInt8.self), count: data.count)
    }
    return JSValue(jsValueRef: arr, in: context)
  }

  private func call(_ name: String, _ args: [Any]) {
    context.globalObject.objectForKeyedSubscript(name)?.call(withArguments: args)
  }

  private func install(_ ctx: JSContext, env: [String: Any]) {
    let n = JSValue(newObjectIn: ctx)!
    let set: (String, Any) -> Void = { name, fn in n.setObject(fn, forKeyedSubscript: name as NSString) }

    set("env", env)
    set("push", { [weak self] (v: JSValue) in
      guard let data = self?.bytes(of: v) else { return }
      data.withUnsafeBytes { buf in sme_push(buf.bindMemory(to: UInt8.self).baseAddress, buf.count) }
    } as @convention(block) (JSValue) -> Void)
    set("log", { [weak self] (level: String, msg: String) in self?.log.write(level, msg) } as @convention(block) (String, String) -> Void)
    set("now", { CACurrentMediaTime() * 1000 } as @convention(block) () -> Double)
    set("epochNow", { Date().timeIntervalSince1970 * 1000 } as @convention(block) () -> Double)
    set("setTimer", { [weak self] (id: Int, ms: Double, repeats: Bool) in
      guard let self else { return }
      let t = Timer(timeInterval: max(0, ms) / 1000, repeats: repeats) { [weak self] _ in
        guard let self else { return }
        if !repeats { self.timers.removeValue(forKey: id) }
        self.call("__timerFire", [id])
      }
      self.timers[id] = t
      RunLoop.current.add(t, forMode: .default)
    } as @convention(block) (Int, Double, Bool) -> Void)
    set("clearTimer", { [weak self] (id: Int) in self?.timers.removeValue(forKey: id)?.invalidate() } as @convention(block) (Int) -> Void)
    set("post", { [weak self] (json: String) in
      guard let data = json.data(using: .utf8), let m = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
      DispatchQueue.main.async { self?.onAppCommand?(m) }
    } as @convention(block) (String) -> Void)
    // Storage (localStorage and the UI state): synchronous, like the web's.
    set("storageGet", { [weak self] (k: String) -> Any in self?.storage.string(forKey: k) ?? NSNull() } as @convention(block) (String) -> Any)
    set("storageSet", { [weak self] (k: String, v: String) in self?.storage.set(v, forKey: k) } as @convention(block) (String, String) -> Void)
    set("storageRemove", { [weak self] (k: String) in self?.storage.removeObject(forKey: k) } as @convention(block) (String) -> Void)
    set("storageKeys", { [weak self] () -> [String] in
      guard let self else { return [] }
      return Array(self.storage.dictionaryRepresentation().keys).filter { self.storage.string(forKey: $0) != nil }
    } as @convention(block) () -> [String])
    set("random", { [weak self] (count: Int) -> JSValue in
      var d = Data(count: count)
      _ = d.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, count, $0.baseAddress!) }
      return self!.u8(d)
    } as @convention(block) (Int) -> JSValue)
    set("digest", { [weak self] (alg: String, v: JSValue) -> JSValue in
      let d = self?.bytes(of: v) ?? Data()
      let out: Data
      switch alg.uppercased() {
      case "SHA-1": out = Data(Insecure.SHA1.hash(data: d))
      case "SHA-384": out = Data(SHA384.hash(data: d))
      case "SHA-512": out = Data(SHA512.hash(data: d))
      default: out = Data(SHA256.hash(data: d))
      }
      return self!.u8(out)
    } as @convention(block) (String, JSValue) -> JSValue)
    set("hmac", { [weak self] (alg: String, key: JSValue, v: JSValue) -> JSValue in
      let k = SymmetricKey(data: self?.bytes(of: key) ?? Data())
      let d = self?.bytes(of: v) ?? Data()
      let out: Data = alg.uppercased() == "SHA-512" ? Data(HMAC<SHA512>.authenticationCode(for: d, using: k)) : Data(HMAC<SHA256>.authenticationCode(for: d, using: k))
      return self!.u8(out)
    } as @convention(block) (String, JSValue, JSValue) -> JSValue)
    set("readFile", { [weak self] (path: String) -> Any in
      guard let d = FileManager.default.contents(atPath: path) else { return NSNull() }
      return self!.u8(d)
    } as @convention(block) (String) -> Any)
    set("readText", { (path: String) -> Any in
      (try? String(contentsOfFile: path, encoding: .utf8)) ?? NSNull()
    } as @convention(block) (String) -> Any)
    set("writeFile", { [weak self] (path: String, v: JSValue) -> Bool in
      guard let d = self?.bytes(of: v) else { return false }
      try? FileManager.default.createDirectory(at: URL(fileURLWithPath: path).deletingLastPathComponent(), withIntermediateDirectories: true)
      return FileManager.default.createFile(atPath: path, contents: d)
    } as @convention(block) (String, JSValue) -> Bool)
    set("fetch", { [weak self] (id: Int, req: [String: Any], body: JSValue) in
      self?.startFetch(id, req, body)
    } as @convention(block) (Int, [String: Any], JSValue) -> Void)
    set("fetchAbort", { [weak self] (id: Int) in
      guard let self else { return }
      self.session.getAllTasks { tasks in tasks.first { self.fetchIds[$0.taskIdentifier] == id }?.cancel() }
    } as @convention(block) (Int) -> Void)
    set("wsOpen", { [weak self] (id: Int, url: String, protocols: [String]) in self?.openSocket(id, url, protocols) } as @convention(block) (Int, String, [String]) -> Void)
    set("wsSend", { [weak self] (id: Int, v: JSValue) in
      guard let self, let task = self.sockets[id] else { return }
      let msg: URLSessionWebSocketTask.Message = v.isString ? .string(v.toString()) : .data(self.bytes(of: v) ?? Data())
      task.send(msg) { err in if let err { self.log.write("warn", "ws send: \(err)") } }
    } as @convention(block) (Int, JSValue) -> Void)
    set("wsClose", { [weak self] (id: Int, code: Int, reason: String) in
      guard let self, let task = self.sockets.removeValue(forKey: id) else { return }
      task.cancel(with: URLSessionWebSocketTask.CloseCode(rawValue: code) ?? .normalClosure, reason: reason.data(using: .utf8))
    } as @convention(block) (Int, Int, String) -> Void)
    ctx.setObject(n, forKeyedSubscript: "__native" as NSString)
  }

  /// Engine → TS: a JSON line from the engine, delivered on the JS thread.
  func deliver(line: String) {
    perform { [weak self] in self?.call("__runeEvent", [line]) }
  }

  // MARK: fetch

  private func startFetch(_ id: Int, _ req: [String: Any], _ body: JSValue) {
    guard let s = req["url"] as? String, let url = URL(string: s) else {
      call("__fetchEvent", [id, "error", "bad url"])
      return
    }
    var r = URLRequest(url: url)
    r.httpMethod = (req["method"] as? String) ?? "GET"
    for (k, v) in (req["headers"] as? [String: String]) ?? [:] { r.setValue(v, forHTTPHeaderField: k) }
    if !body.isUndefined && !body.isNull { r.httpBody = bytes(of: body) }
    if (req["redirect"] as? String) == "manual" { r.setValue("manual", forHTTPHeaderField: "X-Stella-Redirect") }
    // Cookies as a browser page at stella-app:// has them: every backend is another origin, so only
    // `credentials: "include"` sends or keeps them (a stray cookie otherwise trips the backend's
    // origin check on requests the web build makes cookie-free).
    r.httpShouldHandleCookies = (req["credentials"] as? String) == "include"
    let task = session.dataTask(with: r)
    fetchIds[task.taskIdentifier] = id
    task.resume()
  }

  func urlSession(_ s: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
    guard let id = fetchIds[dataTask.taskIdentifier] else { return completionHandler(.cancel) }
    let h = response as? HTTPURLResponse
    var headers: [String: String] = [:]
    for (k, v) in h?.allHeaderFields ?? [:] { headers[String(describing: k).lowercased()] = String(describing: v) }
    let status = h?.statusCode ?? 200
    let finalURL = response.url?.absoluteString ?? ""
    perform { [weak self] in self?.call("__fetchEvent", [id, "head", status, headers, finalURL]) }
    completionHandler(.allow)
  }

  func urlSession(_ s: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    guard let id = fetchIds[dataTask.taskIdentifier] else { return }
    perform { [weak self] in
      guard let self else { return }
      self.call("__fetchEvent", [id, "data", self.u8(data)])
    }
  }

  func urlSession(_ s: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
    completionHandler(task.originalRequest?.value(forHTTPHeaderField: "X-Stella-Redirect") == "manual" ? nil : request)
  }

  func urlSession(_ s: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    if let id = socketIds.removeValue(forKey: task.taskIdentifier) {
      if let error { perform { [weak self] in self?.call("__wsEvent", [id, "error", "\(error.localizedDescription)"]) } }
      return
    }
    guard let id = fetchIds.removeValue(forKey: task.taskIdentifier) else { return }
    perform { [weak self] in
      if let error { self?.call("__fetchEvent", [id, "error", error.localizedDescription]) } else { self?.call("__fetchEvent", [id, "end"]) }
    }
  }

  // MARK: WebSocket

  private func openSocket(_ id: Int, _ url: String, _ protocols: [String]) {
    guard let u = URL(string: url) else {
      call("__wsEvent", [id, "error", "bad url"])
      return
    }
    let task = protocols.isEmpty ? session.webSocketTask(with: u) : session.webSocketTask(with: u, protocols: protocols)
    task.maximumMessageSize = 64 << 20
    sockets[id] = task
    socketIds[task.taskIdentifier] = id
    task.resume()
    receive(id, task)
  }

  private func receive(_ id: Int, _ task: URLSessionWebSocketTask) {
    task.receive { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let m):
        self.perform {
          switch m {
          case .string(let s): self.call("__wsEvent", [id, "message", s])
          case .data(let d): self.call("__wsEvent", [id, "message", self.u8(d)])
          @unknown default: break
          }
        }
        self.receive(id, task)
      case .failure:
        break
      }
    }
  }

  func urlSession(_ s: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol proto: String?) {
    guard let id = socketIds[webSocketTask.taskIdentifier] else { return }
    perform { [weak self] in self?.call("__wsEvent", [id, "open", proto ?? ""]) }
  }

  func urlSession(_ s: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith code: URLSessionWebSocketTask.CloseCode, reason: Data?) {
    guard let id = socketIds.removeValue(forKey: webSocketTask.taskIdentifier) else { return }
    let r = reason.flatMap { String(data: $0, encoding: .utf8) } ?? ""
    perform { [weak self] in
      self?.sockets.removeValue(forKey: id)
      self?.call("__wsEvent", [id, "close", code.rawValue, r])
    }
  }
}

/// The app's log: stderr plus a file in the app's Documents (read with `simctl get_app_container`).
final class AppLog {
  static let shared = AppLog()
  private let queue = DispatchQueue(label: "stella-log")
  private let handle: FileHandle?
  let url: URL

  init() {
    let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    url = docs.appendingPathComponent("stella-rune.log")
    FileManager.default.createFile(atPath: url.path, contents: nil)
    handle = try? FileHandle(forWritingTo: url)
  }

  func write(_ level: String, _ msg: String) {
    let t = String(format: "%.3f", CACurrentMediaTime())
    let line = "[\(t)] \(level): \(msg)\n"
    queue.async { [handle] in
      FileHandle.standardError.write(line.data(using: .utf8)!)
      handle?.write(line.data(using: .utf8)!)
    }
  }
}
