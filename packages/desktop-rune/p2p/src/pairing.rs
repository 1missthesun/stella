//! Pairing codes. A code names the computer (its endpoint id, where it can be reached) and holds a
//! one-time secret. It is `stella-p2p1.<base64url JSON>`; QR codes carry `stella://p2p?c=<code>`.
//! The secret proves the device was shown the code; the QUIC handshake proves both keys, so after
//! pairing each side trusts the other's key alone.

use std::time::{Duration, Instant};

use data_encoding::BASE64URL_NOPAD;
use iroh::{EndpointAddr, EndpointId, RelayUrl, TransportAddr};
use serde::{Deserialize, Serialize};

pub const PREFIX: &str = "stella-p2p1.";
pub const URL_PREFIX: &str = "stella://p2p?c=";
pub const DEFAULT_TTL: Duration = Duration::from_secs(10 * 60);
/// Wrong secrets an offer takes before it is withdrawn.
pub const MAX_FAILED_ATTEMPTS: u32 = 8;

#[derive(Serialize, Deserialize)]
struct Wire {
    v: u8,
    /// Endpoint id, hex.
    h: String,
    /// Secret, base64url.
    s: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    r: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    a: Vec<String>,
}

pub struct Code {
    pub host: EndpointId,
    pub secret: [u8; 16],
    pub relay: Option<String>,
    pub addrs: Vec<String>,
}

impl Code {
    pub fn encode(&self) -> String {
        let wire = Wire { v: 1, h: self.host.to_string(), s: BASE64URL_NOPAD.encode(&self.secret), r: self.relay.clone(), a: self.addrs.clone() };
        format!("{PREFIX}{}", BASE64URL_NOPAD.encode(&serde_json::to_vec(&wire).unwrap_or_default()))
    }

    /// Accepts the code itself, the QR URL, or either with stray whitespace or line breaks from a paste.
    pub fn decode(text: &str) -> Result<Code, String> {
        let cleaned: String = text.chars().filter(|c| !c.is_whitespace()).collect();
        let body = cleaned.strip_prefix(URL_PREFIX).unwrap_or(&cleaned);
        let body = body.strip_prefix(PREFIX).ok_or("That isn't a Stella pairing code.")?;
        let json = BASE64URL_NOPAD.decode(body.as_bytes()).map_err(|_| "That pairing code is incomplete. Copy it again.")?;
        let wire: Wire = serde_json::from_slice(&json).map_err(|_| "That pairing code is damaged. Copy it again.")?;
        if wire.v != 1 {
            return Err("That pairing code is from a newer Stella. Update Stella on this device.".into());
        }
        let host: EndpointId = wire.h.parse().map_err(|_| "That pairing code names no computer.")?;
        let secret = BASE64URL_NOPAD.decode(wire.s.as_bytes()).ok().and_then(|s| <[u8; 16]>::try_from(s.as_slice()).ok()).ok_or("That pairing code is damaged. Copy it again.")?;
        Ok(Code { host, secret, relay: wire.r, addrs: wire.a })
    }
}

pub fn endpoint_addr(id: EndpointId, relay: Option<&str>, addrs: &[String]) -> EndpointAddr {
    let mut transports: Vec<TransportAddr> = addrs.iter().filter_map(|a| a.parse().ok()).map(TransportAddr::Ip).collect();
    if let Some(url) = relay.and_then(|r| r.parse::<RelayUrl>().ok()) {
        transports.push(TransportAddr::Relay(url));
    }
    EndpointAddr::from_parts(id, transports)
}

pub struct Offer {
    pub secret: [u8; 16],
    pub expires: Instant,
    pub expires_at_ms: u64,
    pub failed: u32,
}

pub fn random_secret() -> [u8; 16] {
    let mut secret = [0u8; 16];
    getrandom::fill(&mut secret).expect("the OS has no random source");
    secret
}

/// Constant-time comparison: a device learns nothing from how long a wrong secret took.
pub fn same(a: &[u8; 16], b: &[u8]) -> bool {
    if b.len() != a.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}
