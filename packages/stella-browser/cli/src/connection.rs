use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

#[cfg(unix)]
use std::os::unix::net::UnixStream;

#[derive(Deserialize, Serialize, Default)]
pub struct Response {
    pub success: bool,
    pub data: Option<Value>,
    pub error: Option<String>,
    #[serde(rename = "outcomeUnknown", skip_serializing_if = "Option::is_none")]
    pub outcome_unknown: Option<bool>,
    #[serde(
        rename = "outcomeUnknownReason",
        skip_serializing_if = "Option::is_none"
    )]
    pub outcome_unknown_reason: Option<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[allow(dead_code)]
pub enum Connection {
    #[cfg(unix)]
    Unix(UnixStream),
    Tcp(TcpStream),
}

impl Read for Connection {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        match self {
            #[cfg(unix)]
            Connection::Unix(s) => s.read(buf),
            Connection::Tcp(s) => s.read(buf),
        }
    }
}

impl Write for Connection {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        match self {
            #[cfg(unix)]
            Connection::Unix(s) => s.write(buf),
            Connection::Tcp(s) => s.write(buf),
        }
    }

    fn flush(&mut self) -> std::io::Result<()> {
        match self {
            #[cfg(unix)]
            Connection::Unix(s) => s.flush(),
            Connection::Tcp(s) => s.flush(),
        }
    }
}

impl Connection {
    pub fn set_read_timeout(&self, dur: Option<Duration>) -> std::io::Result<()> {
        match self {
            #[cfg(unix)]
            Connection::Unix(s) => s.set_read_timeout(dur),
            Connection::Tcp(s) => s.set_read_timeout(dur),
        }
    }

    pub fn set_write_timeout(&self, dur: Option<Duration>) -> std::io::Result<()> {
        match self {
            #[cfg(unix)]
            Connection::Unix(s) => s.set_write_timeout(dur),
            Connection::Tcp(s) => s.set_write_timeout(dur),
        }
    }
}

pub fn get_socket_dir() -> PathBuf {
    if let Ok(dir) = env::var("STELLA_BROWSER_SOCKET_DIR") {
        if !dir.is_empty() {
            return PathBuf::from(dir);
        }
    }

    if let Ok(runtime_dir) = env::var("XDG_RUNTIME_DIR") {
        if !runtime_dir.is_empty() {
            return PathBuf::from(runtime_dir).join("stella-browser");
        }
    }

    if let Some(home) = dirs::home_dir() {
        return home.join(".stella-browser");
    }

    env::temp_dir().join("stella-browser")
}

#[cfg(unix)]
fn get_socket_path(session: &str) -> PathBuf {
    get_socket_dir().join(format!("{}.sock", session))
}

fn get_pid_path(session: &str) -> PathBuf {
    get_socket_dir().join(format!("{}.pid", session))
}

fn cleanup_stale_files(session: &str) {
    let pid_path = get_pid_path(session);
    let _ = fs::remove_file(&pid_path);

    #[cfg(unix)]
    {
        let socket_path = get_socket_path(session);
        let _ = fs::remove_file(&socket_path);
    }

    #[cfg(windows)]
    {
        let port_path = get_port_path(session);
        let _ = fs::remove_file(&port_path);
    }
}

#[cfg(windows)]
fn get_port_path(session: &str) -> PathBuf {
    get_socket_dir().join(format!("{}.port", session))
}

#[cfg(windows)]
fn get_port_for_session(session: &str) -> u16 {
    let mut hash: i32 = 0;
    for c in session.chars() {
        hash = ((hash << 5).wrapping_sub(hash)).wrapping_add(c as i32);
    }
    49152 + ((hash.unsigned_abs() as u32 % 16383) as u16)
}

#[cfg(unix)]
fn is_daemon_running(session: &str) -> bool {
    let pid_path = get_pid_path(session);
    if !pid_path.exists() {
        return false;
    }
    if let Ok(pid_str) = fs::read_to_string(&pid_path) {
        if let Ok(pid) = pid_str.trim().parse::<i32>() {
            unsafe {
                if libc::kill(pid, 0) == 0 {
                    return true;
                }
                // EPERM means the process exists but we lack permission to
                // signal it (e.g. inside a macOS sandbox). Only ESRCH means
                // the process is genuinely gone.
                return std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH);
            }
        }
    }
    false
}

