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
use std::sync::{Arc, Mutex};

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
    protocols: Arc<[String]>,
    url: Option<String>,
    html: Option<String>,
    rect: [f32; 4],
    visible: bool,
    corners: [f32; 4],
    /// An overlay (a modal layer, a popover, a menu) covers it: the native view is hidden and its
    /// slot draws the page's last snapshot, so engine-drawn layers above it stay on top.
    covered: bool,
}

thread_local! {
    static VIEWS: RefCell<HashMap<u32, View>> = RefCell::new(HashMap::new());
    /// Views placed before their window had a native handle, with where they go.
    static WAITING: RefCell<HashMap<u32, (u32, [f32; 4])>> = RefCell::new(HashMap::new());
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

thread_local! {
    /// Drawn rects of the scroll viewports webviews sit in.
    static CLIPS: RefCell<HashMap<u32, [f32; 4]>> = RefCell::new(HashMap::new());
}

/// The slot element: an empty box whose drawn rect the WebView follows, showing the page's
/// snapshot while an overlay covers it.
pub fn slot(n: u32) -> El {
    let e = match COVERS.with(|c| c.borrow().get(&n).cloned()) {
        Some(pixels) => el().pixels(&pixels),
        None => el(),
    };
    e.on_drawn_layout_tx(move |s: &mut Win, r: [f32; 4], tx: &mut rune::Tx| {
        tx.live_only();
        place(n, s.node, r);
        reconcile(s.node);
    })
}

thread_local! {
    /// Drawn rects of the overlay layers (modal layers, anchored popovers and menus), by node.
    static OVERLAYS: RefCell<HashMap<u32, (u32, [f32; 4])>> = RefCell::new(HashMap::new());
    /// The snapshot each covered webview's slot draws.
    static COVERS: RefCell<HashMap<u32, rune::Pixels>> = RefCell::new(HashMap::new());
}

/// A lifted layer, tracked as an overlay when it is anchored or holds a modal: native webviews
/// draw above every engine layer, so one it overlaps steps aside for it.
pub fn overlay(layer: El, eng: &engine::Engine, n: u32) -> El {
    if !active() || !is_overlay(eng, n) {
        return layer;
    }
    layer.on_drawn_layout_tx(move |s: &mut Win, r: [f32; 4], tx: &mut rune::Tx| {
        tx.live_only();
        OVERLAYS.with(|o| o.borrow_mut().insert(n, (s.node, r)));
        reconcile(s.node);
    })
}

fn is_overlay(eng: &engine::Engine, n: u32) -> bool {
    let Some(node) = eng.tree.get(n) else { return false };
    node.props.anchor.is_some() || node.props.modal.is_some() || node.children.iter().any(|c| eng.tree.get(*c).is_some_and(|c| c.props.modal.is_some()))
}

pub fn forget_overlay(n: u32) {
    let window = OVERLAYS.with(|o| o.borrow_mut().remove(&n)).map(|(w, _)| w);
    if let Some(w) = window {
        reconcile(w);
    }
}

fn overlaps(a: [f32; 4], b: [f32; 4]) -> bool {
    a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3] && a[2] > 0.0 && a[3] > 0.0 && b[2] > 0.0 && b[3] > 0.0
}

/// Covers each of `window`'s webviews an overlay overlaps, and uncovers the rest.
fn reconcile(window: u32) {
    let overlays: Vec<[f32; 4]> = OVERLAYS.with(|o| o.borrow().values().filter(|(w, _)| *w == window).map(|(_, r)| *r).collect());
    let changes: Vec<(u32, bool)> = VIEWS.with(|v| {
        v.borrow()
            .iter()
            .filter(|(_, x)| x.window == window)
            .filter_map(|(n, x)| {
                let covered = overlays.iter().any(|o| overlaps(*o, x.rect));
                (covered != x.covered).then_some((*n, covered))
            })
            .collect()
    });
    for (n, covered) in changes {
        VIEWS.with(|v| {
            if let Some(view) = v.borrow_mut().get_mut(&n) {
                view.covered = covered;
            }
        });
        if covered {
            cover(n, window);
        } else {
            COVERS.with(|c| c.borrow_mut().remove(&n));
            let rect = VIEWS.with(|v| v.borrow().get(&n).map(|x| x.rect));
            if let Some(r) = rect {
                place(n, window, r);
            }
            redraw(window);
        }
    }
}

