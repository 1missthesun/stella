//! Short pairing codes for a device on another network, like `K7M-49PX`. The first three symbols
//! name a slot on a rendezvous mailbox (a tiny HTTP service holding a few opaque blobs for five
//! minutes); the last four are a SPAKE2 password that never leaves the two devices. Through the
//! slot they agree on a key, and the computer hands over its full pairing code sealed under it;
//! the device then pairs with that code directly, exactly as if it had scanned it.
//!
//! Mailbox: `PUT /v1/slots/:slot {a}` → `{token}` (409 taken), `GET /v1/slots/:slot` → `{a}`,
//! `POST /v1/slots/:slot/b {b, confirm}` → `{token}` (409 already claimed: one guess per code),
//! `GET /v1/slots/:slot/b` (computer's token) → `{b, confirm}` or 204, `POST /v1/slots/:slot/offer
//! {sealed}` (computer's token), `GET /v1/slots/:slot/offer` (device's token) → `{sealed}` or 204,
//! `DELETE /v1/slots/:slot` (either token).

use std::sync::{Arc, OnceLock};
use std::time::Duration;

use data_encoding::BASE64URL_NOPAD;
use reqwest::{Client, Method, StatusCode};
use serde_json::{Value, json};
use tokio::sync::watch;

use crate::pake::{self, Exchange};
use crate::store::now_ms;
use crate::{Inner, client, host, lock};

pub const TTL: Duration = Duration::from_secs(5 * 60);
const POLL: Duration = Duration::from_millis(1500);
const ID_COMPUTER: &[u8] = b"stella computer";
const ID_DEVICE: &[u8] = b"stella device";

/// The computer's live short code, so a new one (or a closed dialog) ends the last.
pub(crate) struct Slot {
    id: u64,
    stop: watch::Sender<bool>,
}

fn http() -> Result<&'static Client, String> {
    static CLIENT: OnceLock<Result<Client, String>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            let tls = iroh::tls::CaTlsConfig::default().client_config(iroh::tls::default_provider()).map_err(|e| e.to_string())?;
            Client::builder().tls_backend_preconfigured(tls).timeout(Duration::from_secs(15)).build().map_err(|e| e.to_string())
        })
        .as_ref()
        .map_err(Clone::clone)
}

struct Reply {
    status: StatusCode,
    body: Value,
}

async fn call(base: &str, method: Method, path: &str, token: Option<&str>, body: Option<Value>) -> Result<Reply, String> {
    let mut req = http()?.request(method, format!("{}{path}", base.trim_end_matches('/')));
    if let Some(token) = token {
        req = req.header("authorization", format!("Bearer {token}"));
    }
    if let Some(body) = body {
        req = req.header("content-type", "application/json").body(body.to_string());
    }
    let res = req.send().await.map_err(|_| "Couldn't reach Stella's pairing service. Check the internet connection, or use the offline code.".to_owned())?;
    let status = res.status();
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    Ok(Reply { status, body: serde_json::from_slice(&bytes).unwrap_or(Value::Null) })
}

fn b64(bytes: &[u8]) -> String {
    BASE64URL_NOPAD.encode(bytes)
}

fn unb64(v: &Value, k: &str) -> Vec<u8> {
    v.get(k).and_then(|x| x.as_str()).and_then(|s| BASE64URL_NOPAD.decode(s.as_bytes()).ok()).unwrap_or_default()
}

fn rendezvous(inner: &Inner) -> Result<String, String> {
    inner.rendezvous.clone().ok_or_else(|| "Short codes are off on this device. Use the offline code.".to_owned())
}

pub fn withdraw(inner: &Inner) {
    if let Some(slot) = lock(&inner.short).take() {
        let _ = slot.stop.send(true);
    }
}

/// A short code for the computer's live pairing offer (making one if none is live).
pub async fn create(inner: &Arc<Inner>) -> Result<Value, String> {
    let base = rendezvous(inner)?;
    let offer = match host::live_offer(inner) {
        Some(offer) => offer,
        None => host::create_offer(inner, Some(TTL.as_millis() as u64)).await?,
    };
    let code = offer.get("code").and_then(|c| c.as_str()).ok_or("no pairing code")?.to_owned();
    let offer_expires = offer.get("expiresAt").and_then(|e| e.as_u64()).unwrap_or(u64::MAX);
    withdraw(inner);
    let password = pake::random_symbols(pake::PASSWORD_LEN);
    let mut placed = None;
    for _ in 0..8 {
        let slot = pake::random_symbols(pake::SLOT_LEN);
        let short = format!("{slot}{password}");
        let (exchange, a) = Exchange::start(true, &pake::short_password(&short), ID_COMPUTER, ID_DEVICE);
        let reply = call(&base, Method::PUT, &format!("/v1/slots/{slot}"), None, Some(json!({ "a": b64(&a) }))).await?;
        match reply.status {
            StatusCode::CONFLICT => continue,
            s if s.is_success() => {
                let token = reply.body.get("token").and_then(|t| t.as_str()).ok_or("the pairing service sent no token")?.to_owned();
                placed = Some((slot, short, exchange, token));
                break;
            }
            StatusCode::TOO_MANY_REQUESTS => return Err("Too many codes from this network just now. Wait a minute, or use the offline code.".into()),
            s => return Err(format!("Stella's pairing service refused the code ({s}). Use the offline code.")),
        }
    }
    let (slot, short, exchange, token) = placed.ok_or("Stella's pairing service is busy. Try again, or use the offline code.")?;
    let expires_at = offer_expires.min(now_ms() + TTL.as_millis() as u64);
    let (stop, stopped) = watch::channel(false);
    let id = inner.next_rid.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    *lock(&inner.short) = Some(Slot { id, stop });
    tokio::spawn(hand_over(inner.clone(), id, base, slot, token, exchange, code.clone(), expires_at, stopped));
    Ok(json!({ "short": pake::display_short(&short), "code": code, "url": format!("{}{code}", crate::pairing::URL_PREFIX), "expiresAt": expires_at }))
}

