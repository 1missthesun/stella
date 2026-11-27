package com.stella.rune

import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import org.json.JSONObject

/**
 * `scanner.scan` (`ui/native/scanner.ts`), as ios/StellaRune/Scanner.swift: Google's code scanner
 * (Play services, its own camera screen, no camera permission for the app) until it reads a QR
 * code, for a computer's pairing code (`stella://p2p?c=…`). Replies `{t:"phone.reply", id, …}`
 * with the code's text, or null when the person closes it; fails with code `unavailable` when the
 * scanner can't run.
 */
object Scanner {
  fun handle(m: JSONObject): Boolean {
    if (m.optString("cmd") != "scanner.scan") return false
    val a = App.activity ?: return true
    val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
    GmsBarcodeScanning.getClient(a, options).startScan()
      .addOnSuccessListener { code -> reply(m, true, code.rawValue ?: JSONObject.NULL) }
      .addOnCanceledListener { reply(m, true, JSONObject.NULL) }
      .addOnFailureListener { e -> reply(m, false, e.message ?: "The camera couldn't open.", "unavailable") }
    return true
  }

  private fun reply(m: JSONObject, ok: Boolean, value: Any, code: String? = null) {
    if (!m.has("id")) return
    val obj = JSONObject().put("t", "phone.reply").put("id", m.get("id")).put("ok", ok).put(if (ok) "value" else "error", value)
    if (code != null) obj.put("code", code)
    App.js?.deliver(obj.toString())
  }
}
