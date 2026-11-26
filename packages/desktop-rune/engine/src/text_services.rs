//! The Edit menu's Substitutions and Speech items on macOS, answered by the window's view as
//! Chromium's `RenderWidgetHostViewCocoa` answers them: Show Substitutions and Start Speaking are
//! always enabled, Stop Speaking while the app speaks, and Smart Quotes, Smart Dashes and Text
//! Replacement while an editable field takes substitutions, checked from the same user defaults.
//! Start Speaking speaks the focused field's selection, else the window's selected text.

use std::cell::RefCell;
use std::collections::HashMap;

use rune::Tx;

use crate::engine;
use crate::windows::Win;

/// `NSTextCheckingType` bits a field takes, as Chromium's `allowedTextCheckingTypes`.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const QUOTE: u64 = 1 << 7;
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const DASH: u64 = 1 << 8;
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const REPLACEMENT: u64 = 1 << 9;

#[derive(Default, PartialEq)]
struct Field {
    checking: u64,
    selected: Option<String>,
}

thread_local! {
    /// Each window's focused field.
    static FIELDS: RefCell<HashMap<u32, Field>> = RefCell::new(HashMap::new());
}

/// Each poll: the window's focused field, what substitutions it takes and its selected text.
pub fn note(s: &Win, tx: &Tx) {
    if !cfg!(target_os = "macos") {
        return;
    }
    let field = tx.focused().and_then(|key| {
        engine::read(|e| {
            s.inputs.iter().find_map(|(n, st)| {
                let props = &e.tree.get(*n)?.props;
                (crate::view::rune_key(*n, props) == key).then(|| {
                    let editable = !props.read_only && !props.disabled && !props.secure;
                    let checking = match (editable, props.spellcheck != Some(false)) {
                        (false, _) => 0,
                        (true, true) => REPLACEMENT | QUOTE | DASH,
                        (true, false) => REPLACEMENT,
                    };
                    let (a, b) = (st.edit.anchor.min(st.edit.focus), st.edit.anchor.max(st.edit.focus));
                    let selected = st.edit.text.get(a..b).filter(|t| !t.is_empty() && !props.secure).map(str::to_owned);
                    Field { checking, selected }
                })
            })
        })
    });
    FIELDS.with(|f| {
        let mut f = f.borrow_mut();
        match field {
            Some(field) if f.get(&s.node) != Some(&field) => {
                f.insert(s.node, field);
            }
            None => {
                f.remove(&s.node);
            }
            _ => {}
        }
    });
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn checking(window: u32) -> u64 {
    FIELDS.with(|f| f.borrow().get(&window).map_or(0, |f| f.checking))
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn speakable(window: u32) -> Option<String> {
    FIELDS.with(|f| f.borrow().get(&window).and_then(|f| f.selected.clone())).or_else(|| crate::windows::selected_text(window))
}

/// Adds the items' actions to winit's view class, once.
pub fn install() {
    imp::install();
}

#[cfg(not(target_os = "macos"))]
mod imp {
    pub fn install() {}
}

#[cfg(target_os = "macos")]
mod imp {
    use std::ffi::CStr;
    use std::sync::OnceLock;

    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject, Bool, Imp, Sel};
    use objc2::{class, msg_send, sel};
    use objc2_foundation::NSString;

    use super::{DASH, QUOTE, REPLACEMENT};

    const QUOTE_KEY: &str = "WebAutomaticQuoteSubstitutionEnabled";
    const DASH_KEY: &str = "WebAutomaticDashSubstitutionEnabled";
    const REPLACEMENT_KEY: &str = "WebAutomaticTextReplacementEnabled";

    /// # Safety
    /// Main thread.
    unsafe fn defaults() -> Retained<AnyObject> {
        unsafe { msg_send![class!(NSUserDefaults), standardUserDefaults] }
    }

    /// Whether `key`'s substitution is on: its stored value, or for text replacement unset,
    /// the system's setting.
    ///
    /// # Safety
    /// Main thread.
    unsafe fn enabled(key: &str) -> bool {
        unsafe {
            let defaults = defaults();
            let name = NSString::from_str(key);
            let stored: Option<Retained<AnyObject>> = msg_send![&defaults, objectForKey: &*name];
            if stored.is_none() && key == REPLACEMENT_KEY {
                return msg_send![class!(NSSpellChecker), isAutomaticTextReplacementEnabled];
            }
            msg_send![&defaults, boolForKey: &*name]
        }
    }

    /// # Safety
    /// Main thread.
    unsafe fn toggle(key: &str) {
        unsafe {
            let on = !enabled(key);
            let _: () = msg_send![&defaults(), setBool: on, forKey: &*NSString::from_str(key)];
        }
    }

    /// # Safety
    /// Main thread.
    unsafe fn speaking() -> bool {
        unsafe {
            let app: Retained<AnyObject> = msg_send![class!(NSApplication), sharedApplication];
            let answers: bool = msg_send![&app, respondsToSelector: sel!(isSpeaking)];
            answers && msg_send![&app, isSpeaking]
        }
    }

    fn window_of(view: *mut AnyObject) -> Option<u32> {
        crate::look_up::window_of(view)
    }

    fn name(sel: Sel) -> &'static str {
        // SAFETY: a registered selector's name lives as long as the process.
        let name: &CStr = unsafe { CStr::from_ptr(objc2::ffi::sel_getName(sel)) };
        name.to_str().unwrap_or("")
    }

    unsafe extern "C-unwind" fn action(this: *mut AnyObject, sel: Sel, sender: *mut AnyObject) {
        // SAFETY: AppKit sends menu actions on the main thread to a live view.
        unsafe {
            match name(sel) {
                "orderFrontSubstitutionsPanel:" => {
                    let checker: Retained<AnyObject> = msg_send![class!(NSSpellChecker), sharedSpellChecker];
                    let panel: Retained<AnyObject> = msg_send![&checker, substitutionsPanel];
                    let _: () = msg_send![&panel, orderFront: sender];
                }
                "toggleAutomaticQuoteSubstitution:" => toggle(QUOTE_KEY),
                "toggleAutomaticDashSubstitution:" => toggle(DASH_KEY),
                "toggleAutomaticTextReplacement:" => toggle(REPLACEMENT_KEY),
                "startSpeaking:" => {
                    let Some(text) = window_of(this).and_then(super::speakable) else { return };
                    let app: Retained<AnyObject> = msg_send![class!(NSApplication), sharedApplication];
                    if !msg_send![&app, respondsToSelector: sel!(speakString:)] {
                        return;
                    }
                    if speaking() {
                        let _: () = msg_send![&app, stopSpeaking: std::ptr::null::<AnyObject>()];
                    }
                    let _: () = msg_send![&app, speakString: &*NSString::from_str(&text)];
                }
                "stopSpeaking:" => {
                    let app: Retained<AnyObject> = msg_send![class!(NSApplication), sharedApplication];
                    let _: () = msg_send![&app, stopSpeaking: std::ptr::null::<AnyObject>()];
                }
                _ => {}
            }
        }
    }

    type Validate = unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) -> Bool;

    static ORIGINAL: OnceLock<Option<Validate>> = OnceLock::new();

    unsafe extern "C-unwind" fn validate(this: *mut AnyObject, sel: Sel, item: *mut AnyObject) -> Bool {
        // SAFETY: AppKit validates menu items on the main thread with a live view and item.
        unsafe {
            let action: Option<Sel> = msg_send![item, action];
            let window = window_of(this);
            let checks = |bit: u64, key: &str| {
                let _: () = msg_send![item, setState: if enabled(key) { 1isize } else { 0 }];
                Bool::new(window.is_some_and(|w| super::checking(w) & bit != 0))
            };
            match action.map(name) {
                Some("orderFrontSubstitutionsPanel:" | "startSpeaking:") => Bool::YES,
                Some("stopSpeaking:") => Bool::new(speaking()),
                Some("toggleAutomaticQuoteSubstitution:") => checks(QUOTE, QUOTE_KEY),
                Some("toggleAutomaticDashSubstitution:") => checks(DASH, DASH_KEY),
                Some("toggleAutomaticTextReplacement:") => checks(REPLACEMENT, REPLACEMENT_KEY),
                _ => match ORIGINAL.get() {
                    Some(Some(original)) => original(this, sel, item),
                    // AppKit's rule without a validator: an item whose target answers it is on.
                    _ => Bool::YES,
                },
            }
        }
    }

    const ACTIONS: [&CStr; 6] = [
        c"orderFrontSubstitutionsPanel:",
        c"toggleAutomaticQuoteSubstitution:",
        c"toggleAutomaticDashSubstitution:",
        c"toggleAutomaticTextReplacement:",
        c"startSpeaking:",
        c"stopSpeaking:",
    ];

    pub fn install() {
        if ORIGINAL.get().is_some() {
            return;
        }
        let Some(class) = AnyClass::get(c"WinitView") else { return };
        let class_ptr = class as *const AnyClass as *mut AnyClass;
        for action_name in ACTIONS {
            let sel = Sel::register(action_name);
            // SAFETY: `action` has the `-(void)action:(id)sender` ABI; adding never replaces a
            // method the class defines.
            let added = unsafe { objc2::ffi::class_addMethod(class_ptr, sel, std::mem::transmute::<unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject), Imp>(action), c"v@:@".as_ptr()) };
            if !added.as_bool() {
                eprintln!("stella-engine: the window view already answers {}", action_name.to_string_lossy());
            }
        }
        let previous = class.instance_method(sel!(validateMenuItem:)).map(|m| m.implementation());
        // SAFETY: `validate` matches `validateMenuItem:`'s `c@:@`.
        unsafe {
            objc2::ffi::class_replaceMethod(class_ptr, sel!(validateMenuItem:), std::mem::transmute::<Validate, Imp>(validate), c"c@:@".as_ptr());
        }
        // SAFETY: an IMP of the same selector, so the same signature.
        let _ = ORIGINAL.set(previous.map(|p| unsafe { std::mem::transmute::<Imp, Validate>(p) }));
    }
}
