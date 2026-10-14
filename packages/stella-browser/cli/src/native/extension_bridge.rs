use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet};

use super::extension_clients::{
    find_profile_with_marker, probe_marker, read_profile_identity, ActivityRanker, ClientInfo,
};
use std::env;
use std::fs;
use std::io::Write as IoWrite;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, mpsc, oneshot, Mutex, Notify};
use uuid::Uuid;

const DEFAULT_EXT_PORT: u16 = 39040;

const DEFAULT_COMMAND_TIMEOUT_MS: u64 = 60_000;
const CHAIN_COMMAND_TIMEOUT_MS: u64 = 5 * 60_000;

const DEFAULT_WAIT_TIMEOUT_MS: u64 = 60_000;

const HEALTH_CHECK_TTL_MS: u64 = 5_000;

const DISCONNECT_SHUTDOWN_MS: u64 = 30_000;

const RECONNECT_WAIT_MS: u64 = 10_000;

const DEAD_AFTER_MISSED_HEALTH_CHECKS: u32 = 2;

const RETIRED_CONNECTION_POLL_MS: u64 = 500;
const EXTENSION_PROTOCOL_VERSION: &str = "2.1";
const MIN_EXTENSION_VERSION: (u64, u64, u64) = (1, 2, 12);

fn parse_extension_version(value: &str) -> Option<(u64, u64, u64)> {
    let mut parts = value.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()?.split('-').next()?.parse().ok()?;
    Some((major, minor, patch))
}

fn validate_extension_hello(parsed: &Value) -> Result<String, String> {
    let extension_version = parsed
        .get("extensionVersion")
        .or_else(|| parsed.get("version"))
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let protocol_version = parsed
        .get("protocolVersion")
        .and_then(Value::as_str)
        .unwrap_or("missing");

    if protocol_version != EXTENSION_PROTOCOL_VERSION {
        return Err(format!(
            "Stella Browser extension protocol mismatch: extension {} advertises protocol {}, but this Stella runtime requires protocol {} and extension 1.2.12 or newer. Update the Stella Browser extension.",
            extension_version, protocol_version, EXTENSION_PROTOCOL_VERSION
        ));
    }
    let parsed_version = parse_extension_version(extension_version).ok_or_else(|| {
        format!(
            "Stella Browser extension reported invalid version '{}'. Update the Stella Browser extension to 1.2.12 or newer.",
            extension_version
        )
    })?;
    if parsed_version < MIN_EXTENSION_VERSION {
        return Err(format!(
            "Stella Browser extension {} is too old; this Stella runtime requires 1.2.12 or newer. Update the Stella Browser extension.",
            extension_version
        ));
    }
    Ok(extension_version.to_string())
}

struct PendingCommand {
    tx: oneshot::Sender<Value>,
    generation: u64,
}

struct Connection {
    cmd_tx: mpsc::Sender<String>,
    info: ClientInfo,
    connected_at_ms: u64,
    last_health_check: Instant,
    missed_health_checks: u32,
}

struct BridgeInner {
    connections: BTreeMap<u64, Connection>,
    last_connection_error: Option<String>,
    next_generation: u64,
    pending: HashMap<String, PendingCommand>,
    owner_routes: HashMap<String, String>,
    known_labels: HashMap<String, String>,
    preferred_key: Option<String>,
    disabled_keys: HashSet<String>,
}

impl BridgeInner {
    fn enabled(&self, connection: &Connection) -> bool {
        !self.disabled_keys.contains(&connection.info.key())
    }

    fn has_enabled_connection(&self) -> bool {
        self.connections.values().any(|c| self.enabled(c))
    }

    fn newest_with_key(&self, key: &str) -> Option<u64> {
        self.connections
            .iter()
            .rev()
            .find(|(_, c)| c.info.key() == key && self.enabled(c))
            .map(|(generation, _)| *generation)
    }

    fn labels(&self) -> String {
        let labels: Vec<String> = self
            .connections
            .iter()
            .map(|(generation, c)| {
                let off = if self.enabled(c) { "" } else { ", turned off" };
                format!("\"{}\" (id {}{})", c.info.label(), generation, off)
            })
            .collect();
        labels.join(", ")
    }
}

const EVENT_BROADCAST_CAPACITY: usize = 256;
const DIALOG_GUARD: &str = "(() => { const w = window; const native = (f) => typeof f === 'function' && /\\[native code\\]/.test(Function.prototype.toString.call(f)); if (!Array.isArray(w.__stellaDialogs)) w.__stellaDialogs = []; const rec = (type, message, result) => { w.__stellaDialogs.push({ type, message: String(message ?? '').slice(0, 300), answer: result === undefined ? 'ok' : result }); return result; }; if (native(w.alert)) w.alert = function (m) { rec('alert', m, undefined); }; if (native(w.confirm)) w.confirm = function (m) { return rec('confirm', m, false); }; if (native(w.prompt)) w.prompt = function (m) { return rec('prompt', m, null); }; return w.__stellaDialogs.splice(0); })()";
const DISARM_BEFOREUNLOAD: &str = "(() => { try { window.onbeforeunload = null; } catch (e) {} try { Object.defineProperty(window, 'onbeforeunload', { configurable: true, get() { return null; }, set() {} }); } catch (e) {} try { const proto = BeforeUnloadEvent.prototype; Object.defineProperty(proto, 'returnValue', { configurable: true, get() { return ''; }, set() {} }); Object.defineProperty(proto, 'preventDefault', { configurable: true, value() {} }); } catch (e) {} return true; })()";
const LIFECYCLE_ACTIONS: [&str; 4] = [
    "finalize_tabs",
    "close_owner",
    "release_owner_lease",
    "close",
];

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Clone)]
pub struct ExtensionBridge {
    port: u16,
    token: String,
    inner: Arc<Mutex<BridgeInner>>,
    connected_notify: Arc<Notify>,
    shutdown_tx: Option<mpsc::Sender<()>>,
    events_tx: broadcast::Sender<String>,
}

impl ExtensionBridge {
    pub fn new(port: Option<u16>, token: Option<String>) -> Self {
        let port = port.unwrap_or_else(|| {
            env::var("STELLA_BROWSER_EXT_PORT")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(DEFAULT_EXT_PORT)
        });

        let token = match token {
            Some(t) => t.trim().to_string(),
            None => env::var("STELLA_BROWSER_EXT_TOKEN")
                .ok()
                .map(|t| t.trim().to_string())
                .unwrap_or_else(|| Uuid::new_v4().to_string()),
        };

        Self {
            port,
            token,
            inner: Arc::new(Mutex::new(BridgeInner {
                connections: BTreeMap::new(),
                last_connection_error: None,
                next_generation: 0,
                pending: HashMap::new(),
                owner_routes: HashMap::new(),
                known_labels: HashMap::new(),
                preferred_key: None,
                disabled_keys: HashSet::new(),
            })),
            connected_notify: Arc::new(Notify::new()),
            shutdown_tx: None,
            events_tx: broadcast::channel(EVENT_BROADCAST_CAPACITY).0,
        }
    }

    pub fn subscribe_events(&self) -> broadcast::Receiver<String> {
        self.events_tx.subscribe()
    }

