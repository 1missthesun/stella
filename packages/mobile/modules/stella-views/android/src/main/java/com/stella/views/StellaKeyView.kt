package com.stella.views

import android.content.Context
import android.content.res.Configuration
import android.view.KeyEvent
import android.view.MotionEvent
import android.widget.EditText
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/**
 * A view's `useKey` chords from a hardware keyboard. Chords arrive canonical from JS
 * (`mod+shift+alt+ctrl+key`, mod being Ctrl as on desktops other than macOS); a key that matches
 * one fires `onChord` and is consumed. Plain typing into a focused text field inside is left alone.
 */
class StellaKeyView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onChord by EventDispatcher()
  var chords: Set<String> = emptySet()
  private var autoFocus = false
  private val consumed = HashSet<Int>()

  init {
    isFocusable = true
    isFocusableInTouchMode = true
    descendantFocusability = FOCUS_AFTER_DESCENDANTS
  }

  fun setAutoFocus(value: Boolean) {
    autoFocus = value
    if (value) focusSoon()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (autoFocus) focusSoon()
  }

  private fun focusSoon() {
    post { if (isAttachedToWindow && findFocus() == null) requestFocus() }
  }

  private val hasHardwareKeyboard: Boolean
    get() = resources.configuration.keyboard != Configuration.KEYBOARD_NOKEYS &&
      resources.configuration.hardKeyboardHidden == Configuration.HARDKEYBOARDHIDDEN_NO

  override fun onInterceptTouchEvent(event: MotionEvent): Boolean {
    if (event.actionMasked == MotionEvent.ACTION_DOWN && hasHardwareKeyboard && findFocus() == null) requestFocus()
    return false
  }

  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    if (event.action == KeyEvent.ACTION_UP && consumed.remove(event.keyCode)) return true
    if (event.action == KeyEvent.ACTION_DOWN) {
      val chord = chord(event)
      val typing = findFocus() is EditText && !event.isCtrlPressed && !event.isAltPressed && !event.isMetaPressed
      if (chord != null && !typing && chord in chords) {
        consumed.add(event.keyCode)
        onChord(mapOf("chord" to chord))
        return true
      }
    }
    return super.dispatchKeyEvent(event)
  }

  companion object {
    private val named = mapOf(
      KeyEvent.KEYCODE_ENTER to "enter", KeyEvent.KEYCODE_NUMPAD_ENTER to "enter",
      KeyEvent.KEYCODE_ESCAPE to "escape", KeyEvent.KEYCODE_TAB to "tab",
      KeyEvent.KEYCODE_DEL to "backspace", KeyEvent.KEYCODE_FORWARD_DEL to "delete",
      KeyEvent.KEYCODE_SPACE to " ", KeyEvent.KEYCODE_DPAD_UP to "arrowup",
      KeyEvent.KEYCODE_DPAD_DOWN to "arrowdown", KeyEvent.KEYCODE_DPAD_LEFT to "arrowleft",
      KeyEvent.KEYCODE_DPAD_RIGHT to "arrowright", KeyEvent.KEYCODE_MOVE_HOME to "home",
      KeyEvent.KEYCODE_MOVE_END to "end", KeyEvent.KEYCODE_PAGE_UP to "pageup",
      KeyEvent.KEYCODE_PAGE_DOWN to "pagedown",
    ) + (1..12).associate { KeyEvent.KEYCODE_F1 + it - 1 to "f$it" }

    fun chord(event: KeyEvent): String? {
      val name = named[event.keyCode] ?: event.getUnicodeChar(0).takeIf { it > 0 }?.let { String(Character.toChars(it)).lowercase() } ?: return null
      val parts = ArrayList<String>(5)
      if (event.isCtrlPressed) parts.add("mod")
      if (event.isShiftPressed) parts.add("shift")
      if (event.isAltPressed) parts.add("alt")
      parts.add(name)
      return parts.joinToString("+")
    }
  }
}
