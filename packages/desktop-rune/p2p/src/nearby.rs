//! Pairing with a computer on the same network, with nothing to copy: computers answer on mDNS
//! (service `stella-p2p`), a device lists them, and asking one to pair makes it show six digits
//! that are typed on the device. The digits are a SPAKE2 password bound to both keys, so a
//! look-alike on the network that relays the request still can't finish it. All of it waits for
//! local-network discovery to be turned on (`local.set`, crate::local).

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use data_encoding::BASE64URL_NOPAD;
use iroh::endpoint::{Connection, RecvStream, SendStream};
use iroh::{EndpointAddr, EndpointId, TransportAddr};
use iroh_mdns_address_lookup::DiscoveryEvent;
use serde_json::{Value, json};
use tokio::sync::{mpsc, oneshot};
use tokio_stream::StreamExt;

use crate::pake::{self, Exchange};
use crate::{Inner, PAIR_ALPN, client, host, lock, wire};

const ATTEMPTS: u32 = 3;
/// How long a computer keeps its six digits on screen.
const CONFIRM_TTL: Duration = Duration::from_secs(120);
const PROBE_TIMEOUT: Duration = Duration::from_secs(4);
pub const CLOSE_DENIED: u32 = 4003;

/// The computer's one open request from a nearby device.
pub(crate) struct Confirming {
    pub request: u64,
    deny: Option<oneshot::Sender<()>>,
}

/// A device's open request to one nearby computer, waiting for the digits.
pub(crate) type Asking = mpsc::Sender<(String, oneshot::Sender<Result<Value, String>>)>;

#[derive(Default)]
pub(crate) struct Nearby {
    watching: bool,
    pub found: HashMap<String, Value>,
    addrs: HashMap<String, EndpointAddr>,
    probing: HashSet<String>,
}

pub async fn answer_info(inner: &Inner, conn: Connection, mut send: SendStream) {
    let name = lock(&inner.name).clone();
    let nearby = inner.discoverable && inner.local.is_on();
    let _ = wire::write(&mut send, &json!({ "name": name, "platform": inner.platform, "nearby": nearby })).await;
    let _ = send.finish();
    let _ = tokio::time::timeout(Duration::from_secs(3), conn.closed()).await;
}

fn b64(bytes: &[u8]) -> String {
    BASE64URL_NOPAD.encode(bytes)
}

fn unb64(v: &Value, k: &str) -> Vec<u8> {
    v.get(k).and_then(|x| x.as_str()).and_then(|s| BASE64URL_NOPAD.decode(s.as_bytes()).ok()).unwrap_or_default()
}

fn ids(device: EndpointId, computer: EndpointId) -> (Vec<u8>, Vec<u8>) {
    (format!("stella device {device}").into_bytes(), format!("stella computer {computer}").into_bytes())
}