    pub async fn start(&mut self, session: &str) -> Result<mpsc::Receiver<()>, String> {
        let socket_dir = get_socket_dir();
        if !socket_dir.exists() {
            let _ = fs::create_dir_all(&socket_dir);
        }

        let token_file = socket_dir.join(format!("{}.ext-token", session));
        let port_file = socket_dir.join(format!("{}.ext-port", session));

        fs::write(&token_file, &self.token)
            .map_err(|e| format!("Failed to write token file: {}", e))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&token_file, fs::Permissions::from_mode(0o600));
        }

        fs::write(&port_file, self.port.to_string())
            .map_err(|e| format!("Failed to write port file: {}", e))?;

        let listener = match bind_reuse(self.port) {
            Ok(l) => l,
            Err(_) => {
                kill_stale_stella_browser_on_port(self.port);
                let mut bound = None;
                for _ in 0..20 {
                    tokio::time::sleep(Duration::from_millis(250)).await;
                    match bind_reuse(self.port) {
                        Ok(l) => {
                            bound = Some(l);
                            break;
                        }
                        Err(_) => continue,
                    }
                }
                bound.ok_or_else(|| {
                    format!(
                        "Failed to bind extension bridge on port {}: it is held by another process",
                        self.port
                    )
                })?
            }
        };

        let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);
        let (disconnect_shutdown_tx, disconnect_shutdown_rx) = mpsc::channel::<()>(1);
        self.shutdown_tx = Some(shutdown_tx);

        let inner = self.inner.clone();
        let connected_notify = self.connected_notify.clone();
        let token = self.token.clone();
        let session_str = session.to_string();
        let events_tx = self.events_tx.clone();

        tokio::spawn(async move {
            loop {
                tokio::select! {
                    accept = listener.accept() => {
                        match accept {
                            Ok((stream, addr)) => {
                                if !is_local_socket(addr) {
                                    let _ = writeln!(std::io::stderr(), "Extension bridge: rejected non-local connection ({})", addr);
                                    continue;
                                }

                                let inner = inner.clone();
                                let notify = connected_notify.clone();
                                let token = token.clone();
                                let session = session_str.clone();
                                let disconnect_tx = disconnect_shutdown_tx.clone();
                                let events = events_tx.clone();

                                tokio::spawn(async move {
                                    handle_extension_connection(
                                        stream,
                                        inner,
                                        notify,
                                        token,
                                        session,
                                        disconnect_tx,
                                        events,
                                    ).await;
                                });
                            }
                            Err(e) => {
                                let _ = writeln!(std::io::stderr(), "Extension bridge accept error: {}", e);
                            }
                        }
                    }
                    _ = shutdown_rx.recv() => {
                        break;
                    }
                }
            }

            let _ = fs::remove_file(&token_file);
            let _ = fs::remove_file(&port_file);
        });

        Ok(disconnect_shutdown_rx)
    }

    pub async fn wait_for_connection(&self) -> bool {
        let deadline = tokio::time::Instant::now() + Duration::from_millis(DEFAULT_WAIT_TIMEOUT_MS);
        loop {
            let notified = self.connected_notify.notified();
            {
                let guard = self.inner.lock().await;
                if guard.has_enabled_connection() {
                    return true;
                }
                if !guard.connections.is_empty() {
                    return false;
                }
            }
            tokio::select! {
                _ = notified => {},
                _ = tokio::time::sleep_until(deadline) => {
                    return self.inner.lock().await.has_enabled_connection();
                }
            }
        }
    }

    pub async fn is_connected(&self) -> bool {
        self.inner.lock().await.has_enabled_connection()
    }

    pub async fn verified_connection_generation(&self) -> Option<u64> {
        for _ in 0..4 {
            let generation = self.select_generation(None, None, false).await.ok()?;
            if self.check_health(generation).await {
                return Some(generation);
            }
            if self
                .inner
                .lock()
                .await
                .connections
                .contains_key(&generation)
            {
                return Some(generation);
            }
        }
        None
    }

    pub async fn force_reconnect(&self) -> bool {
        let generations: Vec<u64> = self
            .inner
            .lock()
            .await
            .connections
            .keys()
            .copied()
            .collect();
        let mut retired = false;
        for generation in generations {
            retired |= deactivate_connection(&self.inner, generation).await;
        }
        retired
    }

    pub async fn set_routing(&self, preferred_key: Option<String>, disabled_keys: Vec<String>) {
        let mut guard = self.inner.lock().await;
        guard.preferred_key = preferred_key.filter(|key| !key.trim().is_empty());
        guard.disabled_keys = disabled_keys.into_iter().collect();
        let disabled = guard.disabled_keys.clone();
        guard.owner_routes.retain(|_, key| !disabled.contains(key));
        drop(guard);
        self.connected_notify.notify_waiters();
    }

    pub async fn status(&self) -> Value {
        self.status_for(None).await
    }

    pub async fn status_for(&self, owner: Option<&str>) -> Value {
        let in_use = self.select_generation(None, None, false).await.ok();
        let guard = self.inner.lock().await;
        let owner_key = owner
            .and_then(|owner| guard.owner_routes.get(owner))
            .cloned();
        let clients: Vec<Value> = guard
            .connections
            .iter()
            .map(|(generation, connection)| {
                let mut client = connection.info.to_json();
                if let Some(object) = client.as_object_mut() {
                    object.insert("id".to_string(), json!(generation.to_string()));
                    object.insert(
                        "connectedAtMs".to_string(),
                        json!(connection.connected_at_ms),
                    );
                    object.insert("enabled".to_string(), json!(guard.enabled(connection)));
                    object.insert("inUse".to_string(), json!(in_use == Some(*generation)));
                    if owner.is_some() {
                        object.insert(
                            "current".to_string(),
                            json!(owner_key.as_deref() == Some(connection.info.key().as_str())),
                        );
                    }
                }
                client
            })
            .collect();
        let mut disabled: Vec<&String> = guard.disabled_keys.iter().collect();
        disabled.sort();
        json!({
            "connected": in_use.is_some(),
            "authorized": in_use.is_some(),
            "connectionGeneration": in_use,
            "preferredKey": guard.preferred_key,
            "disabledKeys": disabled,
            "clients": clients,
        })
    }

    async fn select_generation(
        &self,
        owner: Option<&str>,
        target: Option<&str>,
        remember: bool,
    ) -> Result<u64, String> {
        let (candidates, preferred) = {
            let guard = self.inner.lock().await;
            if let Some(target) = target.map(str::trim).filter(|t| !t.is_empty()) {
                let needle = target.to_lowercase();
                let found = guard
                    .connections
                    .iter()
                    .rev()
                    .find(|(generation, c)| {
                        generation.to_string() == target || c.info.key() == target
                    })
                    .or_else(|| {
                        guard
                            .connections
                            .iter()
                            .rev()
                            .find(|(_, c)| c.info.label().to_lowercase().contains(&needle))
                    });
                return match found {
                    Some((_, c)) if !guard.enabled(c) => Err(format!(
                        "The browser \"{}\" is turned off in Stella's Settings (Browser extension). Use another browser or ask the user to turn it back on.",
                        c.info.label()
                    )),
                    Some((generation, _)) => {
                        let generation = *generation;
                        drop(guard);
                        if remember {
                            self.remember_route(owner, generation).await;
                        }
                        Ok(generation)
                    }
                    None if guard.connections.is_empty() => Err(not_connected_error(&guard)),
                    None => Err(format!(
                        "No connected browser matches \"{}\". Connected browsers: {}. Use one of these with browser.use(\"external\", {{ browser: \"<label>\" }}).",
                        target,
                        guard.labels()
                    )),
                };
            }
            if let Some(key) = owner.and_then(|owner| guard.owner_routes.get(owner)) {
                if let Some(generation) = guard.newest_with_key(key) {
                    return Ok(generation);
                }
            }
            if let Some(key) = guard.preferred_key.clone() {
                if let Some(generation) = guard.newest_with_key(&key) {
                    drop(guard);
                    if remember {
                        self.remember_route(owner, generation).await;
                    }
                    return Ok(generation);
                }
            }
            let candidates: Vec<(u64, ClientInfo, u64)> = guard
                .connections
                .iter()
                .filter(|(_, c)| guard.enabled(c))
                .map(|(generation, c)| (*generation, c.info.clone(), c.connected_at_ms))
                .collect();
            if candidates.is_empty() {
                return Err(if guard.connections.is_empty() {
                    not_connected_error(&guard)
                } else {
                    format!(
                        "The Stella Browser extension is connected only in browsers turned off in Stella's Settings (Browser extension): {}. Ask the user to turn one on, or use Stella's own browser with browser.use(\"in-app\").",
                        guard.labels()
                    )
                });
            }
            (candidates, guard.preferred_key.clone())
        };
        let _ = preferred;
        let generation = if candidates.len() == 1 {
            candidates[0].0
        } else {
            tokio::task::spawn_blocking(move || {
                let mut ranker = ActivityRanker::new();
                let mut ranked: Vec<((usize, usize, std::cmp::Reverse<u64>), u64)> = candidates
                    .iter()
                    .map(|(generation, info, connected_at)| {
                        let (app, profile) = ranker.rank(info);
                        (
                            (app, profile, std::cmp::Reverse(*connected_at)),
                            *generation,
                        )
                    })
                    .collect();
                ranked.sort();
                ranked[0].1
            })
            .await
            .map_err(|e| format!("Failed to choose a browser: {}", e))?
        };
        if remember {
            self.remember_route(owner, generation).await;
        }
        Ok(generation)
    }

    async fn wait_for_owner_browser(&self, owner: &str) -> Result<(), String> {
        let start = Instant::now();
        loop {
            let missing = {
                let guard = self.inner.lock().await;
                match guard.owner_routes.get(owner) {
                    Some(key) if guard.newest_with_key(key).is_none() => Some(key.clone()),
                    _ => None,
                }
            };
            let Some(key) = missing else {
                return Ok(());
            };
            if start.elapsed() >= Duration::from_millis(RECONNECT_WAIT_MS) {
                let guard = self.inner.lock().await;
                let disabled = guard.disabled_keys.contains(&key);
                let name = guard
                    .known_labels
                    .get(&key)
                    .cloned()
                    .unwrap_or_else(|| key.trim_start_matches("browser:").to_string());
                return Err(if disabled {
                    format!(
                        "This task's tabs are in {}, which the user turned off in Stella's Settings. Nothing was sent. Open a new tab with browser.tabs.new() to continue in another browser.",
                        name
                    )
                } else {
                    format!(
                        "This task's tabs are in {}, whose Stella Browser extension disconnected and did not come back within {}s (the browser may have quit). Nothing was sent. Open a new tab with browser.tabs.new() to continue in another connected browser, or browser.use(\"in-app\") for Stella's own.",
                        name,
                        RECONNECT_WAIT_MS / 1000
                    )
                });
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    }

    async fn remember_route(&self, owner: Option<&str>, generation: u64) {
        let Some(owner) = owner.filter(|o| !o.is_empty()) else {
            return;
        };
        let mut guard = self.inner.lock().await;
        if let Some(connection) = guard.connections.get(&generation) {
            let key = connection.info.key();
            let label = connection.info.label();
            guard.known_labels.insert(key.clone(), label);
            guard.owner_routes.insert(owner.to_string(), key);
        }
    }

    async fn check_health(&self, generation: u64) -> bool {
        let stale = {
            let guard = self.inner.lock().await;
            match guard.connections.get(&generation) {
                Some(c) => {
                    c.last_health_check.elapsed() > Duration::from_millis(HEALTH_CHECK_TTL_MS)
                }
                None => return false,
            }
        };
        if !stale {
            return true;
        }
        let alive = send_to_generation(
            &self.inner,
            generation,
            json!({ "action": "healthcheck", "id": format!("_hc_{}", Uuid::new_v4().simple()) }),
            Duration::from_secs(3),
        )
        .await
        .is_ok_and(|response| response.get("success").and_then(Value::as_bool) == Some(true));
        let mut guard = self.inner.lock().await;
        let Some(connection) = guard.connections.get_mut(&generation) else {
            return false;
        };
        if alive {
            connection.last_health_check = Instant::now();
            connection.missed_health_checks = 0;
            return true;
        }
        connection.missed_health_checks += 1;
        if connection.missed_health_checks < DEAD_AFTER_MISSED_HEALTH_CHECKS {
            return false;
        }
        drop(guard);
        deactivate_connection(&self.inner, generation).await;
        false
    }

    pub async fn execute_command(&self, command: &Value) -> Result<Value, String> {
        {
            let has_any = !self.inner.lock().await.connections.is_empty();
            if !has_any && !self.wait_for_connection().await {
                let guard = self.inner.lock().await;
                return Err(guard
                    .last_connection_error
                    .clone()
                    .unwrap_or_else(|| not_connected_error(&guard)));
            }
        }

        let action = command.get("action").and_then(Value::as_str).unwrap_or("");
        let owner = command.get("ownerId").and_then(Value::as_str);
        let target = command.get("browserTarget").and_then(Value::as_str);

        let mut forwarded = command.clone();
        if let Some(object) = forwarded.as_object_mut() {
            object.remove("browserTarget");
            object.remove("type");
        }

        if LIFECYCLE_ACTIONS.contains(&action) && target.is_none() {
            let routed = match owner {
                Some(owner) => {
                    let guard = self.inner.lock().await;
                    guard
                        .owner_routes
                        .get(owner)
                        .and_then(|key| guard.newest_with_key(key))
                }
                None => None,
            };
            if routed.is_none() {
                return self.broadcast(&forwarded).await;
            }
        }

        if target.is_none() {
            if let Some(owner) = owner {
                if let Err(error) = self.wait_for_owner_browser(owner).await {
                    if action != "tab_new" {
                        return Err(error);
                    }
                    self.inner.lock().await.owner_routes.remove(owner);
                }
            }
        }
        let mut generation = self.select_generation(owner, target, true).await?;
        if !self.check_health(generation).await {
            let key = self
                .inner
                .lock()
                .await
                .connections
                .get(&generation)
                .map(|c| (c.info.key(), c.info.label()));
            let start = Instant::now();
            let mut recovered = None;
            while start.elapsed() < Duration::from_millis(RECONNECT_WAIT_MS) {
                if let Ok(next) = self.select_generation(owner, target, true).await {
                    if self.check_health(next).await {
                        recovered = Some(next);
                        break;
                    }
                }
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
            generation = recovered.ok_or_else(|| {
                format!(
                    "The Stella Browser extension{} stopped responding (its background worker was suspended or the browser is busy) and did not reconnect within {}s. Nothing was sent. Retry once; if it fails again, ask the user to click the Stella Browser extension icon to wake it, or continue in Stella's own browser with browser.use(\"in-app\").",
                    key.map(|(_, label)| format!(" in {}", label)).unwrap_or_default(),
                    RECONNECT_WAIT_MS / 1000
                )
            })?;
        }

        let leaves_page = |name: &str| {
            matches!(
                name,
                "navigate" | "back" | "forward" | "reload" | "tab_close"
            )
        };
        let chain_leaves_page = action == "chain"
            && forwarded
                .get("steps")
                .and_then(Value::as_array)
                .is_some_and(|steps| {
                    steps.iter().any(|step| {
                        step.get("action")
                            .and_then(Value::as_str)
                            .is_some_and(leaves_page)
                    })
                });
        if leaves_page(action) || chain_leaves_page {
            let _ = self
                .run_page_script(generation, &forwarded, "unload", DISARM_BEFOREUNLOAD, 1500)
                .await;
        }

        let interaction = |name: &str| {
            matches!(
                name,
                "click"
                    | "dblclick"
                    | "press"
                    | "keydown"
                    | "keyup"
                    | "mouseup"
                    | "check"
                    | "uncheck"
                    | "select"
                    | "tap"
            )
        };
        let chain_interacts = action == "chain"
            && forwarded
                .get("steps")
                .and_then(Value::as_array)
                .is_some_and(|steps| {
                    steps.iter().any(|step| {
                        step.get("action")
                            .and_then(Value::as_str)
                            .is_some_and(interaction)
                    })
                });
        let guard_dialogs = interaction(action) || chain_interacts;
        if guard_dialogs {
            let _ = self
                .run_page_script(generation, &forwarded, "guard", DIALOG_GUARD, 1500)
                .await;
        }

        let timeout_ms = if action == "chain" {
            CHAIN_COMMAND_TIMEOUT_MS
        } else {
            DEFAULT_COMMAND_TIMEOUT_MS
        };
        let mut response = send_to_generation(
            &self.inner,
            generation,
            forwarded.clone(),
            Duration::from_millis(timeout_ms),
        )
        .await?;
        if guard_dialogs {
            if let Some(Value::Array(dialogs)) = self
                .run_page_script(generation, &forwarded, "dialogs", DIALOG_GUARD, 1500)
                .await
                .and_then(|r| r.pointer("/data/result").cloned())
            {
                if !dialogs.is_empty() {
                    if let Some(object) = response.as_object_mut() {
                        let data = object
                            .entry("data".to_string())
                            .or_insert_with(|| json!({}));
                        if let Some(data) = data.as_object_mut() {
                            data.insert("dialogs".to_string(), Value::Array(dialogs));
                        } else {
                            object.insert("dialogs".to_string(), Value::Array(dialogs));
                        }
                    }
                }
            }
        }
        Ok(response)
    }

    async fn run_page_script(
        &self,
        generation: u64,
        base: &Value,
        suffix: &str,
        script: &str,
        timeout_ms: u64,
    ) -> Option<Value> {
        let mut command = base.clone();
        let object = command.as_object_mut()?;
        for field in [
            "url",
            "waitUntil",
            "timeout",
            "index",
            "steps",
            "selector",
            "key",
            "value",
            "values",
            "text",
        ] {
            object.remove(field);
        }
        let id = object
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        object.insert("id".to_string(), json!(format!("{}#{}", id, suffix)));
        object.insert("action".to_string(), json!("evaluate"));
        object.insert("expression".to_string(), json!(script));
        object.insert("timeout".to_string(), json!(timeout_ms));
        send_to_generation(
            &self.inner,
            generation,
            command,
            Duration::from_millis(timeout_ms + 1000),
        )
        .await
        .ok()
        .filter(|r| r.get("success").and_then(Value::as_bool) == Some(true))
    }

    async fn broadcast(&self, command: &Value) -> Result<Value, String> {
        let generations: Vec<u64> = {
            let guard = self.inner.lock().await;
            guard.connections.keys().copied().collect()
        };
        let id = command
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let mut first_ok = None;
        let mut first_err = None;
        for (index, generation) in generations.iter().enumerate() {
            let mut each = command.clone();
            if index > 0 {
                if let Some(object) = each.as_object_mut() {
                    object.insert("id".to_string(), json!(format!("{}#{}", id, index)));
                }
            }
            match send_to_generation(&self.inner, *generation, each, Duration::from_secs(10)).await
            {
                Ok(mut response) => {
                    if let Some(object) = response.as_object_mut() {
                        object.insert("id".to_string(), json!(id));
                    }
                    if response.get("success").and_then(Value::as_bool) == Some(true) {
                        first_ok.get_or_insert(response);
                    } else {
                        first_err.get_or_insert(Ok(response));
                    }
                }
                Err(error) => {
                    first_err.get_or_insert(Err(error));
                }
            }
        }
        match (first_ok, first_err) {
            (Some(ok), _) => Ok(ok),
            (None, Some(err)) => err,
            (None, None) => Ok(json!({ "id": id, "success": true, "data": {} })),
        }
    }

    pub async fn stop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(()).await;
        }

        let mut guard = self.inner.lock().await;
        guard.last_connection_error = None;
        guard.connections.clear();
        guard.pending.clear();
        guard.owner_routes.clear();
    }

    pub fn get_port(&self) -> u16 {
        self.port
    }

    pub fn get_token(&self) -> &str {
        &self.token
    }
}