#[cfg(windows)]
fn is_daemon_running(session: &str) -> bool {
    let pid_path = get_pid_path(session);
    if !pid_path.exists() {
        return false;
    }
    let port = get_port_for_session(session);
    TcpStream::connect_timeout(
        &format!("127.0.0.1:{}", port).parse().unwrap(),
        Duration::from_millis(100),
    )
    .is_ok()
}

fn daemon_ready(session: &str) -> bool {
    #[cfg(unix)]
    {
        let socket_path = get_socket_path(session);
        UnixStream::connect(&socket_path).is_ok()
    }
    #[cfg(windows)]
    {
        let port = get_port_for_session(session);
        TcpStream::connect_timeout(
            &format!("127.0.0.1:{}", port).parse().unwrap(),
            Duration::from_millis(50),
        )
        .is_ok()
    }
}

pub struct DaemonResult {
    pub already_running: bool,
}

fn configure_daemon_command(cmd: &mut Command, session: &str) {
    cmd.args(["service", "run", "--session", session]);
    // The daemon outlives this CLI process, so it must not inherit a parent
    // watch aimed at some other process.
    cmd.env_remove("STELLA_BROWSER_PARENT_PID");
}

pub fn ensure_daemon(session: &str) -> Result<DaemonResult, String> {
    if is_daemon_running(session) && daemon_ready(session) {
        return Ok(DaemonResult {
            already_running: true,
        });
    }

    cleanup_stale_files(session);

    let socket_dir = get_socket_dir();
    if !socket_dir.exists() {
        fs::create_dir_all(&socket_dir)
            .map_err(|e| format!("Failed to create socket directory: {}", e))?;
    }

    #[cfg(unix)]
    {
        let socket_path = get_socket_path(session);
        let path_len = socket_path.as_os_str().len();
        if path_len > 103 {
            return Err(format!(
                "Session name '{}' is too long. Socket path would be {} bytes (max 103).\n\
                 Use a shorter session name or set STELLA_BROWSER_SOCKET_DIR to a shorter path.",
                session, path_len
            ));
        }
    }

    {
        let test_file = socket_dir.join(".write_test");
        match fs::write(&test_file, b"") {
            Ok(_) => {
                let _ = fs::remove_file(&test_file);
            }
            Err(e) => {
                return Err(format!(
                    "Socket directory '{}' is not writable: {}",
                    socket_dir.display(),
                    e
                ));
            }
        }
    }

    let exe_path = env::current_exe().map_err(|e| e.to_string())?;
    let exe_path = exe_path.canonicalize().unwrap_or(exe_path);

    #[allow(unused_assignments)]
    let mut daemon_child: Option<std::process::Child> = None;

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;

        let mut cmd = Command::new(&exe_path);
        configure_daemon_command(&mut cmd, session);

        unsafe {
            cmd.pre_exec(|| {
                libc::setsid();
                Ok(())
            });
        }

        daemon_child = Some(
            cmd.stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| format!("Failed to start daemon: {}", e))?,
        );
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        let mut cmd = Command::new(&exe_path);
        configure_daemon_command(&mut cmd, session);

        const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
        const DETACHED_PROCESS: u32 = 0x00000008;

        daemon_child = Some(
            cmd.creation_flags(CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| format!("Failed to start daemon: {}", e))?,
        );
    }

    for _ in 0..50 {
        if daemon_ready(session) {
            return Ok(DaemonResult {
                already_running: false,
            });
        }

        if let Some(ref mut child) = daemon_child {
            if let Ok(Some(_)) = child.try_wait() {
                let mut stderr_output = String::new();
                if let Some(mut stderr) = child.stderr.take() {
                    let _ = stderr.read_to_string(&mut stderr_output);
                }
                let stderr_trimmed = stderr_output.trim();
                if !stderr_trimmed.is_empty() {
                    let msg = if stderr_trimmed.len() > 500 {
                        let mut end = 500;
                        while !stderr_trimmed.is_char_boundary(end) {
                            end -= 1;
                        }
                        &stderr_trimmed[..end]
                    } else {
                        stderr_trimmed
                    };
                    return Err(format!("Daemon process exited during startup:\n{}", msg));
                }
                return Err(
                    "Daemon process exited during startup with no error output. \
                     Re-run with --debug for more details."
                        .to_string(),
                );
            }
        }

        thread::sleep(Duration::from_millis(100));
    }

    #[cfg(unix)]
    let endpoint_info = format!(
        "socket: {}",
        get_socket_dir().join(format!("{}.sock", session)).display()
    );
    #[cfg(windows)]
    let endpoint_info = format!("port: 127.0.0.1:{}", get_port_for_session(session));

    Err(format!("Daemon failed to start ({})", endpoint_info))
}

