//! App-wide native services: notifications, tray icons, global shortcuts, the app badge.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use rune::{AppHandle, MenuItem, Shortcut, ShortcutId, Tray, TrayEvent, TrayIcon, TrayItem, TraySpec};
use serde_json::{Value, json};

use crate::windows::{Win, send_any_thread};

pub static APP: OnceLock<AppHandle<Win>> = OnceLock::new();
static SHORTCUTS: Mutex<Option<HashMap<String, ShortcutId>>> = Mutex::new(None);

thread_local! {
    static TRAYS: std::cell::RefCell<HashMap<String, Tray>> = std::cell::RefCell::new(HashMap::new());
}

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(|x| x.as_str()).unwrap_or("")
}

pub fn notify(v: &Value) -> Result<Value, String> {
    static CLICKS: OnceLock<()> = OnceLock::new();
    CLICKS.get_or_init(|| {
        rune_notify::on_click(|c| {
            send_any_thread(json!({ "t": "notification", "id": c.get("id"), "action": c.action().unwrap_or("click"), "reply": c.input("reply") }));
        });
    });
    let id = s(v, "id").to_owned();
    let silent = v.get("silent").and_then(|b| b.as_bool()).unwrap_or(false);
    let mut n = rune_notify::Notification::new(id.clone(), s(v, "title")).body(s(v, "body")).sound(!silent).info("id", id);
    if let Some(actions) = v.get("actions").and_then(|a| a.as_array()) {
        for a in actions {
            n = n.action(s(a, "id"), s(a, "label"));
        }
    }
    Ok(json!(rune_notify::post(&n)))
}

/// Electron's `app.setAppUserModelId`: the process's identity, which its toasts post under.
pub fn set_app_user_model_id(v: &Value) -> Result<Value, String> {
    rune_notify::adopt(&rune_notify::Identity::new(s(v, "id"), "Stella"))?;
    Ok(Value::Null)
}

fn icon(v: &Value) -> Result<TrayIcon, String> {
    let bytes = match v.get("blob").and_then(|b| b.as_u64()) {
        Some(id) => crate::engine::read(|e| e.blobs.get(&(id as u32)).map(|b| b.to_vec())).ok_or("no such blob")?,
        None => std::fs::read(s(v, "icon")).map_err(|e| format!("tray icon {}: {e}", s(v, "icon")))?,
    };
    let img = rune::image::png_rgba8(&bytes).map_err(|e| e.to_string())?;
    let (w, h) = img.dimensions();
    Ok(TrayIcon::rgba(w, h, img.into_raw()).template(v.get("template").and_then(|t| t.as_bool()).unwrap_or(false)))
}

fn tray_menu(v: &Value) -> Vec<TrayItem> {
    let Some(items) = v.get("menu").and_then(|m| m.as_array()) else { return Vec::new() };
    items
        .iter()
        .map(|it| {
            if s(it, "type") == "separator" {
                return TrayItem::Separator;
            }
            let enabled = it.get("enabled").and_then(|e| e.as_bool()).unwrap_or(true);
            match it.get("checked").and_then(|c| c.as_bool()) {
                Some(c) => TrayItem::check(s(it, "id"), s(it, "label"), c).enabled(enabled),
                None => TrayItem::action(s(it, "id"), s(it, "label")).enabled(enabled),
            }
        })
        .collect()
}

pub fn tray(cmd: &str, v: &Value) -> Result<Value, String> {
    static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(1);
    let id = match v.get("id").and_then(|x| x.as_str()) {
        Some(id) => id.to_owned(),
        None if cmd == "tray.create" => format!("tray-{}", NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)),
        None => "tray-1".to_owned(),
    };
    match cmd {
        "tray.create" => {
            let spec = TraySpec::new(id.clone(), s(v, "title"), icon(v)?).tooltip(s(v, "tooltip")).menu(tray_menu(v));
            let tid = id.clone();
            let tray = Tray::new(spec, move |ev| {
                let e = match ev {
                    TrayEvent::Activate { .. } => json!({ "t": "tray", "id": tid, "kind": "click" }),
                    TrayEvent::Menu(item) => json!({ "t": "tray", "id": tid, "kind": "menu", "item": item }),
                    _ => return,
                };
                send_any_thread(e);
            })
            .map_err(|e| format!("{e:?}"))?;
            TRAYS.with(|t| t.borrow_mut().insert(id.clone(), tray));
            return Ok(json!(id));
        }
        "tray.destroy" => {
            TRAYS.with(|t| t.borrow_mut().remove(&id));
        }
        _ => {
            let icon = if cmd == "tray.setIcon" { Some(icon(v)?) } else { None };
            TRAYS.with(|t| -> Result<(), String> {
                let t = t.borrow();
                let tray = t.get(&id).ok_or("no such tray")?;
                match cmd {
                    "tray.setMenu" => tray.set_menu(tray_menu(v)),
                    "tray.setTooltip" => tray.set_tooltip(s(v, "tooltip")),
                    "tray.setIcon" => tray.set_icon(icon.ok_or("no icon")?).map_err(|e| format!("{e:?}"))?,
                    _ => {}
                }
                Ok(())
            })?;
        }
    }
    Ok(Value::Null)
}

