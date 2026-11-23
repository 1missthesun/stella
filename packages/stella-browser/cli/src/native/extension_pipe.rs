//! Runs page commands for tabs in the user's own browser inside this service.
//!
//! The extension keeps what only it can do (opening, grouping, owning and
//! closing tabs, cookies, downloads). Everything done to a page is decided
//! here and sent as raw debugger commands through the extension, which checks
//! that the tab belongs to the command's owner. Extensions that don't announce
//! `debuggerPipe` keep getting the high-level commands.

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex as SyncMutex, Weak};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tokio::sync::{mpsc, Mutex, Notify};

use super::actions::{execute_piped, execute_piped_open, is_site_url, DaemonState};
use super::browser::BrowserManager;
use super::cdp::client::CdpClient;
use super::extension_bridge::ExtensionBridge;

/// Commands the service runs itself over the pipe. Anything else (tab
/// lifecycle, cookies, downloads) goes to the extension as a whole command.
const PIPED_ACTIONS: &[&str] = &[
    "navigate",
    "open",
    "back",
    "forward",
    "reload",
    "click",
    "dblclick",
    "fill",
    "type",
    "hover",
    "select",
    "press",
    "scroll",
    "clear",
    "check",
    "uncheck",
    "focus",
    "wait",
    "screenshot",
    "snapshot",
    "content",
    "evaluate",
    "gettext",
    "getattribute",
    "pdf",
    "innertext",
    "innerhtml",
    "inputvalue",
    "boundingbox",
    "scrollintoview",
    "isvisible",
    "isenabled",
    "ischecked",
    "count",
    "styles",
    "waitforurl",
    "requests",
    "responsebody",
    "route",
    "unroute",
    "har_start",
    "har_stop",
    "clipboard",
    "mousemove",
    "mousedown",
    "mouseup",
    "drag",
    "keydown",
    "keyup",
    "inserttext",
    "chain",
];

const COMMAND_TIMEOUT: Duration = Duration::from_secs(60);
const CHAIN_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const EXTENSION_TIMEOUT: Duration = Duration::from_secs(30);
const FRAME_ATTACH_TIMEOUT: Duration = Duration::from_secs(5);
const CURSOR_IDLE: Duration = Duration::from_secs(20);
/// Chrome shows a "started debugging this browser" bar while a tab is
/// attached, so a tab left alone is let go.
const IDLE_DETACH: Duration = Duration::from_secs(5 * 60);

pub(super) fn is_piped_action(action: &str) -> bool {
    PIPED_ACTIONS.contains(&action)
}

pub(super) enum PipeOutcome {
    Done(Value),
    /// The extension runs this command itself.
    UseExtension,
}

struct PipeOwner {
    link: Arc<PipeLink>,
    state: DaemonState,
    last_used: Instant,
}

#[derive(Clone, Default)]
pub(super) struct PipeOwners {
    owners: Arc<Mutex<HashMap<OwnerKey, Arc<Mutex<PipeOwner>>>>>,
}

/// An owner keeps one state per browser it drives.
type OwnerKey = (String, u64);