fn not_connected_error(guard: &BridgeInner) -> String {
    guard.last_connection_error.clone().unwrap_or_else(|| {
        "Extension not connected. Install the Stella Browser Bridge extension and connect it to use your real browser or its logins; Stella's in-app browser works without it.".to_string()
    })
}

async fn send_to_generation(
    inner: &Arc<Mutex<BridgeInner>>,
    generation: u64,
    command: Value,
    timeout: Duration,
) -> Result<Value, String> {
    let id = command
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let mut message = serde_json::Map::new();
    message.insert("type".to_string(), json!("command"));
    message.insert("id".to_string(), json!(id));
    message.insert(
        "action".to_string(),
        json!(command.get("action").and_then(Value::as_str).unwrap_or("")),
    );
    if let Some(object) = command.as_object() {
        for (key, value) in object {
            if key != "type" {
                message.insert(key.clone(), value.clone());
            }
        }
    }
    let line = serde_json::to_string(&Value::Object(message))
        .map_err(|e| format!("Failed to serialize command: {}", e))?;

    let (tx, rx) = oneshot::channel();
    let label = {
        let mut guard = inner.lock().await;
        let Some(connection) = guard.connections.get(&generation) else {
            return Err(
                "Extension disconnected before the command was sent. Nothing was sent; retry."
                    .to_string(),
            );
        };
        let cmd_tx = connection.cmd_tx.clone();
        let label = connection.info.label();
        guard
            .pending
            .insert(id.clone(), PendingCommand { tx, generation });
        if cmd_tx.send(line).await.is_err() {
            remove_pending_for_generation(&mut guard, &id, generation);
            return Err(
                "Extension connection closed before the command was sent. Nothing was sent; retry."
                    .to_string(),
            );
        }
        label
    };

    match tokio::time::timeout(timeout, rx).await {
        Ok(Ok(response)) => {
            let mut guard = inner.lock().await;
            if let Some(connection) = guard.connections.get_mut(&generation) {
                connection.last_health_check = Instant::now();
                connection.missed_health_checks = 0;
            }
            Ok(response)
        }
        Ok(Err(_)) => {
            let mut guard = inner.lock().await;
            remove_pending_for_generation(&mut guard, &id, generation);
            Err(format!(
                "Extension disconnected while waiting for the response from {}",
                label
            ))
        }
        Err(_) => {
            let mut guard = inner.lock().await;
            remove_pending_for_generation(&mut guard, &id, generation);
            Err(format!(
                "{} did not answer within {}ms. The page may be blocked by a dialog (\"Leave site?\", alert or confirm) or busy. The outcome is unknown: check the tab before retrying a mutating action.",
                label,
                timeout.as_millis()
            ))
        }
    }
}

