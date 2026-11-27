package com.stella.rune

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.text.Editable
import android.text.InputType
import android.text.StaticLayout
import android.text.TextWatcher
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.max

/**
 * Stella's text fields on Android are the platform's own: an `EditText` (multi-line for the
 * composer, single-line with autofill hints and secure entry for forms) placed over the box
 * Rune lays out and paints for the `<input>` element. Rune draws the box (fill, border, glass);
 * the text, cursor, selection handles, magnifier, autocorrect, IME, voice typing and autofill
 * are Android's. Engine messages: field / place / hideField / fieldGone / setText / select /
 * focusField / blurField (engine/src/mobile/native.rs), as ios/StellaRune/NativeFields.swift.
 */
@SuppressLint("StaticFieldLeak")
object NativeFields {
  var container: FrameLayout? = null
  /** The view focus goes back to when a field is blurred, so no other field takes it. */
  var focusSink: View? = null
  /**
   * When a finger last lifted (seconds, `System.nanoTime` base). The keyboard comes up only for
   * what the person just did: a focus request without a tap just before it leaves it down.
   */
  var lastTouchEnd = 0.0

  private class Field(val n: Int, val view: StellaEditText) {
    var look: JSONObject = JSONObject()
    var lastHeight = -1f
    var applying = false
    var multiline = false
    var secure = false
    var placed = FloatArray(4) { -1f }
    var text: String
      get() = view.text?.toString() ?: ""
      set(v) {
        view.setText(v)
      }
  }

  /** An EditText that reports selection changes (the platform has no listener for them). */
  class StellaEditText(context: Context) : EditText(context) {
    var onSelection: ((Int, Int) -> Unit)? = null
    override fun onSelectionChanged(selStart: Int, selEnd: Int) {
      super.onSelectionChanged(selStart, selEnd)
      onSelection?.invoke(selStart, selEnd)
    }
  }

  private val fields = HashMap<Int, Field>()
  private val density get() = container?.resources?.displayMetrics?.density ?: 1f

  fun handle(m: JSONObject) {
    val t = m.optString("t")
    val n = m.optInt("n", 0)
    when (t) {
      "field" -> configure(n, m)
      "place" -> {
        val f = fields[n] ?: return
        val r = m.optJSONArray("rect") ?: return
        if (r.length() != 4) return
        place(f, FloatArray(4) { r.optDouble(it, 0.0).toFloat() })
      }
      "hideField" -> {
        // Covered by something Rune draws (a page, a drawer, a dialog): out of sight, and done editing.
        val f = fields[n] ?: return
        if (f.view.hasFocus()) blur()
        f.view.visibility = View.INVISIBLE
      }
      "fieldGone" -> {
        val f = fields.remove(n) ?: return
        if (f.view.hasFocus()) blur()
        container?.removeView(f.view)
      }
      "setText" -> {
        val f = fields[n] ?: return
        val v = m.optString("value", "")
        if (f.text != v) {
          f.applying = true
          f.text = v
          f.view.setSelection(f.view.text.length)
          f.applying = false
          reportHeight(f)
        }
      }
      "select" -> {
        val f = fields[n] ?: return
        val a = m.optInt("start", 0)
        val b = m.optInt("end", a)
        select(f, a, b)
      }
      "focusField" -> {
        val f = fields[n] ?: return
        if (System.nanoTime() / 1e9 - lastTouchEnd >= 1.5) return
        focus(f)
      }
      "blurField" -> blur()
    }
  }

  fun tapOutside() {
    blur()
  }

  private fun focus(f: Field) {
    f.view.requestFocus()
    val imm = f.view.context.getSystemService(InputMethodManager::class.java)
    imm?.showSoftInput(f.view, InputMethodManager.SHOW_IMPLICIT)
  }

  private fun blur() {
    val focused = fields.values.firstOrNull { it.view.hasFocus() } ?: return
    val imm = focused.view.context.getSystemService(InputMethodManager::class.java)
    imm?.hideSoftInputFromWindow(focused.view.windowToken, 0)
    focused.view.clearFocus()
    focusSink?.requestFocus()
  }

