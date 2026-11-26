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
    /// What of it shows, as last applied to the native view, with the rect, corners and scale
    /// it was applied for.
    applied: Option<(Shape, [f32; 4], [f32; 4], f32)>,
    /// The page zoom TS asked for (`webview.zoom`), and the window scale it was applied at.
    zoom: f64,
    zoomed_at: f32,
    #[cfg(target_os = "linux")]
    backdrop: Option<[u8; 4]>,
}

/// The part of a placed webview that shows, in window coordinates: inside its clipping
/// ancestors (`vis`, rounded by `round` where a rounded clip's corner reaches it), less the
/// elements painted over it (`cuts`: rect and corner radii).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Shape {
    pub vis: [f32; 4],
    pub round: [f32; 4],
    pub cuts: Vec<([f32; 4], [f32; 4])>,
}

/// The clipped area of a view at `r` inside its clipping ancestors `chain`: the rect and the
/// radius of each of its corners that a rounded clip's corner cuts (top-left, top-right,
/// bottom-right, bottom-left). `None` when nothing of it is inside.
fn clipped(r: [f32; 4], chain: &[u32]) -> Option<([f32; 4], [f32; 4])> {
    let clips: Vec<([f32; 4], f32)> = CLIPS.with(|m| chain.iter().filter_map(|c| m.borrow().get(c).copied()).collect());
    let mut vis = r;
    for (c, _) in &clips {
        vis = intersect(vis, *c)?;
    }
    let mut round = [0.0f32; 4];
    for (c, radius) in clips.iter().filter(|(_, radius)| *radius > 0.0) {
        let corners = [(vis[0] - c[0], vis[1] - c[1]), (c[0] + c[2] - vis[0] - vis[2], vis[1] - c[1]), (c[0] + c[2] - vis[0] - vis[2], c[1] + c[3] - vis[1] - vis[3]), (vis[0] - c[0], c[1] + c[3] - vis[1] - vis[3])];
        for (i, (dx, dy)) in corners.into_iter().enumerate() {
            let inset = dx.max(dy);
            if inset < *radius {
                round[i] = round[i].max(radius - inset);
            }
        }
    }
    Some((vis, round))
}

/// An element painted over a window's webviews, by node: where it was drawn, and the window
/// build that last made it one (an older build's entry no longer applies).
struct Over {
    window: u32,
    rect: Option<[f32; 4]>,
    corners: [f32; 4],
    build: u64,
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
    /// Drawn rects of the scroll viewports and clipping boxes webviews sit in, with the radius
    /// they round their clip to.
    static CLIPS: RefCell<HashMap<u32, ([f32; 4], f32)>> = RefCell::new(HashMap::new());
    static OVER: RefCell<HashMap<u32, Over>> = RefCell::new(HashMap::new());
    /// Each window's view build count.
    static BUILDS: RefCell<HashMap<u32, u64>> = RefCell::new(HashMap::new());
}

/// Starts a build of `window`'s view: elements over its webviews mark themselves again.
pub fn begin_build(window: u32) {
    BUILDS.with(|b| *b.borrow_mut().entry(window).or_default() += 1);
}

fn build_of(window: u32) -> u64 {
    BUILDS.with(|b| b.borrow().get(&window).copied().unwrap_or(0))
}

/// An element painted over a webview: the native view leaves its drawn rect (rounded by its
/// corners) to the engine, both in what shows and in what takes the pointer.
pub fn over(e: El, window: u32, n: u32, corners: [f32; 4]) -> El {
    let build = build_of(window);
    OVER.with(|o| {
        let mut o = o.borrow_mut();
        let entry = o.entry(n).or_insert(Over { window, rect: None, corners, build });
        entry.window = window;
        entry.corners = corners;
        entry.build = build;
    });
    e.on_drawn_layout_tx(move |s: &mut Win, r: [f32; 4], tx: &mut rune::Tx| {
        tx.live_only();
        OVER.with(|o| {
            if let Some(entry) = o.borrow_mut().get_mut(&n) {
                entry.rect = Some(r);
            }
        });
        refresh(s.node);
    })
}

pub fn forget_over(n: u32) {
    if let Some(gone) = OVER.with(|o| o.borrow_mut().remove(&n)) {
        refresh(gone.window);
    }
}

/// Re-places `window`'s views (every window's with `None`) whose shape changed.
pub fn refresh_all() {
    let views: Vec<(u32, u32, [f32; 4])> = VIEWS.with(|v| v.borrow().iter().map(|(n, x)| (*n, x.window, x.rect)).collect());
    for (n, window, r) in views {
        place(n, window, r);
    }
}

fn refresh(window: u32) {
    let views: Vec<(u32, [f32; 4])> = VIEWS.with(|v| v.borrow().iter().filter(|(_, x)| x.window == window).map(|(n, x)| (*n, x.rect)).collect());
    for (n, r) in views {
        place(n, window, r);
    }
}

fn intersect(a: [f32; 4], b: [f32; 4]) -> Option<[f32; 4]> {
    let (x0, y0) = (a[0].max(b[0]), a[1].max(b[1]));
    let (x1, y1) = ((a[0] + a[2]).min(b[0] + b[2]), (a[1] + a[3]).min(b[1] + b[3]));
    (x1 - x0 >= 0.5 && y1 - y0 >= 0.5).then_some([x0, y0, x1 - x0, y1 - y0])
}

fn contains(outer: [f32; 4], inner: [f32; 4]) -> bool {
    let eps = 0.5;
    inner[0] >= outer[0] - eps && inner[1] >= outer[1] - eps && inner[0] + inner[2] <= outer[0] + outer[2] + eps && inner[1] + inner[3] <= outer[1] + outer[3] + eps
}