pub async fn host_confirm(inner: Arc<Inner>, conn: Connection, mut send: SendStream, mut recv: RecvStream, hello: Value) {
    let device = conn.remote_id();
    let refuse = |error: &'static str| json!({ "ok": false, "error": error });
    if !inner.discoverable || !inner.local.is_on() {
        let _ = wire::write(&mut send, &refuse("off")).await;
        let _ = send.finish();
        return;
    }
    let request = inner.next_rid.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let (deny, mut denied) = oneshot::channel();
    let busy = {
        let mut confirming = lock(&inner.confirming);
        let busy = confirming.is_some();
        if !busy {
            *confirming = Some(Confirming { request, deny: Some(deny) });
        }
        busy
    };
    if busy {
        let _ = wire::write(&mut send, &refuse("busy")).await;
        let _ = send.finish();
        return;
    }
    let code = pake::six_digits();
    let text = |k: &str, fallback: &str| hello.get(k).and_then(|x| x.as_str()).map(|x| x.chars().take(80).collect::<String>()).filter(|x| !x.is_empty()).unwrap_or_else(|| fallback.to_owned());
    (inner.emit)(json!({
        "kind": "pairing", "state": "confirm", "request": request, "code": code,
        "device": { "id": device.to_string(), "name": text("name", "Device"), "platform": text("platform", "unknown") },
    }));
    let outcome = async {
        wire::write(&mut send, &json!({ "t": "code" })).await?;
        let (id_device, id_computer) = ids(device, inner.endpoint.id());
        let mut left = ATTEMPTS;
        loop {
            let Some(frame) = wire::read(&mut recv).await? else { return Ok("cancelled") };
            let theirs = unb64(&frame, "msg");
            let (exchange, ours) = Exchange::start(false, code.as_bytes(), &id_device, &id_computer);
            let keys = exchange.finish(&theirs)?;
            wire::write(&mut send, &json!({ "t": "spake", "msg": b64(&ours), "confirm": b64(&keys.confirm("computer")) })).await?;
            let Some(answer) = wire::read(&mut recv).await? else { return Ok("cancelled") };
            if answer.get("t").and_then(|t| t.as_str()) == Some("confirm") && keys.check("device", &unb64(&answer, "proof")) {
                let device = host::keep_device(&inner, &device.to_string(), &hello)?;
                let name = lock(&inner.name).clone();
                wire::write(&mut send, &json!({ "ok": true, "name": name, "platform": inner.platform })).await?;
                let _ = send.finish();
                (inner.emit)(json!({ "kind": "device", "id": device.id, "state": "paired", "device": device }));
                return Ok::<&str, String>("paired");
            }
            left -= 1;
            wire::write(&mut send, &json!({ "t": "wrong", "left": left })).await?;
            if left == 0 {
                return Ok("failed");
            }
        }
    };
    let result: &str = tokio::select! {
        r = outcome => r.unwrap_or("cancelled"),
        _ = &mut denied => "denied",
        _ = tokio::time::sleep(CONFIRM_TTL) => "expired",
    };
    {
        let mut confirming = lock(&inner.confirming);
        if confirming.as_ref().is_some_and(|c| c.request == request) {
            *confirming = None;
        }
    }
    (inner.emit)(json!({ "kind": "pairing", "state": "confirm_done", "request": request, "result": result }));
    match result {
        "paired" => {
            let _ = tokio::time::timeout(Duration::from_secs(5), conn.closed()).await;
        }
        "denied" | "expired" | "failed" => conn.close(CLOSE_DENIED.into(), result.as_bytes()),
        _ => {}
    }
}

pub fn deny(inner: &Inner, request: u64) -> bool {
    let mut confirming = lock(&inner.confirming);
    match confirming.as_mut() {
        Some(c) if c.request == request => c.deny.take().is_some_and(|d| d.send(()).is_ok()),
        _ => false,
    }
}

pub fn list(inner: &Inner) -> Value {
    let store = lock(&inner.store);
    let nearby = lock(&inner.nearby);
    let list: Vec<Value> = nearby
        .found
        .values()
        .map(|v| {
            let mut v = v.clone();
            v["paired"] = json!(v.get("id").and_then(|i| i.as_str()).is_some_and(|i| store.computer(i).is_some()));
            v
        })
        .collect();
    json!(list)
}

/// Turns local-network discovery on (mDNS, advertising this node if it answers nearby devices) or
/// off (mDNS stops, what it found is forgotten).
pub async fn set_local(inner: &Arc<Inner>, on: bool) -> Result<(), String> {
    if !on {
        inner.local.turn_off();
        let lost: Vec<String> = {
            let mut nearby = lock(&inner.nearby);
            nearby.addrs.clear();
            nearby.found.drain().map(|(id, _)| id).collect()
        };
        for id in lost {
            (inner.emit)(json!({ "kind": "nearby", "id": id, "state": "lost" }));
        }
        return Ok(());
    }
    if inner.local.is_on() {
        return Ok(());
    }
    let mdns = inner.local.turn_on(inner.endpoint.id(), inner.discoverable)?;
    let seen = mdns.subscribe().await;
    drop(mdns);
    track(inner.clone(), seen);
    Ok(())
}

/// Follows the computers mDNS sees while discovery is on (the stream ends when it is turned off).
/// The lookup tells a subscriber only about computers that are new or changed since it last saw
/// them, so subscribing when a dialog opens would miss everything already on the network.
fn track(inner: Arc<Inner>, mut events: impl tokio_stream::Stream<Item = DiscoveryEvent> + Unpin + Send + 'static) {
    tokio::spawn(async move {
        while let Some(event) = events.next().await {
            match event {
                DiscoveryEvent::Discovered { endpoint_info, .. } => {
                    let id = endpoint_info.endpoint_id;
                    if id == inner.endpoint.id() {
                        continue;
                    }
                    let addr = endpoint_info.into_endpoint_addr();
                    let watching = {
                        let mut nearby = lock(&inner.nearby);
                        nearby.addrs.insert(id.to_string(), addr.clone());
                        nearby.watching
                    };
                    if watching {
                        spawn_probe(&inner, addr);
                    }
                }
                DiscoveryEvent::Expired { endpoint_id } => {
                    let id = endpoint_id.to_string();
                    let gone = {
                        let mut nearby = lock(&inner.nearby);
                        nearby.addrs.remove(&id);
                        nearby.found.remove(&id).is_some()
                    };
                    if gone {
                        (inner.emit)(json!({ "kind": "nearby", "id": id, "state": "lost" }));
                    }
                }
                _ => {}
            }
        }
    });
}

