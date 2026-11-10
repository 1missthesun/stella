//! Window-list types from Scrawl's `windows.rs`; Stella fills them from its own helpers.

use serde::{Deserialize, Serialize};

fn yes() -> bool {
    true
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowSnapshot {
    pub t: u64,
    pub windows: Vec<WindowEntry>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowEntry {
    pub id: u32,
    pub app: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bundle_id: Option<String>,
    /// `false` for agent apps (menu-bar utilities, overlays such as Cua Driver's full-screen
    /// window) whose windows are rarely what a capture is about.
    #[serde(default = "yes", skip_serializing_if = "Clone::clone")]
    pub regular: bool,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub title: String,
    /// `[x, y, width, height]` in points from the capture's top-left corner. Windows that hang
    /// off the captured display keep their full size, so `x`/`y` can be negative.
    pub bounds: [i32; 4],
    /// `0` for normal windows, `20` for the Dock, `24` for the menu bar, up to `101` for a
    /// regular app's floating panels and pop-up menus.
    pub layer: i32,
    /// The frontmost app's frontmost normal window.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub frontmost: bool,
}

/// `[t_ms, x, y]` with `x, y` normalized to the capture (`0.0..=1.0`), like clicks.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct CursorSample(pub u64, pub f32, pub f32);

