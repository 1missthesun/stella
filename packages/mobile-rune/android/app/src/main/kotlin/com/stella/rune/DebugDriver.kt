package com.stella.rune

import android.app.Activity
import android.app.UiModeManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import java.io.File

/**
 * Drives the app from the outside in dev builds, as ios/StellaRune/DebugDriver.swift does. Each
 * line appended to `files/driver.txt` (`adb shell run-as com.stella.rune.dev sh -c 'echo … >>
 * files/driver.txt'`) is one `<action>?…` command, also accepted as a
 * `stella-rune://debug/<action>?…` deep link (`adb shell am start -d …`):
 *   tap?x=&y=                    a finger tap (dp), through Rune's touch handling or a native field
 *   drag?x=&y=&dx=&dy=&ms=       a finger drag over ms milliseconds, released moving (flings)
 *   type?text=                   text typed into the focused native field, as the keyboard does
 *   key?name=return|backspace    a key in the focused native field
 *   dark?on=0|1                  the app's appearance
 *   perf?start=label | stop=label  frame recording (files/perf-<label>.json)
 *   kb?h=                        a keyboard height (dp) told to the engine, with no keyboard shown
 *   focusonly?x=&y=              focus the field there without the keyboard
 *   settext?x=&y=&text=          set the text of the field there without focusing it
 *   snapfield[?x=&y=]            draw the focused field (or the one there) alone to files/field.png
 */
object DebugDriver {
  private val main = Handler(Looper.getMainLooper())
  private var file: File? = null

  fun start(a: Activity) {
    val f = File(a.filesDir, "driver.txt")
    file = f
    f.delete()
    val poll = object : Runnable {
      override fun run() {
        if (f.isFile && f.length() > 0) {
          val text = f.readText()
          f.delete()
          for (line in text.split('\n')) {
            val l = line.trim()
            if (l.isNotEmpty()) handle(Uri.parse("stella-rune://debug/$l"))
          }
        }
        main.postDelayed(this, 100)
      }
    }
    main.postDelayed(poll, 100)
  }

  fun handle(u: Uri): Boolean {
    if (u.host != "debug") return false
    val app = App.rune ?: return true
    fun num(k: String, d: Double) = u.getQueryParameter(k)?.toDoubleOrNull() ?: d
    when (u.path) {
      "/tap" -> {
        val x = num("x", 0.0).toFloat()
        val y = num("y", 0.0).toFloat()
        val field = NativeFields.fieldAt(x, y)
        if (field != null) {
          NativeFields.lastTouchEnd = System.nanoTime() / 1e9
          NativeFields.focusView(field)
          return true
        }
        app.inject(9001, 0, x, y)
        main.postDelayed({
          app.inject(9001, 2, x, y)
          NativeFields.tapOutside()
        }, 60)
      }
      "/drag" -> {
        val x = num("x", 200.0)
        val y = num("y", 500.0)
        val dx = num("dx", 0.0)
        val dy = num("dy", -300.0)
        val ms = maxOf(16.0, num("ms", 250.0))
        val steps = maxOf(2, (ms / 8).toInt())
        app.inject(9002, 0, x.toFloat(), y.toFloat())
        for (i in 1..steps) {
          val f = i.toDouble() / steps
          main.postDelayed({
            app.inject(9002, if (i == steps) 2 else 1, (x + dx * f).toFloat(), (y + dy * f).toFloat())
          }, (ms * f).toLong())
        }
      }
      "/type" -> {
        val et = NativeFields.focused() ?: return true
        val text = u.getQueryParameter("text") ?: ""
        val s = et.selectionStart.coerceAtLeast(0)
        val e = et.selectionEnd.coerceAtLeast(0)
        et.text.replace(minOf(s, e), maxOf(s, e), text)
      }
      "/key" -> {
        val et = NativeFields.focused() ?: return true
        val code = if (u.getQueryParameter("name") == "backspace") KeyEvent.KEYCODE_DEL else KeyEvent.KEYCODE_ENTER
        et.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, code))
        et.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_UP, code))
      }
      "/dark" -> {
        val a = App.activity ?: return true
        if (Build.VERSION.SDK_INT >= 31) {
          a.getSystemService(UiModeManager::class.java)?.setApplicationNightMode(if (u.getQueryParameter("on") == "1") UiModeManager.MODE_NIGHT_YES else UiModeManager.MODE_NIGHT_NO)
        }
      }
      "/perf" -> {
        u.getQueryParameter("start")?.let { App.command(org.json.JSONObject().put("cmd", "perf.start").put("label", it)) }
        u.getQueryParameter("stop")?.let { App.command(org.json.JSONObject().put("cmd", "perf.stop").put("label", it)) }
      }
      "/focusonly" -> {
        // Focus the field under x,y without asking for the keyboard.
        NativeFields.fieldAt(num("x", 0.0).toFloat(), num("y", 0.0).toFloat())?.requestFocus()
      }
      "/kb" -> {
        // A keyboard height (dp) told to the engine, with no keyboard shown.
        Engine.nativeKeyboard(app.host, num("h", 0.0).toFloat())
        app.wake()
      }
      "/settext" -> {
        // Text set on the field under x,y without focusing it (no keyboard).
        val et = NativeFields.fieldAt(num("x", 0.0).toFloat(), num("y", 0.0).toFloat()) ?: return true
        et.setText(u.getQueryParameter("text") ?: "")
      }
      "/snapfield" -> {
        // The first field drawn by itself into files/field.png, apart from the window.
        val et = NativeFields.focused() ?: NativeFields.fieldAt(num("x", 0.0).toFloat(), num("y", 0.0).toFloat()) ?: return true
        val bmp = android.graphics.Bitmap.createBitmap(maxOf(1, et.width), maxOf(1, et.height), android.graphics.Bitmap.Config.ARGB_8888)
        bmp.eraseColor(android.graphics.Color.MAGENTA)
        et.draw(android.graphics.Canvas(bmp))
        File(et.context.filesDir, "field.png").outputStream().use { bmp.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        val r = android.graphics.Rect()
        val vis = et.getGlobalVisibleRect(r)
        val parent = et.parent as android.view.ViewGroup
        AppLog.write("info", "field snapshot: text='${et.text}' color=${Integer.toHexString(et.currentTextColor)} size=${et.textSize} vis=$vis rect=$r alpha=${et.alpha} tx=${et.translationX},${et.translationY} z=${et.z} layer=${et.layerType} clip=${et.clipBounds} index=${parent.indexOfChild(et)}/${parent.childCount} rune.z=${App.rune?.z} focused=${et.isFocused} drawn=${et.isDirty}")
      }
      else -> AppLog.write("warn", "debug driver: unknown ${u.path}")
    }
    return true
  }
}