fn spawn_probe(inner: &Arc<Inner>, addr: EndpointAddr) {
    let id = addr.id.to_string();
    {
        let mut nearby = lock(&inner.nearby);
        if nearby.found.contains_key(&id) || !nearby.probing.insert(id.clone()) {
            return;
        }
    }
    let inner = inner.clone();
    tokio::spawn(async move {
        probe(&inner, addr).await;
        lock(&inner.nearby).probing.remove(&id);
    });
}

pub fn start(inner: &Arc<Inner>) -> Result<Value, String> {
    if !inner.local.is_on() {
        return Err("Finding computers on this network is off. Turn it on in Settings.".into());
    }
    let known: Vec<EndpointAddr> = {
        let mut nearby = lock(&inner.nearby);
        nearby.watching = true;
        nearby.addrs.values().cloned().collect()
    };
    for addr in known {
        spawn_probe(inner, addr);
    }
    Ok(list(inner))
}

pub fn stop(inner: &Inner) {
    let mut nearby = lock(&inner.nearby);
    nearby.watching = false;
    nearby.found.clear();
}

/// Asks a computer that showed up on the network for its name, and whether it pairs nearby devices.
async fn probe(inner: &Arc<Inner>, addr: EndpointAddr) {
    let id = addr.id;
    let ask = async {
        let conn = inner.endpoint.connect(addr, PAIR_ALPN).await.map_err(|e| e.to_string())?;
        let (mut send, mut recv) = conn.open_bi().await.map_err(|e| e.to_string())?;
        wire::write(&mut send, &json!({ "v": 1, "mode": "info" })).await?;
        let _ = send.finish();
        let reply = wire::read(&mut recv).await?.ok_or("closed")?;
        conn.close(0u32.into(), b"thanks");
        Ok::<_, String>(reply)
    };
    let Ok(Ok(info)) = tokio::time::timeout(PROBE_TIMEOUT, ask).await else { return };
    if info.get("nearby").and_then(|n| n.as_bool()) != Some(true) {
        return;
    }
    let text = |k: &str, fallback: &str| info.get(k).and_then(|x| x.as_str()).map(|x| x.chars().take(80).collect::<String>()).filter(|x| !x.is_empty()).unwrap_or_else(|| fallback.to_owned());
    let computer = json!({ "id": id.to_string(), "name": text("name", "Computer"), "platform": text("platform", "unknown") });
    let fresh = {
        let mut nearby = lock(&inner.nearby);
        if !nearby.watching {
            return;
        }
        nearby.found.insert(id.to_string(), computer.clone()).is_none()
    };
    if fresh {
        let paired = lock(&inner.store).computer(&id.to_string()).is_some();
        let mut event = json!({ "kind": "nearby", "state": "found", "paired": paired });
        if let (Some(e), Some(c)) = (event.as_object_mut(), computer.as_object()) {
            e.extend(c.clone());
        }
        (inner.emit)(event);
    }
}

fn refusal(error: Option<&str>) -> String {
    match error {
        Some("busy") => "That computer is answering another device. Try again in a moment.".into(),
        Some("off") => "That computer doesn't take nearby devices.".into(),
        _ => "That computer didn't accept the request.".into(),
    }
}

/// Asks a nearby computer to pair; on success it is showing six digits for `pair.nearby.confirm`.
pub async fn ask(inner: &Arc<Inner>, id: &str) -> Result<Value, String> {
    let computer: EndpointId = id.parse().map_err(|_| format!("{id} isn't a device id"))?;
    let addr = lock(&inner.nearby).addrs.get(id).cloned().unwrap_or_else(|| EndpointAddr::from_parts(computer, Vec::<TransportAddr>::new()));
    let reach = || "Couldn't reach that computer. Check that Stella is open on it and try again.".to_owned();
    let conn = tokio::time::timeout(Duration::from_secs(10), inner.endpoint.connect(addr.clone(), PAIR_ALPN)).await.map_err(|_| reach())?.map_err(|_| reach())?;
    let (mut send, mut recv) = conn.open_bi().await.map_err(|e| e.to_string())?;
    let name = lock(&inner.name).clone();
    wire::write(&mut send, &json!({ "v": 1, "mode": "nearby", "name": name, "platform": inner.platform })).await?;
    let reply = tokio::time::timeout(Duration::from_secs(10), wire::read(&mut recv)).await.map_err(|_| "The computer didn't answer.".to_owned())??.ok_or("The computer closed the connection.")?;
    if reply.get("t").and_then(|t| t.as_str()) != Some("code") {
        conn.close(0u32.into(), b"bye");
        return Err(refusal(reply.get("error").and_then(|e| e.as_str())));
    }
    let (tx, rx) = mpsc::channel(1);
    if let Some(previous) = lock(&inner.asking).insert(id.to_owned(), tx) {
        drop(previous);
    }
    tokio::spawn(answer_digits(inner.clone(), computer, addr, conn, send, recv, rx));
    Ok(json!({ "state": "code" }))
}

