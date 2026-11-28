//! Commands from TS (`{cmd, rid?, ...}`), the phone's subset of the desktop's commands.rs:
//! global ones run at once, the rest run in the window's poll with its `Tx`. What only the app
//! can do (clipboard, URLs, the share sheet, haptics, badges, focusing a native field) goes to
//! the app as a native message; a command with a `rid` always gets one reply.

use std::time::Instant;

use rune::Tx;
use serde_json::{Value, json};

use crate::engine::{self, byte_of, reply};
use crate::windows::{self, Win};

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(|x| x.as_str()).unwrap_or("")
}

fn f(v: &Value, k: &str) -> Option<f32> {
    v.get(k).and_then(|x| x.as_f64()).map(|x| x as f32)
}

fn rid_of(v: &Value) -> Option<u64> {
    v.get("rid").and_then(|r| r.as_u64())
}

/// The node a command names: `target` (an element `id` prop) or `n` (a node number).
pub fn target(v: &Value) -> Option<u32> {
    if let Some(n) = v.get("n").and_then(|n| n.as_u64()) {
        return Some(n as u32);
    }
    let key = v.get("target").and_then(|t| t.as_str())?;
    engine::read(|e| e.tree.find_key(key))
}

pub fn route(v: Value) {
    let cmd = s(&v, "cmd").to_owned();
    let rid = rid_of(&v);
    match cmd.as_str() {
        "fonts" => reply(rid, fonts(&v)),
        "colorMotion" => {
            engine::with(|e| e.color_motion = f(&v, "dur"));
            reply(rid, Ok(Value::Null));
        }
        "mark" => reply(rid, Ok(Value::Null)),
        "stage" => {
            crate::stage::command(&v);
            reply(rid, Ok(Value::Null));
        }
        "appearance.get" => reply(rid, Ok(windows::appearance())),
        "screen.displays" => reply(rid, Ok(json!([]))),
        "window.isFocused" => reply(rid, Ok(json!(true))),
        "selection.get" => {
            let t = windows::first_window().and_then(windows::selected_text);
            reply(rid, Ok(json!({ "text": t })));
        }
        // What the app does: clipboard, URLs, share sheet, haptics, badge, notifications.
        "clipboard.writeText" | "clipboard.writeHTML" | "shell.openExternal" | "share" | "haptic" | "app.setBadge" | "notify" | "native" => {
            let mut m = v.clone();
            m["t"] = json!("cmd");
            crate::native::send(m);
            reply(rid, Ok(Value::Null));
        }
        // What only the app can answer (its pickers, the clipboard's contents): the app replies
        // to the rid itself, straight to TS (`{t:"reply", rid, ok, value}`).
        "dialog.openFile" | "clipboard.read" | "clipboard.readText" => {
            let mut m = v.clone();
            m["t"] = json!("cmd");
            crate::native::send(m);
        }
        // A context menu (a message's long press): the phone shows its own (Android's pop-up
        // menu, iOS's edit menu) and answers the rid with the picked id.
        "menu.popup" => {
            let mut m = v.clone();
            m["t"] = json!("cmd");
            crate::native::send(m);
        }
        // The app's own light or dark (its theme, which needn't follow the system's): Android
        // themes its native menus and dialogs to match.
        #[cfg(target_os = "android")]
        "webview.colorScheme" => {
            let mut m = v.clone();
            m["t"] = json!("cmd");
            crate::native::send(m);
            reply(rid, Ok(Value::Null));
        }
        "quit" | "menu.setApplicationMenu" | "tray.create" | "tray.setMenu" | "tray.setTooltip" | "tray.setIcon" | "tray.destroy" | "shortcut.register" | "shortcut.unregister" | "shortcut.unregisterAll" | "app.setAppUserModelId" => {
            reply(rid, Ok(Value::Null))
        }
        // Stella Views' programs run on threads of their own (the desktop's views.rs).
        "views.start" | "views.deliver" | "views.stop" | "views.pause" | "views.resume" => crate::views::command(&cmd, rid, &v),
        // The direct device link (crate stella-p2p, the desktop's p2p.rs): replies and events come
        // from its own runtime's threads.
        c if c.starts_with("p2p.") => crate::p2p::command(c, rid, &v),
        "views.frame" => {
            crate::view_frames::want();
            reply(rid, Ok(Value::Null));
        }
        "view.restore" => {
            let marked: Vec<u32> = engine::read(|e| e.windows.iter().filter(|(_, s)| s.swap_view.is_some()).map(|(w, _)| *w).collect());
            for w in marked {
                windows::queue(w, None, v.clone());
            }
            reply(rid, Ok(Value::Null));
        }
        _ => match windows::first_window() {
            Some(w) if windows::queue(w, rid, v) => {}
            _ => reply(rid, Err(format!("{cmd}: no window to run it in"))),
        },
    }
}