impl PipeOwners {
    /// Boxed because a piped command can reach the bridge again (a
    /// confirmation re-runs its command).
    pub(super) fn run<'a>(
        &'a self,
        bridge: &'a ExtensionBridge,
        generation: u64,
        command: &'a Value,
    ) -> Pin<Box<dyn Future<Output = PipeOutcome> + Send + 'a>> {
        Box::pin(self.run_command(bridge, generation, command))
    }

    async fn run_command(
        &self,
        bridge: &ExtensionBridge,
        generation: u64,
        command: &Value,
    ) -> PipeOutcome {
        let action = command.get("action").and_then(Value::as_str).unwrap_or("");
        let owner_id = command
            .get("ownerId")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|owner| !owner.is_empty());
        if !bridge.has_debugger_pipe(generation).await {
            return PipeOutcome::UseExtension;
        }
        let Some(owner_id) = owner_id else {
            if !is_piped_action(action) {
                return PipeOutcome::UseExtension;
            }
            return PipeOutcome::Done(json!({
                "id": command.get("id").cloned().unwrap_or(Value::Null),
                "success": false,
                "error": format!("{action} in the user's browser needs an ownerId"),
            }));
        };
        let key: OwnerKey = (owner_id.to_string(), generation);
        if matches!(
            action,
            "finalize_tabs" | "close_owner" | "release_owner_lease" | "close"
        ) {
            let owner = self.owners.lock().await.remove(&key);
            if let Some(owner) = owner {
                let owner = owner.lock().await;
                owner.link.set_lease(command);
                owner.link.detach_all().await;
            }
            return PipeOutcome::UseExtension;
        }
        if action == "tab_close" {
            // While attached, a "Leave site?" dialog is answered here instead
            // of holding the tab open.
            let owner = self.owners.lock().await.get(&key).cloned();
            if let (Some(owner), Some(tab_id)) =
                (owner, command.get("tabId").and_then(Value::as_u64))
            {
                let owner = owner.lock().await;
                owner.link.set_lease(command);
                let _ = owner.link.attach(tab_id).await;
                if let Some(browser) = owner.state.browser.as_ref() {
                    browser.dialogs.resume().await;
                }
            }
            return PipeOutcome::UseExtension;
        }
        let opens_site = action == "tab_new"
            && command
                .get("url")
                .and_then(Value::as_str)
                .is_some_and(is_site_url);
        if !is_piped_action(action) && !opens_site {
            return PipeOutcome::UseExtension;
        }

        let owner = self.owner(bridge, key, command).await;
        let mut owner = owner.lock().await;
        owner.link.set_lease(command);
        owner.last_used = Instant::now();
        let link = owner.link.clone();
        let mut held = HeldInput {
            link: link.clone(),
            armed: true,
        };
        let limit = command_timeout(action, command);
        let outcome = tokio::time::timeout(limit, async {
            match opens_site {
                true => execute_piped_open(command, &mut owner.state, &link).await,
                false => execute_piped(command, &mut owner.state, &link).await,
            }
        })
        .await;
        owner.last_used = Instant::now();
        match outcome {
            Ok(response) => {
                held.armed = false;
                PipeOutcome::Done(response)
            }
            Err(_) => PipeOutcome::Done(json!({
                "id": command.get("id").cloned().unwrap_or(Value::Null),
                "success": false,
                "error": format!(
                    "Browser command timed out after {}ms on action={}. The outcome is unknown: check the tab before retrying a mutating action.",
                    limit.as_millis(),
                    action
                ),
            })),
        }
    }

    async fn owner(
        &self,
        bridge: &ExtensionBridge,
        key: OwnerKey,
        command: &Value,
    ) -> Arc<Mutex<PipeOwner>> {
        let mut owners = self.owners.lock().await;
        if let Some(existing) = owners.get(&key) {
            return existing.clone();
        }
        let live = bridge.live_generations().await;
        owners.retain(|(_, generation), _| live.contains(generation));

        let (link, client) = PipeLink::open(bridge.clone(), key.1, &key.0);
        link.set_lease(command);
        let mut state = DaemonState::for_pipe(link.clone());
        state.attach_browser(BrowserManager::over_pipe(client));
        let owner = Arc::new(Mutex::new(PipeOwner {
            link,
            state,
            last_used: Instant::now(),
        }));
        owners.insert(key, owner.clone());
        tokio::spawn(detach_when_idle(Arc::downgrade(&owner)));
        owner
    }
}

fn command_timeout(action: &str, command: &Value) -> Duration {
    if action == "chain" {
        return CHAIN_TIMEOUT;
    }
    let requested = command
        .get("timeout")
        .and_then(Value::as_u64)
        .map(|ms| Duration::from_millis(ms.saturating_add(5_000)))
        .unwrap_or(COMMAND_TIMEOUT);
    requested.clamp(COMMAND_TIMEOUT, CHAIN_TIMEOUT)
}

async fn detach_when_idle(owner: Weak<Mutex<PipeOwner>>) {
    loop {
        tokio::time::sleep(IDLE_DETACH / 5).await;
        let Some(owner) = owner.upgrade() else {
            return;
        };
        let mut owner = owner.lock().await;
        if owner.last_used.elapsed() < IDLE_DETACH || owner.state.observes_network() {
            continue;
        }
        owner.link.detach_all().await;
        owner.state.forget_pipe_pages();
    }
}

/// Releases mouse buttons and keys a cancelled command left pressed.
struct HeldInput {
    link: Arc<PipeLink>,
    armed: bool,
}

