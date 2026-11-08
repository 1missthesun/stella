use serde_json::{json, Value};
use std::fs;
use std::io::{self, BufRead, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::Duration;

use super::bridge_auth;
use crate::connection::get_socket_dir;

const DEFAULT_SESSION: &str = "stella-app-bridge";
const DEFAULT_PORT: u16 = 39040;
const DAEMON_CONNECT_ATTEMPTS: u32 = 5;
const DAEMON_CONNECT_RETRY_DELAY: Duration = Duration::from_millis(400);
const DAEMON_CONNECT_TIMEOUT: Duration = Duration::from_millis(500);
const BRIDGE_IDLE_TICK: Duration = Duration::from_millis(500);
const DAEMON_AUTH_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_HANDSHAKE_LINE: u64 = 4096;
const UNVERIFIED_DAEMON: &str =
    "The process on the Stella browser bridge port could not prove it is Stella. Nothing was sent to it.";

fn read_bridge_token(session: &str) -> Option<String> {
    let token_path = get_socket_dir().join(format!("{}.ext-token", session));
    fs::read_to_string(&token_path)
        .ok()
        .map(|s| s.trim().to_string())
}

fn read_bridge_port(session: &str) -> u16 {
    let port_path = get_socket_dir().join(format!("{}.ext-port", session));
    fs::read_to_string(&port_path)
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(DEFAULT_PORT)
}

fn parent_pid() -> Option<u32> {
    #[cfg(unix)]
    {
        let pid = unsafe { libc::getppid() };
        if pid > 1 {
            return Some(pid as u32);
        }
    }
    None
}

fn process_command_line(pid: u32) -> Option<(String, Vec<String>)> {
    #[cfg(target_os = "linux")]
    {
        let exe = fs::read_link(format!("/proc/{}/exe", pid)).ok()?;
        let raw = fs::read(format!("/proc/{}/cmdline", pid)).ok()?;
        let args = raw
            .split(|b| *b == 0)
            .filter(|a| !a.is_empty())
            .map(|a| String::from_utf8_lossy(a).into_owned())
            .collect();
        return Some((exe.to_string_lossy().into_owned(), args));
    }
    #[cfg(all(unix, not(target_os = "linux")))]
    {
        let output = std::process::Command::new("ps")
            .args(["-p", &pid.to_string(), "-o", "command="])
            .output()
            .ok()?;
        let command = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if command.is_empty() {
            return None;
        }
        let exe = match command.find(" --") {
            Some(index) => command[..index].to_string(),
            None => command.clone(),
        };
        let args = command
            .split(" --")
            .skip(1)
            .map(|arg| format!("--{}", arg.trim()))
            .collect();
        return Some((exe, args));
    }
    #[allow(unreachable_code)]
    {
        let _ = pid;
        None
    }
}

fn client_identity() -> Value {
    let origin = std::env::args()
        .skip(1)
        .find(|a| a.starts_with("chrome-extension://"));
    let bundle_id = std::env::var("__CFBundleIdentifier").ok();
    let ppid = parent_pid();
    let (parent_exe, user_data_dir) = match ppid.and_then(process_command_line) {
        Some((exe, args)) => {
            let dir = args.iter().find_map(|arg| {
                arg.strip_prefix("--user-data-dir=")
                    .map(|v| v.trim().trim_matches('"').to_string())
            });
            (Some(exe), dir)
        }
        None => (None, None),
    };
    json!({
        "origin": origin,
        "bundleId": bundle_id,
        "parentPid": ppid,
        "parentExe": parent_exe,
        "userDataDir": user_data_dir,
    })
}

fn authenticated_hello(hello: &[u8], proof: &str) -> Option<Vec<u8>> {
    let mut value: Value = serde_json::from_slice(hello).ok()?;
    let obj = value.as_object_mut()?;
    if obj.get("type").and_then(Value::as_str) != Some("hello") {
        return None;
    }
    obj.remove("token");
    obj.insert("proof".to_string(), json!(proof));
    if !obj.contains_key("client") {
        obj.insert("client".to_string(), client_identity());
    }
    serde_json::to_vec(&value).ok()
}

/// Chrome allows up to 64 MiB for extension → host messages.
fn read_chrome_frame(stdin: &mut io::StdinLock) -> io::Result<Vec<u8>> {
    let mut len_buf = [0u8; 4];
    stdin.read_exact(&mut len_buf)?;
    let len = u32::from_le_bytes(len_buf) as usize;
    if len > 64 * 1024 * 1024 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "native message too large",
        ));
    }
    let mut buf = vec![0u8; len];
    stdin.read_exact(&mut buf)?;
    Ok(buf)
}

/// Chrome allows at most 1 MiB for host → extension messages.
fn write_chrome_frame(stdout: &mut io::StdoutLock, payload: &[u8]) -> io::Result<()> {
    if payload.len() > 1024 * 1024 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "host→extension message exceeds Chrome 1 MiB limit",
        ));
    }
    let len = payload.len() as u32;
    stdout.write_all(&len.to_le_bytes())?;
    stdout.write_all(payload)?;
    stdout.flush()
}

fn set_tcp_keepalive(stream: &TcpStream) {
    use socket2::SockRef;

    let sock = SockRef::from(stream);
    let _ = sock.set_keepalive(true);
    let _ = sock.set_tcp_keepalive(
        &socket2::TcpKeepalive::new()
            .with_time(Duration::from_secs(60))
            .with_interval(Duration::from_secs(10)),
    );
}

fn send_line(tcp: &mut TcpStream, line: &[u8]) -> bool {
    tcp.write_all(line)
        .and_then(|_| tcp.write_all(b"\n"))
        .and_then(|_| tcp.flush())
        .is_ok()
}

