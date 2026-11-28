//! A bare node for checking a link from a terminal, with no Stella around it.
//!
//!   stella-p2p --data <dir> [--name <name>] status
//!   stella-p2p --data <dir> serve [--short]             print a pairing code (and a short one), answer
//!       requests with {echo}; nearby devices that ask print a `confirm` event with six digits
//!   stella-p2p --data <dir> pair <code>                 pair, then stay connected and print events
//!   stella-p2p --data <dir> pair-short <K7M-49PX>       pair through the rendezvous, then stay connected
//!   stella-p2p --data <dir> nearby                      list computers on this network for 10 seconds
//!   stella-p2p --data <dir> pair-nearby <id>            ask a nearby computer, read its six digits from stdin
//!   stella-p2p --data <dir> request <id> '<json body>'  one request to a paired computer
//!   stella-p2p --data <dir> impostor <code>             connect to the code's computer WITHOUT
//!       pairing (as a device that was never shown the code, or was unpaired): prints how the
//!       computer answered, which must be `not_paired`.
//!
//! `--local` turns on local-network discovery (mDNS and router port mapping), which `nearby`,
//! `pair-nearby` and a `serve` that answers nearby devices need; without it the node stays off the
//! local network. Events print as JSON lines on stdout.

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
    let rendezvous = take("--rendezvous");
    let short = args.iter().position(|a| a == "--short").map(|i| args.remove(i)).is_some();
    let local = args.iter().position(|a| a == "--local").map(|i| args.remove(i)).is_some();
    let start = |data: &str, name: &str, relay: Relay, emit: stella_p2p::Emit| start(data, name, relay, rendezvous.clone(), local, emit);
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
        if short {
            println!("{}", node.command_blocking("pairing.short", Value::Null).unwrap_or_else(|e| die(&e)));
        }
        loop {
            std::thread::sleep(Duration::from_secs(3600));
        }
    }

    let node = start(&data, &name, relay, Arc::new(|e| println!("{e}")));
    match command.as_str() {
        "status" => println!("{}", node.command_blocking("status", Value::Null).unwrap_or_else(|e| die(&e))),
        "pair" | "pair-short" => {
            let code = args.get(1).cloned().unwrap_or_else(|| die("pair <code>"));
            let cmd = if command == "pair" { "pair" } else { "pair.short" };
            println!("{}", node.command_blocking(cmd, json!({ "code": code })).unwrap_or_else(|e| die(&e)));
            loop {
                std::thread::sleep(Duration::from_secs(3600));
            }
        }
        "nearby" => {
            println!("{}", node.command_blocking("nearby.start", Value::Null).unwrap_or_else(|e| die(&e)));
            std::thread::sleep(Duration::from_secs(10));
            println!("{}", node.command_blocking("nearby.list", Value::Null).unwrap_or_else(|e| die(&e)));
        }
        "pair-nearby" => {
            let id = args.get(1).cloned().unwrap_or_else(|| die("pair-nearby <id>"));
            node.command_blocking("nearby.start", Value::Null).unwrap_or_else(|e| die(&e));
            std::thread::sleep(Duration::from_secs(3));
            println!("{}", node.command_blocking("pair.nearby", json!({ "id": id })).unwrap_or_else(|e| die(&e)));
            let mut line = String::new();
            while std::io::stdin().read_line(&mut line).is_ok_and(|n| n > 0) {
                match node.command_blocking("pair.nearby.confirm", json!({ "id": id, "code": line.trim() })) {
                    Ok(computer) => {
                        println!("{computer}");
                        break;
                    }
                    Err(e) => println!("{}", json!({ "error": e })),
                }
                line.clear();
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

fn start(data: &str, name: &str, relay: Relay, rendezvous: Option<String>, local_network: bool, emit: stella_p2p::Emit) -> Node {
    let rendezvous = match rendezvous.as_deref() {
        Some("off") => None,
        Some(url) => Some(url.to_owned()),
        None => Some(stella_p2p::DEFAULT_RENDEZVOUS.to_owned()),
    };
    let config = Config { data_dir: data.into(), name: name.into(), platform: std::env::consts::OS.into(), relay, port: Some(0), discoverable: true, local_network, rendezvous };
    Node::start(config, emit).unwrap_or_else(|e| die(&e))
}

fn die(message: &str) -> ! {
    eprintln!("stella-p2p: {message}");
    std::process::exit(2)
}
