//! A bare node for checking a link from a terminal, with no Stella around it.
//!
//!   stella-p2p --data <dir> [--name <name>] status
//!   stella-p2p --data <dir> serve                       print a pairing code, answer requests with {echo}
//!   stella-p2p --data <dir> pair <code>                 pair, then stay connected and print events
//!   stella-p2p --data <dir> request <id> '<json body>'  one request to a paired computer
//!   stella-p2p --data <dir> impostor <code>             connect to the code's computer WITHOUT
//!       pairing (as a device that was never shown the code, or was unpaired): prints how the
//!       computer answered, which must be `not_paired`.
//!
//! Events print as JSON lines on stdout.

use std::sync::Arc;
use std::time::Duration;

use serde_json::{Value, json};
use stella_p2p::pairing::Code;
use stella_p2p::store::{Computer, Store, now_ms};
use stella_p2p::{Config, Node, Relay};

fn main() {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let mut take = |flag: &str| args.iter().position(|a| a == flag).map(|i| {
        args.remove(i);
        args.remove(i)
    });
    let data = take("--data").unwrap_or_else(|| die("--data <dir> is required"));
    let name = take("--name").unwrap_or_else(|| "stella-p2p cli".into());
    let relay = match take("--relay").as_deref() {
        Some("off") => Relay::Off,
        Some(url) => Relay::Custom(url.into()),
        None => Relay::Default,
    };
    let command = args.first().cloned().unwrap_or_else(|| die("a command is required"));

    if command == "impostor" {
        let code = Code::decode(args.get(1).map(String::as_str).unwrap_or_else(|| die("impostor <code>"))).unwrap_or_else(|e| die(&e));
        let (mut store, _) = Store::open(std::path::Path::new(&data)).unwrap_or_else(|e| die(&e));
        store.put_computer(Computer { id: code.host.to_string(), name: "target".into(), platform: "unknown".into(), paired_at: now_ms(), relay: code.relay, addrs: code.addrs, last_seen_at: None });
        store.save().unwrap_or_else(|e| die(&e));
        drop(store);
        let (tx, rx) = std::sync::mpsc::channel::<Value>();
        let node = start(&data, &name, relay, Arc::new(move |e| {
            println!("{e}");
            let _ = tx.send(e);
        }));
        let host = code.host.to_string();
        node.command_blocking("computer.connect", json!({ "id": host })).unwrap_or_else(|e| die(&e));
        let deadline = std::time::Instant::now() + Duration::from_secs(30);
        while let Ok(event) = rx.recv_timeout(deadline.saturating_duration_since(std::time::Instant::now())) {
            let state = event.get("state").and_then(|s| s.as_str()).unwrap_or("");
            if matches!(state, "not_paired" | "revoked" | "online") {
                println!("{}", json!({ "impostor": state }));
                node.shutdown();
                std::process::exit(if state == "online" { 1 } else { 0 });
            }
        }
        die("the computer never answered");
    }

    if command == "serve" {
        let node: Arc<std::sync::OnceLock<Node>> = Arc::new(std::sync::OnceLock::new());
        let answering = node.clone();
        let started = start(&data, &name, relay, Arc::new(move |e: Value| {
            println!("{e}");
            if e.get("kind").and_then(|k| k.as_str()) == Some("request")
                && let Some(node) = answering.get()
            {
                node.command("respond", json!({ "req": e["req"], "body": { "echo": e["body"] } }), |_| {});
                node.command("emit", json!({ "id": e["from"], "body": { "answered": e["req"] } }), |_| {});
            }
        }));
        let _ = node.set(started);
        let node = node.get().expect("started");
        println!("{}", node.command_blocking("status", Value::Null).unwrap_or_else(|e| die(&e)));
        println!("{}", node.command_blocking("pairing.create", Value::Null).unwrap_or_else(|e| die(&e)));
        loop {
            std::thread::sleep(Duration::from_secs(3600));
        }
    }

    let node = start(&data, &name, relay, Arc::new(|e| println!("{e}")));
    match command.as_str() {
        "status" => println!("{}", node.command_blocking("status", Value::Null).unwrap_or_else(|e| die(&e))),
        "pair" => {
            let code = args.get(1).cloned().unwrap_or_else(|| die("pair <code>"));
            println!("{}", node.command_blocking("pair", json!({ "code": code })).unwrap_or_else(|e| die(&e)));
            loop {
                std::thread::sleep(Duration::from_secs(3600));
            }
        }
        "request" => {
            let id = args.get(1).cloned().unwrap_or_else(|| die("request <id> <body>"));
            let body: Value = serde_json::from_str(args.get(2).map(String::as_str).unwrap_or("null")).unwrap_or_else(|e| die(&e.to_string()));
            node.command_blocking("computer.connect", json!({ "id": id })).unwrap_or_else(|e| die(&e));
            for _ in 0..40 {
                match node.command_blocking("request", json!({ "id": id, "body": body })) {
                    Ok(reply) => {
                        println!("{reply}");
                        break;
                    }
                    Err(e) if e == "offline" => std::thread::sleep(Duration::from_millis(500)),
                    Err(e) => die(&e),
                }
            }
        }
        other => die(&format!("unknown command {other}")),
    }
    node.shutdown();
}

fn start(data: &str, name: &str, relay: Relay, emit: stella_p2p::Emit) -> Node {
    Node::start(Config { data_dir: data.into(), name: name.into(), platform: std::env::consts::OS.into(), relay, port: Some(0) }, emit).unwrap_or_else(|e| die(&e))
}

fn die(message: &str) -> ! {
    eprintln!("stella-p2p: {message}");
    std::process::exit(2)
}
