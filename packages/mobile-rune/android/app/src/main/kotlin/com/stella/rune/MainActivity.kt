package com.stella.rune

import android.annotation.SuppressLint
import android.app.Activity
import android.app.UiModeManager
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Process
import android.os.SystemClock
import android.provider.Settings
import android.view.HapticFeedbackConstants
import android.view.ViewGroup
import android.view.WindowInsets
import android.webkit.MimeTypeMap
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.content.FileProvider
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Locale

/** The whole app: one Rune view (Vulkan), the JS runtime driving it, and Android's text fields. */
@SuppressLint("StaticFieldLeak")
object App {
  var activity: MainActivity? = null
  var rune: RuneView? = null
  var js: JSRuntime? = null
  var dark = false
  /** The app's own theme (`webview.colorScheme`), which needn't follow the system's; null until it says. */
  var themeDark: Boolean? = null
  /** What native menus and dialogs shown over the app match. */
  val uiDark get() = themeDark ?: dark
  /** The caret and selection colour when a field names none. */
  var accent = Color.rgb(0x5b, 0x6c, 0xff)
  var firstFrameMs = 0.0
  var firstContentMs = 0.0
  /** Insets in dp, kept until the engine's host exists. */
  var safeArea = floatArrayOf(0f, 0f, 0f, 0f)
  var keyboard = 0f
  val processStartMs: Double = Process.getStartUptimeMillis().toDouble()
  /** Dev builds: log every engine → app message (`--ez STELLA_TRACE_NATIVE true`). */
  var traceNative = false
  /** What the app calls itself on its HTTP requests and in `navigator.userAgent`: an Android phone, as Chrome on one does. */
  val userAgent: String = "Mozilla/5.0 (Linux; Android ${Build.VERSION.RELEASE}; ${Build.MODEL}) AppleWebKit/537.36 (KHTML, like Gecko) StellaRune/0.1 Mobile Safari/537.36"

  fun onHostReady(view: RuneView) {
    val h = view.host
    Engine.nativeSafeArea(h, safeArea[0], safeArea[1], safeArea[2], safeArea[3])
    Engine.nativeKeyboard(h, keyboard)
    pushAccessibility()
  }

  fun pushAccessibility() {
    val a = activity ?: return
    val h = rune?.host ?: return
    if (h == 0L) return
    val scale = Settings.Global.getFloat(a.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f)
    Engine.nativeAccessibility(h, false, false, scale == 0f)
    rune?.wake()
  }

  /** Messages from the engine for the native side (main thread). */
  fun native(m: JSONObject) {
    if (BuildConfig.STELLA_DEV && traceNative) AppLog.write("debug", "native ${m.toString().take(300)}")
    when (m.optString("t")) {
      "field", "place", "hideField", "fieldGone", "setText", "select", "focusField", "blurField" -> NativeFields.handle(m)
      "haptic" -> haptic(m.optString("kind"))
      "cmd" -> command(m)
      "colorScheme" -> {
        val a = activity ?: return
        if (Build.VERSION.SDK_INT >= 31) {
          val mode = when {
            !m.has("dark") || m.isNull("dark") -> UiModeManager.MODE_NIGHT_AUTO
            m.optBoolean("dark") -> UiModeManager.MODE_NIGHT_YES
            else -> UiModeManager.MODE_NIGHT_NO
          }
          a.getSystemService(UiModeManager::class.java)?.setApplicationNightMode(mode)
        }
      }
    }
  }

  fun haptic(kind: String) {
    val v = rune ?: return
    val k = kind.lowercase()
    val c = when {
      k.contains("success") && Build.VERSION.SDK_INT >= 30 -> HapticFeedbackConstants.CONFIRM
      (k.contains("error") || k.contains("warning")) && Build.VERSION.SDK_INT >= 30 -> HapticFeedbackConstants.REJECT
      k.contains("selection") -> HapticFeedbackConstants.CLOCK_TICK
      k.contains("heavy") || k.contains("rigid") -> HapticFeedbackConstants.LONG_PRESS
      k.contains("light") || k.contains("soft") -> HapticFeedbackConstants.KEYBOARD_TAP
      else -> HapticFeedbackConstants.VIRTUAL_KEY
    }
    val done = v.performHapticFeedback(c)
    if (traceNative) AppLog.write("debug", "haptic '$kind' → feedback $c (${if (done) "played" else "off"})")
  }

