//! stella-mobile-engine: Stella's Rune engine for phones.
//!
//! The desktop engine (`packages/desktop-rune/engine`) is a binary that spawns a Bun host and
//! reads its frames from a pipe. On a phone the TS UI runs in the app's own JavaScriptCore (iOS)
//! or V8 (Android, through Javet) on a JS thread, and this library is linked into the app:
//!
//! - the TS side hands each React commit's frame to [`ffi::sme_push`] (any thread);
//! - the app's display link (iOS `CADisplayLink`, Android `Choreographer`) calls
//!   [`ffi::sme_frame`] on the main thread, which drains frames, rebuilds the dirty tree into
//!   Rune `El`s and presents one Metal (iOS) or Vulkan (Android) frame through
//!   `rune::embed::LayerHost`;
//! - engine events (presses, layout, scroll, ...) reach the TS side as the same JSON lines the
//!   desktop host reads, through the app's event callback.
//!
//! Tree, props, styles, text, markdown, media, effects (`rune-fx` Liquid Glass) and the hot-swap
//! view, and Stella Views' program runs (`views.rs`, PsychoScript) are the desktop modules
//! themselves, included by path. Only windowing, commands, native
//! text fields and the transport live in `mobile/`.

#![allow(dead_code)]

#[path = "../../../desktop-rune/engine/src/backdrop.rs"]
mod backdrop;
#[path = "../../../desktop-rune/engine/src/engine.rs"]
mod engine;
#[path = "../../../desktop-rune/engine/src/fx.rs"]
mod fx;
#[path = "../../../desktop-rune/engine/src/keys.rs"]
mod keys;
#[path = "../../../desktop-rune/engine/src/markdown.rs"]
mod markdown;
#[path = "../../../desktop-rune/engine/src/media.rs"]
mod media;
#[path = "../../../desktop-rune/engine/src/metrics.rs"]
mod metrics;
#[path = "../../../desktop-rune/engine/src/props.rs"]
mod props;
#[path = "../../../desktop-rune/engine/src/protocol.rs"]
mod protocol;
#[path = "../../../desktop-rune/engine/src/style.rs"]
mod style;
#[path = "../../../desktop-rune/engine/src/surface.rs"]
mod surface;
#[path = "../../../desktop-rune/engine/src/swap_view.rs"]
mod swap_view;
#[path = "../../../desktop-rune/engine/src/swapfx.rs"]
mod swapfx;
#[path = "../../../desktop-rune/engine/src/text.rs"]
mod text;
#[path = "../../../desktop-rune/engine/src/tree.rs"]
mod tree;
#[path = "../../../desktop-rune/engine/src/trim.rs"]
mod trim;
#[path = "../../../desktop-rune/engine/src/view.rs"]
mod view;
#[path = "../../../desktop-rune/engine/src/views.rs"]
mod views;

#[path = "mobile/commands.rs"]
mod commands;
#[path = "mobile/control.rs"]
mod control;
#[path = "mobile/input.rs"]
mod input;
#[path = "mobile/native.rs"]
mod native;
#[path = "mobile/view_frames.rs"]
mod view_frames;
#[path = "mobile/windows.rs"]
mod windows;

pub mod ffi;

#[cfg(target_os = "android")]
mod android;
