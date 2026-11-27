//! The desktop's scale for an engine on XWayland. A compositor that gives XWayland physical
//! pixels (Hyprland's `xwayland:force_zero_scaling`, KDE's "applications scale themselves")
//! expects X clients to scale by the output's fractional scale, which X11 has no way to say
//! unless the desktop sets `Xft.dpi`. Without it winit guesses from RandR millimetres (1.5 on a
//! 4K panel set to 1.6), so the scale is read from the Wayland outputs instead: physical mode
//! width over xdg-output logical width.

use wayland_client::globals::{GlobalListContents, registry_queue_init};
use wayland_client::protocol::{wl_output, wl_registry};
use wayland_client::{Connection, Dispatch, QueueHandle, WEnum};
use wayland_protocols::xdg::xdg_output::zv1::client::{zxdg_output_manager_v1, zxdg_output_v1};
use x11rb::connection::Connection as _;
use x11rb::protocol::randr::ConnectionExt as _;
use x11rb::protocol::xproto::{AtomEnum, ConnectionExt as _};

#[derive(Default, Clone, Copy)]
struct Output {
    mode: (i32, i32),
    turned: bool,
    logical: (i32, i32),
}

#[derive(Default)]
struct Outputs(Vec<Output>);

impl Output {
    fn physical_width(&self) -> i32 { if self.turned { self.mode.1 } else { self.mode.0 } }
    fn scale(&self) -> Option<f64> {
        (self.logical.0 > 0 && self.physical_width() > 0).then(|| f64::from(self.physical_width()) / f64::from(self.logical.0))
    }
}

impl Dispatch<wl_registry::WlRegistry, GlobalListContents> for Outputs {
    fn event(_: &mut Self, _: &wl_registry::WlRegistry, _: wl_registry::Event, _: &GlobalListContents, _: &Connection, _: &QueueHandle<Self>) {}
}

impl Dispatch<wl_output::WlOutput, usize> for Outputs {
    fn event(state: &mut Self, _: &wl_output::WlOutput, event: wl_output::Event, i: &usize, _: &Connection, _: &QueueHandle<Self>) {
        let Some(o) = state.0.get_mut(*i) else { return };
        match event {
            wl_output::Event::Mode { flags: WEnum::Value(flags), width, height, .. } if flags.contains(wl_output::Mode::Current) => o.mode = (width, height),
            wl_output::Event::Geometry { transform: WEnum::Value(t), .. } => {
                use wl_output::Transform as T;
                o.turned = matches!(t, T::_90 | T::_270 | T::Flipped90 | T::Flipped270);
            }
            _ => {}
        }
    }
}

impl Dispatch<zxdg_output_manager_v1::ZxdgOutputManagerV1, ()> for Outputs {
    fn event(_: &mut Self, _: &zxdg_output_manager_v1::ZxdgOutputManagerV1, _: zxdg_output_manager_v1::Event, _: &(), _: &Connection, _: &QueueHandle<Self>) {}
}

impl Dispatch<zxdg_output_v1::ZxdgOutputV1, usize> for Outputs {
    fn event(state: &mut Self, _: &zxdg_output_v1::ZxdgOutputV1, event: zxdg_output_v1::Event, i: &usize, _: &Connection, _: &QueueHandle<Self>) {
        if let (Some(o), zxdg_output_v1::Event::LogicalSize { width, height }) = (state.0.get_mut(*i), event) { o.logical = (width, height); }
    }
}

fn wayland_outputs() -> Option<Vec<Output>> {
    let conn = Connection::connect_to_env().ok()?;
    let (globals, mut queue) = registry_queue_init::<Outputs>(&conn).ok()?;
    let qh = queue.handle();
    let manager: zxdg_output_manager_v1::ZxdgOutputManagerV1 = globals.bind(&qh, 1..=3, ()).ok()?;
    let names: Vec<(u32, u32)> = globals.contents().with_list(|list| list.iter().filter(|g| g.interface == "wl_output").map(|g| (g.name, g.version)).collect());
    let mut state = Outputs(vec![Output::default(); names.len()]);
    let registry = globals.registry();
    let mut xdg = Vec::new();
    for (i, (name, version)) in names.into_iter().enumerate() {
        let output: wl_output::WlOutput = registry.bind(name, version.min(2), &qh, i);
        xdg.push(manager.get_xdg_output(&output, &qh, i));
    }
    queue.roundtrip(&mut state).ok()?;
    queue.roundtrip(&mut state).ok()?;
    Some(state.0)
}

/// RandR monitor widths of the X server, or `None` when the desktop already sets `Xft.dpi`.
fn x11_widths_without_xft() -> Option<Vec<i32>> {
    let (conn, screen) = x11rb::connect(None).ok()?;
    let root = conn.setup().roots.get(screen)?.root;
    let resources = conn.get_property(false, root, AtomEnum::RESOURCE_MANAGER, AtomEnum::STRING, 0, 1 << 16).ok()?.reply().ok()?;
    if String::from_utf8_lossy(&resources.value).lines().any(|l| l.starts_with("Xft.dpi:")) { return None; }
    let monitors = conn.randr_get_monitors(root, true).ok()?.reply().ok()?.monitors;
    Some(monitors.iter().map(|m| i32::from(m.width)).collect())
}

/// The scale X clients should use, when the compositor hands XWayland physical pixels and the
/// desktop sets no `Xft.dpi`: the largest output scale (X11 has one scale for the whole screen).
pub fn desktop_scale() -> Option<f64> {
    let outputs = wayland_outputs()?;
    let x = x11_widths_without_xft()?;
    let physical = outputs.iter().any(|o| o.scale().is_some_and(|s| (s - 1.0).abs() > 0.01) && x.contains(&o.physical_width()));
    if !physical { return None; }
    outputs.iter().filter_map(Output::scale).fold(None, |m: Option<f64>, s| Some(m.map_or(s, |m| m.max(s)))).map(|s| (s * 1000.0).round() / 1000.0)
}
