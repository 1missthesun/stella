//! `<webview>`: lazy OS WebViews (wry) placed on their slot's drawn rect. Nothing WebView-related
//! exists until one mounts. macOS: WKWebView subview; Windows: WebView2 child HWND; Linux:
//! WebKitGTK child of the X11 window (the engine runs on X11/XWayland while webviews are built
//! in; see `main::linux_backend`).
//!
//! Pages keep working as they did in an Electron `<iframe>`: `window.parent.postMessage` and
//! `window.top.postMessage` reach TS as `message` events, and TS posts back with
//! `webview.post`, which the page hears as a `message` event. Custom schemes are answered by TS
//! (`request` event → `webview.respond`).

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::Mutex;

use rune::{El, el};
use serde_json::json;
use wry::dpi::{LogicalPosition, LogicalSize, PhysicalPosition, PhysicalSize};
use wry::http::{Request, Response};
use wry::{PageLoadEvent, Rect, RequestAsyncResponder, WebView, WebViewBuilder};

use crate::engine::{self, element_event};
use crate::props::Props;
use crate::windows::Win;

struct View {
    view: WebView,
    window: u32,
    url: Option<String>,
    html: Option<String>,
    rect: [f32; 4],
    visible: bool,
}

thread_local! {
    static VIEWS: RefCell<HashMap<u32, View>> = RefCell::new(HashMap::new());
}

static PENDING: Mutex<Option<HashMap<u64, RequestAsyncResponder>>> = Mutex::new(None);
static NEXT_RID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

const PARENT_SHIM: &str = r#"(() => {
  if (window.__stellaBridge) return;
  const post = (data, targetOrigin) => window.ipc.postMessage(JSON.stringify({ data, targetOrigin: targetOrigin ?? "*" }));
  const host = { postMessage: post };
  window.__stellaBridge = { post, receive(data, origin) { window.dispatchEvent(new MessageEvent("message", { data, origin: origin ?? "stella://host" })); } };
  if (window.parent === window) {
    try { Object.defineProperty(window, "parent", { get: () => host, configurable: true }); } catch {}
    try { Object.defineProperty(window, "top", { get: () => host, configurable: true }); } catch {}
  }
})();"#;

/// The slot element: an empty box whose drawn rect the WebView follows.
pub fn slot(n: u32, p: &Props) -> El {
    let e = el().on_drawn_layout(move |s: &mut Win, r: [f32; 4]| place(n, s.node, r));
    let e = crate::style::apply(e, p);
    crate::view::handlers(e, n, p, false).key(crate::view::rune_key(n, p))
}

fn rect(window: u32, r: [f32; 4]) -> Rect {
    if cfg!(target_os = "linux") {
        let k = handle_of(window).and_then(|h| h.scale()).unwrap_or(1.0);
        let p = |v: f32| (v as f64 * k).round();
        return Rect { position: PhysicalPosition::new(p(r[0]), p(r[1])).into(), size: PhysicalSize::new(p(r[2]).max(1.0) as u32, p(r[3]).max(1.0) as u32).into() };
    }
    Rect { position: LogicalPosition::new(r[0] as f64, r[1] as f64).into(), size: LogicalSize::new(r[2] as f64, r[3] as f64).into() }
}

fn handle_of(window: u32) -> Option<rune::WindowHandle> {
    engine::read(|e| e.windows.get(&window).and_then(|w| w.handle.clone()))
}

#[cfg(target_os = "linux")]
fn ensure_gtk() {
    if !gtk::is_initialized() {
        // NVIDIA + WebKitGTK's DMA-BUF renderer paints black inside a foreign X11 parent.
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            // SAFETY: set once on the UI thread before GTK/WebKit start any threads.
            unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1") };
        }
        let _ = gtk::init();
    }
}