fn cover(n: u32, window: u32) {
    let hide = move || {
        let still = VIEWS.with(|v| v.borrow().get(&n).is_some_and(|x| x.covered));
        if !still {
            return;
        }
        let rect = VIEWS.with(|v| v.borrow().get(&n).map(|x| x.rect));
        if let Some(r) = rect {
            place(n, window, r);
        }
        redraw(window);
    };
    #[cfg(target_os = "macos")]
    {
        let sent = with_view(n, |view| {
            mac::snapshot(&view.view, move |image| {
                if let Some(image) = image {
                    let pixels = rune::Pixels::new();
                    pixels.set(image.width(), image.height(), image.into_raw());
                    COVERS.with(|c| c.borrow_mut().insert(n, pixels));
                }
                hide();
            })
        });
        if sent.is_err() {
            hide();
        }
    }
    #[cfg(not(target_os = "macos"))]
    hide();
}

fn redraw(window: u32) {
    engine::with(|e| {
        if let Some(slot) = e.windows.get_mut(&window) {
            slot.dirty = true;
        }
    });
    engine::wake(window);
}

/// Records a scroll viewport's drawn rect and re-places the webviews inside it.
pub fn clipper(e: El, id: u32) -> El {
    e.on_drawn_layout_tx(move |s: &mut Win, r: [f32; 4], tx: &mut rune::Tx| {
        tx.live_only();
        CLIPS.with(|c| c.borrow_mut().insert(id, r));
        let inside: Vec<(u32, [f32; 4])> = engine::read(|e| e.tree.clip_of.iter().filter(|(_, c)| **c == id).map(|(w, _)| *w).collect::<Vec<_>>())
            .into_iter()
            .filter_map(|w| VIEWS.with(|v| v.borrow().get(&w).map(|view| (w, view.rect))))
            .collect();
        for (w, rect) in inside {
            place(w, s.node, rect);
        }
    })
}

