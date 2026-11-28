package com.stella.rune

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

/**
 * `pdf.open` / `pdf.render` (`ui/native/pdf.ts`), as ios/StellaRune/PdfPages.swift: a PDF's page
 * sizes, and one page drawn `width` pixels wide as a JPEG on white, with Android's PdfRenderer
 * (one page open at a time, so every call runs on one thread).
 */
object PdfPages {
  private val thread = Executors.newSingleThreadExecutor()
  private var openPath: String? = null
  private var renderer: PdfRenderer? = null

  fun handle(m: JSONObject): Boolean {
    val cmd = m.optString("cmd")
    if (cmd != "pdf.open" && cmd != "pdf.render") return false
    val path = m.optString("path")
    thread.execute {
      try {
        val r = rendererFor(path)
        if (cmd == "pdf.open") {
          val pages = JSONArray()
          for (i in 0 until r.pageCount) r.openPage(i).use { pages.put(JSONArray().put(it.width).put(it.height)) }
          reply(m, true, JSONObject().put("pages", pages))
          return@execute
        }
        val out = m.optString("out")
        val width = m.optInt("width", 1000)
        // `rect: [x0, y0, x1, y1]`: only that part of the page (fractions of it), `width` pixels wide.
        val rect = m.optJSONArray("rect")
        var (x0, y0, x1, y1) = listOf(0.0, 0.0, 1.0, 1.0)
        if (rect != null && rect.length() == 4) {
          val v = (0 until 4).map { rect.optDouble(it).coerceIn(0.0, 1.0) }
          if (v[2] > v[0] && v[3] > v[1]) { x0 = v[0]; y0 = v[1]; x1 = v[2]; y1 = v[3] }
        }
        r.openPage(m.optInt("page", 1) - 1).use { page ->
          val height = (width.toDouble() * page.height * (y1 - y0) / (page.width * (x1 - x0))).toInt().coerceAtLeast(1)
          val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
          bitmap.eraseColor(Color.WHITE)
          // The whole page at the scale the part fills the bitmap, shifted so the part lands on it.
          val k = width / (page.width * (x1 - x0))
          val matrix = Matrix().apply {
            setScale(k.toFloat(), k.toFloat())
            postTranslate((-x0 * page.width * k).toFloat(), (-y0 * page.height * k).toFloat())
          }
          page.render(bitmap, null, matrix, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
          File(out).parentFile?.mkdirs()
          File(out).outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 86, it) }
          bitmap.recycle()
        }
        reply(m, true, JSONObject().put("path", out))
      } catch (e: Exception) {
        reply(m, false, "This PDF can't be opened.")
      }
    }
    return true
  }

  private fun rendererFor(path: String): PdfRenderer {
    renderer?.let { if (openPath == path) return it }
    renderer?.close()
    val r = PdfRenderer(ParcelFileDescriptor.open(File(path), ParcelFileDescriptor.MODE_READ_ONLY))
    renderer = r
    openPath = path
    return r
  }

  private fun reply(m: JSONObject, ok: Boolean, value: Any) {
    if (!m.has("id")) return
    val obj = JSONObject().put("t", "phone.reply").put("id", m.get("id")).put("ok", ok).put(if (ok) "value" else "error", value)
    App.activity?.runOnUiThread { App.js?.deliver(obj.toString()) } ?: App.js?.deliver(obj.toString())
  }
}
