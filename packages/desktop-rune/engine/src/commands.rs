//! Commands from TS (`{cmd, rid?, ...}`). `route` runs the global ones at once and queues the
//! rest on the window they concern (named by `window`, or the window holding `target`), where
//! `run` executes them with that window's `Tx`. A command with a `rid` always gets one reply.

use std::path::PathBuf;
use std::time::Instant;

use rune::{FileDialogOptions, PopupItem, PopupMenu, Tx};
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

fn window_named(v: &Value) -> Option<u32> {
    if let Some(w) = v.get("window").and_then(|w| w.as_str()) {
        return engine::read(|e| e.tree.find_key(w).filter(|n| e.windows.contains_key(n)));
    }
    if let Some(w) = v.get("window").and_then(|w| w.as_u64()) {
        return Some(w as u32);
    }
    let t = target(v)?;
    engine::read(|e| e.tree.window_of(t))
}

pub fn route(v: Value) {
    let cmd = s(&v, "cmd").to_owned();
    let rid = rid_of(&v);
    match cmd.as_str() {
        "fonts" => reply(rid, fonts(&v)),
        #[cfg(feature = "webview")]
        "webview.respond" => reply(rid, engine::read(|e| crate::webview::command(&cmd, 0, &v, &e.blobs))),
        "colorMotion" => {
            engine::with(|e| e.color_motion = f(&v, "dur").filter(|d| *d > 0.0));
            reply(rid, Ok(Value::Null));
        }
        "recStart" => {
            crate::metrics::METRICS.lock().unwrap_or_else(|e| e.into_inner()).rec_start(v.get("label").and_then(|l| l.as_str()).unwrap_or("run"));
            reply(rid, Ok(Value::Null));
        }
        "recStop" => {
            let out = crate::metrics::METRICS.lock().unwrap_or_else(|e| e.into_inner()).rec_stop(v.get("frames").and_then(|f| f.as_bool()).unwrap_or(false));
            engine::send(json!({ "t": "rec", "result": out }));
            reply(rid, Ok(out));
        }
        "mark" => {
            crate::metrics::METRICS.lock().unwrap_or_else(|e| e.into_inner()).log(json!({ "mark": v.get("name"), "at": crate::metrics::epoch_ms() }));
        }
        "screen.displays" => reply(rid, Ok(displays())),
        "capture.sources" | "capture.start" | "capture.stop" => crate::capture::command(&cmd, rid, &v),
        "inputhook.start" | "inputhook.stop" => crate::inputhook::command(&cmd, rid, &v),
        "audio.play" | "audio.control" | "audio.devices" => crate::audio::command(&cmd, rid, &v),
        "appearance.get" => reply(rid, Ok(windows::appearance())),
        "selection.get" => {
            let w = window_named(&v).or_else(windows::first_window);
            let text = w.and_then(windows::selected_text);
            let rect = w.and_then(windows::selection_rect);
            reply(rid, Ok(text.map_or(Value::Null, |t| match rect {
                Some(r) => json!({ "text": t, "rect": r }),
                None => json!({ "text": t }),
            })));
        }
        "selection.lookUp" => reply(rid, Ok(json!(false))),
        "window.isFocused" => reply(rid, Ok(json!(window_named(&v).or_else(windows::first_window).is_some_and(|w| engine::read(|e| e.windows.get(&w).is_some_and(|s| s.focused)))))),
        "menu.setApplicationMenu" => reply(rid, crate::services::app_menu(&v)),
        "screen.cursorPoint" => reply(rid, Err("screen.cursorPoint: Rune doesn't report the pointer outside its windows".into())),
        "notify" => reply(rid, crate::services::notify(&v)),
        "app.setBadge" => reply(rid, crate::services::badge(&v)),
        "tray.create" | "tray.setMenu" | "tray.setTooltip" | "tray.setIcon" | "tray.destroy" => reply(rid, crate::services::tray(&cmd, &v)),
        "shortcut.register" | "shortcut.unregister" | "shortcut.unregisterAll" => reply(rid, crate::services::shortcut(&cmd, &v)),
        "quit" => quit(),
        _ => {
            let w = window_named(&v).or_else(windows::first_window);
            match w {
                Some(w) if windows::queue(w, rid, v) => {}
                _ => reply(rid, Err(format!("{cmd}: no window to run it in"))),
            }
        }
    }
}