/// Proves the listener holds the bridge token before anything else crosses:
/// no token, extension hello or command is exchanged with an unproven peer.
fn authenticate_daemon(
    tcp: &mut TcpStream,
    reader: &mut io::BufReader<TcpStream>,
    session: &str,
    port: u16,
    hello: &[u8],
) -> Result<(), String> {
    let client_nonce = bridge_auth::new_nonce()?;
    let request = json!({ "type": bridge_auth::AUTH_REQUEST, "clientNonce": client_nonce });
    if !send_line(tcp, request.to_string().as_bytes()) {
        return Err("Stella browser bridge closed during handshake.".to_string());
    }

    tcp.set_read_timeout(Some(DAEMON_AUTH_TIMEOUT))
        .map_err(|e| e.to_string())?;
    let mut line = String::new();
    let read = reader
        .by_ref()
        .take(MAX_HANDSHAKE_LINE)
        .read_line(&mut line);
    tcp.set_read_timeout(None).map_err(|e| e.to_string())?;
    if !matches!(read, Ok(n) if n > 0 && line.ends_with('\n')) {
        return Err(UNVERIFIED_DAEMON.to_string());
    }
    let challenge: Value = serde_json::from_str(line.trim()).map_err(|_| UNVERIFIED_DAEMON)?;
    if challenge.get("type").and_then(Value::as_str) != Some(bridge_auth::AUTH_CHALLENGE) {
        return Err(UNVERIFIED_DAEMON.to_string());
    }
    let server_nonce = challenge
        .get("serverNonce")
        .and_then(Value::as_str)
        .filter(|nonce| bridge_auth::valid_nonce(nonce))
        .ok_or(UNVERIFIED_DAEMON)?;
    let server_proof = challenge
        .get("serverProof")
        .and_then(Value::as_str)
        .unwrap_or("");
    let token = read_bridge_token(session).unwrap_or_default();
    if !bridge_auth::verify_server_proof(&token, port, &client_nonce, server_nonce, server_proof) {
        return Err(UNVERIFIED_DAEMON.to_string());
    }

    let proof = bridge_auth::client_proof(&token, port, &client_nonce, server_nonce);
    let hello = authenticated_hello(hello, &proof)
        .ok_or_else(|| "The extension's first message was not a hello.".to_string())?;
    if !send_line(tcp, &hello) {
        return Err("Stella browser bridge closed during handshake.".to_string());
    }
    Ok(())
}

fn connect_to_daemon(session: &str) -> Option<(TcpStream, u16)> {
    let port = read_bridge_port(session);
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    for attempt in 0..DAEMON_CONNECT_ATTEMPTS {
        if let Ok(tcp) = TcpStream::connect_timeout(&addr, DAEMON_CONNECT_TIMEOUT) {
            return Some((tcp, port));
        }
        if attempt + 1 < DAEMON_CONNECT_ATTEMPTS {
            std::thread::sleep(DAEMON_CONNECT_RETRY_DELAY);
        }
    }
    None
}

fn bridge(tcp: TcpStream, mut reader: io::BufReader<TcpStream>, frame_rx: &Receiver<Vec<u8>>) {
    let mut tcp_write = tcp;

    let tcp_to_chrome = std::thread::spawn(move || {
        let stdout = io::stdout();
        let mut stdout = stdout.lock();
        let mut line = String::new();
        loop {
            line.clear();
            let n = match reader.read_line(&mut line) {
                Ok(n) => n,
                Err(_) => break,
            };
            if n == 0 {
                break;
            }
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Err(e) = write_chrome_frame(&mut stdout, trimmed.as_bytes()) {
                let _ = writeln!(
                    std::io::stderr(),
                    "native-host: dropping oversized message ({} bytes): {}",
                    trimmed.len(),
                    e
                );
                continue;
            }
        }
    });

    loop {
        if tcp_to_chrome.is_finished() {
            break;
        }
        match frame_rx.recv_timeout(BRIDGE_IDLE_TICK) {
            Ok(buf) => {
                if !send_line(&mut tcp_write, &buf) {
                    break;
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }

    let _ = tcp_write.shutdown(std::net::Shutdown::Both);
    let _ = tcp_to_chrome.join();
}

pub fn run_native_host() -> Result<(), String> {
    let session =
        std::env::var("STELLA_BROWSER_SESSION").unwrap_or_else(|_| DEFAULT_SESSION.to_string());

    let (frame_tx, frame_rx) = std::sync::mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        let stdin = io::stdin();
        let mut stdin = stdin.lock();
        loop {
            match read_chrome_frame(&mut stdin) {
                Ok(buf) => {
                    if frame_tx.send(buf).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    let hello = match frame_rx.recv() {
        Ok(buf) => buf,
        Err(_) => return Ok(()),
    };

    let (mut tcp, port) = match connect_to_daemon(&session) {
        Some(connected) => connected,
        None => return Err("Stella browser bridge is not running. Open Stella first.".to_string()),
    };

    set_tcp_keepalive(&tcp);

    let mut reader = io::BufReader::new(tcp.try_clone().map_err(|e| e.to_string())?);
    if let Err(error) = authenticate_daemon(&mut tcp, &mut reader, &session, port, &hello) {
        let _ = tcp.shutdown(std::net::Shutdown::Both);
        let notice = json!({ "type": "auth_error", "error": error }).to_string();
        let _ = write_chrome_frame(&mut io::stdout().lock(), notice.as_bytes());
        return Err(error);
    }

    bridge(tcp, reader, &frame_rx);
    Ok(())
}
