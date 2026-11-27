import Foundation

/// Requests from the phone's TS (`ui/native/app.ts`, through `__native.post`) that the app
/// answers itself: `{cmd, id, ...}` in, `{t:"phone.reply", id, ok, value|error}` out. Events the
/// app raises on its own (a notification tap, the storefront changing, microphone audio) go
/// out as `{t:"phone.<name>", ...}` lines, which TS reads with `onEngineEvent`.
enum PhoneRequests {
  static func reply(_ m: [String: Any], ok: Bool = true, _ value: Any?) {
    guard let id = m["id"] else { return }
    var obj: [String: Any] = ["t": "phone.reply", "id": id, "ok": ok]
    obj[ok ? "value" : "error"] = value ?? NSNull()
    send(obj)
  }

  static func fail(_ m: [String: Any], _ message: String, code: String? = nil) {
    guard let id = m["id"] else { return }
    var obj: [String: Any] = ["t": "phone.reply", "id": id, "ok": false, "error": message]
    if let code { obj["code"] = code }
    send(obj)
  }

  static func event(_ name: String, _ fields: [String: Any]) {
    var obj = fields
    obj["t"] = "phone.\(name)"
    send(obj)
  }

  static func send(_ obj: [String: Any]) {
    if let d = try? JSONSerialization.data(withJSONObject: obj), let line = String(data: d, encoding: .utf8) {
      App.shared.js.deliver(line: line)
    }
  }
}