impl Drop for HeldInput {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        let link = self.link.clone();
        tokio::spawn(async move { link.release_input().await });
    }
}

#[derive(Clone, Default)]
struct Lease {
    id: Value,
    issued_at: Value,
}

/// One owner's CDP connection to their tabs, over one extension connection.
pub(crate) struct PipeLink {
    bridge: ExtensionBridge,
    generation: u64,
    owner_id: String,
    lease: SyncMutex<Lease>,
    attached: SyncMutex<HashSet<u64>>,
    /// Frame and worker sessions, by the tab they belong to.
    child_tabs: SyncMutex<HashMap<String, u64>>,
    frame_sessions: SyncMutex<HashMap<(u64, String), String>>,
    frame_attached: Notify,
    cursor_scales: SyncMutex<HashMap<u64, f64>>,
    cursor_drawn: SyncMutex<HashMap<u64, Instant>>,
    to_client: mpsc::UnboundedSender<String>,
    events: mpsc::UnboundedSender<Value>,
}

pub(crate) struct PipeTab {
    pub tab_id: u64,
    pub url: String,
    pub title: String,
}

pub(crate) fn tab_session(tab_id: u64) -> String {
    format!("tab-{}", tab_id)
}

fn session_tab(session_id: &str) -> Option<u64> {
    session_id.strip_prefix("tab-")?.parse().ok()
}

impl PipeLink {
    fn open(
        bridge: ExtensionBridge,
        generation: u64,
        owner_id: &str,
    ) -> (Arc<Self>, Arc<CdpClient>) {
        let (from_client, mut commands) = mpsc::unbounded_channel::<String>();
        let (to_client, incoming) = mpsc::unbounded_channel::<String>();
        let (events, mut arrived) = mpsc::unbounded_channel::<Value>();
        let link = Arc::new(Self {
            bridge,
            generation,
            owner_id: owner_id.to_string(),
            lease: SyncMutex::default(),
            attached: SyncMutex::default(),
            child_tabs: SyncMutex::default(),
            frame_sessions: SyncMutex::default(),
            frame_attached: Notify::new(),
            cursor_scales: SyncMutex::default(),
            cursor_drawn: SyncMutex::default(),
            to_client,
            events,
        });
        let client = Arc::new(CdpClient::over_channel(from_client, incoming));

        let weak = Arc::downgrade(&link);
        tokio::spawn(async move {
            while let Some(json) = commands.recv().await {
                let Some(link) = weak.upgrade() else {
                    break;
                };
                link.dispatch(json).await;
            }
        });
        let weak = Arc::downgrade(&link);
        tokio::spawn(async move {
            while let Some(event) = arrived.recv().await {
                let Some(link) = weak.upgrade() else {
                    break;
                };
                link.deliver_event(event);
            }
        });
        (link, client)
    }

    fn set_lease(&self, command: &Value) {
        let mut lease = self.lease.lock().unwrap();
        if let Some(id) = command.get("ownerLeaseId") {
            lease.id = id.clone();
        }
        if let Some(issued_at) = command.get("ownerLeaseIssuedAt") {
            lease.issued_at = issued_at.clone();
        }
    }

    fn request(&self, action: &str, fields: Value) -> Value {
        let lease = self.lease.lock().unwrap().clone();
        let mut request = json!({
            "id": format!(
                "_pipe_{}_{}",
                self.generation,
                uuid::Uuid::new_v4().simple()
            ),
            "action": action,
            "ownerId": self.owner_id,
            "ownerLeaseId": lease.id,
            "ownerLeaseIssuedAt": lease.issued_at,
        });
        if let (Some(target), Value::Object(fields)) = (request.as_object_mut(), fields) {
            target.extend(fields);
        }
        request
    }

    async fn call(&self, action: &str, fields: Value) -> Result<Value, String> {
        let pending = self
            .bridge
            .queue(self.generation, self.request(action, fields))
            .await?;
        let response = self.bridge.reply(pending, EXTENSION_TIMEOUT).await?;
        response_data(response)
    }

    /// Sends a whole command to the extension for a step of a piped one.
    pub(crate) async fn extension_command(&self, command: &Value) -> Result<Value, String> {
        let action = command.get("action").and_then(Value::as_str).unwrap_or("");
        let mut fields = command.clone();
        if let Some(object) = fields.as_object_mut() {
            for key in ["id", "action", "ownerId", "ownerLeaseId", "ownerLeaseIssuedAt"] {
                object.remove(key);
            }
        }
        let pending = self
            .bridge
            .queue(self.generation, self.request(action, fields))
            .await?;
        response_data(self.bridge.reply(pending, COMMAND_TIMEOUT).await?)
    }

