//! Linux: the desktop's font settings, read once at launch, as Chromium reads them for Electron's
//! text. GTK's settings come first (`org.gnome.desktop.interface` through the XDG Settings
//! portal: the UI font `system-ui` names, antialiasing, hinting, subpixel order), then
//! fontconfig has the final say (its match for the app's font: `antialias`, `hinting`,
//! `hintstyle`, `rgba`), as `gfx::GetFontRenderParams` does.

use std::collections::HashMap;
use std::ffi::{CStr, c_char, c_int, c_void};
use std::sync::mpsc;
use std::time::Duration;

#[derive(Clone, Debug, Default)]
pub struct Desktop {
    /// The family of GTK's `font-name` ("Adwaita Sans 11" → "Adwaita Sans").
    pub ui_family: Option<String>,
    antialiasing: Option<String>,
    hinting: Option<String>,
    rgba_order: Option<String>,
}

/// Starts reading the portal on its own thread; `wait` takes the answer.
pub fn start() -> mpsc::Receiver<Desktop> {
    let (tx, rx) = mpsc::channel();
    let _ = std::thread::Builder::new().name("desktop-fonts".into()).spawn(move || {
        let _ = tx.send(read_portal().unwrap_or_default());
    });
    rx
}

/// The portal's answer, or none if it hasn't come in `limit`.
pub fn wait(rx: &mpsc::Receiver<Desktop>, limit: Duration) -> Desktop {
    rx.recv_timeout(limit).unwrap_or_default()
}

fn read_portal() -> Option<Desktop> {
    use zbus::zvariant::OwnedValue;
    let conn = zbus::blocking::Connection::session().ok()?;
    let reply = conn
        .call_method(
            Some("org.freedesktop.portal.Desktop"),
            "/org/freedesktop/portal/desktop",
            Some("org.freedesktop.portal.Settings"),
            "ReadAll",
            &(vec!["org.gnome.desktop.interface"],),
        )
        .ok()?;
    let all: HashMap<String, HashMap<String, OwnedValue>> = reply.body().deserialize().ok()?;
    let keys = all.get("org.gnome.desktop.interface")?;
    let text = |k: &str| keys.get(k).and_then(|v| String::try_from(v.clone()).ok());
    Some(Desktop {
        ui_family: text("font-name").and_then(|n| pango_family(&n)),
        antialiasing: text("font-antialiasing"),
        hinting: text("font-hinting"),
        rgba_order: text("font-rgba-order"),
    })
}

/// The family of a Pango font description: words before the size and style words.
fn pango_family(desc: &str) -> Option<String> {
    const STYLE: &[&str] = &[
        "normal", "roman", "oblique", "italic", "small-caps", "thin", "ultra-light", "extra-light", "light", "semi-light",
        "demi-light", "book", "regular", "medium", "semi-bold", "demi-bold", "bold", "ultra-bold", "extra-bold", "heavy",
        "black", "ultra-black", "extra-black", "ultra-condensed", "extra-condensed", "condensed", "semi-condensed",
        "semi-expanded", "expanded", "extra-expanded", "ultra-expanded",
    ];
    let mut words: Vec<&str> = desc.split_whitespace().collect();
    while let Some(last) = words.last() {
        let w = last.trim_end_matches("px");
        if w.parse::<f32>().is_ok() || STYLE.contains(&last.to_ascii_lowercase().as_str()) {
            words.pop();
        } else {
            break;
        }
    }
    let family = words.join(" ").trim_end_matches(',').to_owned();
    (!family.is_empty()).then_some(family)
}

/// Chromium's `gfx::FontRenderParams` for the app's text, in the terms Rune draws.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Params {
    antialias: bool,
    /// 0 none, 1 slight, 2 medium, 3 full.
    hinting: u8,
    subpixel: bool,
}

/// The text mode that draws as Chromium does under these settings at this device scale.
/// Chromium turns hinting off above a scale of 1 (subpixel positioning, `HINTING_NONE`); at 1,
/// Blink still places antialiased glyphs on subpixel pens unless hinting is full.
pub fn smoothing(desktop: &Desktop, scale: f64) -> (rune::FontSmoothing, String) {
    let p = params(desktop);
    let mode = if !p.antialias {
        rune::FontSmoothing::Hinted
    } else if p.subpixel {
        rune::FontSmoothing::WindfoilRgb
    } else if scale > 1.0 || p.hinting == 0 {
        rune::FontSmoothing::WindfoilChromium
    } else if p.hinting == 3 {
        rune::FontSmoothing::Hinted
    } else {
        rune::FontSmoothing::HintedGpu
    };
    (mode, format!("{p:?}, scale {scale}"))
}