const HEALTH_PROBE_RESPONSE: &str =
    "HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n";

fn remove_pending_for_generation(
    inner: &mut BridgeInner,
    id: &str,
    generation: u64,
) -> Option<PendingCommand> {
    if inner
        .pending
        .get(id)
        .is_some_and(|pending| pending.generation == generation)
    {
        inner.pending.remove(id)
    } else {
        None
    }
}

fn take_pending_for_generation(inner: &mut BridgeInner, generation: u64) -> Vec<PendingCommand> {
    let ids: Vec<String> = inner
        .pending
        .iter()
        .filter(|(_, pending)| pending.generation == generation)
        .map(|(id, _)| id.clone())
        .collect();
    ids.into_iter()
        .filter_map(|id| inner.pending.remove(&id))
        .collect()
}

fn fail_pending_commands(pending: Vec<PendingCommand>, label: &str) {
    for pending in pending {
        let _ = pending.tx.send(json!({
            "success": false,
            "error": format!(
                "Extension disconnected: the Stella Browser extension in {} dropped its connection before answering (the browser closed, the extension restarted, or the computer slept). The command's outcome is unknown: check the tab's state before retrying a mutating action.",
                label
            ),
        }));
    }
}

async fn activate_connection(
    inner: &Arc<Mutex<BridgeInner>>,
    cmd_tx: mpsc::Sender<String>,
    info: ClientInfo,
) -> u64 {
    let mut guard = inner.lock().await;
    guard.next_generation = guard
        .next_generation
        .checked_add(1)
        .expect("extension connection generation overflow");
    let generation = guard.next_generation;
    guard.last_connection_error = None;
    guard.connections.insert(
        generation,
        Connection {
            cmd_tx,
            info,
            connected_at_ms: now_ms(),
            last_health_check: Instant::now(),
            missed_health_checks: 0,
        },
    );
    generation
}