/// Whether window point (x, y) falls on what shows of a view with this shape.
#[cfg(any(target_os = "linux", target_os = "macos"))]
fn shows(s: &Shape, x: f32, y: f32) -> bool {
    let within = |r: [f32; 4]| x >= r[0] && y >= r[1] && x < r[0] + r[2] && y < r[1] + r[3];
    within(s.vis) && in_corners(x - s.vis[0], y - s.vis[1], s.vis[2], s.vis[3], s.round) && !s.cuts.iter().any(|(r, c)| within(*r) && in_corners(x - r[0], y - r[1], r[2], r[3], *c))
}

/// Whether (x, y) inside a w×h box lies within its corner radii (top-left, top-right,
/// bottom-right, bottom-left).
#[cfg(any(target_os = "linux", target_os = "macos"))]
fn in_corners(x: f32, y: f32, w: f32, h: f32, c: [f32; 4]) -> bool {
    let c = c.map(|r| r.min(w / 2.0).min(h / 2.0));
    let corner = if x < c[0] && y < c[0] {
        Some((c[0], c[0], c[0]))
    } else if x > w - c[1] && y < c[1] {
        Some((c[1], w - c[1], c[1]))
    } else if x > w - c[2] && y > h - c[2] {
        Some((c[2], w - c[2], h - c[2]))
    } else if x < c[3] && y > h - c[3] {
        Some((c[3], c[3], h - c[3]))
    } else {
        None
    };
    corner.is_none_or(|(r, cx, cy)| (x - cx).powi(2) + (y - cy).powi(2) <= r * r)
}

/// The shown webview of `window` under window point (x, y): its node and placed rect.
#[cfg(target_os = "linux")]
pub fn at(window: u32, x: f32, y: f32) -> Option<(u32, [f32; 4])> {
    VIEWS.with(|v| {
        v.borrow()
            .iter()
            .find(|(_, view)| view.window == window && view.visible && view.applied.as_ref().is_some_and(|a| shows(&a.0, x, y)))
            .map(|(n, view)| (*n, view.rect))
    })
}

/// Runs `f` on view `n`'s native webview and its window's scale.
#[cfg(target_os = "linux")]
pub fn with_native<R>(n: u32, f: impl FnOnce(&WebView, f32) -> R) -> Option<R> {
    let window = VIEWS.with(|v| v.borrow().get(&n).map(|x| x.window))?;
    let k = handle_of(window).and_then(|h| h.scale()).unwrap_or(1.0) as f32;
    VIEWS.with(|v| v.borrow().get(&n).map(|x| f(&x.view, k)))
}

