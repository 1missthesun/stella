//! App-wide native services: notifications, tray icons, global shortcuts.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use rune::{AppHandle, Shortcut, ShortcutId, Tray, TrayEvent, TrayIcon, TrayItem, TraySpec};
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
    let mut n = rune_notify::Notification::new(id.clone(), s(v, "title")).body(s(v, "body")).info("id", id);
    if let Some(actions) = v.get("actions").and_then(|a| a.as_array()) {
        for a in actions {
            n = n.action(s(a, "id"), s(a, "label"));
        }
    }
    Ok(json!(rune_notify::post(&n)))
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
    let id = v.get("id").and_then(|x| x.as_str()).unwrap_or("tray").to_owned();
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
            TRAYS.with(|t| t.borrow_mut().insert(id, tray));
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
            match app.register_shortcut(sc, move |_s: &mut Win, _tx| crate::engine::send(json!({ "t": "shortcut", "accelerator": name }))) {
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