async fn deactivate_connection(inner: &Arc<Mutex<BridgeInner>>, generation: u64) -> bool {
    let (pending, label) = {
        let mut guard = inner.lock().await;
        let Some(connection) = guard.connections.remove(&generation) else {
            return false;
        };
        (
            take_pending_for_generation(&mut guard, generation),
            connection.info.label(),
        )
    };

    fail_pending_commands(pending, &label);
    true
}

async fn should_shutdown_for_disconnect(inner: &Arc<Mutex<BridgeInner>>, generation: u64) -> bool {
    let guard = inner.lock().await;
    guard.connections.is_empty() && guard.next_generation == generation
}

async fn identify_connection(inner: Arc<Mutex<BridgeInner>>, generation: u64) {
    let info = match inner.lock().await.connections.get(&generation) {
        Some(connection) => connection.info.clone(),
        None => return,
    };
    let marker = probe_marker();
    let pattern = format!("{}.invalid", marker);
    let set = send_to_generation(
        &inner,
        generation,
        json!({
            "action": "site_mod_set",
            "id": format!("_probe_{}", marker),
            "pattern": pattern,
            "css": format!("/*{}*/", marker),
            "label": "Stella profile check",
        }),
        Duration::from_secs(5),
    )
    .await;
    let profile_dir = if set.is_ok_and(|r| r.get("success").and_then(Value::as_bool) == Some(true))
    {
        let lookup_info = info.clone();
        let lookup_marker = marker.clone();
        tokio::task::spawn_blocking(move || find_profile_with_marker(&lookup_info, &lookup_marker))
            .await
            .ok()
            .flatten()
    } else {
        None
    };
    let _ = send_to_generation(
        &inner,
        generation,
        json!({
            "action": "site_mod_remove",
            "id": format!("_probe_rm_{}", marker),
            "pattern": pattern,
        }),
        Duration::from_secs(5),
    )
    .await;
    let Some(profile_dir) = profile_dir else {
        return;
    };
    let identity_dir = profile_dir.clone();
    let (profile, email) =
        tokio::task::spawn_blocking(move || read_profile_identity(&identity_dir))
            .await
            .unwrap_or((None, None));
    let duplicates: Vec<u64> = {
        let mut guard = inner.lock().await;
        let old_key = match guard.connections.get_mut(&generation) {
            Some(connection) => {
                let old_key = connection.info.key();
                connection.info.profile_dir = Some(profile_dir);
                connection.info.profile = profile;
                connection.info.email = email;
                old_key
            }
            None => return,
        };
        let key = guard.connections[&generation].info.key();
        let label = guard.connections[&generation].info.label();
        guard.known_labels.insert(key.clone(), label);
        for route in guard.owner_routes.values_mut() {
            if *route == old_key {
                *route = key.clone();
            }
        }
        guard
            .connections
            .iter()
            .filter(|(other, c)| **other < generation && c.info.key() == key)
            .map(|(other, _)| *other)
            .collect()
    };
    for duplicate in duplicates {
        deactivate_connection(&inner, duplicate).await;
    }
}