/// What of view `n` at `r` in `window` shows; `None` when nothing does.
fn shape(n: u32, window: u32, r: [f32; 4]) -> Option<Shape> {
    let chain = engine::read(|e| e.tree.clip_of.get(&n).cloned()).unwrap_or_default();
    let (vis, round) = clipped(r, &chain)?;
    let build = build_of(window);
    let mut cuts: Vec<([f32; 4], [f32; 4])> = OVER.with(|o| {
        o.borrow()
            .values()
            .filter(|x| x.window == window && x.build == build)
            .filter_map(|x| {
                let rect = x.rect?;
                let inside = intersect(rect, vis)?;
                Some(if contains(vis, rect) { (rect, x.corners) } else { (inside, [0.0; 4]) })
            })
            .collect()
    });
    cuts.sort_by(|a, b| (b.0[2] * b.0[3]).total_cmp(&(a.0[2] * a.0[3])));
    let mut kept: Vec<([f32; 4], [f32; 4])> = Vec::with_capacity(cuts.len());
    for c in cuts {
        if !kept.iter().any(|k| contains(k.0, c.0)) {
            kept.push(c);
        }
    }
    if kept.iter().any(|k| contains(k.0, vis)) {
        return None;
    }
    Some(Shape { vis, round, cuts: kept })
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

pub fn is_overlay(eng: &engine::Engine, n: u32) -> bool {
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
    let sent = with_view(n, |view| {
        snap(&view.view, move |image| {
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

fn redraw(window: u32) {
    engine::with(|e| {
        if let Some(slot) = e.windows.get_mut(&window) {
            slot.dirty = true;
        }
    });
    engine::wake(window);
}

/// Records a scroll viewport's or clipping box's drawn rect and re-places the webviews inside it.
pub fn clipper(e: El, id: u32, radius: f32) -> El {
    e.on_drawn_layout_tx(move |s: &mut Win, r: [f32; 4], tx: &mut rune::Tx| {
        tx.live_only();
        CLIPS.with(|c| c.borrow_mut().insert(id, (r, radius)));
        let inside: Vec<(u32, [f32; 4])> = engine::read(|e| e.tree.clip_of.iter().filter(|(_, c)| c.contains(&id)).map(|(w, _)| *w).collect::<Vec<_>>())
            .into_iter()
            .filter_map(|w| VIEWS.with(|v| v.borrow().get(&w).map(|view| (w, view.rect))))
            .collect();
        for (w, rect) in inside {
            place(w, s.node, rect);
        }
    })
}

/// Whether the view lies wholly inside its scroll viewport. Off macOS a native view can't be
/// clipped, so it shows only then.
fn fits(n: u32, r: [f32; 4]) -> bool {
    let chain = engine::read(|e| e.tree.clip_of.get(&n).cloned()).unwrap_or_default();
    clipped(r, &chain).is_some_and(|(vis, _)| contains(vis, r))
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

#[cfg(target_os = "linux")]
thread_local! {
    static CONTEXT: RefCell<Option<wry::WebContext>> = const { RefCell::new(None) };
}

/// Linux views share one WebKit context, like Electron's default session: WebKitGTK answers a
/// custom scheme with the first handler registered in the process, so a scheme registered by a
/// view whose own context was freed would go unanswered for every later view.
fn create(n: u32, window: u32, p: &Props, r: [f32; 4]) -> Result<WebView, String> {
    #[cfg(target_os = "linux")]
    {
        ensure_gtk();
        CONTEXT.with(|c| {
            let mut c = c.borrow_mut();
            let context = c.get_or_insert_with(wry::WebContext::default);
            let schemes: Vec<String> = p.protocols.iter().filter(|s| !context.is_custom_protocol_registered(s)).cloned().collect();
            build(n, window, p, r, WebViewBuilder::new_with_web_context(context), &schemes)
        })
    }
    #[cfg(not(target_os = "linux"))]
    build(n, window, p, r, WebViewBuilder::new(), &p.protocols)
}

fn build(n: u32, window: u32, p: &Props, r: [f32; 4], b: WebViewBuilder<'_>, schemes: &[String]) -> Result<WebView, String> {
    let id = format!("stella-{n}");
    let protocols: Arc<[String]> = p.protocols.clone().into();
    let load_protocols = protocols.clone();
    let mut b = b
        .with_id(&id)
        .with_bounds(rect(window, r))
        .with_transparent(p.transparent && cfg!(not(target_os = "linux")))
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
    for scheme in schemes {
        let scheme = scheme.clone();
        let name = scheme.clone();
        b = b.with_asynchronous_custom_protocol(name, move |id, req: Request<Vec<u8>>, responder: RequestAsyncResponder| {
            // Linux registers a scheme once for every view, so the asking view picks the node.
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
    #[cfg(not(target_os = "linux"))]
    {
        b = match (&p.url, &p.html) {
            (Some(u), _) => b.with_url(scheme_url::to_view(&protocols, u)),
            (None, Some(h)) => b.with_html(h),
            (None, None) => b.with_url("about:blank"),
        };
    }
    let handle = handle_of(window).ok_or("the webview's window isn't open")?;
    let view = handle.with_raw_handle(|raw| b.build_as_child(&raw).map_err(|e| e.to_string()))??;
    #[cfg(target_os = "linux")]
    {
        main_frame_navigations(n, &view);
        enable_webrtc(&view);
        match (&p.url, &p.html) {
            (Some(u), _) => view.load_url(u).map_err(|e| e.to_string())?,
            (None, Some(h)) => view.load_html(h).map_err(|e| e.to_string())?,
            (None, None) => {}
        }
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

/// WebKitGTK ships WebRTC off (Chromium and WKWebView have it on) and reads the setting when a
/// document is created, so it is set before the view's first load.
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
    let exists = VIEWS.with(|v| v.borrow().contains_key(&n));
    if !exists && handle_of(window).is_none() {
        WAITING.with(|w| w.borrow_mut().insert(n, (window, r)));
        return;
    }
    if !exists {
        let props = engine::read(|e| e.tree.get(n).map(|node| (*node.props).clone()));
        let Some(p) = props else { return };
        let t0 = std::time::Instant::now();
        match create(n, window, &p, r) {
            Ok(view) => {
                let _ = view.set_bounds(rect(window, r));
                #[cfg(target_os = "macos")]
                mac::round(&view, corners(&p));
                eprintln!("stella-engine metric {{\"metric\":\"webview_created\",\"ms\":{:.1},\"node\":{n}}}", t0.elapsed().as_secs_f64() * 1000.0);
                VIEWS.with(|v| {
                    v.borrow_mut().insert(n, View { view, window, protocols: p.protocols.clone().into(), url: p.url.clone(), html: p.html.clone(), rect: r, visible: true, corners: corners(&p), covered: false, applied: None, zoom: 1.0, zoomed_at: 0.0, #[cfg(target_os = "linux")] backdrop: None })
                });
                element_event(n, "ready", json!({}), None);
            }
            Err(e) => {
                eprintln!("stella-engine: webview failed: {e}");
                element_event(n, "error", json!({ "error": e }), None);
                return;
            }
        }
    }
    let shape = shape(n, window, r);
    VIEWS.with(|v| {
        let mut v = v.borrow_mut();
        let Some(view) = v.get_mut(&n) else { return };
        if view.rect != r {
            let _ = view.view.set_bounds(rect(window, r));
            view.rect = r;
        }
        let hidden = r[2] < 1.0 || r[3] < 1.0 || shape.is_none() || view.covered;
        let k = handle_of(window).and_then(|h| h.scale()).unwrap_or(1.0) as f32;
        if view.zoomed_at != k {
            view.zoomed_at = k;
            zoom(view, k);
        }
        #[cfg(target_os = "linux")]
        if let Some(color) = backdrop(n)
            && view.backdrop != Some(color)
        {
            use wry::WebViewExtUnix;
            view.backdrop = Some(color);
            let [r, g, b, a] = color.map(|c| c as f64 / 255.0);
            webkit2gtk::WebViewExt::set_background_color(&view.view.webview(), &gtk::gdk::RGBA::new(r, g, b, a));
        }
        if !hidden && let Some(s) = shape {
            let key = (s, r, view.corners, k);
            if view.applied.as_ref() != Some(&key) {
                #[cfg(target_os = "macos")]
                mac::mask(&view.view, r, Some(&key.0));
                #[cfg(any(target_os = "linux", target_os = "windows"))]
                native_shape::apply(&view.view, r, &key.0, view.corners, k);
                view.applied = Some(key);
            }
        }
        if view.visible == hidden {
            let _ = view.view.set_visible(!hidden);
            view.visible = !hidden;
            // Showing wry's GTK toplevel again restores the size it had when it was hidden.
            if !hidden {
                let _ = view.view.set_bounds(rect(window, r));
            }
        }
    });
}

/// What shows of a native view that can't be masked by layers: a region of device-pixel rects,
/// set as the view's window shape so it neither draws nor takes the pointer outside it.
#[cfg(any(target_os = "linux", target_os = "windows"))]
mod native_shape {
    /// Rows of the view's own rounded rect, of what its clips leave, and of what is cut out.
    type Region<'a> = (&'a [[i32; 4]], &'a [[i32; 4]], &'a [[i32; 4]]);
    /// Device-pixel rows `[x, y, w, h]` covering a rect with corner radii (top-left, top-right,
    /// bottom-right, bottom-left), relative to `origin`; rows with the same span are merged.
    fn rows(r: [f32; 4], c: [f32; 4], k: f32, origin: [i32; 2]) -> Vec<[i32; 4]> {
        let (x0, y0) = ((r[0] * k).round() as i32, (r[1] * k).round() as i32);
        let (x1, y1) = (((r[0] + r[2]) * k).round() as i32, ((r[1] + r[3]) * k).round() as i32);
        let (w, h) = ((x1 - x0) as f32, (y1 - y0) as f32);
        let c = c.map(|v| (v * k).clamp(0.0, w.min(h) / 2.0));
        let inset = |rad: f32, d: f32| if d <= 0.0 || rad <= 0.0 { 0.0 } else { rad - (rad * rad - d * d).max(0.0).sqrt() };
        let mut out: Vec<[i32; 4]> = Vec::new();
        for y in y0..y1 {
            let yc = (y - y0) as f32 + 0.5;
            let left = inset(c[0], c[0] - yc).max(inset(c[3], yc - (h - c[3])));
            let right = inset(c[1], c[1] - yc).max(inset(c[2], yc - (h - c[2])));
            let (a, b) = (x0 + left.round() as i32, x1 - right.round() as i32);
            if b <= a {
                continue;
            }
            let row = [a - origin[0], y - origin[1], b - a, 1];
            match out.last_mut() {
                Some(last) if last[0] == row[0] && last[2] == row[2] && last[1] + last[3] == row[1] => last[3] += 1,
                _ => out.push(row),
            }
        }
        out
    }

    /// The view at `r` shows `shape` (window coordinates), rounded by its own `corners`.
    pub fn apply(view: &wry::WebView, r: [f32; 4], shape: &super::Shape, corners: [f32; 4], k: f32) {
        let origin = [(r[0] * k).round() as i32, (r[1] * k).round() as i32];
        let whole = shape.cuts.is_empty() && super::contains(shape.vis, r) && corners.iter().chain(&shape.round).all(|c| *c <= 0.0);
        if whole {
            platform::set(view, None);
            return;
        }
        let own = rows(r, corners, k, origin);
        let vis = rows(shape.vis, shape.round, k, origin);
        let cuts: Vec<[i32; 4]> = shape.cuts.iter().flat_map(|(c, radii)| rows(*c, *radii, k, origin)).collect();
        platform::set(view, Some((&own, &vis, &cuts)));
    }

    #[cfg(target_os = "linux")]
    mod platform {
        use gtk::prelude::{Cast, WidgetExt};
        use std::sync::OnceLock;
        use wry::WebViewExtUnix;
        use x11_dl::xfixes;
        use x11_dl::xlib::XRectangle;

        const SHAPE_BOUNDING: i32 = 0;
        const SHAPE_INPUT: i32 = 2;

        fn lib() -> Option<&'static xfixes::Xlib> {
            static LIB: OnceLock<Option<xfixes::Xlib>> = OnceLock::new();
            LIB.get_or_init(|| xfixes::Xlib::open().ok()).as_ref()
        }

        /// Shapes wry's X11 container (the foreign window its GTK toplevel wraps): the X server
        /// clips the page's drawing and pointer hits to the region, and the engine window under
        /// it gets what falls outside.
        pub fn set(view: &wry::WebView, region: Option<super::Region<'_>>) {
            let Some(x) = lib() else { return };
            let Some(top) = view.webview().toplevel().and_then(|t| t.downcast::<gtk::Window>().ok()) else { return };
            let Some(gdk_window) = top.window() else { return };
            let Ok(xw) = gdk_window.downcast::<gdkx11::X11Window>() else { return };
            let Some(display) = gtk::gdk::Display::default() else { return };
            let Ok(xd) = display.clone().downcast::<gdkx11::X11Display>() else { return };
            // SAFETY: GDK's Xlib display, alive as long as GDK is.
            let dpy = unsafe { xd.xdisplay() } as *mut x11_dl::xlib::Display;
            let win = xw.xid();
            let make = |rects: &[[i32; 4]]| {
                let mut xr: Vec<XRectangle> = rects.iter().map(|q| XRectangle { x: q[0] as i16, y: q[1] as i16, width: q[2].max(0) as u16, height: q[3].max(0) as u16 }).collect();
                // SAFETY: `dpy` is GDK's live Xlib display; the rects outlive the call.
                unsafe { (x.XFixesCreateRegion)(dpy, xr.as_mut_ptr(), xr.len() as i32) }
            };
            gtk::gdk::error_trap_push();
            match region {
                None => {
                    // SAFETY: as above; region 0 (None) removes the shape.
                    unsafe {
                        (x.XFixesSetWindowShapeRegion)(dpy, win, SHAPE_BOUNDING, 0, 0, 0);
                        (x.XFixesSetWindowShapeRegion)(dpy, win, SHAPE_INPUT, 0, 0, 0);
                    }
                }
                Some((own, vis, cuts)) => {
                    let (a, b, c) = (make(own), make(vis), make(cuts));
                    // SAFETY: as above; every region is created here and destroyed after use.
                    unsafe {
                        (x.XFixesIntersectRegion)(dpy, a, a, b);
                        (x.XFixesSubtractRegion)(dpy, a, a, c);
                        (x.XFixesSetWindowShapeRegion)(dpy, win, SHAPE_BOUNDING, 0, 0, a);
                        (x.XFixesSetWindowShapeRegion)(dpy, win, SHAPE_INPUT, 0, 0, a);
                        for r in [a, b, c] {
                            (x.XFixesDestroyRegion)(dpy, r);
                        }
                    }
                }
            }
            display.flush();
            gtk::gdk::error_trap_pop_ignored();
        }
    }

    #[cfg(target_os = "windows")]
    mod platform {
        use windows::Win32::Graphics::Gdi::{CombineRgn, CreateRectRgn, DeleteObject, HRGN, RGN_AND, RGN_DIFF, RGN_OR, SetWindowRgn};
        use wry::WebViewExtWindows;

        fn region(rects: &[[i32; 4]]) -> HRGN {
            // SAFETY: plain GDI region calls on regions made here.
            unsafe {
                let out = CreateRectRgn(0, 0, 0, 0);
                for q in rects {
                    let one = CreateRectRgn(q[0], q[1], q[0] + q[2], q[1] + q[3]);
                    CombineRgn(Some(out), Some(out), Some(one), RGN_OR);
                    let _ = DeleteObject(one.into());
                }
                out
            }
        }

        /// Sets the window region of wry's WebView2 container: Windows clips the container and
        /// its child windows (the browser's) to it, in drawing and hit testing.
        pub fn set(view: &wry::WebView, rows: Option<super::Region<'_>>) {
            let hwnd = view.hwnd();
            // SAFETY: `hwnd` is wry's live container; the system owns a region once it is set.
            unsafe {
                match rows {
                    None => {
                        SetWindowRgn(hwnd, None, true);
                    }
                    Some((own, vis, cuts)) => {
                        let (a, b, c) = (region(own), region(vis), region(cuts));
                        CombineRgn(Some(a), Some(a), Some(b), RGN_AND);
                        CombineRgn(Some(a), Some(a), Some(c), RGN_DIFF);
                        let _ = DeleteObject(b.into());
                        let _ = DeleteObject(c.into());
                        SetWindowRgn(hwnd, Some(a), true);
                    }
                }
            }
        }
    }
}

/// Applies the view's page zoom at window scale `k`. WebKitGTK lays pages out at GTK's integer
/// scale (GDK_SCALE), not the window's: its zoom makes up the difference, so a CSS pixel is one
/// engine point as in Electron.
fn zoom(view: &View, k: f32) {
    #[cfg(target_os = "linux")]
    let base = {
        use gtk::prelude::WidgetExt;
        use wry::WebViewExtUnix;
        f64::from(k) / f64::from(view.view.webview().scale_factor().max(1))
    };
    #[cfg(not(target_os = "linux"))]
    let base = {
        let _ = k;
        1.0
    };
    let _ = view.view.zoom(base * view.zoom);
}

/// The webview's corner radii (top-left, top-right, bottom-right, bottom-left).
fn corners(p: &Props) -> [f32; 4] {
    p.corners.unwrap_or([p.radius.unwrap_or(0.0); 4])
}

/// A shown webview's pixels at its placed rect, for drawing into a captured frame: only inside
/// `clip` and outside `cuts`, as on screen.
pub struct Shot {
    pub rect: [f32; 4],
    pub corners: [f32; 4],
    pub clip: Option<[f32; 4]>,
    pub cuts: Vec<([f32; 4], [f32; 4])>,
    pub image: image::RgbaImage,
}

/// Snapshots still to come, those taken, and who hears them all.
type Gathering = (usize, Vec<Shot>, Option<Box<dyn FnOnce(Vec<Shot>) + Send>>);

/// Takes the page's current pixels, at the view's size in device pixels or larger.
fn snap(view: &WebView, done: impl FnOnce(Option<image::RgbaImage>) + 'static) {
    #[cfg(target_os = "macos")]
    mac::snapshot(view, done);
    #[cfg(target_os = "linux")]
    gtk_snap::snapshot(view, done);
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = view;
        done(None);
    }
}

/// Snapshots every shown webview of `window` and hands them to `done` once all have answered.
/// Windows can't snapshot yet; there `done` gets none.
pub fn snapshots(window: u32, done: Box<dyn FnOnce(Vec<Shot>) + Send>) {
    let targets: Vec<(u32, [f32; 4], Option<Shape>)> = VIEWS.with(|v| {
        v.borrow().iter().filter(|(_, x)| x.window == window && x.visible).map(|(n, x)| (*n, x.rect, x.applied.as_ref().map(|a| a.0.clone()))).collect()
    });
    if targets.is_empty() {
        done(Vec::new());
        return;
    }
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
    for (n, rect, shape) in targets {
        let c = engine::read(|e| e.tree.get(n).map(|node| corners(&node.props)).unwrap_or_default());
        let (clip, cuts) = match shape {
            Some(s) => (Some(s.vis), s.cuts),
            None => (None, Vec::new()),
        };
        let pending = pending.clone();
        let sent = with_view(n, |view| {
            let pending = pending.clone();
            snap(&view.view, move |image| answer(&pending, image.map(|image| Shot { rect, corners: c, clip, cuts, image })));
        });
        if sent.is_err() {
            answer(&pending, None);
        }
    }
}

#[cfg(target_os = "linux")]
mod gtk_snap {
    use webkit2gtk::{SnapshotOptions, SnapshotRegion, WebViewExt};
    use wry::WebViewExtUnix;

    pub fn snapshot(view: &wry::WebView, done: impl FnOnce(Option<image::RgbaImage>) + 'static) {
        view.webview().snapshot(SnapshotRegion::Visible, SnapshotOptions::TRANSPARENT_BACKGROUND, None::<&gtk::gio::Cancellable>, move |res| {
            done(res.ok().and_then(decode));
        });
    }

    /// Cairo's ARGB32 is premultiplied, in native-endian words (BGRA bytes here).
    fn decode(surface: gtk::cairo::Surface) -> Option<image::RgbaImage> {
        let mut img = gtk::cairo::ImageSurface::try_from(surface).ok()?;
        img.flush();
        let (w, h, stride) = (img.width() as usize, img.height() as usize, img.stride() as usize);
        let data = img.data().ok()?;
        let mut px = Vec::with_capacity(w * h * 4);
        for y in 0..h {
            for x in 0..w {
                let i = y * stride + x * 4;
                let (b, g, r, a) = (data[i], data[i + 1], data[i + 2], data[i + 3]);
                let un = |c: u8| if a == 0 { 0 } else { ((u32::from(c) * 255 + u32::from(a) / 2) / u32::from(a)).min(255) as u8 };
                px.extend_from_slice(&[un(r), un(g), un(b), a]);
            }
        }
        image::RgbaImage::from_raw(w as u32, h as u32, px)
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use std::cell::{Cell, RefCell};
    use std::sync::OnceLock;

    use objc2::runtime::{AnyObject, Imp, Sel};
    use objc2::sel;
    use objc2_web_kit::WKNavigationAction;

    use std::collections::HashMap;
    use std::sync::atomic::{AtomicU64, Ordering};

    use block2::RcBlock;
    use dispatch2::DispatchQueue;
    use objc2_app_kit::NSImage;
    use objc2_core_foundation::{CGPoint, CGRect, CGSize};
    use objc2_core_graphics::{CGBitmapContextCreate, CGColorSpace, CGContext, CGImage, CGImageAlphaInfo, CGImageByteOrderInfo, CGMutablePath, kCGColorSpaceSRGB};
    use objc2_foundation::NSError;
    use objc2_quartz_core::{CACornerMask, CAShapeLayer, CATransaction, kCAFillRuleEvenOdd};
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

    type Done = Box<dyn FnOnce(Option<image::RgbaImage>)>;

    thread_local! {
        static WAITING: RefCell<HashMap<u64, Done>> = RefCell::new(HashMap::new());
    }
    static NEXT: AtomicU64 = AtomicU64::new(1);

    struct Image(objc2::rc::Retained<CGImage>);
    // SAFETY: a CGImage is immutable, and Quartz allows reading one from any thread.
    unsafe impl Send for Image {}

    /// The page's pixels as `done` gets them on the main thread; the decode runs on a worker, so
    /// a recording's snapshot every frame leaves the main thread to WebKit and the host.
    pub fn snapshot(view: &wry::WebView, done: impl FnOnce(Option<image::RgbaImage>) + 'static) {
        let id = NEXT.fetch_add(1, Ordering::Relaxed);
        WAITING.with(|w| w.borrow_mut().insert(id, Box::new(done)));
        let block = RcBlock::new(move |img: *mut NSImage, _err: *mut NSError| {
            // SAFETY: WebKit passes a valid NSImage or null for the call's duration; a null rect
            // asks for the image's own size.
            let cg = unsafe { img.as_ref() }.and_then(|i| unsafe { i.CGImageForProposedRect_context_hints(std::ptr::null_mut(), None, None) }).map(Image);
            let spawned = std::thread::Builder::new().name("stella-snapshot".into()).spawn(move || {
                let decoded = cg.and_then(|c| decode(&c.0));
                DispatchQueue::main().exec_async(move || {
                    if let Some(done) = WAITING.with(|w| w.borrow_mut().remove(&id)) {
                        done(decoded);
                    }
                });
            });
            if spawned.is_err()
                && let Some(done) = WAITING.with(|w| w.borrow_mut().remove(&id))
            {
                done(None);
            }
        });
        // SAFETY: called on the main thread; a nil configuration snapshots the visible bounds.
        unsafe { view.webview().takeSnapshotWithConfiguration_completionHandler(None, &block) };
    }

    fn decode(cg: &CGImage) -> Option<image::RgbaImage> {
        let (w, h) = (CGImage::width(Some(cg)), CGImage::height(Some(cg)));
        if w == 0 || h == 0 {
            return None;
        }
        let mut px = vec![0u8; w * h * 4];
        // SAFETY: a static CoreGraphics constant.
        let space = CGColorSpace::with_name(Some(unsafe { kCGColorSpaceSRGB }))?;
        let info = CGImageAlphaInfo::PremultipliedLast.0 | CGImageByteOrderInfo::Order32Big.0;
        // SAFETY: `px` holds `h` rows of `w * 4` bytes and outlives the context.
        let ctx = unsafe { CGBitmapContextCreate(px.as_mut_ptr().cast(), w, h, 8, w * 4, Some(&space), info) }?;
        CGContext::draw_image(Some(&ctx), CGRect::new(CGPoint::new(0.0, 0.0), CGSize::new(w as f64, h as f64)), Some(cg));
        drop(ctx);
        for p in px.as_chunks_mut::<4>().0 {
            let a = u16::from(p[3]);
            if a > 0 && a < 255 {
                for c in &mut p[..3] {
                    *c = ((u16::from(*c) * 255 + a / 2) / a).min(255) as u8;
                }
            }
        }
        image::RgbaImage::from_raw(w as u32, h as u32, px)
    }

    thread_local! {
        /// What each masked WKWebView shows, in its own top-left coordinates, by view pointer.
        static HOLES: RefCell<HashMap<usize, super::Shape>> = RefCell::new(HashMap::new());
    }

    type HitTest = unsafe extern "C-unwind" fn(&AnyObject, Sel, CGPoint) -> *mut AnyObject;
    static SUPER_HIT: OnceLock<HitTest> = OnceLock::new();

    /// The masked parts of a WKWebView pass the pointer to the engine's view under it.
    unsafe extern "C-unwind" fn hit_test(this: &AnyObject, sel: Sel, point: CGPoint) -> *mut AnyObject {
        let key = this as *const AnyObject as usize;
        let shape = HOLES.try_with(|h| h.borrow().get(&key).cloned()).ok().flatten();
        if let Some(shape) = shape {
            // SAFETY: AppKit calls `hitTest:` on the main thread with the receiver alive.
            let local: CGPoint = unsafe {
                let parent: *mut AnyObject = objc2::msg_send![this, superview];
                objc2::msg_send![this, convertPoint: point, fromView: parent]
            };
            // SAFETY: as above.
            let (bounds, flipped): (CGRect, bool) = unsafe { (objc2::msg_send![this, bounds], objc2::msg_send![this, isFlipped]) };
            let x = (local.x - bounds.origin.x) as f32;
            let y = if flipped { local.y - bounds.origin.y } else { bounds.origin.y + bounds.size.height - local.y } as f32;
            if x >= 0.0 && y >= 0.0 && x < bounds.size.width as f32 && y < bounds.size.height as f32 && !super::shows(&shape, x, y) {
                return std::ptr::null_mut();
            }
        }
        match SUPER_HIT.get() {
            // SAFETY: the inherited `hitTest:` implementation, with its own arguments.
            Some(f) => unsafe { f(this, sel, point) },
            None => std::ptr::null_mut(),
        }
    }

    /// wry's WKWebView class inherits `hitTest:`; it gets one that asks the mask first.
    fn install_hit_test(wk: &AnyObject) {
        static DONE: OnceLock<bool> = OnceLock::new();
        DONE.get_or_init(|| {
            let class = wk.class();
            let Some(parent) = class.superclass() else { return false };
            let (Some(own), Some(inherited)) = (class.instance_method(sel!(hitTest:)), parent.instance_method(sel!(hitTest:))) else { return false };
            if !std::ptr::eq(own, inherited) {
                return false;
            }
            // SAFETY: `hit_test` has `hitTest:`'s exact signature; the inherited IMP is stored
            // before the method is added, both on the main thread.
            unsafe {
                let _ = SUPER_HIT.set(std::mem::transmute::<Imp, HitTest>(inherited.implementation()));
                let imp: Imp = std::mem::transmute::<HitTest, Imp>(hit_test);
                objc2::ffi::class_addMethod(class as *const _ as *mut _, sel!(hitTest:), imp, c"@@:{CGPoint=dd}".as_ptr()).as_bool()
            }
        });
    }

    /// Shows only `shape` of the WKWebView placed at `r` (all of it with `None`), and lets the
    /// pointer through where it doesn't show.
    pub fn mask(view: &wry::WebView, r: [f32; 4], shape: Option<&super::Shape>) {
        let wk = view.webview();
        let key = objc2::rc::Retained::as_ptr(&wk) as usize;
        let local = shape.map(|s| super::Shape {
            vis: [s.vis[0] - r[0], s.vis[1] - r[1], s.vis[2], s.vis[3]],
            round: s.round,
            cuts: s.cuts.iter().map(|(c, k)| ([c[0] - r[0], c[1] - r[1], c[2], c[3]], *k)).collect(),
        });
        let whole = local.as_ref().is_none_or(|s| s.cuts.is_empty() && s.round.iter().all(|c| *c <= 0.0) && s.vis[0] <= 0.5 && s.vis[1] <= 0.5 && s.vis[2] >= r[2] - 0.5 && s.vis[3] >= r[3] - 0.5);
        wk.setWantsLayer(true);
        let Some(layer) = wk.layer() else { return };
        CATransaction::begin();
        CATransaction::setDisableActions(true);
        match local.filter(|_| !whole) {
            None => {
                HOLES.with(|h| h.borrow_mut().remove(&key));
                // SAFETY: main thread; clearing the layer's mask.
                unsafe { layer.setMask(None) };
            }
            Some(s) => {
                install_hit_test(wk.as_ref());
                let bounds = layer.bounds();
                let top_down = layer.contentsAreFlipped();
                let h = bounds.size.height;
                let to_layer = |q: [f32; 4]| {
                    let y = if top_down { f64::from(q[1]) } else { h - f64::from(q[1]) - f64::from(q[3]) };
                    CGRect::new(CGPoint::new(bounds.origin.x + f64::from(q[0]), bounds.origin.y + y), CGSize::new(f64::from(q[2]), f64::from(q[3])))
                };
                let path = CGMutablePath::new();
                let flip = |radii: [f32; 4]| if top_down { radii } else { [radii[3], radii[2], radii[1], radii[0]] };
                rounded(&path, to_layer(s.vis), flip(s.round));
                for (c, radii) in &s.cuts {
                    rounded(&path, to_layer(*c), flip(*radii));
                }
                let shaped = layer.mask().and_then(|m| m.downcast::<CAShapeLayer>().ok());
                let m = shaped.unwrap_or_else(|| {
                    let m = CAShapeLayer::new();
                    // SAFETY: a static CoreAnimation constant.
                    m.setFillRule(unsafe { kCAFillRuleEvenOdd });
                    // SAFETY: main thread; `m` is a fresh layer nothing else holds.
                    unsafe { layer.setMask(Some(&m)) };
                    m
                });
                m.setFrame(bounds);
                m.setPath(Some(&path));
                HOLES.with(|h| h.borrow_mut().insert(key, s));
            }
        }
        CATransaction::commit();
    }

    /// Adds a rect with per-corner radii, listed from the corner at its lowest x and y going
    /// round through increasing x.
    fn rounded(path: &CGMutablePath, r: CGRect, radii: [f32; 4]) {
        let (x0, y0) = (r.origin.x, r.origin.y);
        let (x1, y1) = (x0 + r.size.width, y0 + r.size.height);
        let cap = (r.size.width.min(r.size.height) / 2.0).max(0.0);
        let [a, b, c, d] = radii.map(|v| f64::from(v).clamp(0.0, cap));
        // SAFETY: `path` is a live mutable path; no transform.
        unsafe {
            CGMutablePath::move_to_point(Some(path), std::ptr::null(), x0 + a, y0);
            CGMutablePath::add_arc_to_point(Some(path), std::ptr::null(), x1, y0, x1, y0 + b, b);
            CGMutablePath::add_arc_to_point(Some(path), std::ptr::null(), x1, y1, x1 - c, y1, c);
            CGMutablePath::add_arc_to_point(Some(path), std::ptr::null(), x0, y1, x0, y1 - d, d);
            CGMutablePath::add_arc_to_point(Some(path), std::ptr::null(), x0, y0, x0 + a, y0, a);
        }
        CGMutablePath::close_subpath(Some(path));
    }

    /// Forgets a closing view's mask.
    pub fn unmask(view: &wry::WebView) {
        let key = objc2::rc::Retained::as_ptr(&view.webview()) as usize;
        HOLES.with(|h| h.borrow_mut().remove(&key));
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

/// A transparent view's page background on Linux: what the engine draws under it (its own and its
/// ancestors' fills down to the first opaque one, over Electron's default white). wry's X11
/// container is an opaque child window, and a WebKitGTK view made transparent redraws only its
/// last damage on a full repaint, leaving the rest black.
#[cfg(target_os = "linux")]
fn backdrop(n: u32) -> Option<[u8; 4]> {
    engine::read(|e| {
        if !e.tree.get(n)?.props.transparent {
            return None;
        }
        let mut layers = Vec::new();
        let mut at = n;
        while let Some(node) = e.tree.get(at) {
            if let Some(c) = node.props.fill.as_ref().map(|c| c.0).filter(|c| c.a > 0.0) {
                layers.push(c);
                if c.a >= 1.0 {
                    break;
                }
            }
            if at == 0 || node.parent == at {
                break;
            }
            at = node.parent;
        }
        let rgb = layers.iter().rev().fold([1.0f32; 3], |under, c| [0, 1, 2].map(|i| [c.r, c.g, c.b][i] * c.a + under[i] * (1.0 - c.a)));
        Some([rgb[0], rgb[1], rgb[2], 1.0].map(|v| (rune::color::srgb_encode(v).clamp(0.0, 1.0) * 255.0).round() as u8))
    })
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

/// Whether the views need the loop to keep ticking without a frame of their own: WebKitGTK's
/// events are pumped from it, and a view waiting for its window's native handle retries on it.
pub fn needs_ticks() -> bool {
    cfg!(target_os = "linux") || WAITING.with(|w| !w.borrow().is_empty())
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
    #[cfg(target_os = "linux")]
    crate::webview_input::forget(n);
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
    #[cfg(target_os = "macos")]
    for v in &views {
        mac::unmask(&v.view);
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
        "webview.zoom" => {
            let factor = v.get("factor").and_then(|f| f.as_f64()).unwrap_or(1.0);
            VIEWS.with(|views| {
                let mut views = views.borrow_mut();
                let w = views.get_mut(&n).ok_or("no such webview")?;
                w.zoom = factor;
                zoom(w, w.zoomed_at);
                Ok::<(), String>(())
            })?;
        }
        "webview.state" => {
            let clip: Vec<serde_json::Value> = engine::read(|e| e.tree.clip_of.get(&n).cloned())
                .unwrap_or_default()
                .into_iter()
                .map(|c| json!({ "node": c, "rect": CLIPS.with(|m| m.borrow().get(&c).map(|x| x.0)), "radius": CLIPS.with(|m| m.borrow().get(&c).map(|x| x.1)) }))
                .collect();
            return with_view(n, |w| {
                let covering: Vec<serde_json::Value> = OVERLAYS.with(|o| {
                    o.borrow().iter().filter(|(_, (win, r))| *win == w.window && overlaps(*r, w.rect)).map(|(k, (_, r))| json!({ "node": k, "rect": r })).collect()
                });
                json!({ "rect": w.rect, "shown": w.visible, "covered": w.covered, "covering": covering, "fits": fits(n, w.rect), "clip": clip, "shape": w.applied.as_ref().map(|a| json!({ "vis": a.0.vis, "round": a.0.round, "cuts": a.0.cuts })) })
            });
        }
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
