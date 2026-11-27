//! Stella Views: view programs (`packages/views`) running in PsychoScript live runs, each on a
//! thread of its own, with no JavaScript engine and no WebView. The host compiles a view's TSX to
//! a program and renders the node trees it posts; this module only runs programs and carries
//! their messages.
//!
//! - `views.start {id, program, input, sliceMs?, heapBytes?}` compiles and starts a run (replies
//!   once it is running; a syntax error is the reply's error). Starting an id that runs replaces it.
//! - `views.deliver {id, messages}` queues messages (JSON values) for the program's `receive`.
//! - `views.stop {id}`, `views.pause {id}`, `views.resume {id}`.
//!
//! Events: `{t:"views", id, kind:"posts", posts}` (one wake-up's posts, in order),
//! `{kind:"warning", message}`, `{kind:"exit", exit:"finished"|"failed"|"stopped", message?}`.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use psychoscript_mobile::{GpuCanvasState, LiveExit, LiveHandler, LiveOptions, LiveRun, Program, PsychoScriptError};
use serde_json::{Value, json};

static RUNS: Mutex<Option<HashMap<String, Run>>> = Mutex::new(None);

struct Run {
    live: Arc<LiveRun>,
    generation: u64,
}

static GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

fn with_runs<R>(f: impl FnOnce(&mut HashMap<String, Run>) -> R) -> R {
    let mut guard = RUNS.lock().unwrap_or_else(|e| e.into_inner());
    f(guard.get_or_insert_with(HashMap::new))
}

struct Handler {
    id: String,
    generation: u64,
}

impl Handler {
    fn emit(&self, mut event: Value) {
        event["t"] = "views".into();
        event["id"] = self.id.clone().into();
        event["gen"] = self.generation.into();
        crate::windows::send_any_thread(event);
    }
}

impl LiveHandler for Handler {
    fn on_posts(&self, messages_json: Vec<String>) {
        let posts: Vec<Value> = messages_json.iter().filter_map(|m| serde_json::from_str(m).ok()).collect();
        self.emit(json!({ "kind": "posts", "posts": posts }));
    }
    fn on_posts_bytes(&self, _messages: Vec<Vec<u8>>) {}
    fn on_warning(&self, message: String) {
        self.emit(json!({ "kind": "warning", "message": message }));
    }
    fn on_exit(&self, exit: LiveExit) {
        let event = match exit {
            LiveExit::Finished { .. } => json!({ "kind": "exit", "exit": "finished" }),
            LiveExit::Failed { error } => json!({ "kind": "exit", "exit": "failed", "message": message(&error) }),
            LiveExit::Stopped => json!({ "kind": "exit", "exit": "stopped" }),
        };
        let generation = self.generation;
        with_runs(|runs| {
            if runs.get(&self.id).is_some_and(|r| r.generation == generation) {
                runs.remove(&self.id);
            }
        });
        self.emit(event);
    }
    fn on_gpu_canvas(&self, _key: Option<String>, _state: GpuCanvasState) {}
}

fn message(error: &PsychoScriptError) -> String {
    match error {
        PsychoScriptError::Syntax { reason, .. } | PsychoScriptError::Runtime { reason, .. } => reason.clone(),
        PsychoScriptError::Timeout { timeout_ms, .. } => format!("The view computed for more than {timeout_ms} ms without waiting"),
        PsychoScriptError::MemoryLimitExceeded { max_heap_bytes, .. } => {
            format!("The view used more than {} MB of memory", max_heap_bytes / (1024 * 1024))
        }
        other => format!("{other:?}"),
    }
}

fn id_of(v: &Value) -> Result<String, String> {
    v.get("id").and_then(|x| x.as_str()).map(str::to_owned).ok_or_else(|| "views: missing id".to_owned())
}

pub fn command(cmd: &str, rid: Option<u64>, v: &Value) {
    let result = match cmd {
        "views.start" => start(v),
        "views.deliver" => deliver(v),
        "views.stop" => id_of(v).map(|id| {
            if let Some(run) = with_runs(|runs| runs.remove(&id)) {
                run.live.stop();
            }
            Value::Null
        }),
        "views.pause" | "views.resume" => id_of(v).and_then(|id| {
            let live = with_runs(|runs| runs.get(&id).map(|r| r.live.clone()));
            let Some(live) = live else { return Ok(Value::Bool(false)) };
            let r = if cmd == "views.pause" { live.pause() } else { live.resume() };
            r.map(|_| Value::Bool(true)).map_err(|e| message(&e))
        }),
        _ => Err(format!("{cmd}: unknown views command")),
    };
    crate::engine::reply(rid, result);
}

fn start(v: &Value) -> Result<Value, String> {
    let id = id_of(v)?;
    let program = v.get("program").and_then(|x| x.as_str()).ok_or("views.start: missing program")?;
    let input = v.get("input").cloned().unwrap_or(Value::Null).to_string();
    let compiled = Program::new(program.to_owned(), "__input".to_owned()).map_err(|e| message(&e))?;
    let options = LiveOptions {
        slice_budget_ms: v.get("sliceMs").and_then(|x| x.as_u64()).unwrap_or(100),
        https_hosts: None,
        allow_local_network: false,
        max_heap_bytes: Some(v.get("heapBytes").and_then(|x| x.as_u64()).unwrap_or(64 * 1024 * 1024)),
    };
    let generation = GENERATION.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let handler = Handler { id: id.clone(), generation };
    let live = compiled.start_live(input, Box::new(handler), options, None, None).map_err(|e| message(&e))?;
    if let Some(previous) = with_runs(|runs| runs.insert(id, Run { live, generation })) {
        previous.live.stop();
    }
    Ok(json!({ "gen": generation }))
}

fn deliver(v: &Value) -> Result<Value, String> {
    let id = id_of(v)?;
    let live = with_runs(|runs| runs.get(&id).map(|r| r.live.clone())).ok_or_else(|| format!("views.deliver: no run {id}"))?;
    let messages = v.get("messages").and_then(|m| m.as_array()).cloned().unwrap_or_default();
    for message in messages {
        live.deliver(message.to_string()).map_err(|e| message_of(&e))?;
    }
    Ok(Value::Null)
}

fn message_of(error: &PsychoScriptError) -> String {
    message(error)
}

/// Stops every run (the host went away).
#[allow(dead_code)]
pub fn stop_all() {
    let runs: Vec<Run> = with_runs(|runs| runs.drain().map(|(_, r)| r).collect());
    for run in runs {
        run.live.stop();
    }
}
