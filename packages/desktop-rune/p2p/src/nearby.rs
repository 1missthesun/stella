//! Pairing with a computer on the same network, with nothing to copy: computers answer on mDNS
//! (service `stella-p2p`), a device lists them, and asking one to pair (once the person there
//! allows it) makes it show six digits that are typed on the device. The digits are a SPAKE2
//! password bound to both keys, so a look-alike on the network that relays the request still
//! can't finish it. All of it waits for local-network discovery to be turned on (`local.set`,
//! crate::local).

use std::collections::{HashMap, HashSet};
use std::net::IpAddr;
use std::sync::Arc;
use std::time::Duration;

use data_encoding::BASE64URL_NOPAD;
use iroh::endpoint::{Connection, ConnectionError, PathList, RecvStream, SendStream};
use iroh::{EndpointAddr, EndpointId, TransportAddr};
use iroh_mdns_address_lookup::DiscoveryEvent;
use serde_json::{Value, json};
use tokio::sync::{mpsc, oneshot};
use tokio_stream::StreamExt;

use crate::pake::{self, Exchange};
use crate::store::{NearbyGuard, now_ms};
use crate::{Inner, PAIR_ALPN, client, host, lock, wire};

/// Wrong digits (and requests denied or left unanswered) a computer takes before it stops taking
/// nearby requests for a while; each pause is twice the last, up to `MAX_PAUSE`.
const FREE_FAILURES: u32 = 3;
const FIRST_PAUSE: Duration = Duration::from_secs(60);
const MAX_PAUSE: Duration = Duration::from_secs(60 * 60);
/// A day without a failure forgets the earlier ones.
const FORGET_FAILURES: Duration = Duration::from_secs(24 * 60 * 60);
/// How long a computer waits for the person to allow a request, then to see the digits typed.
const ALLOW_TTL: Duration = Duration::from_secs(90);
const CONFIRM_TTL: Duration = Duration::from_secs(120);
/// How long a request may take to show a path from this computer's own network.
const LOCAL_PATH_WAIT: Duration = Duration::from_secs(5);
const PROBE_TIMEOUT: Duration = Duration::from_secs(4);
pub const CLOSE_DENIED: u32 = 4003;