  /**
   * Fields move by layout (margins), not `translationX/Y`: a translated EditText over the
   * SurfaceView stopped drawing once it had moved (its text and hint vanished from the window).
   */
  private fun place(f: Field, rect: FloatArray) {
    val d = density
    val v = f.view
    if (!rect.contentEquals(f.placed)) {
      val lp = (v.layoutParams as? FrameLayout.LayoutParams) ?: FrameLayout.LayoutParams(0, 0)
      val w = Math.round(rect[2] * d)
      val h = Math.round(rect[3] * d)
      val x = Math.round(rect[0] * d)
      val y = Math.round(rect[1] * d)
      if (lp.width != w || lp.height != h || lp.leftMargin != x || lp.topMargin != y) {
        lp.width = w
        lp.height = h
        lp.leftMargin = x
        lp.topMargin = y
        lp.gravity = Gravity.TOP or Gravity.START
        v.layoutParams = lp
      }
      val sizeChanged = rect[2] != f.placed[2]
      f.placed = rect
      if (sizeChanged) reportHeight(f)
    }
    if (v.visibility != View.VISIBLE) {
      v.visibility = View.VISIBLE
      // Shown again over the SurfaceView (after `hideField`, or placed while hidden): an EditText
      // made visible in the same pass as a relayout sometimes kept its old, empty drawing, losing
      // the placeholder until the next keystroke. Draw it once more after it has laid out.
      v.post { v.invalidate() }
    }
    if (App.traceNative) v.post { AppLog.write("debug", "field ${f.n}: ${v.width}x${v.height} at ${v.x},${v.y} scroll ${v.scrollX},${v.scrollY} lines ${v.layout?.lineCount} layoutH ${v.layout?.height} alpha ${v.alpha} shown ${v.isShown}") }
  }

  // MARK: configuration

  private fun color(v: Any?): Int? {
    var s = v as? String ?: return null
    if (s.startsWith("#")) s = s.substring(1)
    val n = s.toLongOrNull(16) ?: return null
    return when (s.length) {
      6 -> Color.argb(255, ((n shr 16) and 0xff).toInt(), ((n shr 8) and 0xff).toInt(), (n and 0xff).toInt())
      8 -> Color.argb((n and 0xff).toInt(), ((n shr 24) and 0xff).toInt(), ((n shr 16) and 0xff).toInt(), ((n shr 8) and 0xff).toInt())
      else -> null
    }
  }

  private fun pads(m: JSONObject): FloatArray {
    val a = m.optJSONArray("pad") ?: return FloatArray(4)
    return FloatArray(4) { a.optDouble(it, 0.0).toFloat() }
  }