fn create(n: u32, window: u32, p: &Props, r: [f32; 4]) -> Result<WebView, String> {
    #[cfg(target_os = "linux")]
    ensure_gtk();
    let mut b = WebViewBuilder::new()
        .with_bounds(rect(window, r))
        .with_transparent(p.transparent)
        .with_devtools(p.devtools || cfg!(debug_assertions))
        .with_initialization_script(PARENT_SHIM)
        .with_ipc_handler(move |req: Request<String>| {
            let body: serde_json::Value = serde_json::from_str(req.body()).unwrap_or(serde_json::Value::Null);
            element_event(n, "message", json!({ "data": body.get("data"), "targetOrigin": body.get("targetOrigin") }), None);
        })
        .with_navigation_handler(move |url: String| {
            element_event(n, "navigate", json!({ "url": url }), None);
            true
        })
        .with_document_title_changed_handler(move |title: String| element_event(n, "title", json!({ "title": title }), None))
        .with_on_page_load_handler(move |ev: PageLoadEvent, url: String| {
            let phase = match ev {
                PageLoadEvent::Started => "started",
                PageLoadEvent::Finished => "finished",
            };
            element_event(n, "load", json!({ "phase": phase, "url": url }), None)
        });
    if let Some(ua) = &p.user_agent {
        b = b.with_user_agent(ua.clone());
    }
    if let Some(js) = &p.preload {
        b = b.with_initialization_script(js.clone());
    }
    for scheme in &p.protocols {
        let scheme = scheme.clone();
        let name = scheme.clone();
        b = b.with_asynchronous_custom_protocol(name, move |_id, req: Request<Vec<u8>>, responder: RequestAsyncResponder| {
            let rid = NEXT_RID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            PENDING.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(HashMap::new).insert(rid, responder);
            let headers: serde_json::Map<String, serde_json::Value> =
                req.headers().iter().map(|(k, v)| (k.to_string(), json!(v.to_str().unwrap_or("")))).collect();
            let body = String::from_utf8(req.body().clone()).ok();
            element_event(
                n,
                "request",
                json!({ "rid": rid, "scheme": scheme, "url": req.uri().to_string(), "method": req.method().as_str(), "headers": headers, "body": body }),
                None,
            );
        });
    }
    b = match (&p.url, &p.html) {
        (Some(u), _) => b.with_url(u),
        (None, Some(h)) => b.with_html(h),
        (None, None) => b.with_url("about:blank"),
    };
    let handle = handle_of(window).ok_or("the webview's window isn't open")?;
    handle.with_raw_handle(|raw| b.build_as_child(&raw).map_err(|e| e.to_string()))?
}

/// Places (creating on first use) the WebView for node `n` at its slot's drawn rect.
pub fn place(n: u32, window: u32, r: [f32; 4]) {
    let props = engine::read(|e| e.tree.get(n).map(|node| (*node.props).clone()));
    let Some(p) = props else { return };
    let exists = VIEWS.with(|v| v.borrow().contains_key(&n));
    if !exists {
        let t0 = std::time::Instant::now();
        match create(n, window, &p, r) {
            Ok(view) => {
                eprintln!("stella-engine metric {{\"metric\":\"webview_created\",\"ms\":{:.1},\"node\":{n}}}", t0.elapsed().as_secs_f64() * 1000.0);
                VIEWS.with(|v| v.borrow_mut().insert(n, View { view, window, url: p.url.clone(), html: p.html.clone(), rect: r, visible: true }));
                element_event(n, "ready", json!({}), None);
            }
            Err(e) => {
                eprintln!("stella-engine: webview failed: {e}");
                element_event(n, "error", json!({ "error": e }), None);
            }
        }
        return;
    }
    VIEWS.with(|v| {
        let mut v = v.borrow_mut();
        let Some(view) = v.get_mut(&n) else { return };
        if view.rect != r {
            let _ = view.view.set_bounds(rect(window, r));
            view.rect = r;
        }
        let hidden = r[2] < 1.0 || r[3] < 1.0;
        if view.visible == hidden {
            let _ = view.view.set_visible(!hidden);
            view.visible = !hidden;
        }
    });
}

/// Follows prop changes (url, html) of live views.
pub fn sync(n: u32, p: &Props) {
    VIEWS.with(|v| {
        let mut v = v.borrow_mut();
        let Some(view) = v.get_mut(&n) else { return };
        if p.url.is_some() && p.url != view.url {
            if let Some(u) = &p.url {
                let _ = view.view.load_url(u);
            }
            view.url = p.url.clone();
        } else if p.url.is_none() && p.html.is_some() && p.html != view.html {
            if let Some(h) = &p.html {
                let _ = view.view.load_html(h);
            }
            view.html = p.html.clone();
        }
    });
}