async fn handle_extension_connection(
    mut stream: TcpStream,
    inner: Arc<Mutex<BridgeInner>>,
    connected_notify: Arc<Notify>,
    expected_token: String,
    session: String,
    disconnect_shutdown_tx: mpsc::Sender<()>,
    events_tx: broadcast::Sender<String>,
) {
    let mut probe_buf = [0u8; 8];
    match tokio::time::timeout(Duration::from_secs(10), stream.peek(&mut probe_buf)).await {
        Ok(Ok(n)) if n > 0 => {
            let head = &probe_buf[..n];
            if head.starts_with(b"GET ") || head.starts_with(b"HEAD") {
                let _ = stream.write_all(HEALTH_PROBE_RESPONSE.as_bytes()).await;
                let _ = stream.shutdown().await;
                return;
            }
        }
        _ => return,
    }

    let mut authenticated = false;
    let mut connection_generation = None;
    let (cmd_tx, mut cmd_rx) = mpsc::channel::<String>(256);

    let (read_half, mut write_half) = stream.into_split();
    let mut reader = BufReader::new(read_half);
    let active_generation = Arc::new(AtomicU64::new(0));

    let writer_inner = inner.clone();
    let writer_generation = active_generation.clone();
    let write_handle = tokio::spawn(async move {
        let mut retired_poll =
            tokio::time::interval(Duration::from_millis(RETIRED_CONNECTION_POLL_MS));
        retired_poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tokio::select! {
                msg = cmd_rx.recv() => {
                    let Some(msg) = msg else { break };
                    let mut line = msg;
                    line.push('\n');
                    if write_half.write_all(line.as_bytes()).await.is_err() {
                        break;
                    }
                    if write_half.flush().await.is_err() {
                        break;
                    }
                }
                _ = retired_poll.tick() => {
                    let generation = writer_generation.load(Ordering::Acquire);
                    if generation == 0 {
                        continue;
                    }
                    if !writer_inner.lock().await.connections.contains_key(&generation) {
                        break;
                    }
                }
            }
        }
        let _ = write_half.shutdown().await;
    });

    let auth_deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    let mut line = String::new();

    loop {
        line.clear();
        let read_fut = reader.read_line(&mut line);
        let msg = tokio::select! {
            r = read_fut => r,
            _ = tokio::time::sleep_until(auth_deadline), if !authenticated => {
                break;
            }
        };

        let n = match msg {
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

        let parsed: Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let msg_type = parsed.get("type").and_then(|v| v.as_str()).unwrap_or("");

        match msg_type {
            "hello" => {
                if authenticated {
                    continue;
                }

                let extension_version = match validate_extension_hello(&parsed) {
                    Ok(version) => version,
                    Err(error) => {
                        {
                            let mut guard = inner.lock().await;
                            guard.last_connection_error = Some(error.clone());
                        }
                        let err = json!({
                            "type": "auth_error",
                            "error": error,
                        });
                        let _ = cmd_tx.send(serde_json::to_string(&err).unwrap()).await;
                        connected_notify.notify_waiters();
                        break;
                    }
                };
                let token = parsed.get("token").and_then(|v| v.as_str()).unwrap_or("");
                let token_matches = token == expected_token;

                if token_matches || expected_token.is_empty() {
                    authenticated = true;
                    let info = ClientInfo::from_hello(&parsed, &extension_version);
                    let generation = activate_connection(&inner, cmd_tx.clone(), info).await;
                    connection_generation = Some(generation);
                    active_generation.store(generation, Ordering::Release);
                    connected_notify.notify_waiters();

                    let welcome = json!({
                        "type": "welcome",
                        "session": session,
                        "sessionToken": expected_token,
                        "extensionVersion": extension_version,
                        "protocolVersion": EXTENSION_PROTOCOL_VERSION,
                    });
                    let _ = cmd_tx.send(serde_json::to_string(&welcome).unwrap()).await;
                    tokio::spawn(identify_connection(inner.clone(), generation));
                } else {
                    let err = json!({
                        "type": "auth_error",
                        "error": "Invalid token",
                    });
                    let _ = cmd_tx.send(serde_json::to_string(&err).unwrap()).await;
                    break;
                }
            }
            "ping" => {
                if !authenticated {
                    break;
                }
                let pong = json!({ "type": "pong" });
                let _ = cmd_tx.send(serde_json::to_string(&pong).unwrap()).await;
            }
            "response" => {
                if !authenticated {
                    break;
                }
                let id = parsed
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let mut guard = inner.lock().await;
                let Some(generation) = connection_generation else {
                    continue;
                };
                if let Some(pending) = remove_pending_for_generation(&mut guard, &id, generation) {
                    if let Some(connection) = guard.connections.get_mut(&generation) {
                        connection.last_health_check = Instant::now();
                        connection.missed_health_checks = 0;
                    }

                    let response = normalize_extension_command_response(&id, &parsed);

                    let _ = pending.tx.send(response);
                }
            }
            "event" => {
                if !authenticated {
                    break;
                }
                let _ = events_tx.send(trimmed.to_string());
            }
            _ => {}
        }
    }

    if authenticated {
        if let Some(generation) = connection_generation {
            if deactivate_connection(&inner, generation).await {
                let inner_clone = inner.clone();
                let disconnect_tx = disconnect_shutdown_tx.clone();
                tokio::spawn(async move {
                    tokio::time::sleep(Duration::from_millis(DISCONNECT_SHUTDOWN_MS)).await;
                    if should_shutdown_for_disconnect(&inner_clone, generation).await {
                        let _ = disconnect_tx.send(()).await;
                    }
                });
            }
        }
    }

    write_handle.abort();
}

fn normalize_extension_command_response(id: &str, parsed: &Value) -> Value {
    let Some(source) = parsed.as_object() else {
        return json!({
            "id": id,
            "success": false,
            "error": "Extension command returned an invalid response",
        });
    };
    let success = source
        .get("success")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let mut response = source.clone();
    response.remove("type");
    response.insert("id".to_string(), json!(id));
    response.insert("success".to_string(), json!(success));
    if !success
        && response
            .get("error")
            .and_then(Value::as_str)
            .is_none_or(str::is_empty)
    {
        response.insert(
            "error".to_string(),
            json!("Extension command failed without an error message"),
        );
    }
    Value::Object(response)
}

fn is_local_socket(addr: SocketAddr) -> bool {
    match addr.ip() {
        std::net::IpAddr::V4(v4) => v4.is_loopback(),
        std::net::IpAddr::V6(v6) => v6.is_loopback(),
    }
}

fn get_socket_dir() -> PathBuf {
    if let Ok(dir) = env::var("STELLA_BROWSER_SOCKET_DIR") {
        if !dir.is_empty() {
            return PathBuf::from(dir);
        }
    }

    if let Ok(xdg) = env::var("XDG_RUNTIME_DIR") {
        if !xdg.is_empty() {
            return PathBuf::from(xdg).join("stella-browser");
        }
    }

    if let Some(home) = dirs::home_dir() {
        return home.join(".stella-browser");
    }

    std::env::temp_dir().join("stella-browser")
}

fn bind_reuse(port: u16) -> Result<TcpListener, String> {
    use socket2::{Domain, Protocol, Socket, Type};

    let addr: std::net::SocketAddr = format!("127.0.0.1:{}", port)
        .parse()
        .map_err(|e| format!("Invalid address: {}", e))?;

    let socket = Socket::new(Domain::IPV4, Type::STREAM, Some(Protocol::TCP))
        .map_err(|e| format!("Failed to create socket: {}", e))?;

    #[cfg(unix)]
    socket
        .set_reuse_address(true)
        .map_err(|e| format!("Failed to set SO_REUSEADDR: {}", e))?;

    socket
        .bind(&addr.into())
        .map_err(|e| format!("Failed to bind: {}", e))?;

    socket
        .listen(128)
        .map_err(|e| format!("Failed to listen: {}", e))?;

    socket
        .set_nonblocking(true)
        .map_err(|e| format!("Failed to set nonblocking: {}", e))?;

    let std_listener: std::net::TcpListener = socket.into();
    TcpListener::from_std(std_listener)
        .map_err(|e| format!("Failed to convert to tokio listener: {}", e))
}

fn current_exe_stem() -> Option<String> {
    let exe = std::env::current_exe().ok()?;
    Some(exe.file_stem()?.to_string_lossy().to_lowercase())
}

fn session_arg<I: IntoIterator<Item = String>>(args: I) -> Option<String> {
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        if arg == "--session" {
            return args.next();
        }
        if let Some(value) = arg.strip_prefix("--session=") {
            return Some(value.to_string());
        }
    }
    None
}