  private fun configure(n: Int, m: JSONObject) {
    val ctx = container?.context ?: return
    val multiline = m.optBoolean("multiline", false)
    val secure = m.optBoolean("secure", false)
    var f = fields[n]
    if (f != null && (f.multiline != (multiline && !secure) || f.secure != secure)) {
      container?.removeView(f.view)
      fields.remove(n)
      f = null
    }
    val field = f ?: run {
      val et = StellaEditText(ctx)
      et.background = null
      et.isVerticalScrollBarEnabled = false
      et.isHorizontalScrollBarEnabled = false
      et.includeFontPadding = false
      et.visibility = View.INVISIBLE
      val made = Field(n, et)
      made.multiline = multiline && !secure
      made.secure = secure
      fields[n] = made
      container?.addView(et, FrameLayout.LayoutParams(0, 0))
      if (m.has("value")) {
        made.applying = true
        made.text = m.optString("value")
        made.applying = false
      }
      wire(made)
      made
    }
    field.look = m
    val d = density
    val et = field.view
    val size = m.optDouble("size", 16.0).toFloat()
    val weight = m.optDouble("weight", 400.0).toInt()
    et.setTextSize(TypedValue.COMPLEX_UNIT_DIP, size)
    et.typeface = AppFonts.typeface(m.optString("family", "").ifEmpty { null }, weight)
    val fg = color(m.opt("color")) ?: if (App.dark) Color.WHITE else Color.BLACK
    et.setTextColor(fg)
    val lineHeight = m.optDouble("lineHeight", 0.0).toFloat()
    if (lineHeight > 0) et.setLineHeight(TypedValue.COMPLEX_UNIT_DIP, lineHeight)
    val tracking = m.optDouble("tracking", 0.0).toFloat()
    et.letterSpacing = if (size > 0) tracking / size else 0f
    val pad = pads(m)
    et.setPadding(Math.round(pad[3] * d), Math.round(pad[0] * d), Math.round(pad[1] * d), Math.round(pad[2] * d))
    val tint = color(m.opt("caret")) ?: App.accent
    if (Build.VERSION.SDK_INT >= 29) {
      et.textCursorDrawable = GradientDrawable().apply {
        setColor(tint)
        setSize(Math.round(2 * d), Math.round(size * 1.2f * d))
      }
    }
    et.highlightColor = (tint and 0x00ffffff) or 0x55000000
    et.hint = m.optString("placeholder", "").ifEmpty { null }
    et.setHintTextColor(color(m.opt("placeholderColor")) ?: ((fg and 0x00ffffff) or 0x80000000.toInt()))
    val readOnly = m.optBoolean("readOnly", false)
    val spellcheck = if (m.has("spellcheck")) m.optBoolean("spellcheck", true) else true
    if (field.multiline) {
      var type = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
      type = type or if (spellcheck) InputType.TYPE_TEXT_FLAG_AUTO_CORRECT else InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
      if (et.inputType != type) et.inputType = type
      et.isSingleLine = false
      et.gravity = Gravity.TOP or Gravity.START
      et.imeOptions = EditorInfo.IME_FLAG_NO_ENTER_ACTION
    } else {
      val hint = "${m.optString("id")} ${m.optString("label")} ${m.optString("placeholder")}".lowercase()
      var type = InputType.TYPE_CLASS_TEXT
      var autofill: String? = null
      when {
        secure -> {
          type = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
          autofill = View.AUTOFILL_HINT_PASSWORD
        }
        hint.contains("email") || hint.contains("@") -> {
          type = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
          autofill = View.AUTOFILL_HINT_EMAIL_ADDRESS
        }
        hint.contains("code") -> {
          type = InputType.TYPE_CLASS_NUMBER
          autofill = "smsOTPCode"
        }
        !spellcheck -> type = type or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
      }
      if (et.inputType != type) et.inputType = type
      et.isSingleLine = true
      et.gravity = Gravity.CENTER_VERTICAL or Gravity.START
      if (autofill != null) {
        et.setAutofillHints(autofill)
        et.importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_YES
      } else {
        et.importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_AUTO
      }
      et.imeOptions = if (m.optBoolean("submit", false)) EditorInfo.IME_ACTION_GO else EditorInfo.IME_ACTION_DONE
    }
    et.isEnabled = !readOnly
    et.textDirection = if (m.optString("dir") == "rtl") View.TEXT_DIRECTION_RTL else View.TEXT_DIRECTION_FIRST_STRONG
    reportHeight(field)
    if (m.optBoolean("autoFocus", false) && !et.hasFocus()) {
      et.post { focus(field) }
    }
  }

  private fun wire(f: Field) {
    val et = f.view
    et.addTextChangedListener(object : TextWatcher {
      override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
      override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
      override fun afterTextChanged(s: Editable?) {
        reportInput(f)
      }
    })
    et.onSelection = { a, b ->
      if (!f.applying && fields[f.n] === f) send(f.n, JSONObject().put("e", "selection").put("start", a).put("end", b))
    }
    et.setOnFocusChangeListener { _, has ->
      send(f.n, JSONObject().put("e", "focus").put("focused", has))
    }
    et.setOnEditorActionListener { _, action, ev ->
      if (f.multiline) return@setOnEditorActionListener false
      val enter = action == EditorInfo.IME_ACTION_GO || action == EditorInfo.IME_ACTION_DONE || action == EditorInfo.IME_ACTION_SEND ||
        (ev != null && ev.keyCode == KeyEvent.KEYCODE_ENTER && ev.action == KeyEvent.ACTION_DOWN)
      if (!enter) return@setOnEditorActionListener false
      val len = f.text.length
      val mods = JSONObject().put("mod", false).put("shift", false).put("alt", false).put("ctrl", false).put("meta", false)
      send(f.n, JSONObject().put("e", "key").put("key", "Enter").put("chord", "Enter").put("mods", mods).put("value", f.text).put("start", len).put("end", len).put("length", len))
      if (f.look.optBoolean("submit", false)) send(f.n, JSONObject().put("e", "submit"))
      true
    }
  }

