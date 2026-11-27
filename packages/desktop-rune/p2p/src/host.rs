//! The computer's side: pairing new devices, accepting paired ones (and only those), answering
//! their requests through the embedder, and pushing events to them.

use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use data_encoding::BASE64URL_NOPAD;
use iroh::endpoint::{Connection, RecvStream, SendStream};
use serde_json::{Value, json};
use tokio::sync::{mpsc, oneshot};

use crate::pairing::{self, Code, Offer};
use crate::store::{Device, now_ms};
use crate::{ALPN, CLOSE_NOT_PAIRED, CLOSE_REPLACED, CLOSE_REVOKED, DeviceLink, Inner, PAIR_ALPN, lock, wire};

/// How long the embedder has to answer one request.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10 * 60);

pub async fn accept_loop(inner: Arc<Inner>) {
    while let Some(incoming) = inner.endpoint.accept().await {
        let inner = inner.clone();
        tokio::spawn(async move {
            let Ok(conn) = incoming.await else { return };
            if conn.alpn() == PAIR_ALPN {
                pair_incoming(inner, conn).await;
            } else if conn.alpn() == ALPN {
                device_incoming(inner, conn).await;
            } else {
                conn.close(400u32.into(), b"unknown protocol");
            }
        });
    }
}

pub async fn create_offer(inner: &Inner, ttl_ms: Option<u64>) -> Result<Value, String> {
    let ttl = ttl_ms.map(Duration::from_millis).unwrap_or(pairing::DEFAULT_TTL).clamp(Duration::from_secs(30), Duration::from_secs(60 * 60));
    let _ = tokio::time::timeout(Duration::from_secs(3), inner.endpoint.online()).await;
    let (relay, mut addrs) = crate::reachable(inner);
    // A shorter code makes a QR code a phone reads at a glance; the rest arrive with the first hello.
    addrs.truncate(4);
    let secret = pairing::random_secret();
    let expires_at_ms = now_ms() + ttl.as_millis() as u64;
    {
        let mut offers = lock(&inner.offers);
        offers.retain(|o| o.expires > Instant::now());
        // One live code at a time: showing a new one withdraws the last.
        offers.clear();
        offers.push(Offer { secret, expires: Instant::now() + ttl, expires_at_ms, failed: 0 });
    }
    let code = Code { host: inner.endpoint.id(), secret, relay, addrs }.encode();
    Ok(json!({ "code": code, "url": format!("{}{code}", pairing::URL_PREFIX), "expiresAt": expires_at_ms }))
}

async fn pair_incoming(inner: Arc<Inner>, conn: Connection) {
    let device_id = conn.remote_id().to_string();
    let Ok(Ok((mut send, mut recv))) = tokio::time::timeout(Duration::from_secs(15), conn.accept_bi()).await else {
        conn.close(400u32.into(), b"no pairing request");
        return;
    };
    let Ok(Ok(Some(hello))) = tokio::time::timeout(Duration::from_secs(15), wire::read(&mut recv)).await else {
        conn.close(400u32.into(), b"no pairing request");
        return;
    };
    let secret = hello.get("secret").and_then(|s| s.as_str()).and_then(|s| BASE64URL_NOPAD.decode(s.as_bytes()).ok()).unwrap_or_default();
    let accepted = {
        let mut offers = lock(&inner.offers);
        offers.retain(|o| o.expires > Instant::now());
        match offers.iter().position(|o| pairing::same(&o.secret, &secret)) {
            Some(i) => {
                offers.remove(i);
                true
            }
            None => {
                for offer in offers.iter_mut() {
                    offer.failed += 1;
                }
                let before = offers.len();
                offers.retain(|o| o.failed < pairing::MAX_FAILED_ATTEMPTS);
                if offers.len() < before {
                    (inner.emit)(json!({ "kind": "pairing", "state": "withdrawn", "reason": "too_many_attempts" }));
                }
                false
            }
        }
    };
    if !accepted {
        let _ = wire::write(&mut send, &json!({ "ok": false, "error": "expired" })).await;
        let _ = send.finish();
        tokio::time::sleep(Duration::from_millis(200)).await;
        conn.close(CLOSE_NOT_PAIRED.into(), b"pairing code expired");
        return;
    }
    let text = |k: &str, fallback: &str| hello.get(k).and_then(|x| x.as_str()).map(|x| x.chars().take(80).collect::<String>()).filter(|x| !x.is_empty()).unwrap_or_else(|| fallback.to_owned());
    let device = Device { id: device_id.clone(), name: text("name", "Device"), platform: text("platform", "unknown"), paired_at: now_ms(), last_seen_at: Some(now_ms()) };
    let saved = {
        let mut store = lock(&inner.store);
        store.put_device(device.clone());
        store.save()
    };
    if let Err(e) = saved {
        let _ = wire::write(&mut send, &json!({ "ok": false, "error": e })).await;
        let _ = send.finish();
        return;
    }
    let name = lock(&inner.name).clone();
    let _ = wire::write(&mut send, &json!({ "ok": true, "name": name, "platform": inner.platform })).await;
    let _ = send.finish();
    (inner.emit)(json!({ "kind": "pairing", "state": "used", "device": device }));
    (inner.emit)(json!({ "kind": "device", "id": device_id, "state": "paired", "device": device }));
    let _ = tokio::time::timeout(Duration::from_secs(5), conn.closed()).await;
}