/// A native view can't be clipped: it shows only while wholly inside its scroll viewport.
fn fits(n: u32, r: [f32; 4]) -> bool {
    let Some(c) = engine::read(|e| e.tree.clip_of.get(&n).copied()) else { return true };
    let Some(c) = CLIPS.with(|m| m.borrow().get(&c).copied()) else { return true };
    let eps = 0.5;
    r[0] >= c[0] - eps && r[1] >= c[1] - eps && r[0] + r[2] <= c[0] + c[2] + eps && r[1] + r[3] <= c[1] + c[3] + eps
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

/// WebView2 serves a custom scheme only as `https://<scheme>.<host>/…` (wry's mapping, which also
/// gives pages a secure context); everything outside this module sees `<scheme>://<host>/…`.
mod scheme_url {
    #[cfg(target_os = "windows")]
    pub fn to_view(protocols: &[String], url: &str) -> String {
        protocols
            .iter()
            .find_map(|s| url.strip_prefix(&format!("{s}://")).map(|rest| format!("https://{s}.{rest}")))
            .unwrap_or_else(|| url.to_owned())
    }

    #[cfg(target_os = "windows")]
    pub fn from_view(protocols: &[String], url: &str) -> String {
        protocols
            .iter()
            .find_map(|s| url.strip_prefix(&format!("https://{s}.")).map(|rest| format!("{s}://{rest}")))
            .unwrap_or_else(|| url.to_owned())
    }

    #[cfg(not(target_os = "windows"))]
    pub fn to_view(_: &[String], url: &str) -> String {
        url.to_owned()
    }

    #[cfg(not(target_os = "windows"))]
    pub fn from_view(_: &[String], url: &str) -> String {
        url.to_owned()
    }
}

fn create(n: u32, window: u32, p: &Props, r: [f32; 4]) -> Result<WebView, String> {
    #[cfg(target_os = "linux")]
    ensure_gtk();
    let id = format!("stella-{n}");
    let protocols: Arc<[String]> = p.protocols.clone().into();
    let load_protocols = protocols.clone();
    let mut b = WebViewBuilder::new()
        .with_id(&id)
        .with_bounds(rect(window, r))
        .with_transparent(p.transparent)
        .with_focused(false)
        .with_devtools(p.devtools || cfg!(debug_assertions))
        .with_initialization_script(PARENT_SHIM)
        .with_ipc_handler(move |req: Request<String>| {
            let body: serde_json::Value = serde_json::from_str(req.body()).unwrap_or(serde_json::Value::Null);
            element_event(n, "message", json!({ "data": body.get("data"), "targetOrigin": body.get("targetOrigin") }), None);
        })
        .with_document_title_changed_handler(move |title: String| element_event(n, "title", json!({ "title": title }), None))
        .with_on_page_load_handler(move |ev: PageLoadEvent, url: String| {
            let phase = match ev {
                PageLoadEvent::Started => "started",
                PageLoadEvent::Finished => "finished",
            };
            element_event(n, "load", json!({ "phase": phase, "url": scheme_url::from_view(&load_protocols, &url) }), None)
        });
    #[cfg(not(target_os = "linux"))]
    {
        let protocols = protocols.clone();
        b = b.with_navigation_handler(move |url: String| {
            let mut ev = json!({ "url": scheme_url::from_view(&protocols, &url) });
            if let Some(main) = main_frame_only() {
                ev["mainFrame"] = json!(main);
            }
            element_event(n, "navigate", ev, None);
            true
        });
    }
    #[cfg(target_os = "windows")]
    {
        use wry::WebViewBuilderExtWindows;
        b = b.with_https_scheme(true);
    }
    #[cfg(not(target_os = "macos"))]
    if p.microphone {
        b = b.with_permission_handler(|kind| match kind {
            wry::PermissionKind::Microphone => wry::PermissionResponse::Allow,
            _ => wry::PermissionResponse::Default,
        });
    }
    if let Some(ua) = &p.user_agent {
        b = b.with_user_agent(ua.clone());
    }
    if let Some(js) = &p.preload {
        b = b.with_initialization_script(js.clone());
    }
    for scheme in &p.protocols {
        let scheme = scheme.clone();
        let name = scheme.clone();
        // WebKitGTK keeps a scheme's first handler for the whole process, so route by the asking view.
        b = b.with_asynchronous_custom_protocol(name, move |id, req: Request<Vec<u8>>, responder: RequestAsyncResponder| {
            let n = id.strip_prefix("stella-").and_then(|v| v.parse().ok()).unwrap_or(n);
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
        (Some(u), _) => b.with_url(scheme_url::to_view(&protocols, u)),
        (None, Some(h)) => b.with_html(h),
        (None, None) => b.with_url("about:blank"),
    };
    let handle = handle_of(window).ok_or("the webview's window isn't open")?;
    let view = handle.with_raw_handle(|raw| b.build_as_child(&raw).map_err(|e| e.to_string()))??;
    #[cfg(target_os = "linux")]
    {
        main_frame_navigations(n, &view);
        enable_webrtc(&view);
    }
    #[cfg(target_os = "macos")]
    mac::track_main_frame(&view);
    Ok(view)
}

/// WebView2's NavigationStarting is main-frame only; WKWebView's policy also asks for subframes,
/// so there the flag is the frame of the action being decided.
#[cfg(not(target_os = "linux"))]
fn main_frame_only() -> Option<bool> {
    #[cfg(target_os = "macos")]
    return mac::deciding_main_frame();
    #[cfg(not(target_os = "macos"))]
    Some(true)
}

/// WebKitGTK asks navigation policy for subframes too without saying which frame; the response
/// policy does, so `navigate` comes from a main frame's document response. A main-frame load
/// that gets no response (an unknown scheme, a policy cancel, a network error) reports through
/// `load-failed`, which is main-frame only.
#[cfg(target_os = "linux")]
fn main_frame_navigations(n: u32, view: &WebView) {
    use gtk::prelude::Cast;
    use webkit2gtk::{PolicyDecisionType, ResponsePolicyDecision, ResponsePolicyDecisionExt, URIResponseExt, WebViewExt};
    use wry::WebViewExtUnix;
    let reported = std::rc::Rc::new(std::cell::RefCell::new(String::new()));
    let seen = reported.clone();
    let web = view.webview();
    web.connect_decide_policy(move |_, decision, kind| {
        if kind != PolicyDecisionType::Response {
            return false;
        }
        let Some(r) = decision.downcast_ref::<ResponsePolicyDecision>() else { return false };
        if r.is_main_frame_main_resource() {
            let url = r.response().and_then(|res| res.uri()).map(|u| u.to_string()).unwrap_or_default();
            *seen.borrow_mut() = url.clone();
            element_event(n, "navigate", json!({ "url": url, "mainFrame": true }), None);
        }
        false
    });
    web.connect_load_failed(move |_, _, uri, _| {
        if *reported.borrow() != uri {
            *reported.borrow_mut() = uri.to_owned();
            element_event(n, "navigate", json!({ "url": uri, "mainFrame": true }), None);
        }
        false
    });
}

/// WebKitGTK ships WebRTC off; Chromium (Electron) and WKWebView have it on.
#[cfg(target_os = "linux")]
fn enable_webrtc(view: &WebView) {
    use webkit2gtk::{SettingsExt, WebViewExt};
    use wry::WebViewExtUnix;
    if let Some(settings) = WebViewExt::settings(&view.webview()) {
        settings.set_enable_webrtc(true);
    }
}

/// Places (creating on first use) the WebView for node `n` at its slot's drawn rect.
pub fn place(n: u32, window: u32, r: [f32; 4]) {
    let props = engine::read(|e| e.tree.get(n).map(|node| (*node.props).clone()));
    let Some(p) = props else { return };
    let exists = VIEWS.with(|v| v.borrow().contains_key(&n));
    if !exists && handle_of(window).is_none() {
        WAITING.with(|w| w.borrow_mut().insert(n, (window, r)));
        return;
    }
    if !exists {
        let t0 = std::time::Instant::now();
        match create(n, window, &p, r) {
            Ok(view) => {
                let _ = view.set_bounds(rect(window, r));
                #[cfg(target_os = "macos")]
                mac::round(&view, corners(&p));
                eprintln!("stella-engine metric {{\"metric\":\"webview_created\",\"ms\":{:.1},\"node\":{n}}}", t0.elapsed().as_secs_f64() * 1000.0);
                VIEWS.with(|v| v.borrow_mut().insert(n, View { view, window, protocols: p.protocols.clone().into(), url: p.url.clone(), html: p.html.clone(), rect: r, visible: true, corners: corners(&p), covered: false }));
                element_event(n, "ready", json!({}), None);
            }
            Err(e) => {
                eprintln!("stella-engine: webview failed: {e}");
                element_event(n, "error", json!({ "error": e }), None);
                return;
            }
        }
    }
    VIEWS.with(|v| {
        let mut v = v.borrow_mut();
        let Some(view) = v.get_mut(&n) else { return };
        if view.rect != r {
            let _ = view.view.set_bounds(rect(window, r));
            view.rect = r;
        }
        let hidden = r[2] < 1.0 || r[3] < 1.0 || !fits(n, r) || view.covered;
        if view.visible == hidden {
            let _ = view.view.set_visible(!hidden);
            view.visible = !hidden;
        }
    });
}

/// The webview's corner radii (top-left, top-right, bottom-right, bottom-left).
fn corners(p: &Props) -> [f32; 4] {
    p.corners.unwrap_or([p.radius.unwrap_or(0.0); 4])
}

/// A shown webview's pixels at its placed rect, for drawing into a captured frame.
pub struct Shot {
    pub rect: [f32; 4],
    pub corners: [f32; 4],
    pub clip: Option<[f32; 4]>,
    pub image: image::RgbaImage,
}

/// Snapshots still to come, those taken, and who hears them all.
#[cfg(target_os = "macos")]
type Gathering = (usize, Vec<Shot>, Option<Box<dyn FnOnce(Vec<Shot>) + Send>>);

/// Snapshots every shown webview of `window` and hands them to `done` once all have answered.
/// Only macOS can snapshot so far; elsewhere `done` gets none.
pub fn snapshots(window: u32, done: Box<dyn FnOnce(Vec<Shot>) + Send>) {
    let targets: Vec<(u32, [f32; 4])> =
        VIEWS.with(|v| v.borrow().iter().filter(|(_, x)| x.window == window && x.visible).map(|(n, x)| (*n, x.rect)).collect());
    #[cfg(target_os = "macos")]
    if !targets.is_empty() {
        let pending = std::rc::Rc::new(RefCell::new((targets.len(), Vec::new(), Some(done))));
        let answer = |pending: &std::rc::Rc<RefCell<Gathering>>, shot: Option<Shot>| {
            let mut p = pending.borrow_mut();
            p.0 -= 1;
            p.1.extend(shot);
            if p.0 == 0
                && let Some(done) = p.2.take()
            {
                done(std::mem::take(&mut p.1));
            }
        };
        for (n, rect) in targets {
            let (c, clip) = engine::read(|e| {
                let c = e.tree.get(n).map(|node| corners(&node.props)).unwrap_or_default();
                let clip = e.tree.clip_of.get(&n).and_then(|c| CLIPS.with(|m| m.borrow().get(c).copied()));
                (c, clip)
            });
            let pending = pending.clone();
            let sent = with_view(n, |view| {
                let pending = pending.clone();
                mac::snapshot(&view.view, move |image| answer(&pending, image.map(|image| Shot { rect, corners: c, clip, image })));
            });
            if sent.is_err() {
                answer(&pending, None);
            }
        }
        return;
    }
    let _ = targets;
    done(Vec::new());
}

#[cfg(target_os = "macos")]
mod mac {
    use std::cell::{Cell, RefCell};
    use std::sync::OnceLock;

    use objc2::runtime::{AnyObject, Imp, Sel};
    use objc2::sel;
    use objc2_web_kit::WKNavigationAction;

    use block2::RcBlock;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
    use objc2_foundation::{NSDictionary, NSError};
    use objc2_quartz_core::CACornerMask;
    use wry::WebViewExtMacOS;

    thread_local! {
        static DECIDING: Cell<Option<bool>> = const { Cell::new(None) };
    }

    type Decide = unsafe extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject, *mut WKNavigationAction, *mut AnyObject);
    static WRY_DECIDE: OnceLock<Decide> = OnceLock::new();

    /// Whether the navigation whose policy is being decided targets a main frame, while wry's
    /// navigation handler runs inside that decision.
    pub fn deciding_main_frame() -> Option<bool> {
        DECIDING.get()
    }

    unsafe extern "C-unwind" fn decide(this: &AnyObject, sel: Sel, web: *mut AnyObject, action: *mut WKNavigationAction, handler: *mut AnyObject) {
        // SAFETY: WebKit passes a valid action (or null) for the call's duration.
        let main = unsafe { action.as_ref() }.map(|a| unsafe { a.targetFrame() }.is_some_and(|f| unsafe { f.isMainFrame() }));
        let outer = DECIDING.replace(main);
        if let Some(wry_decide) = WRY_DECIDE.get() {
            // SAFETY: the original implementation of this selector, called with its own arguments.
            unsafe { wry_decide(this, sel, web, action, handler) };
        }
        DECIDING.set(outer);
    }

    /// wry's navigation handler is given only the URL, so its delegate's policy method is wrapped
    /// once (all wry views share the delegate class) to expose the action's target frame.
    pub fn track_main_frame(view: &wry::WebView) {
        if WRY_DECIDE.get().is_some() {
            return;
        }
        // SAFETY: called on the main thread with a live WKWebView.
        let Some(delegate) = (unsafe { view.webview().navigationDelegate() }) else { return };
        let object: &AnyObject = delegate.as_ref();
        let Some(method) = object.class().instance_method(sel!(webView:decidePolicyForNavigationAction:decisionHandler:)) else { return };
        // SAFETY: `decide` has the selector's exact signature and forwards to the replaced IMP,
        // which is stored before any decision can run on this (the main) thread.
        unsafe {
            let wrapped: Imp = std::mem::transmute::<Decide, Imp>(decide);
            let original = method.set_implementation(wrapped);
            let _ = WRY_DECIDE.set(std::mem::transmute::<Imp, Decide>(original));
        }
    }

    pub fn snapshot(view: &wry::WebView, done: impl FnOnce(Option<image::RgbaImage>) + 'static) {
        let done = RefCell::new(Some(done));
        let block = RcBlock::new(move |img: *mut NSImage, _err: *mut NSError| {
            if let Some(done) = done.borrow_mut().take() {
                // SAFETY: WebKit passes a valid NSImage or null for the call's duration.
                done(unsafe { img.as_ref() }.and_then(decode));
            }
        });
        // SAFETY: called on the main thread; a nil configuration snapshots the visible bounds.
        unsafe { view.webview().takeSnapshotWithConfiguration_completionHandler(None, &block) };
    }

    fn decode(img: &NSImage) -> Option<image::RgbaImage> {
        let tiff = img.TIFFRepresentation()?;
        let rep = NSBitmapImageRep::imageRepWithData(&tiff)?;
        // SAFETY: an empty property dictionary is valid for PNG.
        let png = unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new()) }?;
        image::load_from_memory_with_format(&png.to_vec(), image::ImageFormat::Png).ok().map(|i| i.to_rgba8())
    }

    /// Rounds the WKWebView's own layer, which clips the page drawn in its sublayers.
    pub fn round(view: &wry::WebView, c: [f32; 4]) {
        let wk = view.webview();
        let r = c.iter().copied().fold(0.0f32, f32::max);
        if r <= 0.0 && wk.layer().is_none() {
            return;
        }
        wk.setWantsLayer(true);
        let Some(layer) = wk.layer() else { return };
        let (tl, tr, bl, br) = if layer.contentsAreFlipped() {
            (CACornerMask::LayerMinXMinYCorner, CACornerMask::LayerMaxXMinYCorner, CACornerMask::LayerMinXMaxYCorner, CACornerMask::LayerMaxXMaxYCorner)
        } else {
            (CACornerMask::LayerMinXMaxYCorner, CACornerMask::LayerMaxXMaxYCorner, CACornerMask::LayerMinXMinYCorner, CACornerMask::LayerMaxXMinYCorner)
        };
        let mut mask = CACornerMask::empty();
        for (radius, corner) in [(c[0], tl), (c[1], tr), (c[2], br), (c[3], bl)] {
            if radius > 0.0 {
                mask |= corner;
            }
        }
        layer.setCornerRadius(f64::from(r));
        layer.setMaskedCorners(mask);
        layer.setMasksToBounds(r > 0.0);
    }
}