fn stem_of(path: &str) -> Option<String> {
    std::path::Path::new(path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_lowercase())
}

#[cfg(target_os = "linux")]
fn process_exe_and_args(pid: u32) -> Option<(String, Vec<String>)> {
    let exe = std::fs::read_link(format!("/proc/{}/exe", pid)).ok()?;
    let cmdline = std::fs::read(format!("/proc/{}/cmdline", pid)).ok()?;
    let args = cmdline
        .split(|byte| *byte == 0)
        .filter(|arg| !arg.is_empty())
        .map(|arg| String::from_utf8_lossy(arg).into_owned())
        .collect();
    Some((exe.to_string_lossy().into_owned(), args))
}

#[cfg(all(unix, not(target_os = "linux")))]
fn process_exe_and_args(pid: u32) -> Option<(String, Vec<String>)> {
    let ps = |field: &str| {
        std::process::Command::new("ps")
            .args(["-p", &pid.to_string(), "-o", field])
            .output()
            .ok()
            .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
            .filter(|value| !value.is_empty())
    };
    let exe = ps("comm=")?;
    let args = ps("command=")?
        .split_whitespace()
        .map(str::to_string)
        .collect();
    Some((exe, args))
}

#[cfg(target_os = "linux")]
fn listening_pids(port: u16) -> Vec<u32> {
    const TCP_LISTEN: &str = "0A";
    let mut inodes = std::collections::HashSet::new();
    for table in ["/proc/net/tcp", "/proc/net/tcp6"] {
        let Ok(content) = std::fs::read_to_string(table) else {
            continue;
        };
        for line in content.lines().skip(1) {
            let fields: Vec<&str> = line.split_whitespace().collect();
            let (Some(local), Some(state), Some(inode)) =
                (fields.get(1), fields.get(3), fields.get(9))
            else {
                continue;
            };
            let local_port = local
                .rsplit(':')
                .next()
                .and_then(|hex| u16::from_str_radix(hex, 16).ok());
            if *state == TCP_LISTEN && local_port == Some(port) {
                inodes.insert(format!("socket:[{}]", inode));
            }
        }
    }
    if inodes.is_empty() {
        return Vec::new();
    }
    let Ok(procs) = std::fs::read_dir("/proc") else {
        return Vec::new();
    };
    procs
        .filter_map(|entry| entry.ok()?.file_name().to_str()?.parse::<u32>().ok())
        .filter(|pid| {
            std::fs::read_dir(format!("/proc/{}/fd", pid))
                .map(|fds| {
                    fds.filter_map(|fd| std::fs::read_link(fd.ok()?.path()).ok())
                        .any(|target| inodes.contains(target.to_string_lossy().as_ref()))
                })
                .unwrap_or(false)
        })
        .collect()
}

#[cfg(all(unix, not(target_os = "linux")))]
fn listening_pids(port: u16) -> Vec<u32> {
    std::process::Command::new("lsof")
        .args(["-ti", &format!("tcp:{}", port), "-s", "tcp:listen"])
        .output()
        .map(|out| {
            String::from_utf8_lossy(&out.stdout)
                .lines()
                .filter_map(|line| line.trim().parse::<u32>().ok())
                .collect()
        })
        .unwrap_or_default()
}