pub fn active() -> bool {
    VIEWS.with(|v| !v.borrow().is_empty())
}

/// Drops the WebView (and its web process) of a removed node.
pub fn close(n: u32) {
    VIEWS.with(|v| {
        if v.borrow_mut().remove(&n).is_some() {
            eprintln!("stella-engine: webview {n} closed");
        }
    });
}

/// Hides every view of a window that stopped drawing (closed, hidden).
pub fn close_window(window: u32) {
    VIEWS.with(|v| v.borrow_mut().retain(|_, view| view.window != window));
}

/// GTK needs its loop turned on Linux; Rune owns the loop, so turn it from poll.
pub fn pump() {
    #[cfg(target_os = "linux")]
    if gtk::is_initialized() {
        while gtk::events_pending() {
            gtk::main_iteration_do(false);
        }
    }
}

fn with_view<R>(n: u32, f: impl FnOnce(&View) -> R) -> Result<R, String> {
    VIEWS.with(|v| v.borrow().get(&n).map(f).ok_or_else(|| "no such webview".to_string()))
}

/// `webview.*` commands from TS.
pub fn command(cmd: &str, n: u32, v: &serde_json::Value, blobs: &HashMap<u32, std::sync::Arc<[u8]>>) -> Result<serde_json::Value, String> {
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_owned();
    match cmd {
        "webview.post" => {
            let data = v.get("data").cloned().unwrap_or(serde_json::Value::Null);
            let js = format!("window.__stellaBridge && window.__stellaBridge.receive({}, {});", data, json!(v.get("origin")));
            with_view(n, |w| w.view.evaluate_script(&js).map_err(|e| e.to_string()))??;
        }
        "webview.eval" => with_view(n, |w| w.view.evaluate_script(&s("js")).map_err(|e| e.to_string()))??,
        "webview.load" => with_view(n, |w| w.view.load_url(&s("url")).map_err(|e| e.to_string()))??,
        "webview.loadHtml" => with_view(n, |w| w.view.load_html(&s("html")).map_err(|e| e.to_string()))??,
        "webview.reload" => with_view(n, |w| w.view.reload().map_err(|e| e.to_string()))??,
        "webview.back" => with_view(n, |w| w.view.evaluate_script("history.back()").map_err(|e| e.to_string()))??,
        "webview.forward" => with_view(n, |w| w.view.evaluate_script("history.forward()").map_err(|e| e.to_string()))??,
        "webview.focus" => with_view(n, |w| w.view.focus().map_err(|e| e.to_string()))??,
        "webview.blur" => with_view(n, |w| w.view.focus_parent().map_err(|e| e.to_string()))??,
        "webview.zoom" => with_view(n, |w| w.view.zoom(v.get("factor").and_then(|f| f.as_f64()).unwrap_or(1.0)).map_err(|e| e.to_string()))??,
        "webview.url" => return with_view(n, |w| json!(w.view.url().ok())),
        "webview.respond" => {
            let rid = v.get("rid").and_then(|r| r.as_u64()).unwrap_or(0);
            let responder = PENDING.lock().unwrap_or_else(|e| e.into_inner()).as_mut().and_then(|m| m.remove(&rid)).ok_or("no such request")?;
            let body: Vec<u8> = match v.get("blob").and_then(|b| b.as_u64()) {
                Some(id) => blobs.get(&(id as u32)).map(|b| b.to_vec()).unwrap_or_default(),
                None => s("body").into_bytes(),
            };
            let mut res = Response::builder().status(v.get("status").and_then(|x| x.as_u64()).unwrap_or(200) as u16);
            if let Some(h) = v.get("headers").and_then(|h| h.as_object()) {
                for (k, val) in h {
                    if let Some(val) = val.as_str() {
                        res = res.header(k.as_str(), val);
                    }
                }
            }
            responder.respond(res.body(body).map_err(|e| e.to_string())?);
        }
        other => return Err(format!("unknown command {other}")),
    }
    Ok(serde_json::Value::Null)
}