fn params(desktop: &Desktop) -> Params {
    let mut p = Params { antialias: true, hinting: 1, subpixel: false };
    match desktop.antialiasing.as_deref() {
        Some("none") => p.antialias = false,
        Some("rgba") => p.subpixel = !matches!(desktop.rgba_order.as_deref(), Some("none") | None),
        _ => {}
    }
    match desktop.hinting.as_deref() {
        Some("none") => p.hinting = 0,
        Some("slight") => p.hinting = 1,
        Some("medium") => p.hinting = 2,
        Some("full") => p.hinting = 3,
        _ => {}
    }
    if let Some(fc) = fontconfig_match() {
        if let Some(a) = fc.antialias { p.antialias = a; }
        match (fc.hinting, fc.hintstyle) {
            (Some(false), _) => p.hinting = 0,
            (_, Some(style)) => p.hinting = style.clamp(0, 3) as u8,
            _ => {}
        }
        if let Some(rgba) = fc.rgba { p.subpixel = (1..=4).contains(&rgba); }
    }
    if !p.antialias {
        p.subpixel = false;
        p.hinting = 3;
    }
    p
}

struct FcAnswer {
    antialias: Option<bool>,
    hinting: Option<bool>,
    hintstyle: Option<c_int>,
    rgba: Option<c_int>,
}

/// fontconfig's match for the app's font at Chromium's body size (dlopened, as fontique loads it).
#[allow(unsafe_code)]
fn fontconfig_match() -> Option<FcAnswer> {
    type NameParse = unsafe extern "C" fn(*const u8) -> *mut c_void;
    type Substitute = unsafe extern "C" fn(*mut c_void, *mut c_void, c_int) -> c_int;
    type Default = unsafe extern "C" fn(*mut c_void);
    type Match = unsafe extern "C" fn(*mut c_void, *mut c_void, *mut c_int) -> *mut c_void;
    type GetBool = unsafe extern "C" fn(*mut c_void, *const c_char, c_int, *mut c_int) -> c_int;
    type GetInt = unsafe extern "C" fn(*mut c_void, *const c_char, c_int, *mut c_int) -> c_int;
    type Destroy = unsafe extern "C" fn(*mut c_void);
    // SAFETY: libfontconfig's C API, called with patterns it made and freed once; symbols are
    // checked non-null before they're cast to their documented signatures.
    unsafe {
        let lib = libc::dlopen(c"libfontconfig.so.1".as_ptr(), libc::RTLD_NOW | libc::RTLD_LOCAL);
        if lib.is_null() {
            return None;
        }
        let sym = |name: &CStr| {
            let p = libc::dlsym(lib, name.as_ptr());
            (!p.is_null()).then_some(p)
        };
        let name_parse: NameParse = std::mem::transmute(sym(c"FcNameParse")?);
        let substitute: Substitute = std::mem::transmute(sym(c"FcConfigSubstitute")?);
        let default: Default = std::mem::transmute(sym(c"FcDefaultSubstitute")?);
        let font_match: Match = std::mem::transmute(sym(c"FcFontMatch")?);
        let get_bool: GetBool = std::mem::transmute(sym(c"FcPatternGetBool")?);
        let get_int: GetInt = std::mem::transmute(sym(c"FcPatternGetInteger")?);
        let destroy: Destroy = std::mem::transmute(sym(c"FcPatternDestroy")?);
        let pattern = name_parse(c"Manrope:pixelsize=13:scalable=True:fontwrapper=SFNT".as_ptr().cast());
        if pattern.is_null() {
            return None;
        }
        substitute(std::ptr::null_mut(), pattern, 0);
        default(pattern);
        let mut result = 0;
        let found = font_match(std::ptr::null_mut(), pattern, &mut result);
        destroy(pattern);
        if found.is_null() {
            return None;
        }
        let b = |k: &CStr| {
            let mut v = 0;
            (get_bool(found, k.as_ptr(), 0, &mut v) == 0).then_some(v != 0)
        };
        let i = |k: &CStr| {
            let mut v = 0;
            (get_int(found, k.as_ptr(), 0, &mut v) == 0).then_some(v)
        };
        let answer = FcAnswer { antialias: b(c"antialias"), hinting: b(c"hinting"), hintstyle: i(c"hintstyle"), rgba: i(c"rgba") };
        destroy(found);
        Some(answer)
    }
}
