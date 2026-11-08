//! Mutual authentication between the native-messaging host and the extension
//! bridge. Both sides hold the bridge token from the 0600 token file; neither
//! sends it. The daemon proves itself first, so a process squatting the
//! loopback port learns nothing and receives nothing.
//!
//! host   -> daemon: {"type":"bridge_auth","clientNonce":cn}
//! daemon -> host:   {"type":"bridge_auth_challenge","serverNonce":sn,"serverProof":HMAC(token, server|port|cn|sn)}
//! host   -> daemon: hello with "proof": HMAC(token, client|port|cn|sn), no "token"
//!
//! The port is the daemon's bound port and the port the host dialed, so a
//! squatter cannot relay a challenge from a daemon listening elsewhere.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::fs;
use std::io::{self, Write};
use std::path::Path;

type HmacSha256 = Hmac<Sha256>;

pub const AUTH_REQUEST: &str = "bridge_auth";
pub const AUTH_CHALLENGE: &str = "bridge_auth_challenge";
const NONCE_BYTES: usize = 32;
const MAX_NONCE_CHARS: usize = 128;

#[derive(Clone, Copy)]
enum Role {
    Server,
    Client,
}

pub fn new_nonce() -> Result<String, String> {
    let mut bytes = [0u8; NONCE_BYTES];
    getrandom::getrandom(&mut bytes).map_err(|e| format!("No randomness: {}", e))?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

pub fn valid_nonce(nonce: &str) -> bool {
    !nonce.is_empty()
        && nonce.len() <= MAX_NONCE_CHARS
        && nonce
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn mac(token: &str, role: Role, port: u16, client_nonce: &str, server_nonce: &str) -> HmacSha256 {
    let mut mac =
        HmacSha256::new_from_slice(token.as_bytes()).expect("HMAC accepts keys of any length");
    let label: &[u8] = match role {
        Role::Server => b"stella-browser-bridge/server",
        Role::Client => b"stella-browser-bridge/client",
    };
    for part in [
        label,
        port.to_string().as_bytes(),
        client_nonce.as_bytes(),
        server_nonce.as_bytes(),
    ] {
        mac.update(&(part.len() as u32).to_be_bytes());
        mac.update(part);
    }
    mac
}

fn prove(token: &str, role: Role, port: u16, client_nonce: &str, server_nonce: &str) -> String {
    URL_SAFE_NO_PAD.encode(
        mac(token, role, port, client_nonce, server_nonce)
            .finalize()
            .into_bytes(),
    )
}

fn verify(
    token: &str,
    role: Role,
    port: u16,
    client_nonce: &str,
    server_nonce: &str,
    proof: &str,
) -> bool {
    if token.is_empty() {
        return false;
    }
    let Ok(bytes) = URL_SAFE_NO_PAD.decode(proof.as_bytes()) else {
        return false;
    };
    mac(token, role, port, client_nonce, server_nonce)
        .verify_slice(&bytes)
        .is_ok()
}

pub fn server_proof(token: &str, port: u16, client_nonce: &str, server_nonce: &str) -> String {
    prove(token, Role::Server, port, client_nonce, server_nonce)
}

pub fn client_proof(token: &str, port: u16, client_nonce: &str, server_nonce: &str) -> String {
    prove(token, Role::Client, port, client_nonce, server_nonce)
}

pub fn verify_server_proof(
    token: &str,
    port: u16,
    client_nonce: &str,
    server_nonce: &str,
    proof: &str,
) -> bool {
    verify(token, Role::Server, port, client_nonce, server_nonce, proof)
}

pub fn verify_client_proof(
    token: &str,
    port: u16,
    client_nonce: &str,
    server_nonce: &str,
    proof: &str,
) -> bool {
    verify(token, Role::Client, port, client_nonce, server_nonce, proof)
}

pub fn create_private_dir(dir: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(dir)
    }
    #[cfg(not(unix))]
    {
        fs::create_dir_all(dir)
    }
}

/// Publishes `contents` at `path` readable only by this user: the file is
/// created 0600 under a fresh name and renamed into place, so it is never
/// visible with wider permissions or half-written.
pub fn write_private_file(path: &Path, contents: &str) -> io::Result<()> {
    let mut suffix = [0u8; 8];
    getrandom::getrandom(&mut suffix).map_err(io::Error::other)?;
    let temporary = path.with_extension(format!("{}.tmp", URL_SAFE_NO_PAD.encode(suffix)));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = options
        .open(&temporary)
        .and_then(|mut file| {
            file.write_all(contents.as_bytes())?;
            file.sync_all()
        })
        .and_then(|_| fs::rename(&temporary, path));
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}