fn fonts(v: &Value) -> Result<Value, String> {
    let mut families = Vec::new();
    let mut errors = Vec::new();
    let files: Vec<String> = v.get("files").and_then(|f| f.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_owned)).collect()).unwrap_or_default();
    let mut loaded = Vec::new();
    let mut count = 0;
    for path in files {
        let stamp = std::fs::metadata(&path).map(|m| (m.len(), m.modified().ok()));
        if stamp.as_ref().is_ok_and(|s| engine::read(|e| e.font_files.get(&path) == Some(s))) {
            count += 1;
            continue;
        }
        match std::fs::read(&path) {
            Ok(bytes) => {
                count += 1;
                loaded.push((path, stamp.ok(), std::sync::Arc::<[u8]>::from(bytes)));
            }
            Err(e) => errors.push(format!("{path}: {e}")),
        }
    }
    engine::with(|e| {
        for (path, stamp, bytes) in loaded {
            if let Some(stamp) = stamp {
                e.font_files.insert(path, stamp);
            }
            e.fonts.push(bytes);
        }
        let sans = v.get("sans").and_then(|x| x.as_str());
        let mono = v.get("mono").and_then(|x| x.as_str());
        if sans.is_some() || mono.is_some() {
            let cur = e.families.clone().unwrap_or(("Inter".into(), "ui-monospace".into()));
            e.families = Some((sans.map(str::to_owned).unwrap_or(cur.0), mono.map(str::to_owned).unwrap_or(cur.1)));
            e.families_gen += 1;
        }
        if let Some((s, m)) = &e.families {
            families.push(s.clone());
            families.push(m.clone());
        }
        for slot in e.windows.values_mut() {
            slot.dirty = true;
        }
    });
    windows::wake_all();
    if !errors.is_empty() && count == 0 {
        return Err(errors.join("; "));
    }
    Ok(json!({ "loaded": count, "errors": errors, "families": families }))
}

/// Saves pasted PNG bytes to a temp file and returns its path.
pub fn save_png(png: &[u8]) -> Option<String> {
    let dir = std::env::temp_dir().join("stella-rune-paste");
    std::fs::create_dir_all(&dir).ok()?;
    let name = format!("paste-{}.png", crate::metrics::epoch_ms() as u64);
    let path = dir.join(name);
    std::fs::write(&path, png).ok()?;
    Some(path.to_string_lossy().into_owned())
}

pub fn quit() {}

fn key_of(n: u32) -> Option<String> {
    engine::read(|e| e.tree.get(n).map(|node| crate::view::rune_key(n, &node.props)))
}

fn is_input(n: u32) -> bool {
    engine::read(|e| e.tree.get(n).is_some_and(|node| node.kind == crate::props::Kind::Input))
}