  /** Commands from TS (through the engine's `native` commands or `__native.post`). */
  fun command(m: JSONObject) {
    val a = activity ?: return
    if (Pickers.handle(m) || Menus.handle(m) || Scanner.handle(m) || VideoPoster.handle(m) || PdfPages.handle(m)) return
    val cmd = m.optString("cmd").ifEmpty { m.optString("t") }
    when (cmd) {
      "clipboard.writeText" -> Pickers.write(m.optString("text"), null)
      "clipboard.writeHTML" -> Pickers.write(m.optString("text"), m.optString("html").ifEmpty { null })
      "shell.openExternal", "openURL" -> openURL(a, m.optString("url").ifEmpty { return }, m.optBoolean("inApp", false))
      "share" -> share(a, m)
      "haptic" -> haptic(m.optString("kind").ifEmpty { m.optString("style") })
      "app.setBadge" -> {}
      "webview.colorScheme" -> themeDark = m.optBoolean("dark")
      // Back with nothing left to close: leave the app as Android's own back does, keeping it alive (as React Native's).
      "app.background" -> a.moveTaskToBack(true)
      "firstContent" -> if (firstContentMs == 0.0) {
        firstContentMs = SystemClock.uptimeMillis() - processStartMs
        AppLog.write("info", String.format("first content %.1f ms after process start", firstContentMs))
      }
      "perf.start" -> {
        rune?.resetRecording()
        rune?.recording = true
        rune?.wake()
      }
      "perf.stop" -> {
        rune?.recording = false
        writePerf(m.optString("label").ifEmpty { "run" })
      }
      else -> AppLog.write("warn", "unknown app command $cmd")
    }
  }

  /** A web page in a Custom Tab over the app when `inApp`, else whichever app handles the URL. */
  private fun openURL(a: MainActivity, url: String, inApp: Boolean) {
    val u = Uri.parse(url)
    try {
      if (inApp && (u.scheme == "http" || u.scheme == "https")) {
        CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(a, u)
      } else {
        a.startActivity(Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE))
      }
    } catch (e: Throwable) {
      AppLog.write("warn", "no app opens $url")
    }
  }

  /** The share sheet for text, a URL or a file (through the app's FileProvider). */
  private fun share(a: MainActivity, m: JSONObject) {
    val text = listOfNotNull(m.optString("text").ifEmpty { null }, m.optString("url").ifEmpty { null }).joinToString("\n")
    val path = m.optString("path").ifEmpty { null }
    val send = Intent(Intent.ACTION_SEND)
    if (path != null) {
      val file = File(path)
      val uri = try {
        FileProvider.getUriForFile(a, "${a.packageName}.files", file)
      } catch (e: Throwable) {
        AppLog.write("warn", "share: $path is outside the shareable folders")
        return
      }
      val type = MimeTypeMap.getSingleton().getMimeTypeFromExtension(file.extension.lowercase()) ?: "application/octet-stream"
      send.setType(type).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      send.clipData = android.content.ClipData.newRawUri(file.name, uri)
      if (text.isNotEmpty()) send.putExtra(Intent.EXTRA_TEXT, text)
    } else {
      if (text.isEmpty()) return
      send.setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
      m.optString("title").ifEmpty { null }?.let { send.putExtra(Intent.EXTRA_TITLE, it) }
    }
    a.startActivity(Intent.createChooser(send, m.optString("title").ifEmpty { null }))
  }

  private fun writePerf(label: String) {
    val r = rune ?: return
    val a = activity ?: return
    val times = r.frameTimes
    val gaps = JSONArray()
    for (i in 1 until times.size) gaps.put((times[i] - times[i - 1]) * 1000)
    val cpu = JSONArray()
    for (c in r.frameCpuUs) cpu.put(c / 1000)
    val mem = android.os.Debug.MemoryInfo().also { android.os.Debug.getMemoryInfo(it) }
    val obj = JSONObject().put("label", label).put("frames", times.size).put("gapsMs", gaps).put("cpuMs", cpu).put("pssMB", mem.totalPss / 1024.0)
    val f = File(a.filesDir, "perf-$label.json")
    f.writeText(obj.toString())
    AppLog.write("info", "perf $label: ${times.size} frames → ${f.name}")
  }
}

class MainActivity : ComponentActivity() {
  private lateinit var root: FrameLayout
  private lateinit var rune: RuneView
  private val js by lazy { JSRuntime(applicationContext) }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    App.activity = this
    AppLog.open(this)
    Pickers.register(this)
    window.setDecorFitsSystemWindows(false)
    window.statusBarColor = Color.TRANSPARENT
    window.navigationBarColor = Color.TRANSPARENT
    App.dark = isDark(resources.configuration)
    val res = Resources.extract(this)
    AppFonts.register(File(res, "fonts"))

