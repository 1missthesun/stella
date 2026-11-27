package com.stella.rune

import android.view.ContextThemeWrapper
import android.view.Gravity
import android.view.Menu
import android.view.View
import android.widget.FrameLayout
import android.widget.PopupMenu
import org.json.JSONArray
import org.json.JSONObject

/**
 * The engine's `menu.popup` (a message's long-press menu, and every other context menu the shared
 * UI opens) as Android's own pop-up menu at the press point. The picked item's id, or null when
 * the menu is dismissed, goes back to TS as the command's reply, as a desktop menu's pick does.
 */
object Menus {
  fun handle(m: JSONObject): Boolean {
    if (m.optString("cmd") != "menu.popup") return false
    val rid = if (m.has("rid") && !m.isNull("rid")) m.optLong("rid") else null
    val a = App.activity
    val root = NativeFields.container
    val items = m.optJSONArray("items") ?: JSONArray()
    if (a == null || root == null || items.length() == 0) {
      Pickers.reply(rid, null)
      return true
    }
    val d = a.resources.displayMetrics.density
    val x = m.optDouble("x", 0.0).toFloat() * d
    val y = m.optDouble("y", 0.0).toFloat() * d
    // A one-pixel view at the press point for the menu to drop from.
    val anchor = View(a)
    root.addView(anchor, FrameLayout.LayoutParams(1, 1).apply {
      leftMargin = x.toInt().coerceIn(0, maxOf(0, root.width - 1))
      topMargin = y.toInt().coerceIn(0, maxOf(0, root.height - 1))
    })
    val theme = if (App.uiDark) android.R.style.Theme_DeviceDefault else android.R.style.Theme_DeviceDefault_Light
    val popup = PopupMenu(ContextThemeWrapper(a, theme), anchor, Gravity.NO_GRAVITY)
    val ids = HashMap<Int, String>()
    fill(popup.menu, items, ids)
    popup.menu.setGroupDividerEnabled(true)
    var answered = false
    var openingSubmenu = false
    fun answer(id: String?) {
      if (answered) return
      answered = true
      Pickers.reply(rid, id)
    }
    popup.setOnMenuItemClickListener { item ->
      if (item.hasSubMenu()) {
        openingSubmenu = true
        false
      } else {
        answer(ids[item.itemId])
        true
      }
    }
    popup.setOnDismissListener {
      root.removeView(anchor)
      if (openingSubmenu) openingSubmenu = false else answer(null)
    }
    App.haptic("medium")
    popup.show()
    return true
  }

  /** The Electron-style template (`{id, label, enabled, type, checked, submenu}`), a group per run between separators. */
  private fun fill(menu: Menu, items: JSONArray, ids: HashMap<Int, String>) {
    var group = 0
    var order = 0
    for (i in 0 until items.length()) {
      val it = items.optJSONObject(i) ?: continue
      val type = it.optString("type")
      if (type == "separator") {
        group++
        continue
      }
      if (it.has("visible") && !it.optBoolean("visible", true)) continue
      val label = it.optString("label")
      val sub = it.optJSONArray("submenu")
      if (type == "submenu" || sub != null) {
        val s = menu.addSubMenu(group, Menu.NONE, order++, label)
        s.item.isEnabled = it.optBoolean("enabled", true)
        fill(s, sub ?: JSONArray(), ids)
        continue
      }
      val itemId = ids.size + 1
      ids[itemId] = it.optString("id")
      val item = menu.add(group, itemId, order++, label)
      item.isEnabled = it.optBoolean("enabled", true)
      if (type == "checkbox" || type == "radio") {
        item.isCheckable = true
        item.isChecked = it.optBoolean("checked", false)
      }
    }
  }
}
