//! `p2p.*`: Stella's direct device link (crate `stella-p2p`, ../p2p). `p2p.start {dataDir, name,
//! platform, relay?}` starts this computer's node once and `p2p.stop` shuts it down (a later start
//! makes a new one); every other `p2p.<command>` is that crate's command of the same name, with
//! its reply. Its events reach TS as `{t:"p2p", ...event}`.

use std::sync::{Arc, Mutex};

use serde_json::{Value, json};
use stella_p2p::{Config, Node};

use crate::engine::reply_any_thread;

static NODE: Mutex<Option<Node>> = Mutex::new(None);

fn emit(event: Value) {
    let mut frame = json!({ "t": "p2p" });
    if let (Some(frame), Value::Object(event)) = (frame.as_object_mut(), event) {
        frame.extend(event);
    }
    crate::windows::send_any_thread(frame);
}

pub fn command(cmd: &str, rid: Option<u64>, v: &Value) {
    let name = cmd.trim_start_matches("p2p.").to_owned();
    if name == "start" {
        let v = v.clone();
        std::thread::spawn(move || {
            let mut node = NODE.lock().unwrap_or_else(|e| e.into_inner());
            if node.is_none() {
                match Config::from_json(&v).and_then(|config| Node::start(config, Arc::new(emit))) {
                    Ok(started) => *node = Some(started),
                    Err(e) => return reply_any_thread(rid, Err(e)),
                }
            }
            let started = node.as_ref().expect("started");
            started.command("status", Value::Null, move |result| reply_any_thread(rid, result));
        });
        return;
    }
    if name == "stop" {
        // Taken out first, so a later `p2p.start` makes a live node instead of finding this closed one.
        let stopping = NODE.lock().unwrap_or_else(|e| e.into_inner()).take();
        std::thread::spawn(move || {
            if let Some(node) = stopping {
                node.shutdown();
            }
            reply_any_thread(rid, Ok(Value::Null));
        });
        return;
    }
    let node = NODE.lock().unwrap_or_else(|e| e.into_inner());
    match node.as_ref() {
        Some(node) => node.command(&name, v.clone(), move |result| reply_any_thread(rid, result)),
        None => reply_any_thread(rid, Err("the device link hasn't started (p2p.start)".into())),
    }
}
