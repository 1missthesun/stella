//! Lazy OS WebView slot. Nothing WebView-related exists until TS mounts a `<box webview="url">`;
//! then one wry child WebView is created inside the Rune window and kept on the box's drawn rect.
//! macOS: WKWebView as an NSView subview; Windows: WebView2 child HWND; Linux: WebKitGTK child
//! (X11 only — wry's `build_as_child` doesn't work on Wayland).

use std::cell::RefCell;

use wry::dpi::{LogicalPosition, LogicalSize, PhysicalPosition, PhysicalSize};
use wry::{Rect, WebView, WebViewBuilder};

thread_local! {
    static WINDOW: RefCell<Option<rune::WindowHandle>> = const { RefCell::new(None) };
    static VIEW: RefCell<Option<(String, WebView, [f32; 4])>> = const { RefCell::new(None) };
}

pub fn set_window(h: &rune::WindowHandle) {
    WINDOW.with(|w| *w.borrow_mut() = Some(h.clone()));
}

/// Rune reports window points. WKWebView and WebView2 take logical units through wry; a
/// WebKitGTK child under X11 runs at GDK scale 1, so it gets device pixels.
fn rect(r: [f32; 4]) -> Rect {
    if cfg!(target_os = "linux") {
        let k = WINDOW.with(|w| w.borrow().as_ref().and_then(|h| h.scale())).unwrap_or(1.0);
        let p = |v: f32| (v as f64 * k).round();
        return Rect { position: PhysicalPosition::new(p(r[0]), p(r[1])).into(), size: PhysicalSize::new(p(r[2]).max(1.0) as u32, p(r[3]).max(1.0) as u32).into() };
    }
    Rect { position: LogicalPosition::new(r[0] as f64, r[1] as f64).into(), size: LogicalSize::new(r[2] as f64, r[3] as f64).into() }
}

/// Places (creating on first use) the WebView for `url` at the slot's drawn rect.
pub fn place(url: &str, r: [f32; 4]) {
    VIEW.with(|v| {
        let mut v = v.borrow_mut();
        if let Some((cur, view, last)) = v.as_mut() {
            if cur != url {
                let _ = view.load_url(url);
                *cur = url.to_owned();
            }
            if *last != r {
                let _ = view.set_bounds(rect(r));
                *last = r;
            }
            return;
        }
        let t0 = std::time::Instant::now();
        #[cfg(target_os = "linux")]
        if !gtk::is_initialized() {
            // NVIDIA + WebKitGTK's DMA-BUF renderer paints black inside a foreign X11 parent.
            if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
                // SAFETY: set once on the UI thread before GTK/WebKit start any threads.
                unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1") };
            }
            let _ = gtk::init();
        }
        let built = WINDOW.with(|w| {
            let w = w.borrow();
            let Some(h) = w.as_ref() else { return Err("no window".to_string()) };
            h.with_raw_handle(|raw| {
                WebViewBuilder::new().with_url(url).with_bounds(rect(r)).build_as_child(&raw).map_err(|e| e.to_string())
            })?
        });
        match built {
            Ok(view) => {
                eprintln!("stella-engine metric {{\"metric\":\"webview_created\",\"ms\":{:.1},\"url\":{:?},\"rect\":{:?}}}", t0.elapsed().as_secs_f64() * 1000.0, url, r);
                *v = Some((url.to_owned(), view, r));
            }
            Err(e) => eprintln!("stella-engine: webview failed: {e}"),
        }
    });
}

pub fn active() -> bool {
    VIEW.with(|v| v.borrow().is_some())
}

/// Drops the WebView (and its web process) once no slot asks for it.
pub fn close() {
    VIEW.with(|v| {
        if v.borrow_mut().take().is_some() {
            eprintln!("stella-engine: webview closed");
        }
    });
}

/// GTK needs its loop turned on Linux; Rune owns the loop, so turn it from poll.
pub fn pump() {
    #[cfg(target_os = "linux")]
    while gtk::events_pending() {
        gtk::main_iteration_do(false);
    }
}