pub fn quit() {
    if let Some(mut c) = engine::with(|e| e.child.take()) {
        let _ = c.kill();
        let _ = c.wait();
    }
    std::process::exit(0);
}

fn fonts(v: &Value) -> Result<Value, String> {
    let mut families = Vec::new();
    let mut errors = Vec::new();
    let files: Vec<String> = v.get("files").and_then(|f| f.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_owned)).collect()).unwrap_or_default();
    let mut loaded = Vec::new();
    for path in files {
        match std::fs::read(&path) {
            Ok(bytes) => loaded.push(std::sync::Arc::<[u8]>::from(bytes)),
            Err(e) => errors.push(format!("{path}: {e}")),
        }
    }
    let count = loaded.len();
    engine::with(|e| {
        e.fonts.extend(loaded);
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

/// Electron display ids are numbers; this one is stable for a monitor name and position.
pub(crate) fn display_id(name: &str, at: (i32, i32)) -> u32 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    (name, at).hash(&mut h);
    h.finish() as u32
}

fn displays() -> Value {
    let list: Vec<Value> = rune::displays()
        .into_iter()
        .map(|d| {
            let ((wx, wy), (ww, wh)) = d.work_area();
            let k = if d.scale > 0.0 { d.scale } else { 1.0 };
            let pt = |v: f64| (v / k).round();
            json!({
                "id": display_id(d.name.as_deref().unwrap_or(""), d.position),
                "label": d.name,
                "primary": d.primary,
                "scaleFactor": d.scale,
                "bounds": { "x": pt(d.position.0 as f64), "y": pt(d.position.1 as f64), "width": pt(d.size.0 as f64), "height": pt(d.size.1 as f64) },
                "workArea": { "x": pt(wx as f64), "y": pt(wy as f64), "width": pt(ww as f64), "height": pt(wh as f64) },
                "physical": { "x": d.position.0, "y": d.position.1, "width": d.size.0, "height": d.size.1 },
            })
        })
        .collect();
    json!(list)
}

/// Saves clipboard/pasted PNG bytes to a temp file and returns its path.
pub fn save_png(png: &[u8]) -> Option<String> {
    let dir = std::env::temp_dir().join("stella-rune-paste");
    std::fs::create_dir_all(&dir).ok()?;
    let name = format!("paste-{}-{}.png", std::process::id(), crate::metrics::epoch_ms() as u64);
    let path = dir.join(name);
    std::fs::write(&path, png).ok()?;
    Some(path.to_string_lossy().into_owned())
}

fn dialog_options(v: &Value) -> FileDialogOptions {
    let mut o = FileDialogOptions { title: s(v, "title").to_owned(), ..Default::default() };
    if let Some(p) = v.get("defaultPath").and_then(|x| x.as_str()) {
        let p = PathBuf::from(p);
        if p.is_dir() {
            o.directory = Some(p);
        } else {
            o.directory = p.parent().map(|d| d.to_path_buf());
            o.file_name = p.file_name().map(|n| n.to_string_lossy().into_owned());
        }
    }
    if let Some(filters) = v.get("filters").and_then(|x| x.as_array()) {
        for fl in filters {
            let name = s(fl, "name").to_owned();
            let exts: Vec<String> = fl.get("extensions").and_then(|e| e.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_owned)).collect()).unwrap_or_default();
            o.filters.push((name, exts));
        }
    }
    o
}