async fn device_incoming(inner: Arc<Inner>, conn: Connection) {
    let device_id = conn.remote_id().to_string();
    if lock(&inner.store).device(&device_id).is_none() {
        (inner.emit)(json!({ "kind": "device", "id": device_id, "state": "rejected", "reason": "not_paired" }));
        conn.close(CLOSE_NOT_PAIRED.into(), b"not paired");
        return;
    }
    let Ok(Ok((mut send, mut recv))) = tokio::time::timeout(Duration::from_secs(15), conn.accept_bi()).await else {
        conn.close(400u32.into(), b"no hello");
        return;
    };
    let Ok(Ok(Some(hello))) = tokio::time::timeout(Duration::from_secs(15), wire::read(&mut recv)).await else {
        conn.close(400u32.into(), b"no hello");
        return;
    };
    {
        let mut store = lock(&inner.store);
        if let Some(mut device) = store.device(&device_id).cloned() {
            if let Some(name) = hello.get("name").and_then(|n| n.as_str()).filter(|n| !n.is_empty()) {
                device.name = name.chars().take(80).collect();
            }
            device.last_seen_at = Some(now_ms());
            store.put_device(device);
            let _ = store.save();
        }
    }
    let (relay, addrs) = crate::reachable(&inner);
    let name = lock(&inner.name).clone();
    if wire::write(&mut send, &json!({ "t": "hello", "v": 1, "name": name, "platform": inner.platform, "relay": relay, "addrs": addrs })).await.is_err() {
        return;
    }
    let (events, mut queue) = mpsc::unbounded_channel::<Value>();
    let previous = lock(&inner.devices).insert(device_id.clone(), DeviceLink { conn: conn.clone(), events });
    if let Some(previous) = previous {
        previous.conn.close(CLOSE_REPLACED.into(), b"replaced by a newer connection");
    }
    let stable = conn.stable_id();
    (inner.emit)(json!({ "kind": "device", "id": device_id, "state": "connected", "path": path_of(&conn) }));

    let writer = tokio::spawn(async move {
        while let Some(event) = queue.recv().await {
            if wire::write(&mut send, &event).await.is_err() {
                break;
            }
        }
    });
    loop {
        tokio::select! {
            accepted = conn.accept_bi() => match accepted {
                Ok((send, recv)) => {
                    tokio::spawn(answer(inner.clone(), device_id.clone(), send, recv));
                }
                Err(_) => break,
            },
            _ = conn.closed() => break,
        }
    }
    writer.abort();
    let mut devices = lock(&inner.devices);
    if devices.get(&device_id).is_some_and(|l| l.conn.stable_id() == stable) {
        devices.remove(&device_id);
        drop(devices);
        (inner.emit)(json!({ "kind": "device", "id": device_id, "state": "disconnected" }));
    }
}

async fn answer(inner: Arc<Inner>, device_id: String, mut send: SendStream, mut recv: RecvStream) {
    let Ok(Some(body)) = wire::read(&mut recv).await else { return };
    let rid = inner.next_rid.fetch_add(1, Ordering::Relaxed);
    let (reply, result) = oneshot::channel();
    lock(&inner.pending).insert(rid, reply);
    (inner.emit)(json!({ "kind": "request", "req": rid, "from": device_id, "body": body }));
    let result = match tokio::time::timeout(REQUEST_TIMEOUT, result).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("the computer stopped answering".to_owned()),
        Err(_) => {
            lock(&inner.pending).remove(&rid);
            Err("the computer took too long to answer".to_owned())
        }
    };
    let frame = match result {
        Ok(body) => json!({ "ok": true, "body": body }),
        Err(error) => json!({ "ok": false, "error": error }),
    };
    if wire::write(&mut send, &frame).await.is_ok() {
        let _ = send.finish();
        let _ = send.stopped().await;
    }
}

pub fn revoke(inner: &Inner, id: &str) -> Result<Value, String> {
    let removed = {
        let mut store = lock(&inner.store);
        let before = store.peers.devices.len();
        store.peers.devices.retain(|d| d.id != id);
        let removed = store.peers.devices.len() < before;
        if removed {
            store.save()?;
        }
        removed
    };
    if let Some(link) = lock(&inner.devices).remove(id) {
        link.conn.close(CLOSE_REVOKED.into(), b"unpaired");
    }
    if removed {
        (inner.emit)(json!({ "kind": "device", "id": id, "state": "revoked" }));
    }
    Ok(json!(removed))
}

/// Queues `body` for one connected device, or every one; the number it reached.
pub fn emit(inner: &Inner, id: Option<&str>, body: Value) -> usize {
    let devices = lock(&inner.devices);
    let frame = json!({ "t": "event", "body": body });
    match id {
        Some(id) => devices.get(id).map_or(0, |l| usize::from(l.events.send(frame).is_ok())),
        None => devices.values().filter(|l| l.events.send(frame.clone()).is_ok()).count(),
    }
}

pub fn path_of(conn: &Connection) -> Value {
    let paths = conn.paths();
    let selected = paths.iter().find(|p| p.is_selected());
    match selected {
        Some(p) => json!({ "kind": if p.is_relay() { "relay" } else { "direct" } }),
        None => Value::Null,
    }
}
