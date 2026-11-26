//! What a page sees of its host before its own styles: the preferred color scheme and, on Linux,
//! Chromium's default fonts.

use std::sync::atomic::{AtomicU8, Ordering};

use wry::WebView;

/// 0 until the UI names the app's scheme, then 1 light or 2 dark.
static SCHEME: AtomicU8 = AtomicU8::new(0);

/// `webview.colorScheme {dark}`: pages prefer the app's color scheme, as Chromium gives an iframe
/// its owner's, live for every open page.
pub fn set_color_scheme(dark: bool) {
    if SCHEME.swap(if dark { 2 } else { 1 }, Ordering::Relaxed) == if dark { 2 } else { 1 } {
        return;
    }
    #[cfg(target_os = "linux")]
    if gtk::is_initialized_main_thread() {
        gtk_scheme();
    }
    #[cfg(not(target_os = "linux"))]
    crate::webview::each(apply_scheme);
}

/// Before a new view's first load.
pub fn prepare(view: &WebView) {
    #[cfg(not(target_os = "linux"))]
    apply_scheme(view);
    #[cfg(target_os = "linux")]
    {
        gtk_scheme();
        chromium_fonts(view);
    }
}

fn scheme() -> Option<bool> {
    match SCHEME.load(Ordering::Relaxed) {
        0 => None,
        s => Some(s == 2),
    }
}

/// WebKitGTK reads the scheme from GTK's settings and follows their changes, so it is one per
/// process; GTK starts with the first view.
#[cfg(target_os = "linux")]
fn gtk_scheme() {
    use gtk::prelude::GtkSettingsExt;
    if let (Some(dark), Some(settings)) = (scheme(), gtk::Settings::default()) {
        settings.set_gtk_application_prefer_dark_theme(dark);
    }
}

#[cfg(not(target_os = "linux"))]
fn apply_scheme(view: &WebView) {
    let Some(dark) = scheme() else { return };
    #[cfg(target_os = "windows")]
    {
        use wry::WebViewExtWindows;
        let _ = view.set_theme(if dark { wry::Theme::Dark } else { wry::Theme::Light });
    }
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{NSAppearance, NSAppearanceCustomization, NSAppearanceNameAqua, NSAppearanceNameDarkAqua};
        use wry::WebViewExtMacOS;
        // SAFETY: AppKit's appearance names are immutable static strings.
        let name = unsafe { if dark { NSAppearanceNameDarkAqua } else { NSAppearanceNameAqua } };
        view.webview().setAppearance(NSAppearance::appearanceNamed(name).as_deref());
    }
}

/// WebKitGTK falls back to sans-serif; Chromium's Linux defaults are Times New Roman for standard
/// and serif text, Arial and Monospace, at 16 and 13 px, matched through fontconfig (Liberation
/// Serif and Sans where installed).
#[cfg(target_os = "linux")]
fn chromium_fonts(view: &WebView) {
    use webkit2gtk::{SettingsExt, WebViewExt};
    use wry::WebViewExtUnix;
    if let Some(settings) = WebViewExt::settings(&view.webview()) {
        settings.set_default_font_family("Times New Roman");
        settings.set_serif_font_family("Times New Roman");
        settings.set_sans_serif_font_family("Arial");
        settings.set_monospace_font_family("Monospace");
        settings.set_default_font_size(16);
        settings.set_default_monospace_font_size(13);
    }
}
