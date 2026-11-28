package com.stella.rune

import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import org.json.JSONObject
import java.io.File
import kotlin.concurrent.thread

/**
 * `media.videoPoster` (`ui/native/video-poster.ts`), as ios/StellaRune/VideoPoster.swift: a frame
 * of the video at `url`, written as a JPEG to `out` at about the card's size, with the video's
 * length. Replies `{path, durationMs, width, height}`; fails when there is no frame to give.
 */
object VideoPoster {
  fun handle(m: JSONObject): Boolean {
    if (m.optString("cmd") != "media.videoPoster") return false
    val url = m.optString("url")
    val out = m.optString("out")
    val density = App.activity?.resources?.displayMetrics?.density ?: 3f
    val side = (maxOf(m.optDouble("width", 176.0), m.optDouble("height", 132.0)) * density * 1.5).toInt()
    thread(name = "video-poster") {
      val retriever = MediaMetadataRetriever()
      try {
        retriever.setDataSource(url, HashMap())
        val ms = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
        val at = if (ms > 0) minOf(1_000L, ms / 10) * 1_000 else 0L
        val frame = retriever.getScaledFrameAtTime(at, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, side, side)
          ?: throw IllegalStateException("no frame")
        File(out).parentFile?.mkdirs()
        File(out).outputStream().use { frame.compress(Bitmap.CompressFormat.JPEG, 82, it) }
        reply(m, true, JSONObject().put("path", out).put("durationMs", ms).put("width", frame.width).put("height", frame.height))
      } catch (e: Exception) {
        reply(m, false, "The video has no frame to show.")
      } finally {
        retriever.release()
      }
    }
    return true
  }

  private fun reply(m: JSONObject, ok: Boolean, value: Any) {
    if (!m.has("id")) return
    val obj = JSONObject().put("t", "phone.reply").put("id", m.get("id")).put("ok", ok).put(if (ok) "value" else "error", value)
    App.activity?.runOnUiThread { App.js?.deliver(obj.toString()) } ?: App.js?.deliver(obj.toString())
  }
}