fn connect(session: &str) -> std::io::Result<Connection> {
    #[cfg(unix)]
    {
        UnixStream::connect(get_socket_path(session)).map(Connection::Unix)
    }
    #[cfg(windows)]
    {
        TcpStream::connect(format!("127.0.0.1:{}", get_port_for_session(session)))
            .map(Connection::Tcp)
    }
}

enum SendError {
    Connect(std::io::Error),
    Encode(serde_json::Error),
    Send(std::io::Error),
    Read(std::io::Error),
    Decode(serde_json::Error),
}

impl SendError {
    fn is_transient(&self) -> bool {
        use std::io::ErrorKind;
        match self {
            SendError::Connect(error) | SendError::Send(error) | SendError::Read(error) => {
                matches!(
                    error.kind(),
                    ErrorKind::WouldBlock
                        | ErrorKind::UnexpectedEof
                        | ErrorKind::ConnectionReset
                        | ErrorKind::ConnectionRefused
                        | ErrorKind::BrokenPipe
                        | ErrorKind::NotFound
                )
            }
            SendError::Decode(error) => error.is_eof(),
            SendError::Encode(_) => false,
        }
    }
}

impl std::fmt::Display for SendError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SendError::Connect(error) => write!(f, "Failed to connect: {}", error),
            SendError::Encode(error) => write!(f, "{}", error),
            SendError::Send(error) => write!(f, "Failed to send: {}", error),
            SendError::Read(error) => write!(f, "Failed to read: {}", error),
            SendError::Decode(error) => write!(f, "Invalid response: {}", error),
        }
    }
}

pub fn send_command(cmd: Value, session: &str) -> Result<Response, String> {
    send_command_with_timeout(cmd, session, Duration::from_secs(30))
}

pub fn send_command_with_timeout(
    cmd: Value,
    session: &str,
    timeout: Duration,
) -> Result<Response, String> {
    const MAX_RETRIES: u32 = 5;
    const RETRY_DELAY_MS: u64 = 200;

    let mut last_error = String::new();

    for attempt in 0..MAX_RETRIES {
        if attempt > 0 {
            thread::sleep(Duration::from_millis(RETRY_DELAY_MS * (attempt as u64)));
        }

        match send_command_once(&cmd, session, timeout) {
            Ok(response) => return Ok(response),
            Err(error) if error.is_transient() => {
                last_error = error.to_string();
            }
            Err(error) => return Err(error.to_string()),
        }
    }

    Err(format!(
        "{} (after {} retries - daemon may be busy or unresponsive)",
        last_error, MAX_RETRIES
    ))
}

