//! Stella Views' frame clock on the phone. The desktop answers `views.frame` from Rune's
//! `on_frame_encoded` (desktop-rune/engine/src/views.rs), which an embedded `LayerHost` doesn't
//! have; here the app's display link (`sme_frame`) is the clock: the tick after a view asks for a
//! frame answers it with `{t:"views", id:"", kind:"frame", at}`, so `useFrame` and
//! `requestAnimationFrame` in a view step with the display (120 Hz ProMotion, 60 Hz most Androids).

use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::json;

static WANTED: AtomicBool = AtomicBool::new(false);

/// `views.frame`: the next display-link tick is the views' next frame.
pub fn want() {
    if !WANTED.swap(true, Ordering::SeqCst) {
        crate::windows::wake_all();
    }
}

/// From the main window's poll: keeps the display link ticking while a view waits on a frame.
pub fn poll(tx: &mut rune::Tx) {
    if WANTED.load(Ordering::SeqCst) {
        tx.wake_after(std::time::Duration::ZERO);
    }
}

/// After each display-link frame (main thread): answers a waiting view's frame request.
pub fn after_frame() {
    if !WANTED.swap(false, Ordering::SeqCst) {
        return;
    }
    crate::engine::send(json!({ "t": "views", "id": "", "kind": "frame", "at": crate::metrics::epoch_ms() }));
}