fn menu_of(items: &[Value]) -> PopupMenu {
    let mut m = PopupMenu::new();
    for it in items {
        if s(it, "type") == "separator" || it.get("separator").and_then(|x| x.as_bool()) == Some(true) {
            m = m.separator();
            continue;
        }
        let label = s(it, "label").to_owned();
        if let Some(sub) = it.get("submenu").and_then(|x| x.as_array()) {
            let enabled = it.get("enabled").and_then(|x| x.as_bool()).unwrap_or(true);
            m = m.submenu_enabled(label, menu_of(sub), enabled);
            continue;
        }
        let mut item = PopupItem::new(s(it, "id"), label);
        if let Some(e) = it.get("enabled").and_then(|x| x.as_bool()) {
            item = item.enabled(e);
        }
        if let Some(c) = it.get("checked").and_then(|x| x.as_bool()) {
            item = item.checked(c);
        }
        m = m.item(item);
    }
    m
}

fn window_node(s: &Win) -> u32 {
    s.node
}

fn handle(s: &Win) -> Option<rune::WindowHandle> {
    engine::read(|e| e.windows.get(&s.node).and_then(|w| w.handle.clone()))
}

fn key_of(n: u32) -> Option<String> {
    engine::read(|e| e.tree.get(n).map(|node| crate::view::rune_key(n, &node.props)))
}

