//! Look Up on macOS: the dictionary popover for the selection, as Chromium's
//! `RenderWidgetHostViewMac::ShowDefinitionForSelection` shows it, from the context menu, a force
//! click or three-finger tap on the selection (`quickLookWithEvent:`), or ⌃⌘D.

use rune::KeyEvent;

use crate::engine;

/// ⌃⌘D, AppKit's Look Up shortcut.
pub fn is_shortcut(ev: &KeyEvent) -> bool {
    cfg!(target_os = "macos") && ev.mods.ctrl && ev.mods.cmd && !ev.mods.alt && !ev.mods.shift && ev.is_command('d')
}

/// A settled selection, in the view's points before UI zoom.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub struct Target {
    pub text: String,
    /// The font of the text it starts in, as laid out.
    pub font: rune::ResolvedTextStyle,
    /// Its first glyph's baseline origin, where Chromium anchors the popover.
    pub origin: [f32; 2],
    pub rects: Vec<[f32; 4]>,
}

impl Target {
    /// `baseline`: how far below the first line box's top its baseline sits.
    pub fn new(text: String, font: rune::ResolvedTextStyle, baseline: f32, rects: Vec<[f32; 4]>) -> Option<Self> {
        let r = *rects.first()?;
        Some(Target { text, font, origin: [r[0], r[1] + baseline], rects })
    }
}

/// Shows the popover for `window`'s selection; false when there is none or off macOS.
pub fn show(window: u32) -> bool {
    show_at(window, None)
}

/// `at`, where a force click landed in window points from the top left, must be on the
/// selection.
fn show_at(window: u32, at: Option<[f32; 2]>) -> bool {
    let Some(target) = crate::windows::look_up_target(window) else { return false };
    let z = engine::read(|e| e.tree.get(window).and_then(|n| n.props.zoom)).filter(|z| z.is_finite()).map_or(1.0, |z| z.clamp(0.1, 10.0));
    if let Some([x, y]) = at {
        let on = |r: &[f32; 4]| x >= r[0] * z && x <= (r[0] + r[2]) * z && y >= r[1] * z && y <= (r[1] + r[3]) * z;
        if !target.rects.iter().any(on) {
            return false;
        }
    }
    imp::present(window, &target, z)
}

/// Hooks `quickLookWithEvent:` on winit's view class, once.
pub fn install() {
    imp::install();
}

#[cfg(not(target_os = "macos"))]
mod imp {
    pub fn present(_window: u32, _target: &super::Target, _zoom: f32) -> bool {
        false
    }
    pub fn install() {}
}

#[cfg(target_os = "macos")]
mod imp {
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
    use objc2::{class, msg_send, sel};
    use objc2_core_foundation::{CGPoint, CGRect};
    use objc2_foundation::NSString;
    use rune::raw_window_handle::RawWindowHandle;

    use crate::engine;

    fn view_of(window: u32) -> Option<*mut AnyObject> {
        let handle = engine::read(|e| e.windows.get(&window).and_then(|w| w.handle.clone()))?;
        handle
            .with_raw_handle(|raw| match raw.as_raw() {
                RawWindowHandle::AppKit(h) => Some(h.ns_view.as_ptr().cast::<AnyObject>()),
                _ => None,
            })
            .ok()
            .flatten()
    }

    // AppKit's NSFontWeight for a CSS weight.
    fn ns_weight(w: f32) -> f64 {
        const STEPS: [(f32, f64); 9] = [(100.0, -0.8), (200.0, -0.6), (300.0, -0.4), (400.0, 0.0), (500.0, 0.23), (600.0, 0.3), (700.0, 0.4), (800.0, 0.56), (900.0, 0.62)];
        STEPS.iter().min_by(|a, b| (a.0 - w).abs().total_cmp(&(b.0 - w).abs())).map_or(0.0, |s| s.1)
    }

    /// # Safety
    /// Main thread.
    unsafe fn font(style: &rune::ResolvedTextStyle, size: f64) -> Retained<AnyObject> {
        let named: Option<Retained<AnyObject>> = match &style.family {
            Some(name) => unsafe { msg_send![class!(NSFont), fontWithName: &*NSString::from_str(name), size: size] },
            None => None,
        };
        named.unwrap_or_else(|| unsafe { msg_send![class!(NSFont), systemFontOfSize: size, weight: ns_weight(style.weight)] })
    }

    pub fn present(window: u32, target: &super::Target, z: f32) -> bool {
        let Some(view) = view_of(window) else { return false };
        // SAFETY: the engine's commands and AppKit's event callbacks run on the main thread, and
        // `view` is the live window's content view.
        unsafe {
            let font = font(&target.font, f64::from(target.font.size * z));
            let attributes: Retained<AnyObject> = msg_send![class!(NSDictionary), dictionaryWithObject: &*font, forKey: &*NSString::from_str("NSFont")];
            let string: Retained<AnyObject> = msg_send![msg_send![class!(NSAttributedString), alloc], initWithString: &*NSString::from_str(&target.text), attributes: &*attributes];
            let (bounds, flipped): (CGRect, bool) = (msg_send![view, bounds], msg_send![view, isFlipped]);
            let (x, y) = (f64::from(target.origin[0] * z), f64::from(target.origin[1] * z));
            let point = CGPoint::new(x, if flipped { y } else { bounds.size.height - y });
            let _: () = msg_send![view, showDefinitionForAttributedString: &*string, atPoint: point];
        }
        true
    }

    type QuickLookImp = unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject);

    static ORIGINAL: std::sync::OnceLock<Option<QuickLookImp>> = std::sync::OnceLock::new();

    unsafe extern "C-unwind" fn quick_look(this: *mut AnyObject, sel: Sel, event: *mut AnyObject) {
        // SAFETY: AppKit calls `quickLookWithEvent:` on the main thread with a live view and event.
        let shown = unsafe {
            let point: CGPoint = msg_send![event, locationInWindow];
            let local: CGPoint = msg_send![this, convertPoint: point, fromView: std::ptr::null::<AnyObject>()];
            let (bounds, flipped): (CGRect, bool) = (msg_send![this, bounds], msg_send![this, isFlipped]);
            let y = if flipped { local.y } else { bounds.size.height - local.y };
            let window = engine::read(|e| e.windows.keys().copied().collect::<Vec<_>>()).into_iter().find(|w| view_of(*w) == Some(this));
            window.is_some_and(|w| super::show_at(w, Some([local.x as f32, y as f32])))
        };
        if !shown && let Some(Some(original)) = ORIGINAL.get() {
            // SAFETY: the method this one replaced, with its own arguments.
            unsafe { original(this, sel, event) };
        }
    }

    pub fn install() {
        if ORIGINAL.get().is_some() {
            return;
        }
        let Some(class) = AnyClass::get(c"WinitView") else { return };
        // NSView's own Look Up through NSTextInputClient, inherited, so not what replacing returns.
        let previous = class.instance_method(sel!(quickLookWithEvent:)).map(|m| m.implementation());
        // SAFETY: `quick_look` matches `quickLookWithEvent:`'s `v@:@`.
        unsafe {
            objc2::ffi::class_replaceMethod(class as *const AnyClass as *mut AnyClass, sel!(quickLookWithEvent:), std::mem::transmute::<QuickLookImp, Imp>(quick_look), c"v@:@".as_ptr());
        }
        // SAFETY: an IMP of the same selector, so the same signature.
        let _ = ORIGINAL.set(previous.map(|p| unsafe { std::mem::transmute::<Imp, QuickLookImp>(p) }));
    }
}