fn menu_items(items: &[Value]) -> Vec<MenuItem<Win>> {
    items
        .iter()
        .filter(|it| it.get("visible").and_then(|v| v.as_bool()) != Some(false))
        .map(|it| {
            if s(it, "type") == "separator" {
                return MenuItem::separator();
            }
            let label = s(it, "label").to_owned();
            let id = match s(it, "id") {
                "" => label.clone(),
                id => id.to_owned(),
            };
            let item = match it.get("submenu").and_then(|m| m.as_array()) {
                Some(sub) => MenuItem::submenu(label, menu_items(sub)),
                None => {
                    let picked = id.clone();
                    let mut item = MenuItem::with_action(label, move |_s: &mut Win, _tx: &mut rune::Tx| crate::engine::send(json!({ "t": "menu", "id": picked })));
                    if let Some(sc) = it.get("accelerator").and_then(|a| a.as_str()).and_then(|a| accelerator(a).parse::<Shortcut>().ok()) {
                        item = item.key_equivalent(sc);
                    }
                    match SYSTEM_ACTIONS.iter().find(|(role, _)| *role == s(it, "role")) {
                        Some((_, action)) => item.system_action(*action),
                        None => item,
                    }
                }
            };
            item.id(id)
                .enabled(it.get("enabled").and_then(|e| e.as_bool()).unwrap_or(true))
                .checked(it.get("checked").and_then(|c| c.as_bool()).unwrap_or(false))
        })
        .collect()
}

/// The roles Electron gives AppKit's own items on macOS (`electron_menu_controller.mm`): Rune's
/// default menu bar already holds each one, where Electron's default menu has it.
const NATIVE_ROLES: &[&str] = &[
    "about", "hide", "hideothers", "unhide", "front", "undo", "redo", "cut", "copy", "paste", "delete",
    "pasteandmatchstyle", "selectall", "showsubstitutions", "togglesmartquotes", "togglesmartdashes",
    "toggletextreplacement", "startspeaking", "stopspeaking", "minimize", "close", "zoom", "quit", "services",
];

/// The roles Electron's macOS menu sends to the first responder as AppKit actions
/// (`electron_menu_controller.mm` kRolesMap) that Rune's default menu bar has no item for.
const SYSTEM_ACTIONS: &[(&str, &str)] = &[("togglefullscreen", "toggleFullScreenMode:")];

/// An Electron template without its native-role items, the submenus they leave empty and the
/// separators left leading, trailing or doubled.
fn without_native(items: &[Value]) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    for it in items {
        if NATIVE_ROLES.contains(&s(it, "role")) {
            continue;
        }
        if s(it, "type") == "separator" {
            if out.last().is_some_and(|l| s(l, "type") != "separator") {
                out.push(it.clone());
            }
            continue;
        }
        let mut it = it.clone();
        if let Some(sub) = it.get("submenu").and_then(Value::as_array) {
            let sub = without_native(sub);
            if sub.is_empty() {
                continue;
            }
            it["submenu"] = Value::Array(sub);
        }
        out.push(it);
    }
    while out.last().is_some_and(|l| s(l, "type") == "separator") {
        out.pop();
    }
    out
}

