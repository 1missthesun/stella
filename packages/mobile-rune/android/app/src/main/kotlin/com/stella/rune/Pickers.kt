package com.stella.rune

import android.app.AlertDialog
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID
import kotlin.concurrent.thread

/**
 * The phone's answers to the engine's `dialog.openFile` (the composer's add button) and the
 * clipboard reads, as ios/StellaRune/Pickers.swift: a chooser offering the photo picker or the
 * system file picker, the picks copied into the app's cache folder (photos as JPEG), and their
 * paths sent back to TS as the command's reply.
 */
object Pickers {
  private const val MAX_PHOTOS = 10
  private val main = Handler(Looper.getMainLooper())
  private var pending: Long? = null
  private lateinit var photo: ActivityResultLauncher<PickVisualMediaRequest>
  private lateinit var photos: ActivityResultLauncher<PickVisualMediaRequest>
  private lateinit var document: ActivityResultLauncher<Array<String>>
  private lateinit var documents: ActivityResultLauncher<Array<String>>
  private var activity: ComponentActivity? = null

  /** Registers the result contracts; called from the activity's `onCreate`. */
  fun register(a: ComponentActivity) {
    activity = a
    photo = a.registerForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> copy(listOfNotNull(uri)) }
    photos = a.registerForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(MAX_PHOTOS)) { uris -> copy(uris) }
    document = a.registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> copy(listOfNotNull(uri)) }
    documents = a.registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris -> copy(uris) }
  }

  /** `{t:"reply", rid, ok, value|error}` straight to TS, as the engine's own replies. */
  fun reply(rid: Long?, value: Any?, ok: Boolean = true) {
    rid ?: return
    val obj = JSONObject().put("t", "reply").put("rid", rid).put("ok", ok).put(if (ok) "value" else "error", value ?: JSONObject.NULL)
    App.js?.deliver(obj.toString())
  }

  /** Handles the commands only the app can answer; false for any other. */
  fun handle(m: JSONObject): Boolean {
    val rid = if (m.has("rid") && !m.isNull("rid")) m.optLong("rid") else null
    return when (m.optString("cmd")) {
      "clipboard.readText" -> {
        reply(rid, clipboard().text)
        true
      }
      "clipboard.read" -> {
        val c = clipboard()
        val formats = JSONArray()
        if (c.text.isNotEmpty()) formats.put("text/plain")
        if (c.html != null) formats.put("text/html")
        reply(rid, JSONObject().put("text", c.text).put("html", c.html ?: JSONObject.NULL).put("files", JSONArray()).put("image", JSONObject.NULL).put("formats", formats))
        true
      }
      "dialog.openFile" -> {
        openFile(rid, m.optBoolean("multi", false))
        true
      }
      else -> false
    }
  }

  private class Clip(val text: String, val html: String?)

  private fun clipboard(): Clip {
    val a = activity ?: return Clip("", null)
    val clip = a.getSystemService(ClipboardManager::class.java)?.primaryClip ?: return Clip("", null)
    if (clip.itemCount == 0) return Clip("", null)
    val item = clip.getItemAt(0)
    val html = if (clip.description.hasMimeType(ClipDescription.MIMETYPE_TEXT_HTML)) item.htmlText else null
    return Clip(item.coerceToText(a)?.toString() ?: "", html)
  }

  /** Puts text (and its HTML, when given) on the clipboard. */
  fun write(text: String, html: String?) {
    val a = activity ?: return
    val clip = if (html.isNullOrEmpty()) ClipData.newPlainText("Stella", text) else ClipData.newHtmlText("Stella", text, html)
    a.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(clip)
  }

  private fun finish(paths: List<String>) {
    val rid = pending
    pending = null
    reply(rid, if (paths.isEmpty()) null else JSONArray(paths))
  }

  private fun openFile(rid: Long?, multi: Boolean) {
    val a = activity ?: return reply(rid, null)
    if (pending != null) finish(emptyList())
    pending = rid
    var chosen = false
    AlertDialog.Builder(a, if (App.uiDark) android.R.style.Theme_DeviceDefault_Dialog_Alert else android.R.style.Theme_DeviceDefault_Light_Dialog_Alert)
      .setItems(arrayOf("Photo Library", "Choose Files")) { _, which ->
        chosen = true
        val media = PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)
        when (which) {
          0 -> if (multi) photos.launch(media) else photo.launch(media)
          else -> if (multi) documents.launch(arrayOf("*/*")) else document.launch(arrayOf("*/*"))
        }
      }
      .setNegativeButton(android.R.string.cancel, null)
      .setOnDismissListener { if (!chosen) finish(emptyList()) }
      .show()
  }

  /** Copies the picks off the main thread into `cache/picked/<uuid>/`, then replies. */
  private fun copy(uris: List<Uri>) {
    val a = activity ?: return finish(emptyList())
    if (uris.isEmpty()) return finish(emptyList())
    thread(name = "stella-picks") {
      val dir = File(a.cacheDir, "picked/${UUID.randomUUID()}").also { it.mkdirs() }
      val out = ArrayList<String>()
      for (uri in uris) {
        try {
          out.add(copyOne(a, uri, dir).path)
        } catch (e: Throwable) {
          AppLog.write("warn", "pick $uri not copied: ${e.message}")
        }
      }
      main.post { finish(out) }
    }
  }

  private fun copyOne(a: ComponentActivity, uri: Uri, dir: File): File {
    val cr = a.contentResolver
    val type = cr.getType(uri) ?: ""
    var name = cr.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
      if (c.moveToFirst()) c.getString(0) else null
    }?.replace('/', '_')?.ifBlank { null } ?: UUID.randomUUID().toString()
    // The photo picker names a pick by its media id ("19.png"): name it as a camera would.
    if (uri.authority == "media" && uri.path.orEmpty().contains("picker")) {
      val ext = name.substringAfterLast('.', "").ifEmpty { null }
      val stamp = java.text.SimpleDateFormat("yyyyMMdd_HHmmss", java.util.Locale.US).format(java.util.Date())
      name = (if (type.startsWith("video/")) "VID_" else "IMG_") + stamp + (ext?.let { ".$it" } ?: "")
    }
    // Photos as JPEG (HEIC, AVIF and the like aren't something every model reads); GIFs keep
    // their frames, videos and other files are copied as they are.
    if (type.startsWith("image/") && type != "image/jpeg" && type != "image/gif") {
      val bitmap = ImageDecoder.decodeBitmap(ImageDecoder.createSource(cr, uri)) { d, _, _ ->
        d.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
      }
      val dest = unique(dir, name.substringBeforeLast('.') + ".jpg")
      dest.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 90, it) }
      bitmap.recycle()
      return dest
    }
    if (!name.contains('.')) {
      android.webkit.MimeTypeMap.getSingleton().getExtensionFromMimeType(type)?.let { name += ".$it" }
    }
    val dest = unique(dir, name)
    (cr.openInputStream(uri) ?: error("unreadable")).use { input -> dest.outputStream().use { input.copyTo(it) } }
    return dest
  }

  private fun unique(dir: File, name: String): File {
    var f = File(dir, name)
    var i = 2
    while (f.exists()) f = File(dir, "${name.substringBeforeLast('.')} $i.${name.substringAfterLast('.', "")}".removeSuffix(".")).also { i++ }
    return f
  }
}
