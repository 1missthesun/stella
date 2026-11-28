//! C API over [`Node::command`] for hosts that aren't Rust (an Expo native module, Swift, Kotlin).
//! Strings are UTF-8 JSON. Callbacks run on the node's own threads; `ctx` is passed back as is.
//! See `include/stella_p2p.h`.

use std::ffi::{CStr, CString, c_char, c_void};
use std::sync::{Arc, RwLock};

use serde_json::{Value, json};

use crate::{Config, Node};

pub type EventCallback = extern "C" fn(ctx: *mut c_void, json: *const c_char);
pub type ReplyCallback = extern "C" fn(ctx: *mut c_void, token: u64, json: *const c_char);

#[derive(Clone, Copy)]
struct Ctx(*mut c_void);
// The embedder promises `ctx` may be used from any thread (documented in the header).
unsafe impl Send for Ctx {}
unsafe impl Sync for Ctx {}

/// Callbacks pass through this gate: `stella_p2p_stop` closes it, waiting for any callback still
/// running, so the embedder may free `ctx` once stop returns.
type Gate = Arc<RwLock<bool>>;

/// What `stella_p2p_start` hands out as `StellaP2pNode *`.
pub struct Handle {
    node: Node,
    gate: Gate,
}

fn text(ptr: *const c_char) -> String {
    if ptr.is_null() {
        return String::new();
    }
    unsafe { CStr::from_ptr(ptr) }.to_string_lossy().into_owned()
}

fn call(gate: &Gate, f: impl FnOnce(*const c_char), value: &Value) {
    let open = gate.read().unwrap_or_else(|e| e.into_inner());
    if !*open {
        return;
    }
    let s = CString::new(value.to_string()).unwrap_or_default();
    f(s.as_ptr());
}

/// Starts a node; returns null and writes `{error}` through `on_event` when it can't.
#[unsafe(no_mangle)]
pub extern "C" fn stella_p2p_start(config_json: *const c_char, on_event: EventCallback, ctx: *mut c_void) -> *mut Handle {
    let ctx = Ctx(ctx);
    let gate: Gate = Arc::new(RwLock::new(true));
    let events = gate.clone();
    let emit = Arc::new(move |event: Value| {
        let ctx = ctx;
        call(&events, |s| on_event(ctx.0, s), &event)
    });
    let config = serde_json::from_str::<Value>(&text(config_json)).map_err(|e| e.to_string()).and_then(|v| Config::from_json(&v));
    match config.and_then(|c| Node::start(c, emit.clone())) {
        Ok(node) => Box::into_raw(Box::new(Handle { node, gate })),
        Err(error) => {
            emit(json!({ "kind": "error", "error": error }));
            std::ptr::null_mut()
        }
    }
}

/// Runs `cmd` with `args_json`; `reply` gets `token` and `{ok, value}` or `{ok:false, error}`.
/// The node is used only during this call (the reply comes later, on the node's threads).
///
/// # Safety
/// `node` is null or a live pointer from [`stella_p2p_start`], not being stopped meanwhile; the
/// strings are null or NUL-terminated.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn stella_p2p_command(node: *mut Handle, cmd: *const c_char, args_json: *const c_char, token: u64, reply: ReplyCallback, ctx: *mut c_void) {
    let ctx = Ctx(ctx);
    let Some(handle) = (unsafe { node.as_ref() }) else {
        let s = CString::new(json!({ "ok": false, "error": "no node" }).to_string()).unwrap_or_default();
        return reply(ctx.0, token, s.as_ptr());
    };
    let gate = handle.gate.clone();
    let answer = move |value: Value| {
        let ctx = ctx;
        call(&gate, |s| reply(ctx.0, token, s), &value)
    };
    let args = serde_json::from_str::<Value>(&text(args_json)).unwrap_or(Value::Null);
    handle.node.command(&text(cmd), args, move |result| {
        answer(match result {
            Ok(value) => json!({ "ok": true, "value": value }),
            Err(error) => json!({ "ok": false, "error": error }),
        })
    });
}

/// Closes every connection and frees the node. Once it returns, no callback of this node runs
/// again (one already running is waited for), so `ctx` may be freed.
///
/// # Safety
/// `node` is null or a pointer from [`stella_p2p_start`] not yet stopped, with no
/// [`stella_p2p_command`] on it still running; it is invalid afterwards. Not to be called from
/// inside one of this node's callbacks.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn stella_p2p_stop(node: *mut Handle) {
    if node.is_null() {
        return;
    }
    let handle = unsafe { Box::from_raw(node) };
    *handle.gate.write().unwrap_or_else(|e| e.into_inner()) = false;
    handle.node.shutdown();
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