/// Runs a window command with the window's `Tx`.
pub fn run(st: &mut Win, tx: &mut Tx, rid: Option<u64>, v: Value) {
    let cmd = s(&v, "cmd").to_owned();
    let node = target(&v);
    let tkey = node.and_then(key_of);
    let r: Result<Value, String> = (|| {
        match cmd.as_str() {
            "bg" => {
                st.bg = Some(v.get("color").and_then(|c| c.as_str()).and_then(crate::props::parse_color).ok_or("bg: needs a color")?);
            }
            "scrollTo" => {
                let key = tkey.clone().ok_or("scrollTo: no target")?;
                let x = f(&v, "x").unwrap_or(0.0);
                if v.get("y").and_then(|y| y.as_str()) == Some("end") {
                    if v.get("animate").and_then(|a| a.as_bool()) == Some(false) {
                        tx.scroll_to_bottom_instant(key);
                    } else if let Some(d) = f(&v, "spring").filter(|d| *d > 0.0) {
                        tx.scroll_to_bottom_with(key, rune::Spring::new(d, 0.0));
                    } else {
                        tx.scroll_to_bottom(key);
                    }
                } else {
                    let y = f(&v, "y").unwrap_or(0.0);
                    match (f(&v, "spring"), v.get("animate").and_then(|a| a.as_bool())) {
                        (Some(d), _) if d > 0.0 => tx.scroll_to_with(key, x, y, rune::Spring::new(d, 0.0)),
                        (_, Some(false)) => tx.scroll_to_instant(key, x, y),
                        _ => tx.scroll_to(key, x, y),
                    }
                }
            }
            "scrollIntoView" => tx.scroll_into_view(tkey.clone().ok_or("scrollIntoView: no target")?),
            "scrollPage" => tx.scroll_page(tkey.clone().ok_or("no target")?, f(&v, "pages").unwrap_or(1.0) as i32),
            "stopScroll" => tx.stop_scroll(tkey.clone().ok_or("no target")?),
            "scrollKeyTo" => tx.scroll_key_to(v.get("key").and_then(|k| k.as_str()).ok_or("scrollKeyTo: needs a key")?, f(&v, "at").unwrap_or(0.0)),
            "keepOnScreen" => tx.keep_on_screen(v.get("key").and_then(|k| k.as_str()).ok_or("keepOnScreen: needs a key")?),
            "focus" => match (node, tkey.clone()) {
                // A text field is the app's native view: it takes focus (and the keyboard) there.
                (Some(n), _) if is_input(n) => crate::native::send(json!({ "t": "focusField", "n": n })),
                (_, Some(key)) => tx.focus(key, v.get("ring").and_then(|r| r.as_bool()).unwrap_or(false)),
                _ => return Ok(json!(false)),
            },
            "view.restore" => crate::swap_view::arm(st, tx),
            "blur" => {
                crate::native::send(json!({ "t": "blurField" }));
                tx.blur();
            }
            "selectText" => {
                let key = tkey.clone().ok_or("no target")?;
                match (v.get("start").and_then(|x| x.as_u64()), v.get("end").and_then(|x| x.as_u64())) {
                    (Some(a), Some(b)) => tx.select_text(key, a as usize..b as usize),
                    _ => tx.select_all_text(key),
                }
            }
            "input.set" | "input.select" | "input.get" => {
                let Some(n) = node else {
                    return if cmd == "input.get" { Err("no target".into()) } else { Ok(Value::Null) };
                };
                let state = st.inputs.get_mut(&n).ok_or("no such input")?;
                if cmd == "input.set" {
                    let value = s(&v, "value").to_owned();
                    let sel = match (v.get("start").and_then(|x| x.as_u64()), v.get("end").and_then(|x| x.as_u64())) {
                        (Some(a), Some(b)) => Some((a as usize, b as usize)),
                        _ => None,
                    };
                    state.set(&value, sel);
                    crate::native::send(json!({ "t": "setText", "n": n, "value": value, "start": sel.map(|s| s.0), "end": sel.map(|s| s.1) }));
                    state.push = false;
                } else if cmd == "input.select" {
                    let text = state.edit.text.clone();
                    let a16 = v.get("start").and_then(|x| x.as_u64()).unwrap_or(0) as usize;
                    let b16 = v.get("end").and_then(|x| x.as_u64()).map(|x| x as usize).unwrap_or(text.encode_utf16().count());
                    state.edit.set_selection(byte_of(&text, a16), byte_of(&text, b16));
                    crate::native::send(json!({ "t": "select", "n": n, "start": a16, "end": b16 }));
                }
                let (a, b) = crate::view::selection16(&state.edit);
                return Ok(json!({ "value": state.edit.text, "start": a, "end": b }));
            }
            c if c.starts_with("control.") => return crate::control::command(st, tx, rid, c, &v),
            "scrollRun" => {
                let _ = Instant::now();
            }
            other => return Err(format!("unknown command {other}")),
        }
        Ok(Value::Null)
    })();
    match r {
        Err(e) if e.starts_with('\u{0}') => {}
        r => reply(rid, r),
    }
}