    /// The owner's tab a command addresses (its active one without a tabId),
    /// opened if the owner has none. The extension checks ownership.
    pub(crate) async fn resolve_tab(&self, tab_id: Option<u64>) -> Result<PipeTab, String> {
        let fields = match tab_id {
            Some(tab_id) => json!({ "tabId": tab_id }),
            None => json!({}),
        };
        let data = self.call("pipe_tab", fields).await?;
        let text = |key: &str| {
            data.get(key)
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string()
        };
        Ok(PipeTab {
            tab_id: data
                .get("tabId")
                .and_then(Value::as_u64)
                .ok_or("The Stella Browser extension did not name the tab")?,
            url: text("url"),
            title: text("title"),
        })
    }

    pub(crate) fn is_attached(&self, tab_id: u64) -> bool {
        self.attached.lock().unwrap().contains(&tab_id)
    }

    pub(crate) async fn attach(&self, tab_id: u64) -> Result<(), String> {
        if self.is_attached(tab_id) {
            return Ok(());
        }
        self.bridge
            .route_pipe_tab(self.generation, tab_id, Some(self.events.clone()))
            .await;
        match self.call("pipe_attach", json!({ "tabId": tab_id })).await {
            Ok(_) => {
                self.attached.lock().unwrap().insert(tab_id);
                Ok(())
            }
            Err(error) => {
                self.bridge
                    .route_pipe_tab(self.generation, tab_id, None)
                    .await;
                Err(error)
            }
        }
    }

    /// Opens an empty page in a tab that can't be debugged as it is.
    pub(crate) async fn blank(&self, tab_id: u64) -> Result<(), String> {
        self.call("pipe_blank", json!({ "tabId": tab_id }))
            .await
            .map(drop)
    }

    pub(crate) async fn detach_all(&self) {
        let tabs: Vec<u64> = self.attached.lock().unwrap().iter().copied().collect();
        for tab_id in tabs {
            let _ = self.call("pipe_detach", json!({ "tabId": tab_id })).await;
            self.bridge
                .route_pipe_tab(self.generation, tab_id, None)
                .await;
            self.forget_tab(tab_id);
        }
    }

    async fn release_input(&self) {
        let tabs: Vec<u64> = self.attached.lock().unwrap().iter().copied().collect();
        for tab_id in tabs {
            let _ = self.call("pipe_release", json!({ "tabId": tab_id })).await;
        }
    }

    fn forget_tab(&self, tab_id: u64) {
        self.attached.lock().unwrap().remove(&tab_id);
        self.cursor_scales.lock().unwrap().remove(&tab_id);
        self.cursor_drawn.lock().unwrap().remove(&tab_id);
        self.child_tabs
            .lock()
            .unwrap()
            .retain(|_, tab| *tab != tab_id);
        self.frame_sessions
            .lock()
            .unwrap()
            .retain(|(tab, _), _| *tab != tab_id);
    }

    /// Splits a CDP session id into the tab and, for a frame, its session.
    fn address(&self, session_id: &str) -> Option<(u64, Option<String>)> {
        if let Some(tab_id) = session_tab(session_id) {
            return Some((tab_id, None));
        }
        let tab_id = *self.child_tabs.lock().unwrap().get(session_id)?;
        Some((tab_id, Some(session_id.to_string())))
    }