/// Follows prop changes (url, html, corners) of live views.
pub fn sync(n: u32, p: &Props) {
    VIEWS.with(|v| {
        let mut v = v.borrow_mut();
        let Some(view) = v.get_mut(&n) else { return };
        #[cfg(target_os = "macos")]
        if corners(p) != view.corners {
            view.corners = corners(p);
            mac::round(&view.view, view.corners);
        }
        if p.url.is_some() && p.url != view.url {
            if let Some(u) = &p.url {
                let _ = view.view.load_url(&scheme_url::to_view(&view.protocols, u));
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
    VIEWS.with(|v| !v.borrow().is_empty()) || WAITING.with(|w| !w.borrow().is_empty())
}

/// Creates the views whose window had no native handle yet when they were first placed (a
/// launch window's handle arrives with its first frame on macOS).
pub fn retry_waiting() {
    let waiting: Vec<(u32, (u32, [f32; 4]))> = WAITING.with(|w| w.borrow_mut().drain().collect());
    for (n, (window, r)) in waiting {
        if engine::read(|e| e.tree.get(n).is_some()) {
            place(n, window, r);
        }
    }
}

/// Drops the WebView (and its web process) of a removed node.
pub fn close(n: u32) {
    let gone = VIEWS.with(|v| v.borrow_mut().remove(&n));
    if gone.is_some() {
        destroy(gone.into_iter().collect());
        eprintln!("stella-engine: webview {n} closed");
    }
}

/// Drops every view of a window that is closing, before its native window goes.
pub fn close_window(window: u32) {
    let gone: Vec<View> = VIEWS.with(|v| {
        let mut v = v.borrow_mut();
        let ids: Vec<u32> = v.iter().filter(|(_, view)| view.window == window).map(|(n, _)| *n).collect();
        ids.into_iter().filter_map(|n| v.remove(&n)).collect()
    });
    destroy(gone);
}

/// wry's X11 teardown destroys its container before GTK unmaps it, which GDK would treat as a
/// fatal X error; ignore the errors of the teardown's requests.
fn destroy(views: Vec<View>) {
    if views.is_empty() {
        return;
    }
    #[cfg(target_os = "linux")]
    {
        gtk::gdk::error_trap_push();
        drop(views);
        pump();
        if let Some(d) = gtk::gdk::Display::default() {
            d.sync();
        }
        gtk::gdk::error_trap_pop_ignored();
    }
    #[cfg(not(target_os = "linux"))]
    drop(views);
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
        "webview.load" => with_view(n, |w| w.view.load_url(&scheme_url::to_view(&w.protocols, &s("url"))).map_err(|e| e.to_string()))??,
        "webview.loadHtml" => with_view(n, |w| w.view.load_html(&s("html")).map_err(|e| e.to_string()))??,
        "webview.reload" => with_view(n, |w| w.view.reload().map_err(|e| e.to_string()))??,
        "webview.back" => with_view(n, |w| w.view.evaluate_script("history.back()").map_err(|e| e.to_string()))??,
        "webview.forward" => with_view(n, |w| w.view.evaluate_script("history.forward()").map_err(|e| e.to_string()))??,
        "webview.focus" => with_view(n, |w| w.view.focus().map_err(|e| e.to_string()))??,
        "webview.blur" => with_view(n, |w| w.view.focus_parent().map_err(|e| e.to_string()))??,
        "webview.zoom" => with_view(n, |w| w.view.zoom(v.get("factor").and_then(|f| f.as_f64()).unwrap_or(1.0)).map_err(|e| e.to_string()))??,
        "webview.url" => return with_view(n, |w| json!(w.view.url().ok().map(|u| scheme_url::from_view(&w.protocols, &u)))),
        "webview.respond" => {
            let rid = v.get("req").and_then(|r| r.as_u64()).ok_or("webview.respond: needs req")?;
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