fn send_command_once(cmd: &Value, session: &str, timeout: Duration) -> Result<Response, SendError> {
    let mut stream = connect(session).map_err(SendError::Connect)?;

    stream.set_read_timeout(Some(timeout)).ok();
    stream.set_write_timeout(Some(Duration::from_secs(5))).ok();

    let mut json_str = serde_json::to_string(cmd).map_err(SendError::Encode)?;
    json_str.push('\n');

    stream
        .write_all(json_str.as_bytes())
        .map_err(SendError::Send)?;

    let mut reader = BufReader::new(stream);
    let mut response_line = String::new();
    reader
        .read_line(&mut response_line)
        .map_err(SendError::Read)?;

    serde_json::from_str(&response_line).map_err(SendError::Decode)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::EnvGuard;

    #[test]
    fn test_response_preserves_failure_receipt_and_unknown_outcome_metadata() {
        let response: Response = serde_json::from_value(serde_json::json!({
            "id": "daemon-response-id",
            "success": false,
            "error": "Browser chain timed out",
            "data": {
                "results": [{
                    "index": 0,
                    "action": "click",
                    "success": false,
                    "outcomeUnknown": true
                }]
            },
            "outcomeUnknown": true,
            "outcomeUnknownReason": "The dispatched click may still complete",
            "deadline": { "timeoutMs": 25 }
        }))
        .expect("response should deserialize");

        assert!(!response.success);
        assert_eq!(
            response.data.as_ref().unwrap()["results"][0]["action"],
            "click"
        );
        assert_eq!(response.outcome_unknown, Some(true));
        assert_eq!(
            response.outcome_unknown_reason.as_deref(),
            Some("The dispatched click may still complete")
        );
        assert_eq!(response.extra["id"], "daemon-response-id");
        assert_eq!(response.extra["deadline"]["timeoutMs"], 25);
    }

    #[test]
    fn test_get_socket_dir_explicit_override() {
        let _guard = EnvGuard::new(&["STELLA_BROWSER_SOCKET_DIR", "XDG_RUNTIME_DIR"]);

        _guard.set("STELLA_BROWSER_SOCKET_DIR", "/custom/socket/path");
        _guard.remove("XDG_RUNTIME_DIR");

        assert_eq!(get_socket_dir(), PathBuf::from("/custom/socket/path"));
    }

    #[test]
    fn test_get_socket_dir_ignores_empty_socket_dir() {
        let _guard = EnvGuard::new(&["STELLA_BROWSER_SOCKET_DIR", "XDG_RUNTIME_DIR"]);

        _guard.set("STELLA_BROWSER_SOCKET_DIR", "");
        _guard.remove("XDG_RUNTIME_DIR");

        assert!(get_socket_dir()
            .to_string_lossy()
            .ends_with(".stella-browser"));
    }

    #[test]
    fn test_get_socket_dir_xdg_runtime() {
        let _guard = EnvGuard::new(&["STELLA_BROWSER_SOCKET_DIR", "XDG_RUNTIME_DIR"]);

        _guard.remove("STELLA_BROWSER_SOCKET_DIR");
        _guard.set("XDG_RUNTIME_DIR", "/run/user/1000");

        assert_eq!(
            get_socket_dir(),
            PathBuf::from("/run/user/1000/stella-browser")
        );
    }

    #[test]
    fn test_get_socket_dir_ignores_empty_xdg_runtime() {
        let _guard = EnvGuard::new(&["STELLA_BROWSER_SOCKET_DIR", "XDG_RUNTIME_DIR"]);

        _guard.set("STELLA_BROWSER_SOCKET_DIR", "");
        _guard.set("XDG_RUNTIME_DIR", "");

        assert!(get_socket_dir()
            .to_string_lossy()
            .ends_with(".stella-browser"));
    }

    #[test]
    fn test_get_socket_dir_home_fallback() {
        let _guard = EnvGuard::new(&["STELLA_BROWSER_SOCKET_DIR", "XDG_RUNTIME_DIR"]);

        _guard.remove("STELLA_BROWSER_SOCKET_DIR");
        _guard.remove("XDG_RUNTIME_DIR");

        let result = get_socket_dir();
        assert!(result.to_string_lossy().ends_with(".stella-browser"));
        assert!(
            result.to_string_lossy().contains("home") || result.to_string_lossy().contains("Users")
        );
    }

    #[test]
    #[cfg(windows)]
    fn test_get_port_for_session() {
        assert_eq!(get_port_for_session("default"), 50838);
        assert_eq!(get_port_for_session("my-session"), 63105);
        assert_eq!(get_port_for_session("work"), 51184);
        assert_eq!(get_port_for_session(""), 49152);
    }
}