    async fn dispatch(self: Arc<Self>, json: String) {
        let Ok(command) = serde_json::from_str::<Value>(&json) else {
            return;
        };
        let id = command.get("id").cloned().unwrap_or(Value::Null);
        let method = command
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let params = command.get("params").cloned().unwrap_or_else(|| json!({}));
        let Some(session_id) = command.get("sessionId").and_then(Value::as_str) else {
            self.answer(
                id,
                Err(format!("{} is not available in the user's browser", method)),
            );
            return;
        };
        let Some((tab_id, frame_session)) = self.address(session_id) else {
            self.answer(id, Err("Session with given id not found.".to_string()));
            return;
        };

        if method == "Target.attachToTarget" {
            let link = self.clone();
            tokio::spawn(async move {
                let target = params
                    .get("targetId")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let attached = link
                    .attach_frame(tab_id, frame_session.as_deref(), target)
                    .await
                    .map(|session| json!({ "sessionId": session }));
                link.answer(id, attached);
            });
            return;
        }

        let pending = self
            .queue_raw(tab_id, frame_session.as_deref(), &method, params.clone())
            .await;
        if method == "Input.dispatchMouseEvent" {
            self.clone().draw_cursor(tab_id, &params).await;
        }
        let link = self.clone();
        tokio::spawn(async move {
            let result = match pending {
                Ok(pending) => match link.bridge.reply(pending, EXTENSION_TIMEOUT).await {
                    Ok(response) => response_data(response),
                    Err(error) => Err(error),
                },
                Err(error) => Err(error),
            };
            link.answer(id, result);
        });
    }

    async fn queue_raw(
        &self,
        tab_id: u64,
        frame_session: Option<&str>,
        method: &str,
        params: Value,
    ) -> Result<super::extension_bridge::PendingReply, String> {
        let mut fields = json!({ "tabId": tab_id, "method": method, "params": params });
        if let Some(session) = frame_session {
            fields["debuggerSession"] = json!(session);
        }
        self.bridge
            .queue(self.generation, self.request("pipe_send", fields))
            .await
    }

    async fn send_raw(
        &self,
        tab_id: u64,
        frame_session: Option<&str>,
        method: &str,
        params: Value,
    ) -> Result<Value, String> {
        let pending = self
            .queue_raw(tab_id, frame_session, method, params)
            .await?;
        response_data(self.bridge.reply(pending, EXTENSION_TIMEOUT).await?)
    }

    fn answer(&self, id: Value, result: Result<Value, String>) {
        let message = match result {
            Ok(result) => json!({ "id": id, "result": result }),
            Err(error) => json!({ "id": id, "error": { "code": -32000, "message": error } }),
        };
        let _ = self.to_client.send(message.to_string());
    }

    /// Cross-origin frames can only be attached by asking Chrome to attach
    /// their parent's frames and taking the one that was asked for.
    async fn attach_frame(
        &self,
        tab_id: u64,
        parent: Option<&str>,
        target: &str,
    ) -> Result<String, String> {
        let key = (tab_id, target.to_string());
        let known = || self.frame_sessions.lock().unwrap().get(&key).cloned();
        if let Some(session) = known() {
            return Ok(session);
        }
        self.send_raw(
            tab_id,
            parent,
            "Target.setAutoAttach",
            json!({ "autoAttach": true, "waitForDebuggerOnStart": false, "flatten": true }),
        )
        .await?;
        let deadline = tokio::time::Instant::now() + FRAME_ATTACH_TIMEOUT;
        loop {
            let arrived = self.frame_attached.notified();
            if let Some(session) = known() {
                return Ok(session);
            }
            tokio::select! {
                _ = arrived => {}
                _ = tokio::time::sleep_until(deadline) => {
                    return known().ok_or_else(|| "Browser frame target was not found.".to_string());
                }
            }
        }
    }