  /** A growing field's box follows its text: the text height (without the box's padding), in dp. */
  private fun reportHeight(f: Field) {
    if (!f.multiline) return
    val d = density
    val et = f.view
    val pad = pads(f.look)
    val widthPx = if (f.placed[2] > 0) f.placed[2] * d else 300 * d
    val inner = max(1, (widthPx - (pad[1] + pad[3]) * d).toInt())
    val lh = f.look.optDouble("lineHeight", 20.0).toFloat()
    val text = f.text
    var h = lh
    if (text.isNotEmpty()) {
      val layout = StaticLayout.Builder.obtain(text, 0, text.length, et.paint, inner)
        .setIncludePad(false)
        .setLineSpacing(et.lineSpacingExtra, et.lineSpacingMultiplier)
        .build()
      h = max(lh, ceil(layout.lineCount * lh))
    }
    if (abs(h - f.lastHeight) > 0.25f) {
      f.lastHeight = h
      send(f.n, JSONObject().put("e", "height").put("height", h.toDouble()))
    }
  }

  private fun select(f: Field, a: Int, b: Int) {
    val len = f.view.text.length
    f.applying = true
    f.view.setSelection(a.coerceIn(0, len), b.coerceIn(0, len))
    f.applying = false
  }

  private fun send(n: Int, v: JSONObject) {
    Engine.nativeFieldEvent(n, v.toString().toByteArray(Charsets.UTF_8))
    App.rune?.wake()
  }

  private fun reportInput(f: Field) {
    if (f.applying || fields[f.n] !== f) return
    val v = f.view
    send(f.n, JSONObject().put("e", "input").put("value", f.text).put("start", v.selectionStart).put("end", v.selectionEnd))
    reportHeight(f)
  }

  /** The focused field (the debug driver types into it). */
  fun focused(): EditText? = fields.values.firstOrNull { it.view.hasFocus() }?.view

  /** The field under a point in dp, if any is shown there (the debug driver's taps). */
  fun fieldAt(x: Float, y: Float): EditText? = fields.values.firstOrNull {
    it.view.visibility == View.VISIBLE && x >= it.placed[0] && y >= it.placed[1] && x <= it.placed[0] + it.placed[2] && y <= it.placed[1] + it.placed[3]
  }?.view

  fun focusView(et: EditText) {
    fields.values.firstOrNull { it.view === et }?.let { focus(it) }
  }

  @Suppress("unused")
  private fun JSONArray.floats(): FloatArray = FloatArray(length()) { optDouble(it, 0.0).toFloat() }
}

/** The app's bundled faces (resources/fonts), for native text fields to use Stella's font too. */
object AppFonts {
  var sans: String? = "Manrope"
  private val files = HashMap<String, java.io.File>()
  private val cache = HashMap<String, Typeface>()

  fun register(dir: java.io.File) {
    val list = dir.listFiles() ?: return
    for (f in list) {
      if (!f.name.endsWith(".ttf") && !f.name.endsWith(".otf")) continue
      // "ibm-plex-mono-bold.ttf" → "ibmplexmono" (bold), as a family name "IBM Plex Mono" keys.
      var stem = f.nameWithoutExtension.lowercase()
      val suffix = listOf("-bold", "-medium", "-semibold", "-regular").firstOrNull { stem.endsWith(it) }
      if (suffix != null) stem = stem.removeSuffix(suffix)
      val fam = key(stem)
      if (suffix == null || suffix == "-regular") files[fam] = f else files.putIfAbsent(fam, f)
    }
  }

  private fun key(name: String) = name.lowercase().filter { it in 'a'..'z' }

  fun typeface(family: String?, weight: Int): Typeface {
    val fam = key((family ?: sans ?: "").split(',').first())
    val key = "$fam/$weight"
    cache[key]?.let { return it }
    val file = files[fam] ?: files[key(sans ?: "")]
    val tf = if (file != null) {
      try {
        Typeface.Builder(file).setFontVariationSettings("'wght' $weight").setWeight(weight.coerceIn(1, 1000)).build()
      } catch (_: Throwable) {
        Typeface.create(Typeface.DEFAULT, weight.coerceIn(1, 1000), false)
      }
    } else {
      Typeface.create(Typeface.DEFAULT, weight.coerceIn(1, 1000), false)
    }
    cache[key] = tf
    return tf
  }
}
