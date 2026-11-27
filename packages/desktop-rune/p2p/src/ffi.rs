//! C API over [`Node::command`] for hosts that aren't Rust (an Expo native module, Swift, Kotlin).
//! Strings are UTF-8 JSON. Callbacks run on the node's own threads; `ctx` is passed back as is.
//! See `include/stella_p2p.h`.

use std::ffi::{CStr, CString, c_char, c_void};
use std::sync::Arc;

use serde_json::{Value, json};

use crate::{Config, Node};

pub type EventCallback = extern "C" fn(ctx: *mut c_void, json: *const c_char);
pub type ReplyCallback = extern "C" fn(ctx: *mut c_void, token: u64, json: *const c_char);

#[derive(Clone, Copy)]
struct Ctx(*mut c_void);
// The embedder promises `ctx` may be used from any thread (documented in the header).
unsafe impl Send for Ctx {}
unsafe impl Sync for Ctx {}

fn text(ptr: *const c_char) -> String {
    if ptr.is_null() {
        return String::new();
    }
    unsafe { CStr::from_ptr(ptr) }.to_string_lossy().into_owned()
}

fn call(f: impl FnOnce(*const c_char), value: &Value) {
    let s = CString::new(value.to_string()).unwrap_or_default();
    f(s.as_ptr());
}

/// Starts a node; returns null and writes `{error}` through `on_event` when it can't.
#[unsafe(no_mangle)]
pub extern "C" fn stella_p2p_start(config_json: *const c_char, on_event: EventCallback, ctx: *mut c_void) -> *mut Node {
    let ctx = Ctx(ctx);
    let emit = Arc::new(move |event: Value| {
        let ctx = ctx;
        call(|s| on_event(ctx.0, s), &event)
    });
    let config = serde_json::from_str::<Value>(&text(config_json)).map_err(|e| e.to_string()).and_then(|v| Config::from_json(&v));
    match config.and_then(|c| Node::start(c, emit.clone())) {
        Ok(node) => Box::into_raw(Box::new(node)),
        Err(error) => {
            emit(json!({ "kind": "error", "error": error }));
            std::ptr::null_mut()
        }
    }
}

/// Runs `cmd` with `args_json`; `reply` gets `token` and `{ok, value}` or `{ok:false, error}`.
///
/// # Safety
/// `node` is null or a live pointer from [`stella_p2p_start`]; the strings are null or NUL-terminated.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn stella_p2p_command(node: *mut Node, cmd: *const c_char, args_json: *const c_char, token: u64, reply: ReplyCallback, ctx: *mut c_void) {
    let ctx = Ctx(ctx);
    let answer = move |value: Value| {
        let ctx = ctx;
        call(|s| reply(ctx.0, token, s), &value)
    };
    let Some(node) = (unsafe { node.as_ref() }) else {
        return answer(json!({ "ok": false, "error": "no node" }));
    };
    let args = serde_json::from_str::<Value>(&text(args_json)).unwrap_or(Value::Null);
    node.command(&text(cmd), args, move |result| {
        answer(match result {
            Ok(value) => json!({ "ok": true, "value": value }),
            Err(error) => json!({ "ok": false, "error": error }),
        })
    });
}

/// Closes every connection and frees the node.
///
/// # Safety
/// `node` is null or a pointer from [`stella_p2p_start`] not yet stopped; it is invalid afterwards.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn stella_p2p_stop(node: *mut Node) {
    if !node.is_null() {
        unsafe { Box::from_raw(node) }.shutdown();
    }
}

/// Hands the app's Java VM and Android `Context` to the link once, before the first
/// `stella_p2p_start`; Iroh reads the system's DNS servers through them. Later calls do nothing.
///
/// # Safety
///
/// `vm` must be the process's `JavaVM*` and `context` a global reference to an Android `Context`,
/// both valid for the life of the process.
#[cfg(target_os = "android")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn stella_p2p_android_init(vm: *mut c_void, context: *mut c_void) {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| unsafe { ndk_context::initialize_android_context(vm, context) });
}
