//! The device's side: pairing to a computer with its code, keeping a link to it (reconnecting on
//! its own while the computer sleeps or moves networks), requests to it and its events.

use std::sync::Arc;
use std::time::Duration;

use data_encoding::BASE64URL_NOPAD;
use iroh::EndpointId;
use iroh::endpoint::{Connection, ConnectionError};
use serde_json::{Value, json};
use tokio::sync::{Notify, watch};

use crate::pairing::{self, Code};
use crate::store::{Computer, now_ms};
use crate::{ALPN, CLOSE_NOT_PAIRED, CLOSE_REPLACED, CLOSE_REVOKED, ComputerLink, Inner, PAIR_ALPN, lock, wire};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_BACKOFF: Duration = Duration::from_secs(5);

fn parse_id(id: &str) -> Result<EndpointId, String> {
    id.parse().map_err(|_| format!("{id} isn't a device id"))
}

pub async fn pair(inner: &Arc<Inner>, code: &str) -> Result<Value, String> {
    let code = Code::decode(code)?;
    if code.host == inner.endpoint.id() {
        return Err("That's this device's own pairing code. Open it on the other device.".into());
    }
    let addr = pairing::endpoint_addr(code.host, code.relay.as_deref(), &code.addrs);
    let conn = tokio::time::timeout(Duration::from_secs(20), inner.endpoint.connect(addr, PAIR_ALPN))
        .await
        .map_err(|_| "Couldn't reach that computer. Check that Stella is open on it and try again.".to_owned())?
        .map_err(|e| format!("Couldn't reach that computer: {e}"))?;
    let (mut send, mut recv) = conn.open_bi().await.map_err(|e| e.to_string())?;
    let name = lock(&inner.name).clone();
    wire::write(&mut send, &json!({ "v": 1, "secret": BASE64URL_NOPAD.encode(&code.secret), "name": name, "platform": inner.platform })).await?;
    let _ = send.finish();
    let reply = tokio::time::timeout(Duration::from_secs(15), wire::read(&mut recv))
        .await
        .map_err(|_| "The computer didn't answer.".to_owned())??
        .ok_or("The computer closed the connection.")?;
    conn.close(0u32.into(), b"paired");
    if reply.get("ok").and_then(|o| o.as_bool()) != Some(true) {
        return Err("That pairing code has expired or was already used. Show a new one on the computer.".into());
    }
    saved(inner, code.host, &reply, code.relay, code.addrs)
}

/// Who a pairing code names, as that computer itself answers (the connection proves it holds the
/// code's key), without pairing or spending the code.
pub async fn preview(inner: &Arc<Inner>, code: &str) -> Result<Value, String> {
    let code = Code::decode(code)?;
    if code.host == inner.endpoint.id() {
        return Err("That's this device's own pairing code. Open it on the other device.".into());
    }
    let addr = pairing::endpoint_addr(code.host, code.relay.as_deref(), &code.addrs);
    let reach = || "Couldn't reach that computer. Check that Stella is open on it and try again.".to_owned();
    let conn = tokio::time::timeout(Duration::from_secs(20), inner.endpoint.connect(addr, PAIR_ALPN)).await.map_err(|_| reach())?.map_err(|_| reach())?;
    let ask = async {
        let (mut send, mut recv) = conn.open_bi().await.map_err(|e| e.to_string())?;
        wire::write(&mut send, &json!({ "v": 1, "mode": "info" })).await?;
        let _ = send.finish();
        wire::read(&mut recv).await?.ok_or_else(|| "The computer closed the connection.".to_owned())
    };
    let info = tokio::time::timeout(Duration::from_secs(15), ask).await.map_err(|_| "The computer didn't answer.".to_owned());
    conn.close(0u32.into(), b"thanks");
    let info = info??;
    let id = code.host.to_string();
    let text = |k: &str, fallback: &str| info.get(k).and_then(|x| x.as_str()).map(|x| x.chars().take(80).collect::<String>()).filter(|x| !x.is_empty()).unwrap_or_else(|| fallback.to_owned());
    let paired = lock(&inner.store).computer(&id).is_some();
    Ok(json!({ "id": id, "name": text("name", "Computer"), "platform": text("platform", "unknown"), "paired": paired }))
}

/// Keeps a computer that just accepted this device and starts the link to it.
pub(crate) fn saved(inner: &Arc<Inner>, host: EndpointId, reply: &Value, relay: Option<String>, addrs: Vec<String>) -> Result<Value, String> {
    let text = |k: &str, fallback: &str| reply.get(k).and_then(|x| x.as_str()).map(|x| x.chars().take(80).collect::<String>()).filter(|x| !x.is_empty()).unwrap_or_else(|| fallback.to_owned());
    let computer = Computer { id: host.to_string(), name: text("name", "Computer"), platform: text("platform", "unknown"), paired_at: now_ms(), relay, addrs, last_seen_at: Some(now_ms()) };
    {
        let mut store = lock(&inner.store);
        store.put_computer(computer.clone());
        store.save()?;
    }
    (inner.emit)(json!({ "kind": "computer", "id": computer.id, "state": "paired", "computer": computer }));
    // Pairing again (after an unpair, say) starts over rather than reusing the link that ended.
    disconnect(inner, &computer.id)?;
    connect(inner, &computer.id)?;
    Ok(serde_json::to_value(&computer).unwrap_or(Value::Null))
}