    fn deliver_event(&self, event: Value) {
        let Some(tab_id) = event.get("tabId").and_then(Value::as_u64) else {
            return;
        };
        if event.get("detached").is_some() {
            self.forget_tab(tab_id);
            for message in [
                json!({
                    "method": "Target.detachedFromTarget",
                    "params": { "sessionId": tab_session(tab_id) },
                }),
                json!({
                    "method": "Target.targetDestroyed",
                    "params": { "targetId": tab_session(tab_id) },
                }),
            ] {
                let _ = self.to_client.send(message.to_string());
            }
            return;
        }
        let Some(method) = event.get("method").and_then(Value::as_str) else {
            return;
        };
        let params = event.get("params").cloned().unwrap_or_else(|| json!({}));
        let child = params.get("sessionId").and_then(Value::as_str);
        match (method, child) {
            ("Target.attachedToTarget", Some(session)) => {
                self.child_tabs
                    .lock()
                    .unwrap()
                    .insert(session.to_string(), tab_id);
                if let Some(target) = params
                    .pointer("/targetInfo/targetId")
                    .and_then(Value::as_str)
                {
                    self.frame_sessions
                        .lock()
                        .unwrap()
                        .insert((tab_id, target.to_string()), session.to_string());
                }
                self.frame_attached.notify_waiters();
            }
            ("Target.detachedFromTarget", Some(session)) => {
                self.child_tabs.lock().unwrap().remove(session);
                self.frame_sessions
                    .lock()
                    .unwrap()
                    .retain(|_, known| known != session);
            }
            _ => {}
        }
        let session_id = event
            .get("debuggerSession")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| tab_session(tab_id));
        let message = json!({ "method": method, "params": params, "sessionId": session_id });
        let _ = self.to_client.send(message.to_string());
    }

    /// Shows the person where the agent points, with Chrome's own overlay:
    /// nothing is added to the page.
    async fn draw_cursor(self: Arc<Self>, tab_id: u64, params: &Value) {
        let (Some(x), Some(y)) = (
            params.get("x").and_then(Value::as_f64),
            params.get("y").and_then(Value::as_f64),
        ) else {
            return;
        };
        let idle = self
            .cursor_drawn
            .lock()
            .unwrap()
            .insert(tab_id, Instant::now())
            .is_none();
        if idle {
            tokio::spawn(hide_idle_cursor(Arc::downgrade(&self), tab_id));
        }
        let scale = self.cursor_scales.lock().unwrap().get(&tab_id).copied();
        if let Some(scale) = scale {
            let _ = self
                .queue_raw(
                    tab_id,
                    None,
                    "Overlay.highlightQuad",
                    cursor_quad(x, y, scale),
                )
                .await;
            return;
        }
        self.cursor_scales.lock().unwrap().insert(tab_id, 1.0);
        tokio::spawn(async move {
            let _ = self.send_raw(tab_id, None, "DOM.enable", json!({})).await;
            let _ = self
                .send_raw(tab_id, None, "Overlay.enable", json!({}))
                .await;
            let metrics = self
                .send_raw(tab_id, None, "Page.getLayoutMetrics", json!({}))
                .await
                .unwrap_or(Value::Null);
            let width = |viewport: &str| {
                metrics
                    .pointer(&format!("/{}/clientWidth", viewport))
                    .and_then(Value::as_f64)
                    .filter(|width| *width > 0.0)
            };
            let scale = match (width("layoutViewport"), width("cssLayoutViewport")) {
                (Some(device), Some(css)) => device / css,
                _ => 1.0,
            };
            self.cursor_scales.lock().unwrap().insert(tab_id, scale);
            let _ = self
                .queue_raw(
                    tab_id,
                    None,
                    "Overlay.highlightQuad",
                    cursor_quad(x, y, scale),
                )
                .await;
        });
    }
}

async fn hide_idle_cursor(link: Weak<PipeLink>, tab_id: u64) {
    loop {
        tokio::time::sleep(CURSOR_IDLE / 4).await;
        let Some(link) = link.upgrade() else {
            return;
        };
        let idle = {
            let mut drawn = link.cursor_drawn.lock().unwrap();
            match drawn.get(&tab_id) {
                None => return,
                Some(at) if at.elapsed() < CURSOR_IDLE => false,
                Some(_) => drawn.remove(&tab_id).is_some(),
            }
        };
        if idle {
            let _ = link
                .send_raw(tab_id, None, "Overlay.hideHighlight", json!({}))
                .await;
            return;
        }
    }
}

/// An arrow pointer with its tip at the point. Chrome scales highlight quads
/// by the device pixel ratio once more than CSS pixels need.
fn cursor_quad(x: f64, y: f64, scale: f64) -> Value {
    let quad: Vec<f64> = [
        x,
        y,
        x,
        y + 20.0,
        x + 5.4,
        y + 15.2,
        x + 14.2,
        y + 14.2,
    ]
    .iter()
    .map(|value| value / scale)
    .collect();
    json!({
        "quad": quad,
        "color": { "r": 51, "g": 156, "b": 255, "a": 1 },
        "outlineColor": { "r": 255, "g": 255, "b": 255, "a": 1 },
    })
}

fn response_data(response: Value) -> Result<Value, String> {
    if response.get("success").and_then(Value::as_bool) == Some(true) {
        return Ok(response.get("data").cloned().unwrap_or(Value::Null));
    }
    Err(response
        .get("error")
        .and_then(Value::as_str)
        .unwrap_or("The Stella Browser extension failed without an error message")
        .to_string())
}