#[allow(clippy::too_many_arguments)]
async fn hand_over(inner: Arc<Inner>, id: u64, base: String, slot: String, token: String, exchange: Exchange, code: String, expires_at: u64, mut stopped: watch::Receiver<bool>) {
    let path = format!("/v1/slots/{slot}");
    let mut exchange = Some(exchange);
    let outcome = loop {
        if now_ms() >= expires_at {
            break "expired";
        }
        if !host::offer_is_live(&inner, &code) {
            break "withdrawn";
        }
        let reply = call(&base, Method::GET, &format!("{path}/b"), Some(&token), None).await;
        match reply {
            Ok(r) if r.status == StatusCode::OK => {
                let Some(exchange) = exchange.take() else { break "failed" };
                let keys = match exchange.finish(&unb64(&r.body, "b")) {
                    Ok(keys) => keys,
                    Err(_) => break "failed",
                };
                if !keys.check("device", &unb64(&r.body, "confirm")) {
                    break "failed";
                }
                let sealed = keys.seal(code.as_bytes());
                match call(&base, Method::POST, &format!("{path}/offer"), Some(&token), Some(json!({ "sealed": b64(&sealed) }))).await {
                    Ok(r) if r.status.is_success() => {
                        // The device pairs with the code directly now; the slot deletes itself once read.
                        return;
                    }
                    _ => break "failed",
                }
            }
            Ok(r) if r.status == StatusCode::NOT_FOUND => break "expired",
            _ => {}
        }
        tokio::select! {
            _ = tokio::time::sleep(POLL) => {}
            _ = stopped.changed() => break "withdrawn",
        }
    };
    let _ = call(&base, Method::DELETE, &path, Some(&token), None).await;
    {
        let mut short = lock(&inner.short);
        if short.as_ref().is_some_and(|s| s.id == id) {
            *short = None;
        }
    }
    if outcome != "withdrawn" {
        (inner.emit)(json!({ "kind": "pairing", "state": "short_ended", "reason": outcome }));
    }
}

/// Pairs with a computer through its short code.
pub async fn pair(inner: &Arc<Inner>, typed: &str) -> Result<Value, String> {
    let short = pake::normalize_short(typed).ok_or("That code should be 7 letters and numbers, like K7M-49PX.")?;
    let base = rendezvous(inner)?;
    let slot = &short[..pake::SLOT_LEN];
    let path = format!("/v1/slots/{slot}");
    let gone = || "That code has expired or doesn't exist. Check it, or show a new one on the computer.".to_owned();
    let reply = call(&base, Method::GET, &path, None, None).await?;
    if reply.status != StatusCode::OK {
        return Err(gone());
    }
    let (exchange, b) = Exchange::start(false, &pake::short_password(&short), ID_COMPUTER, ID_DEVICE);
    let keys = exchange.finish(&unb64(&reply.body, "a")).map_err(|_| gone())?;
    let claim = call(&base, Method::POST, &format!("{path}/b"), None, Some(json!({ "b": b64(&b), "confirm": b64(&keys.confirm("device")) }))).await?;
    match claim.status {
        s if s.is_success() => {}
        StatusCode::CONFLICT => return Err("That code was already used. Show a new one on the computer.".into()),
        StatusCode::TOO_MANY_REQUESTS => return Err("Too many tries from this network just now. Wait a minute and try again.".into()),
        _ => return Err(gone()),
    }
    let token = claim.body.get("token").and_then(|t| t.as_str()).ok_or("the pairing service sent no token")?.to_owned();
    let deadline = now_ms() + 30_000;
    let sealed = loop {
        let reply = call(&base, Method::GET, &format!("{path}/offer"), Some(&token), None).await?;
        match reply.status {
            StatusCode::OK => break unb64(&reply.body, "sealed"),
            StatusCode::NOT_FOUND => return Err("That code doesn't match. Check it and try again, with a new code from the computer.".into()),
            _ if now_ms() > deadline => return Err("The computer didn't answer. Check that Stella is open on it.".into()),
            _ => tokio::time::sleep(Duration::from_millis(800)).await,
        }
    };
    let _ = call(&base, Method::DELETE, &path, Some(&token), None).await;
    let code = keys.open(&sealed).map_err(|_| "That code doesn't match. Check it and try again.".to_owned())?;
    client::pair(inner, &String::from_utf8_lossy(&code)).await
}