pub fn connect(inner: &Arc<Inner>, id: &str) -> Result<Value, String> {
    let host = parse_id(id)?;
    if lock(&inner.store).computer(id).is_none() {
        return Err("This device isn't paired to that computer.".into());
    }
    let mut links = lock(&inner.computers);
    if let Some(link) = links.get(id) {
        let ended = matches!(link.state.get("state").and_then(|s| s.as_str()), Some("revoked" | "not_paired"));
        if !ended {
            link.retry.notify_one();
            return Ok(link.state.clone());
        }
        links.remove(id);
    }
    let (stop, stopped) = watch::channel(false);
    let retry = Arc::new(Notify::new());
    let state = json!({ "state": "connecting" });
    links.insert(id.to_owned(), ComputerLink { stop, retry: retry.clone(), conn: None, state: state.clone() });
    drop(links);
    tokio::spawn(link(inner.clone(), host, stopped, retry));
    Ok(state)
}

pub fn disconnect(inner: &Inner, id: &str) -> Result<Value, String> {
    if let Some(link) = lock(&inner.computers).remove(id) {
        let _ = link.stop.send(true);
        if let Some(conn) = link.conn {
            conn.close(0u32.into(), b"bye");
        }
    }
    Ok(Value::Null)
}

pub fn forget(inner: &Inner, id: &str) -> Result<Value, String> {
    disconnect(inner, id)?;
    let removed = {
        let mut store = lock(&inner.store);
        let before = store.peers.computers.len();
        store.peers.computers.retain(|c| c.id != id);
        let removed = store.peers.computers.len() < before;
        if removed {
            store.save()?;
        }
        removed
    };
    if removed {
        (inner.emit)(json!({ "kind": "computer", "id": id, "state": "forgotten" }));
    }
    Ok(json!(removed))
}

pub fn retry(inner: &Inner, id: Option<&str>) {
    for (key, link) in lock(&inner.computers).iter() {
        if id.is_none_or(|id| id == key) {
            link.retry.notify_one();
        }
    }
}

pub async fn request(inner: &Inner, id: &str, body: Value, timeout: Duration) -> Result<Value, String> {
    let conn = lock(&inner.computers).get(id).and_then(|l| l.conn.clone()).ok_or("offline")?;
    let exchange = async {
        let (mut send, mut recv) = conn.open_bi().await.map_err(|e| e.to_string())?;
        wire::write(&mut send, &body).await?;
        let _ = send.finish();
        wire::read(&mut recv).await?.ok_or_else(|| "the computer closed the request".to_owned())
    };
    let reply = tokio::time::timeout(timeout, exchange).await.map_err(|_| "the computer didn't answer in time".to_owned())??;
    if reply.get("ok").and_then(|o| o.as_bool()) == Some(true) {
        Ok(reply.get("body").cloned().unwrap_or(Value::Null))
    } else {
        Err(reply.get("error").and_then(|e| e.as_str()).unwrap_or("the computer couldn't answer").to_owned())
    }
}

fn set_state(inner: &Inner, id: &str, state: Value, conn: Option<Option<Connection>>) {
    let mut links = lock(&inner.computers);
    let Some(link) = links.get_mut(id) else { return };
    if let Some(conn) = conn {
        link.conn = conn;
    }
    if link.state == state {
        return;
    }
    link.state = state.clone();
    drop(links);
    let mut event = json!({ "kind": "computer", "id": id });
    if let (Some(e), Some(s)) = (event.as_object_mut(), state.as_object()) {
        e.extend(s.clone());
    }
    (inner.emit)(event);
}

/// Why a connection ended: the computer unpaired us, never knew us, or just went away.
fn ending(error: &ConnectionError) -> Option<&'static str> {
    match error {
        ConnectionError::ApplicationClosed(close) => {
            let code: u64 = close.error_code.into();
            match code {
                c if c == CLOSE_REVOKED as u64 => Some("revoked"),
                c if c == CLOSE_NOT_PAIRED as u64 => Some("not_paired"),
                c if c == CLOSE_REPLACED as u64 => Some("replaced"),
                _ => None,
            }
        }
        _ => None,
    }
}