/// The computer's one open request from a nearby device: allowed (`true`) or denied by the person.
pub(crate) struct Confirming {
    pub request: u64,
    decide: mpsc::UnboundedSender<bool>,
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

/// Failures left before the next pause, or how long the current pause has to run (ms).
fn budget(inner: &Inner) -> Result<u32, u64> {
    let now = now_ms();
    let mut store = lock(&inner.store);
    let guard = &mut store.peers.nearby_guard;
    if guard.failures > 0 && now.saturating_sub(guard.last_failure_at) > FORGET_FAILURES.as_millis() as u64 && guard.locked_until <= now {
        *guard = NearbyGuard::default();
        let _ = store.save();
        return Ok(FREE_FAILURES);
    }
    if guard.locked_until > now {
        return Err(guard.locked_until - now);
    }
    Ok(FREE_FAILURES - guard.failures % FREE_FAILURES)
}

/// Counts one failure; true when it starts a pause.
fn failed(inner: &Inner) -> bool {
    let now = now_ms();
    let mut store = lock(&inner.store);
    let guard = &mut store.peers.nearby_guard;
    guard.failures = guard.failures.saturating_add(1);
    guard.last_failure_at = now;
    let paused = guard.failures.is_multiple_of(FREE_FAILURES);
    if paused {
        let doublings = (guard.failures / FREE_FAILURES - 1).min(16);
        let pause = FIRST_PAUSE.saturating_mul(1 << doublings).min(MAX_PAUSE);
        guard.locked_until = now + pause.as_millis() as u64;
    }
    if let Err(e) = store.save() {
        eprintln!("stella-p2p: {e}");
    }
    paused
}

fn succeeded(inner: &Inner) {
    let mut store = lock(&inner.store);
    if !store.peers.nearby_guard.is_clear() {
        store.peers.nearby_guard = NearbyGuard::default();
        let _ = store.save();
    }
}

/// Addresses on this computer's own network: private, link-local and loopback ones, and IPv6
/// addresses in one of this computer's own /64s.
fn on_own_network(ip: IpAddr, own: &[IpAddr]) -> bool {
    let ip = match ip {
        IpAddr::V6(v6) => v6.to_ipv4_mapped().map(IpAddr::V4).unwrap_or(ip),
        ip => ip,
    };
    match ip {
        IpAddr::V4(v4) => v4.is_private() || v4.is_link_local() || v4.is_loopback(),
        IpAddr::V6(v6) => {
            let first = v6.segments()[0];
            v6.is_loopback()
                || first & 0xfe00 == 0xfc00
                || first & 0xffc0 == 0xfe80
                || own.iter().any(|o| matches!(o, IpAddr::V6(o) if o.segments()[..4] == v6.segments()[..4]))
        }
    }
}

/// Nearby pairing is for devices on this computer's network: a request that arrives only through
/// a relay, or from an address elsewhere on the internet, is refused before anyone sees it.
async fn from_own_network(inner: &Inner, conn: &Connection) -> bool {
    let own: Vec<IpAddr> = inner.endpoint.addr().ip_addrs().map(|a| a.ip()).collect();
    let local = |paths: &PathList<'_>| paths.iter().any(|p| matches!(p.remote_addr(), TransportAddr::Ip(a) if on_own_network(a.ip(), &own)));
    if local(&conn.paths()) {
        return true;
    }
    let watch = async {
        let mut paths = conn.paths_stream();
        while let Some(list) = paths.next().await {
            if local(&list) {
                return true;
            }
        }
        false
    };
    tokio::time::timeout(LOCAL_PATH_WAIT, watch).await.unwrap_or(false)
}

/// Answers a request it won't take, and leaves the device time to read why before hanging up.
async fn refuse(conn: Connection, mut send: SendStream, reply: Value) {
    let _ = wire::write(&mut send, &reply).await;
    let _ = send.finish();
    let _ = tokio::time::timeout(Duration::from_secs(3), conn.closed()).await;
}

/// Waits until the person denies the request (an allow repeated meanwhile changes nothing).
async fn until_denied(decisions: &mut mpsc::UnboundedReceiver<bool>) {
    loop {
        match decisions.recv().await {
            Some(false) => return,
            Some(true) => continue,
            None => std::future::pending::<()>().await,
        }
    }
}

/// A nearby device asking to pair. The person on the computer allows it first (a dialog names
/// the device); only then does the computer show six digits, which the device has `left` tries
/// to type. Every failure counts against a budget kept on disk, so asking again never resets it.
pub async fn host_confirm(inner: Arc<Inner>, conn: Connection, mut send: SendStream, mut recv: RecvStream, hello: Value) {
    let device = conn.remote_id();
    if !inner.discoverable || !inner.local.is_on() {
        return refuse(conn, send, json!({ "ok": false, "error": "off" })).await;
    }
    if let Err(wait_ms) = budget(&inner) {
        return refuse(conn, send, json!({ "ok": false, "error": "paused", "retryAfterMs": wait_ms })).await;
    }
    if !from_own_network(&inner, &conn).await {
        return refuse(conn, send, json!({ "ok": false, "error": "not_local" })).await;
    }
    let request = inner.next_rid.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let (decide, mut decisions) = mpsc::unbounded_channel();
    let busy = {
        let mut confirming = lock(&inner.confirming);
        let busy = confirming.is_some();
        if !busy {
            *confirming = Some(Confirming { request, decide });
        }
        busy
    };
    if busy {
        return refuse(conn, send, json!({ "ok": false, "error": "busy" })).await;
    }
    let text = |k: &str, fallback: &str| hello.get(k).and_then(|x| x.as_str()).map(|x| x.chars().take(80).collect::<String>()).filter(|x| !x.is_empty()).unwrap_or_else(|| fallback.to_owned());
    let asker = json!({ "id": device.to_string(), "name": text("name", "Device"), "platform": text("platform", "unknown") });
    (inner.emit)(json!({ "kind": "pairing", "state": "confirm", "request": request, "code": null, "device": asker }));
    let allowed = tokio::select! {
        allowed = decisions.recv() => if allowed == Some(true) { Ok(()) } else { Err("denied") },
        _ = tokio::time::sleep(ALLOW_TTL) => Err("expired"),
        _ = conn.closed() => Err("cancelled"),
    };
    let result: &str = match allowed {
        Err(result) => {
            failed(&inner);
            result
        }
        Ok(()) => {
            let code = pake::six_digits();
            (inner.emit)(json!({ "kind": "pairing", "state": "confirm", "request": request, "code": code, "device": asker }));
            let guesses = async {
                wire::write(&mut send, &json!({ "t": "code" })).await?;
                let (id_device, id_computer) = ids(device, inner.endpoint.id());
                loop {
                    let Some(frame) = wire::read(&mut recv).await? else { return Ok("cancelled") };
                    let theirs = unb64(&frame, "msg");
                    let (exchange, ours) = Exchange::start(false, code.as_bytes(), &id_device, &id_computer);
                    let keys = exchange.finish(&theirs)?;
                    wire::write(&mut send, &json!({ "t": "spake", "msg": b64(&ours), "confirm": b64(&keys.confirm("computer")) })).await?;
                    let Some(answer) = wire::read(&mut recv).await? else { return Ok("cancelled") };
                    if answer.get("t").and_then(|t| t.as_str()) == Some("confirm") && keys.check("device", &unb64(&answer, "proof")) {
                        succeeded(&inner);
                        let device = host::keep_device(&inner, &device.to_string(), &hello)?;
                        let name = lock(&inner.name).clone();
                        wire::write(&mut send, &json!({ "ok": true, "name": name, "platform": inner.platform })).await?;
                        let _ = send.finish();
                        (inner.emit)(json!({ "kind": "device", "id": device.id, "state": "paired", "device": device }));
                        return Ok::<&str, String>("paired");
                    }
                    let paused = failed(&inner);
                    let left = if paused { 0 } else { budget(&inner).unwrap_or(0) };
                    wire::write(&mut send, &json!({ "t": "wrong", "left": left })).await?;
                    if left == 0 {
                        return Ok("failed");
                    }
                }
            };
            tokio::select! {
                r = guesses => r.unwrap_or("cancelled"),
                _ = until_denied(&mut decisions) => {
                    failed(&inner);
                    "denied"
                }
                _ = tokio::time::sleep(CONFIRM_TTL) => "expired",
            }
        }
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
        "failed" => {
            // The device reads that no tries are left, then hangs up itself.
            let _ = tokio::time::timeout(Duration::from_secs(2), conn.closed()).await;
            conn.close(CLOSE_DENIED.into(), b"failed");
        }
        "denied" | "expired" => conn.close(CLOSE_DENIED.into(), result.as_bytes()),
        _ => {}
    }
}

/// The person on the computer allows (`true`) or denies the open nearby request.
pub fn decide(inner: &Inner, request: u64, allow: bool) -> bool {
    let confirming = lock(&inner.confirming);
    match confirming.as_ref() {
        Some(c) if c.request == request => c.decide.send(allow).is_ok(),
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

fn refusal(reply: &Value) -> String {
    match reply.get("error").and_then(|e| e.as_str()) {
        Some("busy") => "That computer is answering another device. Try again in a moment.".into(),
        Some("off") => "That computer doesn't take nearby devices.".into(),
        Some("not_local") => "That computer only pairs nearby devices on its own network. Use its QR code or short code instead.".into(),
        Some("paused") => {
            let minutes = reply.get("retryAfterMs").and_then(|m| m.as_u64()).unwrap_or(60_000).div_ceil(60_000).max(1);
            format!("That computer paused nearby pairing after too many tries. Try again in {minutes} {}, or use its QR code.", if minutes == 1 { "minute" } else { "minutes" })
        }
        _ => "That computer didn't accept the request.".into(),
    }
}

/// Asks a nearby computer to pair and waits while the person there allows it; on success it is
/// showing six digits for `pair.nearby.confirm`. `pair.nearby.cancel` ends the wait.
pub async fn ask(inner: &Arc<Inner>, id: &str) -> Result<Value, String> {
    let computer: EndpointId = id.parse().map_err(|_| format!("{id} isn't a device id"))?;
    let addr = lock(&inner.nearby).addrs.get(id).cloned().unwrap_or_else(|| EndpointAddr::from_parts(computer, Vec::<TransportAddr>::new()));
    let reach = || "Couldn't reach that computer. Check that Stella is open on it and try again.".to_owned();
    let (tx, mut rx) = mpsc::channel(1);
    lock(&inner.asking).insert(id.to_owned(), tx.clone());
    let cancelled = async {
        while rx.recv().await.is_some() {}
    };
    let started = async {
        let conn = tokio::time::timeout(Duration::from_secs(10), inner.endpoint.connect(addr.clone(), PAIR_ALPN)).await.map_err(|_| reach())?.map_err(|_| reach())?;
        let (mut send, mut recv) = conn.open_bi().await.map_err(|e| e.to_string())?;
        let name = lock(&inner.name).clone();
        wire::write(&mut send, &json!({ "v": 1, "mode": "nearby", "name": name, "platform": inner.platform })).await?;
        let reply = match tokio::time::timeout(ALLOW_TTL + Duration::from_secs(10), wire::read(&mut recv)).await {
            Err(_) => return Err("The computer didn't answer.".to_owned()),
            Ok(Ok(Some(reply))) => reply,
            Ok(_) if matches!(conn.close_reason(), Some(ConnectionError::ApplicationClosed(c)) if u64::from(c.error_code) == CLOSE_DENIED as u64) => {
                return Err("That computer didn't allow it.".to_owned());
            }
            Ok(_) => return Err("The computer closed the connection.".to_owned()),
        };
        if reply.get("t").and_then(|t| t.as_str()) != Some("code") {
            conn.close(0u32.into(), b"bye");
            return Err(refusal(&reply));
        }
        Ok((conn, send, recv))
    };
    // The map's sender is the only other one: removing it (cancel, or a newer ask) ends `cancelled`.
    drop(tx);
    let outcome = tokio::select! {
        started = started => started,
        _ = cancelled => Err("Cancelled.".to_owned()),
    };
    match outcome {
        Ok((conn, send, recv)) => {
            tokio::spawn(answer_digits(inner.clone(), computer, addr, conn, send, recv, rx));
            Ok(json!({ "state": "code" }))
        }
        Err(e) => {
            drop(rx);
            let mut asking = lock(&inner.asking);
            if asking.get(id).is_some_and(|a| a.is_closed()) {
                asking.remove(id);
            }
            Err(e)
        }
    }
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