/// Runs a window command with that window's `Tx`.
pub fn run(st: &mut Win, tx: &mut Tx, rid: Option<u64>, v: Value) {
    let cmd = s(&v, "cmd").to_owned();
    let tkey = target(&v).and_then(key_of);
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
            "focus" => tx.focus(tkey.clone().ok_or("focus: no target")?, v.get("ring").and_then(|r| r.as_bool()).unwrap_or(false)),
            "blur" => tx.blur(),
            "selectText" => {
                let key = tkey.clone().ok_or("no target")?;
                match (v.get("start").and_then(|x| x.as_u64()), v.get("end").and_then(|x| x.as_u64())) {
                    (Some(a), Some(b)) => tx.select_text(key, a as usize..b as usize),
                    _ => tx.select_all_text(key),
                }
            }
            "input.set" | "input.select" | "input.get" => {
                let n = target(&v).ok_or("no target")?;
                let state = st.inputs.get_mut(&n).ok_or("no such input")?;
                if cmd == "input.set" {
                    let value = s(&v, "value").to_owned();
                    let sel = match (v.get("start").and_then(|x| x.as_u64()), v.get("end").and_then(|x| x.as_u64())) {
                        (Some(a), Some(b)) => Some((a as usize, b as usize)),
                        _ => None,
                    };
                    state.set(&value, sel);
                } else if cmd == "input.select" {
                    let text = state.edit.text.clone();
                    let a = byte_of(&text, v.get("start").and_then(|x| x.as_u64()).unwrap_or(0) as usize);
                    let b = byte_of(&text, v.get("end").and_then(|x| x.as_u64()).map(|x| x as usize).unwrap_or(usize::MAX));
                    state.edit.set_selection(a, b);
                }
                let (a, b) = crate::view::selection16(&state.edit);
                return Ok(json!({ "value": state.edit.text, "start": a, "end": b }));
            }
            "window.minimize" => tx.minimize(),
            "window.maximize" | "window.unmaximize" | "window.toggleMaximize" => {
                let maxed = handle(st).and_then(|h| h.placement()).map(|p| p.maximized).unwrap_or(false);
                let want = match cmd.as_str() {
                    "window.maximize" => true,
                    "window.unmaximize" => false,
                    _ => !maxed,
                };
                if want != maxed {
                    tx.toggle_maximized();
                }
            }
            "window.setFullScreen" => tx.set_full_screen(v.get("on").and_then(|x| x.as_bool()).unwrap_or(true)),
            "window.center" => tx.center_window(),
            "window.focus" => handle(st).ok_or("window not open")?.focus(),
            "window.show" => handle(st).ok_or("window not open")?.show(),
            "window.hide" => handle(st).ok_or("window not open")?.hide(),
            "window.close" => {
                let node = window_node(st);
                let is_main = engine::read(|e| e.windows.get(&node).map(|w| w.is_main).unwrap_or(false));
                let h = handle(st).ok_or("window not open")?;
                if is_main { h.hide() } else { h.close() }
            }
            "window.setTitle" => tx.set_title(s(&v, "title").to_owned()),
            "window.setAlwaysOnTop" => handle(st).ok_or("window not open")?.set_always_on_top(v.get("on").and_then(|x| x.as_bool()).unwrap_or(true)),
            "window.setBounds" => {
                if let (Some(w), Some(h)) = (f(&v, "width"), f(&v, "height")) {
                    tx.resize_window((w, h));
                }
                if let (Some(x), Some(y)) = (v.get("x").and_then(|x| x.as_i64()), v.get("y").and_then(|y| y.as_i64())) {
                    let k = handle(st).and_then(|h| h.scale()).unwrap_or(1.0);
                    handle(st).ok_or("window not open")?.set_position(((x as f64 * k) as i32, (y as f64 * k) as i32));
                }
            }
            "window.getBounds" | "window.state" => {
                let h = handle(st).ok_or("window not open")?;
                let p = h.placement().ok_or("window not placed yet")?;
                let k = if p.scale > 0.0 { p.scale } else { 1.0 };
                let pt = |v: f64| (v / k).round();
                return Ok(json!({
                    "x": pt(p.position.0 as f64), "y": pt(p.position.1 as f64),
                    "width": pt(p.content_size.0 as f64), "height": pt(p.content_size.1 as f64),
                    "scaleFactor": p.scale, "maximized": p.maximized, "minimized": p.minimized, "fullScreen": p.full_screen,
                    "visible": h.is_ready(),
                }));
            }
            "clipboard.writeText" => tx.copy(s(&v, "text").to_owned()),
            "clipboard.writeHTML" => tx.copy_rich(rune::ClipboardContent::new(s(&v, "text").to_owned()).with_html(s(&v, "html").to_owned())),
            "clipboard.writeImage" => {
                let png = match v.get("blob").and_then(|b| b.as_u64()) {
                    Some(id) => engine::read(|e| e.blobs.get(&(id as u32)).cloned()).ok_or("no such blob")?,
                    None => std::fs::read(s(&v, "path")).map_err(|e| e.to_string())?.into(),
                };
                let img = rune::ClipboardImage::from_png(png).ok_or("not a PNG")?;
                tx.copy_rich(rune::ClipboardContent::new(String::new()).with_image(img));
            }
            "clipboard.read" => {
                tx.read_clipboard(move |_s: &mut Win, c: &rune::ClipboardContent, _tx: &mut Tx| {
                    let files: Vec<String> = c.files().iter().map(|p| p.to_string_lossy().into_owned()).collect();
                    let image = c.image().and_then(|i| save_png(i.png()));
                    let mut formats = Vec::new();
                    if !c.text().is_empty() {
                        formats.push("text/plain");
                    }
                    if c.html().is_some() {
                        formats.push("text/html");
                    }
                    if !files.is_empty() {
                        formats.push("text/uri-list");
                    }
                    if image.is_some() {
                        formats.push("image/png");
                    }
                    reply(rid, Ok(json!({ "text": c.text(), "html": c.html(), "files": files, "image": image, "formats": formats })));
                });
                return Err(String::from("\u{0}pending"));
            }
            "dialog.openFile" | "dialog.openFiles" | "dialog.openFolder" | "dialog.saveFile" => {
                let o = dialog_options(&v);
                let one = move |_s: &mut Win, r: rune::FileDialogResult, _tx: &mut Tx| {
                    reply(rid, r.map(|p| json!(p.map(|p| vec![p.to_string_lossy().into_owned()]))).map_err(|e| e.to_string()))
                };
                let multi = v.get("multi").and_then(|m| m.as_bool()).unwrap_or(false);
                match cmd.as_str() {
                    "dialog.saveFile" => tx.save_file(o, move |_s: &mut Win, r: rune::FileDialogResult, _tx: &mut Tx| {
                        reply(rid, r.map(|p| json!(p.map(|p| p.to_string_lossy().into_owned()))).map_err(|e| e.to_string()))
                    }),
                    "dialog.openFolder" => tx.open_folder(o, one),
                    _ if v.get("directory").and_then(|d| d.as_bool()) == Some(true) => tx.open_folder(o, one),
                    _ if multi || cmd == "dialog.openFiles" => tx.open_files(o, move |_s: &mut Win, r: rune::FileDialogFilesResult, _tx: &mut Tx| {
                        reply(rid, r.map(|p| json!(p.map(|ps| ps.iter().map(|p| p.to_string_lossy().into_owned()).collect::<Vec<_>>()))).map_err(|e| e.to_string()))
                    }),
                    _ => tx.open_file(o, one),
                }
                return Err(String::from("\u{0}pending"));
            }
            "menu.popup" => {
                let items = v.get("items").and_then(|i| i.as_array()).cloned().unwrap_or_default();
                let menu = menu_of(&items);
                let anchor: rune::PopupAnchor = match (tkey.clone(), f(&v, "x"), f(&v, "y")) {
                    (_, Some(x), Some(y)) => (x, y).into(),
                    (Some(k), _, _) => k.into(),
                    _ => (0.0, 0.0).into(),
                };
                tx.popup_menu(menu, anchor, move |_s: &mut Win, picked: Option<&str>, _tx: &mut Tx| {
                    if let Some(id) = picked {
                        engine::send(json!({ "t": "menu", "id": id }));
                    }
                    reply(rid, Ok(json!(picked)));
                });
                return Err(String::from("\u{0}pending"));
            }
            "shell.openExternal" => tx.open_url(s(&v, "url")).map_err(|e| format!("{e:?}"))?,
            "shell.openPath" => tx.open_path(s(&v, "path")).map_err(|e| format!("{e:?}"))?,
            "shell.showItemInFolder" => tx.reveal_path(s(&v, "path")).map_err(|e| format!("{e:?}"))?,
            "media.play" | "media.pause" | "media.seek" | "media.state" => {
                let n = target(&v).ok_or("no target")?;
                let p = crate::media::player(n).ok_or("no player")?;
                match cmd.as_str() {
                    "media.play" => p.play(),
                    "media.pause" => p.pause(),
                    "media.seek" => p.seek(v.get("time").and_then(|t| t.as_f64()).unwrap_or(0.0)),
                    _ => {}
                }
                return Ok(json!({ "time": p.time(), "duration": p.duration(), "playing": p.is_playing() }));
            }
            c if c.starts_with("webview.") => {
                #[cfg(feature = "webview")]
                {
                    let n = target(&v).ok_or("no target")?;
                    return engine::read(|e| crate::webview::command(c, n, &v, &e.blobs));
                }
                #[cfg(not(feature = "webview"))]
                return Err("built without webviews".into());
            }
            c if c.starts_with("control.") => return crate::control::command(st, tx, rid, c, &v),
            "resize" => tx.resize_window((f(&v, "w").unwrap_or(1280.0), f(&v, "h").unwrap_or(820.0))),
            "resizeAnim" => crate::control::resize_anim(&v),
            "scrollRun" => crate::control::scroll_run(tkey.clone().unwrap_or_default(), f(&v, "speed").unwrap_or(4000.0), f(&v, "dur").unwrap_or(5.0), Instant::now()),
            other => return Err(format!("unknown command {other}")),
        }
        Ok(Value::Null)
    })();
    match r {
        Err(e) if e.starts_with('\u{0}') => {}
        r => reply(rid, r),
    }
}