/// Stop a leftover daemon of this same session still listening on `port`.
/// Anything else holding the port is left running and the bind reports the
/// conflict.
pub fn kill_stale_stella_browser_on_port(port: u16) {
    let (Some(stem), Some(session)) = (current_exe_stem(), session_arg(std::env::args())) else {
        return;
    };
    let own_pid = std::process::id();

    #[cfg(windows)]
    {
        use std::process::Command;
        let quote = |value: &str| value.replace('\'', "''");
        let script = format!(
            "Get-NetTCPConnection -LocalPort {port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object {{ $p = Get-CimInstance Win32_Process -Filter \"ProcessId=$($_.OwningProcess)\"; if ($p -and $p.ProcessId -ne {own_pid} -and [IO.Path]::GetFileNameWithoutExtension($p.Name).ToLower() -eq '{stem}' -and ($p.CommandLine -like '* --session {session}' -or $p.CommandLine -like '* --session {session} *')) {{ Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }} }}",
            stem = quote(&stem),
            session = quote(&session),
        );
        let utf16: Vec<u8> = script
            .encode_utf16()
            .flat_map(|c| c.to_le_bytes())
            .collect();
        let encoded = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &utf16);
        let _ = Command::new("powershell")
            .args(["-NoProfile", "-EncodedCommand", &encoded])
            .output();
    }

    #[cfg(unix)]
    {
        for pid in listening_pids(port)
            .into_iter()
            .filter(|pid| *pid != own_pid)
        {
            let same_session_daemon = process_exe_and_args(pid).is_some_and(|(exe, args)| {
                stem_of(&exe).as_deref() == Some(stem.as_str())
                    && session_arg(args).as_deref() == Some(session.as_str())
            });
            if same_session_daemon {
                unsafe {
                    libc::kill(pid as libc::pid_t, libc::SIGKILL);
                }
            } else {
                eprintln!(
                    "[stella-browser] port {} is held by pid {}, which is not a stella-browser daemon of session {}; leaving it running",
                    port, pid, session
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_inner() -> Arc<Mutex<BridgeInner>> {
        Arc::new(Mutex::new(BridgeInner {
            connected: false,
            last_connection_error: None,
            cmd_tx: None,
            connection_generation: None,
            next_generation: 0,
            pending: HashMap::new(),
            last_health_check: Instant::now() - Duration::from_secs(60),
        }))
    }

    #[test]
    fn inbound_failure_preserves_complete_unknown_outcome_receipt() {
        let parsed = json!({
            "type": "response",
            "id": "extension-id",
            "success": false,
            "error": "Browser chain timed out",
            "data": {
                "results": [{
                    "step": 0,
                    "action": "click",
                    "success": false,
                    "outcomeUnknown": true,
                }],
            },
            "outcomeUnknown": true,
            "outcomeUnknownReason": "The dispatched click may still complete",
            "deadline": { "timeoutMs": 25 },
        });

        let normalized = normalize_extension_command_response("request-id", &parsed);
        assert_eq!(normalized["id"], "request-id");
        assert_eq!(normalized["success"], false);
        assert_eq!(normalized["data"]["results"][0]["outcomeUnknown"], true);
        assert_eq!(normalized["outcomeUnknown"], true);
        assert_eq!(
            normalized["outcomeUnknownReason"],
            "The dispatched click may still complete"
        );
        assert_eq!(normalized["deadline"]["timeoutMs"], 25);
        assert!(normalized.get("type").is_none());
    }

    #[test]
    fn extension_handshake_rejects_legacy_or_incompatible_protocols() {
        let legacy = json!({ "type": "hello", "version": "1.0.0" });
        assert!(validate_extension_hello(&legacy)
            .unwrap_err()
            .contains("protocol mismatch"));

        let old = json!({
            "type": "hello",
            "extensionVersion": "1.2.11",
            "protocolVersion": EXTENSION_PROTOCOL_VERSION,
        });
        assert!(validate_extension_hello(&old)
            .unwrap_err()
            .contains("too old"));

        let current = json!({
            "type": "hello",
            "extensionVersion": "1.2.12",
            "protocolVersion": EXTENSION_PROTOCOL_VERSION,
        });
        assert_eq!(validate_extension_hello(&current).unwrap(), "1.2.12");

        let pre_marking_peer = json!({
            "type": "hello",
            "extensionVersion": "1.2.11",
            "protocolVersion": "2.0",
        });
        assert!(validate_extension_hello(&pre_marking_peer)
            .unwrap_err()
            .contains("protocol mismatch"));
    }

    #[tokio::test]
    async fn pre_marking_extension_fails_closed_before_events_are_accepted() {
        use tokio::io::AsyncWriteExt;

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind loopback");
        let addr = listener.local_addr().expect("local addr");

        let inner = test_inner();
        let notify = Arc::new(Notify::new());
        let (disconnect_tx, _disconnect_rx) = mpsc::channel::<()>(1);
        let (events_tx, mut events_rx) = broadcast::channel::<String>(16);
        let _events_guard = events_tx.clone();

        let server = {
            let inner = inner.clone();
            let notify = notify.clone();
            tokio::spawn(async move {
                let (stream, _) = listener.accept().await.expect("accept");
                handle_extension_connection(
                    stream,
                    inner,
                    notify,
                    String::new(),
                    "test-session".to_string(),
                    disconnect_tx,
                    events_tx,
                )
                .await;
            })
        };

        let mut client = tokio::net::TcpStream::connect(addr).await.expect("connect");
        client
            .write_all(
                b"{\"type\":\"hello\",\"extensionVersion\":\"1.2.11\",\"protocolVersion\":\"2.0\"}\n{\"type\":\"event\",\"event\":\"cookies_changed\"}\n",
            )
            .await
            .expect("send incompatible hello and event");

        tokio::time::timeout(Duration::from_secs(2), server)
            .await
            .expect("incompatible connection should be closed")
            .expect("server task");

        let guard = inner.lock().await;
        assert!(!guard.connected);
        assert_eq!(guard.next_generation, 0);
        assert!(guard
            .last_connection_error
            .as_deref()
            .is_some_and(|error| error.contains("protocol mismatch")));
        drop(guard);
        assert!(matches!(
            events_rx.try_recv(),
            Err(broadcast::error::TryRecvError::Empty)
        ));
    }

    #[tokio::test]
    async fn extension_event_message_is_broadcast_to_subscribers() {
        use tokio::io::AsyncWriteExt;

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind loopback");
        let addr = listener.local_addr().expect("local addr");

        let inner = test_inner();
        let notify = Arc::new(Notify::new());
        let (disconnect_tx, _disconnect_rx) = mpsc::channel::<()>(1);
        let (events_tx, mut events_rx) = broadcast::channel::<String>(16);

        let server = {
            let inner = inner.clone();
            let notify = notify.clone();
            let events_tx = events_tx.clone();
            tokio::spawn(async move {
                let (stream, _) = listener.accept().await.expect("accept");
                handle_extension_connection(
                    stream,
                    inner,
                    notify,
                    String::new(),
                    "test-session".to_string(),
                    disconnect_tx,
                    events_tx,
                )
                .await;
            })
        };

        let mut client = tokio::net::TcpStream::connect(addr).await.expect("connect");
        client
            .write_all(
                b"{\"type\":\"hello\",\"extensionVersion\":\"1.2.12\",\"protocolVersion\":\"2.1\"}\n",
            )
            .await
            .expect("send hello");
        client
            .write_all(
                b"{\"type\":\"event\",\"event\":\"cookies_changed\",\"changes\":[{\"removed\":false}]}\n",
            )
            .await
            .expect("send event");

        let received = tokio::time::timeout(Duration::from_secs(2), events_rx.recv())
            .await
            .expect("event should be broadcast before timeout")
            .expect("broadcast recv ok");
        assert!(
            received.contains("cookies_changed"),
            "unexpected broadcast payload: {received}"
        );

        drop(client);
        let _ = tokio::time::timeout(Duration::from_secs(2), server).await;
    }

    #[tokio::test]
    async fn old_disconnect_after_new_connect_preserves_new_channel_and_pending_command() {
        let inner = test_inner();
        let (old_tx, _old_rx) = mpsc::channel(1);
        let old_generation = activate_connection(&inner, old_tx).await;
        let (new_tx, mut new_rx) = mpsc::channel(1);
        let new_generation = activate_connection(&inner, new_tx).await;

        let (pending_tx, mut pending_rx) = oneshot::channel();
        {
            let mut guard = inner.lock().await;
            guard.pending.insert(
                "new-command".to_string(),
                PendingCommand {
                    tx: pending_tx,
                    generation: new_generation,
                },
            );
        }

        assert!(!deactivate_connection(&inner, old_generation).await);

        let current_tx = {
            let guard = inner.lock().await;
            assert!(guard.connected);
            assert_eq!(guard.connection_generation, Some(new_generation));
            assert!(guard.pending.contains_key("new-command"));
            guard.cmd_tx.clone().expect("new command channel")
        };
        current_tx.send("still-current".to_string()).await.unwrap();
        assert_eq!(new_rx.recv().await.as_deref(), Some("still-current"));
        assert!(matches!(
            pending_rx.try_recv(),
            Err(oneshot::error::TryRecvError::Empty)
        ));
    }

    #[tokio::test]
    async fn old_response_after_new_connect_cannot_complete_new_pending_command() {
        let inner = test_inner();
        let (old_tx, _old_rx) = mpsc::channel(1);
        let old_generation = activate_connection(&inner, old_tx).await;
        let (new_tx, _new_rx) = mpsc::channel(1);
        let new_generation = activate_connection(&inner, new_tx).await;
        let (pending_tx, mut pending_rx) = oneshot::channel();

        {
            let mut guard = inner.lock().await;
            guard.pending.insert(
                "shared-id".to_string(),
                PendingCommand {
                    tx: pending_tx,
                    generation: new_generation,
                },
            );
            assert!(
                remove_pending_for_generation(&mut guard, "shared-id", old_generation).is_none()
            );
            assert!(guard.pending.contains_key("shared-id"));
        }
        assert!(matches!(
            pending_rx.try_recv(),
            Err(oneshot::error::TryRecvError::Empty)
        ));

        let pending = {
            let mut guard = inner.lock().await;
            remove_pending_for_generation(&mut guard, "shared-id", new_generation)
                .expect("new generation owns the pending command")
        };
        let response = json!({ "success": true });
        pending.tx.send(response.clone()).unwrap();
        assert_eq!(pending_rx.await.unwrap(), response);
    }

    #[tokio::test]
    async fn old_disconnect_timer_cannot_shutdown_after_replacement_disconnects() {
        let inner = test_inner();
        let (old_tx, _old_rx) = mpsc::channel(1);
        let old_generation = activate_connection(&inner, old_tx).await;
        assert!(deactivate_connection(&inner, old_generation).await);

        let (new_tx, _new_rx) = mpsc::channel(1);
        let new_generation = activate_connection(&inner, new_tx).await;
        assert!(deactivate_connection(&inner, new_generation).await);

        assert!(!should_shutdown_for_disconnect(&inner, old_generation).await);
        assert!(should_shutdown_for_disconnect(&inner, new_generation).await);
    }
}