pub async fn confirm(inner: &Inner, id: &str, code: &str) -> Result<Value, String> {
    let digits = pake::digits_only(code);
    if digits.len() != 6 {
        return Err("Enter the six digits shown on the computer.".into());
    }
    let asking = lock(&inner.asking).get(id).cloned().ok_or("Ask the computer again: that request ended.")?;
    let (reply, result) = oneshot::channel();
    asking.send((digits, reply)).await.map_err(|_| "Ask the computer again: that request ended.".to_owned())?;
    result.await.map_err(|_| "Ask the computer again: that request ended.".to_owned())?
}

pub fn cancel(inner: &Inner, id: &str) {
    lock(&inner.asking).remove(id);
}

async fn answer_digits(
    inner: Arc<Inner>,
    computer: EndpointId,
    addr: EndpointAddr,
    conn: Connection,
    mut send: SendStream,
    mut recv: RecvStream,
    mut codes: mpsc::Receiver<(String, oneshot::Sender<Result<Value, String>>)>,
) {
    let id = computer.to_string();
    let (id_device, id_computer) = ids(inner.endpoint.id(), computer);
    let ended = |reason: &str| json!({ "kind": "nearby", "id": id, "state": "ended", "reason": reason });
    let reason = loop {
        let (code, reply) = tokio::select! {
            next = codes.recv() => match next {
                Some(next) => next,
                None => break "cancelled",
            },
            // The computer only speaks unasked to end the request: denied, expired.
            _ = conn.closed() => break "denied",
        };
        let round = async {
            let (exchange, ours) = Exchange::start(true, code.as_bytes(), &id_device, &id_computer);
            wire::write(&mut send, &json!({ "t": "spake", "msg": b64(&ours) })).await?;
            let theirs = wire::read(&mut recv).await?.ok_or("closed")?;
            let keys = exchange.finish(&unb64(&theirs, "msg"))?;
            if keys.check("computer", &unb64(&theirs, "confirm")) {
                wire::write(&mut send, &json!({ "t": "confirm", "proof": b64(&keys.confirm("device")) })).await?;
                let done = wire::read(&mut recv).await?.ok_or("closed")?;
                return Ok::<_, String>(Ok(done));
            }
            wire::write(&mut send, &json!({ "t": "wrong" })).await?;
            let wrong = wire::read(&mut recv).await?.ok_or("closed")?;
            Ok(Err(wrong.get("left").and_then(|l| l.as_u64()).unwrap_or(0)))
        };
        match tokio::time::timeout(Duration::from_secs(15), round).await {
            Ok(Ok(Ok(done))) if done.get("ok").and_then(|o| o.as_bool()) == Some(true) => {
                conn.close(0u32.into(), b"paired");
                let relay = addr.relay_urls().next().map(|u| u.to_string());
                let addrs = addr.ip_addrs().map(|a| a.to_string()).collect();
                let _ = reply.send(client::saved(&inner, computer, &done, relay, addrs));
                break "paired";
            }
            Ok(Ok(Err(left))) if left > 0 => {
                let _ = reply.send(Err(format!("Those digits don't match. {left} {} left.", if left == 1 { "try" } else { "tries" })));
            }
            Ok(Ok(Err(_))) => {
                let _ = reply.send(Err("Those digits didn't match. Ask the computer again.".into()));
                break "failed";
            }
            _ => {
                let _ = reply.send(Err("The computer ended the request. Ask it again.".into()));
                break "denied";
            }
        }
    };
    {
        let mut asking = lock(&inner.asking);
        if asking.get(&id).is_some_and(|a| a.is_closed() || reason != "cancelled") {
            asking.remove(&id);
        }
    }
    if reason != "paired" {
        conn.close(0u32.into(), b"bye");
    }
    (inner.emit)(ended(reason));
}