/// `menu.setApplicationMenu`: Electron's template, each top-level submenu becoming a menu-bar
/// menu (`role: "appmenu"` is the app menu). macOS only; elsewhere the app draws its menus.
pub fn app_menu(v: &Value) -> Result<Value, String> {
    let app = APP.get().ok_or("no app")?;
    let top = v.get("items").and_then(|m| m.as_array()).cloned().unwrap_or_default();
    let mut items = Vec::new();
    for t in &top {
        let app_menu = s(t, "role").eq_ignore_ascii_case("appmenu");
        let sub = without_native(t.get("submenu").and_then(|m| m.as_array()).map(Vec::as_slice).unwrap_or(&[]));
        for item in menu_items(&sub) {
            items.push(if app_menu { item } else { item.menu(s(t, "label").to_owned()) });
        }
    }
    match app.set_menu(items) {
        Ok(()) => Ok(json!(true)),
        Err(rune::MenuError::Unsupported) => Ok(json!(false)),
        Err(e) => Err(format!("{e:?}")),
    }
}

/// Electron accelerators (`CommandOrControl+Shift+K`) in Rune's chord syntax.
fn accelerator(a: &str) -> String {
    a.split('+')
        .map(|p| match p.trim().to_ascii_lowercase().as_str() {
            "commandorcontrol" | "cmdorctrl" => "mod".to_owned(),
            "command" | "cmd" | "super" | "meta" => "super".to_owned(),
            "control" | "ctrl" => "ctrl".to_owned(),
            "option" | "alt" | "altgr" => "alt".to_owned(),
            other => other.to_owned(),
        })
        .collect::<Vec<_>>()
        .join("+")
}

pub fn shortcut(cmd: &str, v: &Value) -> Result<Value, String> {
    let app = APP.get().ok_or("no app")?;
    let accel = s(v, "accelerator").to_owned();
    let mut map = SHORTCUTS.lock().unwrap_or_else(|e| e.into_inner());
    let map = map.get_or_insert_with(HashMap::new);
    match cmd {
        "shortcut.register" => {
            if map.contains_key(&accel) {
                return Ok(json!(true));
            }
            let sc: Shortcut = accelerator(&accel).parse().map_err(|e| format!("{e:?}"))?;
            let name = accel.clone();
            let fire = move |_s: &mut Win, _tx: &mut rune::Tx| crate::engine::send(json!({ "t": "shortcut", "accelerator": name, "accel": name }));
            let registered = match (v.get("id").and_then(Value::as_str), v.get("description").and_then(Value::as_str)) {
                (None, None) => app.register_shortcut(sc, fire),
                (id, description) => app.register_shortcut_named(sc, id.unwrap_or(""), description.unwrap_or(""), fire),
            };
            match registered {
                Ok(id) => {
                    map.insert(accel, id);
                    Ok(json!(true))
                }
                Err(e) => {
                    eprintln!("stella-engine: shortcut {accel}: {e:?}");
                    Ok(json!(false))
                }
            }
        }
        "shortcut.unregister" => {
            if let Some(id) = map.remove(&accel) {
                app.unregister_shortcut(id).map_err(|e| format!("{e:?}"))?;
            }
            Ok(Value::Null)
        }
        _ => {
            for (_, id) in map.drain() {
                let _ = app.unregister_shortcut(id);
            }
            Ok(Value::Null)
        }
    }
}

/// `app.setBadge`: Electron's `app.dock.setBadge` / `app.setBadgeCount`. macOS shows `label` as
/// given on the Dock icon; Windows shows its count over the main window's taskbar button (Rune's
/// overlay reads "9+" above 9); Linux has no badge yet.
pub fn badge(v: &Value) -> Result<Value, String> {
    let label = s(v, "label");
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::NSApplication;
        let mtm = objc2::MainThreadMarker::new().ok_or("app.setBadge: not on the main thread")?;
        let tile = NSApplication::sharedApplication(mtm).dockTile();
        let text = (!label.is_empty()).then(|| objc2_foundation::NSString::from_str(label));
        tile.setBadgeLabel(text.as_deref());
        Ok(json!(true))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let count = v.get("count").and_then(|c| c.as_u64()).or_else(|| label.trim_end_matches('+').parse().ok()).unwrap_or(0);
        let handle = crate::engine::read(|e| e.main_handle.clone()).ok_or("app.setBadge: no main window")?;
        handle.set_taskbar(rune::Taskbar::new().badge(count.min(u64::from(u32::MAX)) as u32, label));
        Ok(json!(cfg!(target_os = "windows")))
    }
}