async fn link(inner: Arc<Inner>, host: EndpointId, mut stopped: watch::Receiver<bool>, retry: Arc<Notify>) {
    let id = host.to_string();
    let mut backoff = Duration::from_millis(500);
    while !*stopped.borrow() {
        let Some(computer) = lock(&inner.store).computer(&id).cloned() else { break };
        let offline = lock(&inner.computers).get(&id).is_some_and(|l| l.state.get("state").and_then(|s| s.as_str()) == Some("offline"));
        if !offline {
            set_state(&inner, &id, json!({ "state": "connecting" }), None);
        }
        let addr = pairing::endpoint_addr(host, computer.relay.as_deref(), &computer.addrs);
        let attempt = async {
            let conn = tokio::time::timeout(CONNECT_TIMEOUT, inner.endpoint.connect(addr, ALPN)).await.map_err(|_| "unreachable".to_owned())?.map_err(|e| e.to_string())?;
            let hello = async {
                let (mut send, mut recv) = conn.open_bi().await.map_err(|e| e.to_string())?;
                let name = lock(&inner.name).clone();
                wire::write(&mut send, &json!({ "t": "hello", "v": 1, "name": name, "platform": inner.platform })).await?;
                let reply = wire::read(&mut recv).await?.ok_or("closed")?;
                Ok::<_, String>((send, recv, reply))
            };
            match tokio::time::timeout(CONNECT_TIMEOUT, hello).await {
                Ok(Ok((send, recv, reply))) => Ok((conn, send, recv, reply)),
                Ok(Err(e)) => Err(conn.close_reason().as_ref().and_then(ending).map(str::to_owned).unwrap_or(e)),
                Err(_) => Err("unreachable".to_owned()),
            }
        };
        let outcome = tokio::select! {
            outcome = attempt => outcome,
            _ = stopped.changed() => break,
        };
        match outcome {
            Ok((conn, _send, mut recv, hello)) => {
                backoff = Duration::from_millis(500);
                {
                    let mut store = lock(&inner.store);
                    if let Some(mut computer) = store.computer(&id).cloned() {
                        if let Some(name) = hello.get("name").and_then(|n| n.as_str()).filter(|n| !n.is_empty()) {
                            computer.name = name.to_owned();
                        }
                        if let Some(addrs) = hello.get("addrs").and_then(|a| a.as_array()) {
                            let addrs: Vec<String> = addrs.iter().filter_map(|a| a.as_str().map(str::to_owned)).collect();
                            if !addrs.is_empty() {
                                computer.addrs = addrs;
                            }
                        }
                        if let Some(relay) = hello.get("relay").and_then(|r| r.as_str()) {
                            computer.relay = Some(relay.to_owned());
                        }
                        computer.last_seen_at = Some(now_ms());
                        store.put_computer(computer);
                        let _ = store.save();
                    }
                }
                let name = hello.get("name").cloned().unwrap_or(Value::Null);
                set_state(&inner, &id, json!({ "state": "online", "name": name, "path": crate::host::path_of(&conn) }), Some(Some(conn.clone())));
                let mut paths = tokio::time::interval(Duration::from_secs(2));
                let ended = loop {
                    tokio::select! {
                        frame = wire::read(&mut recv) => match frame {
                            Ok(Some(frame)) => {
                                if frame.get("t").and_then(|t| t.as_str()) == Some("event") {
                                    (inner.emit)(json!({ "kind": "event", "from": id, "body": frame.get("body").cloned().unwrap_or(Value::Null) }));
                                }
                            }
                            _ => break conn.close_reason(),
                        },
                        _ = paths.tick() => {
                            set_state(&inner, &id, json!({ "state": "online", "name": name, "path": crate::host::path_of(&conn) }), None);
                        }
                        error = conn.closed() => break Some(error),
                        _ = stopped.changed() => {
                            conn.close(0u32.into(), b"bye");
                            return;
                        }
                    }
                };
                match ended.as_ref().and_then(ending) {
                    Some(reason @ ("revoked" | "not_paired")) => {
                        set_state(&inner, &id, json!({ "state": reason }), Some(None));
                        return;
                    }
                    _ => set_state(&inner, &id, json!({ "state": "offline", "since": now_ms() }), Some(None)),
                }
            }
            Err(reason) if reason == "revoked" || reason == "not_paired" => {
                set_state(&inner, &id, json!({ "state": reason }), Some(None));
                return;
            }
            Err(reason) => {
                let since = lock(&inner.computers).get(&id).and_then(|l| l.state.get("since").cloned()).unwrap_or(json!(now_ms()));
                set_state(&inner, &id, json!({ "state": "offline", "since": since, "reason": reason }), Some(None));
            }
        }
        tokio::select! {
            _ = tokio::time::sleep(backoff) => {}
            _ = retry.notified() => {}
            _ = stopped.changed() => break,
        }
        backoff = (backoff * 2).min(MAX_BACKOFF);
    }
}