    root = FrameLayout(this)
    root.isFocusableInTouchMode = true
    root.setBackgroundColor(if (App.dark) Color.BLACK else Color.WHITE)
    rune = RuneView(this) { App.dark }
    root.addView(rune, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    setContentView(root)
    App.rune = rune
    App.js = js
    NativeFields.container = root
    NativeFields.focusSink = root

    root.setOnApplyWindowInsetsListener { _, insets ->
      val d = resources.displayMetrics.density
      val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
      App.safeArea = floatArrayOf(bars.top / d, bars.right / d, bars.bottom / d, bars.left / d)
      App.keyboard = insets.getInsets(WindowInsets.Type.ime()).bottom / d
      val h = rune.host
      if (h != 0L) {
        Engine.nativeSafeArea(h, App.safeArea[0], App.safeArea[1], App.safeArea[2], App.safeArea[3])
        Engine.nativeKeyboard(h, App.keyboard)
        rune.wake()
      }
      insets
    }

    Engine.nativeInit(object : Engine.Callbacks {
      override fun event(line: ByteArray) = js.deliver(line)
      override fun nativeMessage(json: ByteArray) {
        val m = try { JSONObject(String(json, Charsets.UTF_8)) } catch (_: Throwable) { return }
        App.native(m)
      }
      override fun wake() = rune.wake()
    }, applicationContext)
    rune.onFirstFrame = {
      App.firstFrameMs = SystemClock.uptimeMillis() - App.processStartMs
      AppLog.write("info", String.format("first frame %.1f ms after process start", App.firstFrameMs))
    }
    js.onAppCommand = { App.command(it) }

    val dm = resources.displayMetrics
    val stellaEnv = HashMap<String, Any?>()
    intent?.extras?.let { ex -> for (k in ex.keySet()) if (k.startsWith("STELLA_")) stellaEnv[k] = ex.get(k)?.toString() }
    App.traceNative = stellaEnv["STELLA_TRACE_NATIVE"] == "true"
    val docs = File(filesDir, "Documents").also { it.mkdirs() }
    val env = hashMapOf<String, Any?>(
      "resources" to res.path,
      "documents" to docs.path,
      "caches" to cacheDir.path,
      "tmp" to File(cacheDir, "tmp").also { it.mkdirs() }.path,
      "platform" to "android",
      "osVersion" to Build.VERSION.RELEASE,
      "model" to Build.MODEL,
      "scale" to dm.density.toDouble(),
      "width" to (dm.widthPixels / dm.density).toDouble(),
      "height" to (dm.heightPixels / dm.density).toDouble(),
      "dark" to App.dark,
      "processStartMs" to App.processStartMs,
      "locale" to Locale.getDefault().toLanguageTag(),
      "userAgent" to App.userAgent,
      "args" to ArrayList<String>(),
      "env" to stellaEnv,
    )
    js.start(File(res, "app.js"), env)
    // Opened by a link (a computer's pairing QR code): TS hears it once the bundle has run.
    intent?.data?.let { u -> if (!(BuildConfig.STELLA_DEV && u.host == "debug")) js.deliver(JSONObject().put("t", "open-url").put("url", u.toString()).toString()) }
    // Back goes to TS, which closes what is on top (a menu or dialog, a drawer, a full-screen view),
    // returns to the Chat tab, or asks to leave (`app.background`).
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        js.deliver(JSONObject().put("t", "phone.back").toString())
      }
    })
    if (BuildConfig.STELLA_DEV) DebugDriver.start(this)
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    val d = isDark(newConfig)
    if (d != App.dark) {
      App.dark = d
      root.setBackgroundColor(if (d) Color.BLACK else Color.WHITE)
      if (rune.host != 0L) Engine.nativeSetDark(rune.host, d)
      rune.wake()
    }
  }

  override fun onResume() {
    super.onResume()
    App.pushAccessibility()
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    val u = intent.data ?: return
    if (BuildConfig.STELLA_DEV && DebugDriver.handle(u)) return
    js.deliver(JSONObject().put("t", "open-url").put("url", u.toString()).toString())
  }

  override fun onDestroy() {
    if (isFinishing) {
      rune.destroy()
    }
    super.onDestroy()
  }

  private fun isDark(c: Configuration) = (c.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
}

/** The APK's assets (app.js, fonts, images) as files, which the JS side and the engine read by path. */
object Resources {
  fun extract(a: Activity): File {
    val stamp = a.packageManager.getPackageInfo(a.packageName, 0).lastUpdateTime
    val dir = File(a.filesDir, "res")
    val mark = File(dir, ".stamp")
    if (mark.isFile && mark.readText() == stamp.toString()) return dir
    dir.deleteRecursively()
    copy(a, "", dir)
    mark.writeText(stamp.toString())
    return dir
  }

  private fun copy(a: Activity, path: String, to: File) {
    val list = a.assets.list(path) ?: return
    if (list.isEmpty()) {
      to.parentFile?.mkdirs()
      a.assets.open(path).use { input -> to.outputStream().use { input.copyTo(it) } }
      return
    }
    to.mkdirs()
    for (name in list) {
      if (path.isEmpty() && (name == "images" || name == "webkit" || name == "geoid_map" || name == "hyph-data")) continue
      copy(a, if (path.isEmpty()) name else "$path/$name", File(to, name))
    }
  }
}
