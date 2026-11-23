//! What a session's pages send over the network: live request tracking, HAR
//! recording, and request routing. Works from CDP events as they arrive, so a
//! paused request is answered and a body read while the browser still has it,
//! whether or not a command is running.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex as SyncMutex, Weak};
use std::time::Duration;

use serde_json::{json, Value};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use tokio::sync::broadcast::error::RecvError;
use tokio::sync::Notify;

use super::cdp::client::CdpClient;
use super::cdp::types::CdpEvent;
use super::network::DomainFilter;

pub const MAX_TRACKED_REQUESTS: usize = 256;
pub const MAX_TRACKED_BODY_BYTES: usize = 128 * 1024;
pub const MAX_TRACKED_TOTAL_BODY_BYTES: usize = 2 * 1024 * 1024;
/// Bodies worth reading before anyone asks for them.
const EAGER_BODY_BYTES: i64 = 1024 * 1024;
const CAPTURE_WAIT: Duration = Duration::from_secs(2);
const LEFT_BODY_WAIT: Duration = Duration::from_secs(5);
const MAX_TRACKED_REQUEST_BODY_BYTES: usize = 128 * 1024;
const MAX_TRACKED_HEADERS: usize = 128;
const MAX_TRACKED_HEADER_VALUE_BYTES: usize = 8 * 1024;

const HAR_MAX_ENTRIES: usize = 5_000;
const HAR_MAX_BODY_BYTES: usize = 512 * 1024;
const HAR_MAX_TOTAL_BODY_BYTES: usize = 8 * 1024 * 1024;
const HAR_MAX_STREAM_FRAMES: usize = 300;
const HAR_MAX_FRAME_BYTES: usize = 32 * 1024;
const HAR_BODY_WAIT: Duration = Duration::from_secs(5);

#[derive(Clone)]
pub struct RouteEntry {
    pub url_pattern: String,
    pub response: Option<RouteResponse>,
    pub abort: bool,
}

#[derive(Clone)]
pub struct RouteResponse {
    pub status: Option<u16>,
    pub body: Option<String>,
    pub content_type: Option<String>,
    pub headers: Option<HashMap<String, String>>,
}

#[derive(Clone)]
pub struct RequestRewriteEntry {
    pub session_id: String,
    pub url_pattern: String,
    pub method: Option<String>,
    pub post_data: Option<String>,
    pub json_patch: Option<Value>,
    pub headers: HashMap<String, String>,
}

#[derive(Clone, Default)]
pub struct RequestRules {
    pub routes: Vec<RouteEntry>,
    pub rewrites: Vec<RequestRewriteEntry>,
    pub domain_filter: Option<DomainFilter>,
}

impl RequestRules {
    /// The `Fetch.enable` patterns for a session; none when it needs no pausing.
    pub fn patterns(&self, session_id: &str) -> Vec<Value> {
        let mut patterns: Vec<Value> = self
            .routes
            .iter()
            .map(|route| &route.url_pattern)
            .chain(
                self.rewrites
                    .iter()
                    .filter(|rewrite| rewrite.session_id == session_id)
                    .map(|rewrite| &rewrite.url_pattern),
            )
            .map(|pattern| json!({ "urlPattern": pattern }))
            .collect();
        if self.domain_filter.is_some() && !patterns.iter().any(|p| p["urlPattern"] == "*") {
            patterns.push(json!({ "urlPattern": "*" }));
        }
        patterns
    }
}

#[derive(Clone, serde::Serialize)]
pub struct TrackedRequest {
    #[serde(skip)]
    pub request_id: String,
    #[serde(skip)]
    pub session_id: String,
    /// The session that made the request: the page's, or a frame's or worker's in it.
    #[serde(skip)]
    pub source_session: String,
    #[serde(skip)]
    pub body_pending: bool,
    #[serde(skip)]
    pub body_read: bool,
    pub url: String,
    pub method: String,
    pub headers: Value,
    #[serde(rename = "postData", skip_serializing_if = "Option::is_none")]
    pub post_data: Option<String>,
    #[serde(
        rename = "postDataTruncated",
        skip_serializing_if = "std::ops::Not::not"
    )]
    pub post_data_truncated: bool,
    pub timestamp: u64,
    #[serde(rename = "resourceType")]
    pub resource_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<i64>,
    #[serde(rename = "responseHeaders", skip_serializing_if = "Option::is_none")]
    pub response_headers: Option<Value>,
    #[serde(rename = "mimeType", skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(rename = "bodyBase64", skip_serializing_if = "std::ops::Not::not")]
    pub body_base64: bool,
    #[serde(rename = "bodyTruncated", skip_serializing_if = "std::ops::Not::not")]
    pub body_truncated: bool,
    pub completed: bool,
    #[serde(rename = "failureText", skip_serializing_if = "Option::is_none")]
    pub failure_text: Option<String>,
}

impl TrackedRequest {
    fn left_in_browser(&self) -> bool {
        self.completed && !self.body_read && !self.body_pending && self.failure_text.is_none()
    }
}

struct HarEntry {
    request_id: String,
    source_session: String,
    wall_time: f64,
    method: String,
    url: String,
    request_headers: Vec<(String, String)>,
    post_data: Option<String>,
    /// Too large for the request event; read separately.
    post_data_elsewhere: bool,
    request_body_size: i64,
    resource_type: String,
    status: Option<i64>,
    status_text: String,
    http_version: String,
    response_headers: Vec<(String, String)>,
    mime_type: String,
    redirect_url: String,
    response_body_size: i64,
    response_body: Option<String>,
    response_body_base64: bool,
    response_body_truncated: bool,
    cdp_timing: Option<Value>,
    loading_finished_timestamp: Option<f64>,
    frames: Vec<Value>,
    frames_truncated: bool,
}

#[derive(Default)]
struct Har {
    entries: Vec<HarEntry>,
    body_bytes: usize,
    truncated: bool,
}

pub struct HarCapture {
    pub entries: Vec<Value>,
    pub bodies_captured: usize,
    pub truncated: bool,
}

#[derive(Default)]
struct LogState {
    /// Page sessions whose requests are kept.
    pages: HashSet<String>,
    /// Whether a task asked to see requests, so the tab must stay attached and
    /// every body is read before the page can drop it.
    tracking: bool,
    tracked: Vec<TrackedRequest>,
    /// By page session.
    har: HashMap<String, Har>,
    /// Bodies being read; HAR waits for them.
    reading: usize,
    /// Frame and worker sessions, by the page session they belong to.
    roots: HashMap<String, String>,
    rules: RequestRules,
}

impl LogState {
    fn active(&self) -> bool {
        !self.pages.is_empty() || !self.har.is_empty()
    }

    fn wants_every_body(&self) -> bool {
        self.tracking || !self.har.is_empty()
    }

    fn buffers(&self) -> Value {
        buffers(self.wants_every_body())
    }

    fn body_bytes(&self, page: &str) -> usize {
        self.tracked
            .iter()
            .filter(|entry| entry.session_id == page)
            .filter_map(|entry| entry.body.as_ref())
            .map(String::len)
            .sum()
    }

    /// Drops a page's oldest bodies until `room` bytes fit.
    fn make_room(&mut self, page: &str, room: usize) {
        let mut held = self.body_bytes(page);
        for entry in self.tracked.iter_mut() {
            if held + room <= MAX_TRACKED_TOTAL_BODY_BYTES {
                return;
            }
            if entry.session_id != page {
                continue;
            }
            if let Some(body) = entry.body.as_mut().filter(|body| !body.is_empty()) {
                held -= body.len();
                *body = String::new();
                entry.body_truncated = true;
            }
        }
    }

    fn push_tracked(&mut self, request: TrackedRequest) {
        let page = request.session_id.clone();
        self.tracked.push(request);
        let held = self.tracked.iter().filter(|entry| entry.session_id == page).count();
        if held > MAX_TRACKED_REQUESTS {
            if let Some(oldest) = self.tracked.iter().position(|entry| entry.session_id == page) {
                self.tracked.remove(oldest);
            }
        }
    }

    fn forget(&mut self, session: &str) {
        self.roots.remove(session);
        if self.pages.remove(session) {
            self.tracked.retain(|entry| entry.session_id != session);
            self.roots.retain(|_, root| root != session);
        }
    }

    fn root_of(&self, session_id: &str) -> String {
        self.roots
            .get(session_id)
            .cloned()
            .unwrap_or_else(|| session_id.to_string())
    }

    fn tracked_mut(&mut self, source: &str, request_id: &str) -> Option<&mut TrackedRequest> {
        self.tracked
            .iter_mut()
            .rev()
            .find(|entry| entry.request_id == request_id && entry.source_session == source)
    }

    fn har_mut(&mut self, source: &str, request_id: &str) -> Option<&mut HarEntry> {
        let page = self.root_of(source);
        self.har
            .get_mut(&page)?
            .entries
            .iter_mut()
            .rev()
            .find(|entry| entry.request_id == request_id && entry.source_session == source)
    }

    fn push_har(&mut self, entry: HarEntry) {
        let page = self.root_of(&entry.source_session);
        let Some(har) = self.har.get_mut(&page) else {
            return;
        };
        if har.entries.len() >= HAR_MAX_ENTRIES {
            har.truncated = true;
            return;
        }
        har.entries.push(entry);
    }
}

#[derive(Default)]
struct Shared {
    state: SyncMutex<LogState>,
    changed: Notify,
}

#[derive(Clone)]
pub struct NetworkLog {
    client: Arc<CdpClient>,
    shared: Arc<Shared>,
    /// Whether Chrome attaches a page's frames and workers when asked to.
    auto_attach: bool,
}

impl NetworkLog {
    pub fn new(
        client: Arc<CdpClient>,
        domain_filter: Option<DomainFilter>,
        auto_attach: bool,
    ) -> Self {
        let log = Self {
            client,
            shared: Arc::default(),
            auto_attach,
        };
        log.shared.state.lock().unwrap().rules.domain_filter = domain_filter;
        tokio::spawn(watch(
            log.client.subscribe(),
            Arc::downgrade(&log.client),
            Arc::downgrade(&log.shared),
            auto_attach,
        ));
        log
    }

    pub fn is_active(&self) -> bool {
        let state = self.shared.state.lock().unwrap();
        state.wants_every_body() || !state.rules.routes.is_empty() || !state.rules.rewrites.is_empty()
    }

    /// Keeps what a page sends from now on, without holding its tab attached.
    pub async fn capture(&self, session_id: &str) {
        if !self.shared.state.lock().unwrap().pages.insert(session_id.to_string()) {
            return;
        }
        let observed = tokio::time::timeout(CAPTURE_WAIT, self.observe(session_id)).await;
        if matches!(observed, Ok(Err(_))) {
            self.shared.state.lock().unwrap().pages.remove(session_id);
        }
    }

    /// The pages' tabs are no longer attached. What they sent is kept.
    pub fn forget_pages(&self) {
        let mut state = self.shared.state.lock().unwrap();
        state.pages.clear();
        state.roots.clear();
    }

    pub async fn track(&self, session_id: &str) -> Result<(), String> {
        {
            let mut state = self.shared.state.lock().unwrap();
            state.tracking = true;
            state.pages.insert(session_id.to_string());
        }
        self.observe(session_id).await
    }

    async fn observe(&self, session_id: &str) -> Result<(), String> {
        let buffers = self.shared.state.lock().unwrap().buffers();
        let enable = self
            .client
            .send_command("Network.enable", Some(buffers), Some(session_id));
        if !self.auto_attach {
            return enable.await.map(drop);
        }
        let attach = self
            .client
            .send_command("Target.setAutoAttach", Some(flat()), Some(session_id));
        tokio::join!(enable, attach).0.map(drop)
    }

    pub fn clear_tracked(&self, session_id: &str) {
        let mut state = self.shared.state.lock().unwrap();
        state.tracked.retain(|entry| entry.session_id != session_id);
    }

    /// Reads the bodies that were left in the browser. Pictures, fonts and
    /// media are read only when one is asked for by URL.
    pub async fn read_left_bodies(
        &self,
        session_id: &str,
        filter: Option<&str>,
        after: u64,
        limit: usize,
    ) {
        let wanted: Vec<(String, String)> = {
            let mut state = self.shared.state.lock().unwrap();
            let picked: Vec<(String, String)> = state
                .tracked
                .iter()
                .rev()
                .filter(|entry| {
                    entry.session_id == session_id
                        && entry.timestamp >= after
                        && filter.is_none_or(|filter| entry.url.contains(filter))
                })
                .take(limit)
                .filter(|entry| {
                    entry.left_in_browser()
                        && !matches!(
                            entry.resource_type.as_str(),
                            "Image" | "Font" | "Media" | "Stylesheet"
                        )
                })
                .map(|entry| (entry.source_session.clone(), entry.request_id.clone()))
                .collect();
            for (source, request_id) in &picked {
                if let Some(entry) = state.tracked_mut(source, request_id) {
                    entry.body_pending = true;
                }
            }
            state.reading += picked.len();
            picked
        };
        let reads = wanted.into_iter().map(|(source, request_id)| {
            tokio::spawn(read_bodies(
                self.client.clone(),
                self.shared.clone(),
                source,
                request_id,
                Keep::IfRoom,
            ))
        });
        let _ = tokio::time::timeout(LEFT_BODY_WAIT, futures_util::future::join_all(reads)).await;
    }

    pub fn tracked(
        &self,
        session_id: &str,
        filter: Option<&str>,
        after: u64,
        limit: usize,
    ) -> Vec<TrackedRequest> {
        let state = self.shared.state.lock().unwrap();
        let mut requests: Vec<TrackedRequest> = state
            .tracked
            .iter()
            .rev()
            .filter(|entry| {
                entry.session_id == session_id
                    && entry.timestamp >= after
                    && filter.is_none_or(|filter| entry.url.contains(filter))
            })
            .take(limit)
            .cloned()
            .collect();
        requests.reverse();
        requests
    }

    /// The newest response whose URL contains `pattern`, waiting for it to
    /// arrive and finish.
    pub async fn wait_for_response(
        &self,
        session_id: &str,
        pattern: &str,
        after: u64,
        timeout: Duration,
    ) -> Result<TrackedRequest, String> {
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            let changed = self.shared.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            let found = {
                let state = self.shared.state.lock().unwrap();
                state
                    .tracked
                    .iter()
                    .rev()
                    .find(|entry| {
                        entry.session_id == session_id
                            && entry.timestamp >= after
                            && entry.url.contains(pattern)
                            && (entry.status.is_some() || entry.failure_text.is_some())
                    })
                    .filter(|entry| entry.completed && !entry.body_pending)
                    .cloned()
            };
            if let Some(entry) = found.as_ref().filter(|entry| entry.left_in_browser()) {
                self.shared.state.lock().unwrap().reading += 1;
                let read = read_bodies(
                    self.client.clone(),
                    self.shared.clone(),
                    entry.source_session.clone(),
                    entry.request_id.clone(),
                    Keep::Newest,
                );
                if tokio::time::timeout_at(deadline, tokio::spawn(read)).await.is_ok() {
                    continue;
                }
            }
            if let Some(entry) = found {
                return match (&entry.failure_text, entry.status) {
                    (Some(failure), _) => Err(format!(
                        "Response matching '{}' failed to load: {}",
                        pattern, failure
                    )),
                    _ => Ok(entry),
                };
            }
            if tokio::time::timeout_at(deadline, changed).await.is_err() {
                return Err(format!(
                    "Timeout waiting for response matching '{}'",
                    pattern
                ));
            }
        }
    }

    pub async fn start_har(&self, session_id: &str) -> Result<(), String> {
        {
            let mut state = self.shared.state.lock().unwrap();
            state.har.insert(session_id.to_string(), Har::default());
            state.pages.insert(session_id.to_string());
        }
        self.observe(session_id).await
    }

    pub async fn stop_har(&self, session_id: Option<&str>) -> Option<HarCapture> {
        let deadline = tokio::time::Instant::now() + HAR_BODY_WAIT;
        loop {
            let changed = self.shared.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            if self.shared.state.lock().unwrap().reading == 0
                || tokio::time::timeout_at(deadline, changed).await.is_err()
            {
                break;
            }
        }
        let har = {
            let mut state = self.shared.state.lock().unwrap();
            state.har.remove(session_id?)
        };
        let har = har?;
        Some(HarCapture {
            bodies_captured: har
                .entries
                .iter()
                .filter(|entry| entry.response_body.is_some())
                .count(),
            truncated: har.truncated,
            entries: har.entries.into_iter().map(har_entry_to_json).collect(),
        })
    }

    pub async fn change_rules(
        &self,
        session_id: &str,
        change: impl FnOnce(&mut RequestRules),
    ) -> Result<(), String> {
        let patterns = {
            let mut state = self.shared.state.lock().unwrap();
            change(&mut state.rules);
            state.rules.patterns(session_id)
        };
        if patterns.is_empty() {
            self.client
                .send_command("Fetch.disable", None, Some(session_id))
                .await?;
        } else {
            self.client
                .send_command(
                    "Fetch.enable",
                    Some(json!({ "patterns": patterns })),
                    Some(session_id),
                )
                .await?;
        }
        Ok(())
    }
}

/// CDP keeps response bodies in the page's process, dropping the oldest. A page
/// nobody asked about keeps fewer.
fn buffers(every_body: bool) -> Value {
    let (total, resource) = match every_body {
        true => (100 * 1024 * 1024, 20 * 1024 * 1024),
        false => (16 * 1024 * 1024, 4 * 1024 * 1024),
    };
    json!({ "maxTotalBufferSize": total, "maxResourceBufferSize": resource })
}

fn flat() -> Value {
    json!({ "autoAttach": true, "waitForDebuggerOnStart": false, "flatten": true })
}

async fn watch(
    mut events: tokio::sync::broadcast::Receiver<CdpEvent>,
    client: Weak<CdpClient>,
    shared: Weak<Shared>,
    auto_attach: bool,
) {
    loop {
        let event = match events.recv().await {
            Ok(event) => event,
            Err(RecvError::Lagged(_)) => continue,
            Err(RecvError::Closed) => return,
        };
        let (Some(client), Some(shared)) = (client.upgrade(), shared.upgrade()) else {
            return;
        };
        match event.method.as_str() {
            "Fetch.requestPaused" => {
                let rules = shared.state.lock().unwrap().rules.clone();
                tokio::spawn(answer_paused(client, rules, event));
            }
            "Target.attachedToTarget" | "Page.frameDetached" => {
                follow_target(client, shared, event, auto_attach)
            }
            "Target.detachedFromTarget" => {
                if let Some(session) = text(&event.params, "sessionId") {
                    shared.state.lock().unwrap().forget(session);
                }
            }
            method if method.starts_with("Network.") => {
                record(&client, &shared, &event);
                shared.changed.notify_waiters();
            }
            _ => {}
        }
    }
}

/// Cross-origin frames and workers are targets of their own, whose traffic the
/// page's session doesn't report.
fn follow_target(
    client: Arc<CdpClient>,
    shared: Arc<Shared>,
    event: CdpEvent,
    auto_attach: bool,
) {
    let Some(parent) = event.session_id else {
        return;
    };
    let frame = match event.method.as_str() {
        "Page.frameDetached" => {
            if text(&event.params, "reason") != Some("swap") || auto_attach {
                return;
            }
            text(&event.params, "frameId").map(str::to_string)
        }
        _ => None,
    };
    let attached = text(&event.params, "sessionId").map(str::to_string);
    if !shared.state.lock().unwrap().active() {
        return;
    }
    tokio::spawn(async move {
        let session = match (attached, frame) {
            (Some(session), _) => session,
            (None, Some(frame)) => match client.attach_frame(&parent, &frame).await {
                Ok(session) => session,
                Err(_) => return,
            },
            (None, None) => return,
        };
        let buffers = {
            let mut state = shared.state.lock().unwrap();
            let root = state.root_of(&parent);
            if state.roots.insert(session.clone(), root).is_some() {
                return;
            }
            state.buffers()
        };
        let _ = client
            .send_command("Network.enable", Some(buffers), Some(&session))
            .await;
        if auto_attach {
            let _ = client
                .send_command("Target.setAutoAttach", Some(flat()), Some(&session))
                .await;
        } else {
            let _ = client
                .send_command_no_params("Page.enable", Some(&session))
                .await;
        }
    });
}

fn text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

fn now_seconds() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs_f64())
        .unwrap_or(0.0)
}

fn record(client: &Arc<CdpClient>, shared: &Arc<Shared>, event: &CdpEvent) {
    let Some(source) = event.session_id.as_deref() else {
        return;
    };
    let params = &event.params;
    let request_id = text(params, "requestId").unwrap_or("");
    let mut state = shared.state.lock().unwrap();
    if !state.active() {
        return;
    }
    match event.method.as_str() {
        "Network.requestWillBeSent" => request_sent(&mut state, source, request_id, params),
        "Network.responseReceived" => {
            if let Some(response) = params.get("response") {
                response_received(&mut state, source, request_id, response);
            }
        }
        "Network.loadingFinished" => {
            let finished = params.get("timestamp").and_then(Value::as_f64);
            let length = params.get("encodedDataLength").and_then(Value::as_i64);
            let every_body = state.wants_every_body();
            let small = length.is_none_or(|length| length <= EAGER_BODY_BYTES);
            let mut wanted = false;
            if let Some(entry) = state.har_mut(source, request_id) {
                entry.loading_finished_timestamp = finished;
                if let Some(length) = length {
                    entry.response_body_size = length;
                }
                wanted = har_is_api_shaped(&entry.resource_type, &entry.mime_type);
            }
            if let Some(entry) = state.tracked_mut(source, request_id) {
                entry.completed = true;
                let api = har_is_api_shaped(
                    &entry.resource_type,
                    entry.mime_type.as_deref().unwrap_or(""),
                );
                entry.body_pending = wanted || every_body || (api && small);
                wanted = entry.body_pending;
            }
            if wanted {
                state.reading += 1;
                tokio::spawn(read_bodies(
                    client.clone(),
                    shared.clone(),
                    source.to_string(),
                    request_id.to_string(),
                    Keep::Newest,
                ));
            }
        }
        "Network.loadingFailed" => {
            let failure = text(params, "errorText").map(str::to_string);
            if let Some(entry) = state.tracked_mut(source, request_id) {
                entry.completed = true;
                entry.failure_text = failure;
            }
        }
        "Network.webSocketCreated" => {
            let url = text(params, "url").unwrap_or("").to_string();
            let entry = stream_entry(source, request_id, url, "WebSocket");
            state.push_har(entry);
        }
        "Network.webSocketFrameSent" | "Network.webSocketFrameReceived" => {
            let direction = match event.method.as_str() {
                "Network.webSocketFrameSent" => "send",
                _ => "receive",
            };
            let payload = params.pointer("/response/payloadData").and_then(Value::as_str);
            let mut frame = stream_frame(direction, payload);
            frame["opcode"] = params
                .pointer("/response/opcode")
                .cloned()
                .unwrap_or(Value::Null);
            push_frame(&mut state, source, request_id, frame);
        }
        "Network.eventSourceMessageReceived" => {
            let mut frame = stream_frame("receive", text(params, "data"));
            for key in ["eventName", "eventId"] {
                frame[key] = params.get(key).cloned().unwrap_or(Value::Null);
            }
            push_frame(&mut state, source, request_id, frame);
        }
        _ => {}
    }
}

fn request_sent(state: &mut LogState, source: &str, request_id: &str, params: &Value) {
    // A redirect is reported as the next request's `redirectResponse`, under
    // the same id, rather than by a response event of its own.
    if let Some(response) = params.get("redirectResponse") {
        response_received(state, source, request_id, response);
        if let Some(entry) = state.tracked_mut(source, request_id) {
            entry.completed = true;
            entry.body_read = true;
        }
    }
    let Some(request) = params.get("request") else {
        return;
    };
    let method = text(request, "method").unwrap_or("GET").to_string();
    let url = text(request, "url").unwrap_or("").to_string();
    let resource_type = text(params, "type").unwrap_or("Other").to_string();
    let post_data = text(request, "postData").map(str::to_string);
    let has_post_data = request.get("hasPostData").and_then(Value::as_bool) == Some(true);
    if state.har.contains_key(&state.root_of(source)) {
        let request_body_size = post_data.as_ref().map_or(0, |body| body.len() as i64);
        state.push_har(HarEntry {
            request_id: request_id.to_string(),
            source_session: source.to_string(),
            wall_time: params
                .get("wallTime")
                .and_then(Value::as_f64)
                .unwrap_or(0.0),
            method: method.clone(),
            url: url.clone(),
            request_headers: har_extract_headers(request.get("headers")),
            post_data: post_data.clone(),
            post_data_elsewhere: has_post_data && post_data.is_none(),
            request_body_size,
            resource_type: resource_type.clone(),
            ..stream_entry(source, request_id, String::new(), "")
        });
    }
    let (post_data, post_data_truncated) = match post_data {
        Some(body) => {
            let (body, truncated) = truncate_utf8(&body, MAX_TRACKED_REQUEST_BODY_BYTES);
            (Some(body), truncated)
        }
        None => (None, false),
    };
    let session_id = state.root_of(source);
    state.push_tracked(TrackedRequest {
        request_id: request_id.to_string(),
        session_id,
        source_session: source.to_string(),
        body_pending: false,
        body_read: false,
        url,
        method,
        headers: bounded_header_object(request.get("headers")),
        post_data,
        post_data_truncated,
        timestamp: (now_seconds() * 1_000.0) as u64,
        resource_type,
        status: None,
        response_headers: None,
        mime_type: None,
        body: None,
        body_base64: false,
        body_truncated: false,
        completed: false,
        failure_text: None,
    });
}

fn response_received(state: &mut LogState, source: &str, request_id: &str, response: &Value) {
    let status = response.get("status").and_then(Value::as_i64);
    let mime_type = text(response, "mimeType").unwrap_or("").to_string();
    if let Some(entry) = state.har_mut(source, request_id) {
        entry.status = status;
        entry.status_text = text(response, "statusText").unwrap_or("").to_string();
        entry.mime_type = mime_type.clone();
        entry.http_version = text(response, "protocol")
            .map(har_cdp_protocol_to_http_version)
            .unwrap_or_else(|| "HTTP/1.1".to_string());
        entry.response_headers = har_extract_headers(response.get("headers"));
        entry.redirect_url = entry
            .response_headers
            .iter()
            .find(|(name, _)| name.eq_ignore_ascii_case("location"))
            .map(|(_, value)| value.clone())
            .unwrap_or_default();
        entry.response_body_size = response
            .get("encodedDataLength")
            .and_then(Value::as_i64)
            .unwrap_or(-1);
        entry.cdp_timing = response.get("timing").cloned();
    }
    if let Some(entry) = state.tracked_mut(source, request_id) {
        entry.status = status;
        entry.response_headers = Some(bounded_header_object(response.get("headers")));
        entry.mime_type = Some(mime_type);
    }
}

fn stream_entry(source: &str, request_id: &str, url: String, kind: &str) -> HarEntry {
    let socket = kind == "WebSocket";
    HarEntry {
        request_id: request_id.to_string(),
        source_session: source.to_string(),
        wall_time: now_seconds(),
        method: "GET".to_string(),
        url,
        request_headers: Vec::new(),
        post_data: None,
        post_data_elsewhere: false,
        request_body_size: 0,
        resource_type: kind.to_string(),
        status: socket.then_some(101),
        status_text: String::new(),
        http_version: "HTTP/1.1".to_string(),
        response_headers: Vec::new(),
        mime_type: String::new(),
        redirect_url: String::new(),
        response_body_size: -1,
        response_body: None,
        response_body_base64: false,
        response_body_truncated: false,
        cdp_timing: None,
        loading_finished_timestamp: None,
        frames: Vec::new(),
        frames_truncated: false,
    }
}

fn stream_frame(direction: &str, payload: Option<&str>) -> Value {
    json!({
        "type": direction,
        "time": now_seconds(),
        "data": truncate_utf8(payload.unwrap_or(""), HAR_MAX_FRAME_BYTES).0,
    })
}

fn push_frame(state: &mut LogState, source: &str, request_id: &str, frame: Value) {
    let Some(entry) = state.har_mut(source, request_id) else {
        return;
    };
    if entry.frames.len() >= HAR_MAX_STREAM_FRAMES {
        entry.frames_truncated = true;
        return;
    }
    entry.frames.push(frame);
}

/// Whether a body may push out older ones.
#[derive(Clone, Copy)]
enum Keep {
    Newest,
    IfRoom,
}

async fn read_bodies(
    client: Arc<CdpClient>,
    shared: Arc<Shared>,
    source: String,
    request_id: String,
    keep: Keep,
) {
    let params = json!({ "requestId": request_id });
    let wants_post_data = shared
        .state
        .lock()
        .unwrap()
        .har_mut(&source, &request_id)
        .is_some_and(|entry| entry.post_data_elsewhere);
    let post_data = match wants_post_data {
        true => client
            .send_command(
                "Network.getRequestPostData",
                Some(params.clone()),
                Some(&source),
            )
            .await
            .ok()
            .and_then(|value| text(&value, "postData").map(str::to_string)),
        false => None,
    };
    let response = client
        .send_command("Network.getResponseBody", Some(params), Some(&source))
        .await
        .unwrap_or(Value::Null);
    let body = text(&response, "body");
    let base64 = response.get("base64Encoded").and_then(Value::as_bool) == Some(true);

    let mut state = shared.state.lock().unwrap();
    let page = state.root_of(&source);
    let har_room = state.har.get(&page).map_or(0, |har| {
        HAR_MAX_TOTAL_BODY_BYTES.saturating_sub(har.body_bytes)
    });
    let mut kept = 0;
    if let Some(entry) = state.har_mut(&source, &request_id) {
        if let Some(post_data) = post_data {
            entry.request_body_size = post_data.len() as i64;
            entry.post_data = Some(post_data);
        }
        let wanted = har_is_api_shaped(&entry.resource_type, &entry.mime_type) && har_room > 0;
        if let (Some(body), true) = (body, wanted) {
            let (body, truncated) = truncate_utf8(body, HAR_MAX_BODY_BYTES);
            kept = body.len();
            entry.response_body = Some(body);
            entry.response_body_base64 = base64;
            entry.response_body_truncated = truncated;
        }
    }
    if let Some(har) = state.har.get_mut(&page) {
        har.body_bytes += kept;
    }
    if let (Some(body), Keep::Newest) = (body, keep) {
        state.make_room(&page, body.len().min(MAX_TRACKED_BODY_BYTES));
    }
    let room = MAX_TRACKED_TOTAL_BODY_BYTES.saturating_sub(state.body_bytes(&page));
    if let Some(entry) = state.tracked_mut(&source, &request_id) {
        entry.body_pending = false;
        entry.body_read = true;
        if let Some(body) = body {
            let (body, truncated) = truncate_utf8(body, MAX_TRACKED_BODY_BYTES.min(room));
            entry.body = Some(body);
            entry.body_base64 = base64;
            entry.body_truncated = truncated;
        }
    }
    state.reading = state.reading.saturating_sub(1);
    drop(state);
    shared.changed.notify_waiters();
}

async fn answer_paused(client: Arc<CdpClient>, rules: RequestRules, event: CdpEvent) {
    let Some(session_id) = event.session_id else {
        return;
    };
    let request = event.params.get("request").cloned().unwrap_or(Value::Null);
    let paused = FetchPausedRequest {
        request_id: text(&event.params, "requestId").unwrap_or("").to_string(),
        url: text(&request, "url").unwrap_or("").to_string(),
        resource_type: text(&event.params, "resourceType").unwrap_or("").to_string(),
        session_id,
        headers: request.get("headers").cloned().unwrap_or_else(|| json!({})),
        post_data: text(&request, "postData").map(str::to_string),
    };
    resolve_fetch_paused(&client, &rules, &paused).await;
}

struct FetchPausedRequest {
    request_id: String,
    url: String,
    resource_type: String,
    session_id: String,
    headers: Value,
    post_data: Option<String>,
}

fn truncate_utf8(value: &str, max_bytes: usize) -> (String, bool) {
    if value.len() <= max_bytes {
        return (value.to_string(), false);
    }
    let mut end = max_bytes;
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    (value[..end].to_string(), true)
}

fn har_entry_to_json(e: HarEntry) -> Value {
    let started_date_time = har_wall_time_to_rfc3339(e.wall_time);

    let request_cookies = e
        .request_headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("cookie"))
        .map(|(_, v)| har_parse_request_cookies(v))
        .unwrap_or_default();

    let query_string = har_parse_query_string(&e.url);

    let req_headers: Vec<Value> = e
        .request_headers
        .iter()
        .map(|(k, v)| json!({ "name": k, "value": v }))
        .collect();

    let resp_cookies: Vec<Value> = e
        .response_headers
        .iter()
        .filter(|(k, _)| k.eq_ignore_ascii_case("set-cookie"))
        .map(|(_, v)| {
            let name_value = v.split(';').next().unwrap_or("");
            let (name, value) = name_value.split_once('=').unwrap_or((name_value, ""));
            json!({ "name": name.trim(), "value": value.trim() })
        })
        .collect();

    let resp_headers: Vec<Value> = e
        .response_headers
        .iter()
        .map(|(k, v)| json!({ "name": k, "value": v }))
        .collect();

    let (timings, total_time) =
        har_compute_timings(e.cdp_timing.as_ref(), e.loading_finished_timestamp);

    let mime_type = if e.mime_type.is_empty() {
        "application/octet-stream".to_string()
    } else {
        e.mime_type
    };

    let post_content_type = e
        .request_headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("content-type"))
        .map(|(_, v)| v.as_str())
        .unwrap_or("text/plain")
        .to_string();

    let mut request = json!({
        "method": e.method,
        "url": e.url,
        "httpVersion": e.http_version,
        "cookies": request_cookies,
        "headers": req_headers,
        "queryString": query_string,
        "headersSize": -1,
        "bodySize": e.request_body_size,
    });
    if let Some(body) = e.post_data {
        request["postData"] = json!({ "mimeType": post_content_type, "text": body });
    }

    let mut content = json!({
        "size": e.response_body_size,
        "mimeType": mime_type,
    });
    if let Some(body) = e.response_body {
        content["text"] = json!(body);
        if e.response_body_base64 {
            content["encoding"] = json!("base64");
        }
        if e.response_body_truncated {
            content["_truncated"] = json!(true);
        }
    }

    let mut entry = json!({
        "startedDateTime": started_date_time,
        "time": total_time,
        "request": request,
        "response": {
            "status": e.status.unwrap_or(0),
            "statusText": e.status_text,
            "httpVersion": e.http_version,
            "cookies": resp_cookies,
            "headers": resp_headers,
            "content": content,
            "redirectURL": e.redirect_url,
            "headersSize": -1,
            "bodySize": e.response_body_size,
        },
        "cache": {},
        "timings": timings,
        "_resourceType": e.resource_type,
    });
    if !e.frames.is_empty() {
        let key = match e.resource_type.as_str() {
            "EventSource" => "_eventSourceMessages",
            _ => "_webSocketMessages",
        };
        entry[key] = Value::Array(e.frames);
        if e.frames_truncated {
            entry["_framesTruncated"] = json!(true);
        }
    }
    entry
}

async fn resolve_fetch_paused(
    client: &CdpClient,
    rules: &RequestRules,
    paused: &FetchPausedRequest,
) {
    let session_id = &paused.session_id;

    if let Some(filter) = rules.domain_filter.as_ref() {
        if let Ok(parsed) = url::Url::parse(&paused.url) {
            let scheme = parsed.scheme();
            if scheme != "http" && scheme != "https" {
                if paused.resource_type.eq_ignore_ascii_case("document") {
                    let _ = client
                        .send_command(
                            "Fetch.failRequest",
                            Some(json!({
                                "requestId": paused.request_id,
                                "errorReason": "BlockedByClient"
                            })),
                            Some(session_id),
                        )
                        .await;
                } else {
                    let _ = client
                        .send_command(
                            "Fetch.continueRequest",
                            Some(json!({ "requestId": paused.request_id })),
                            Some(session_id),
                        )
                        .await;
                }
                return;
            }

            if let Some(hostname) = parsed.host_str() {
                if !filter.is_allowed(hostname) {
                    if paused.resource_type.eq_ignore_ascii_case("document") {
                        let error_body = format!(
                            "<html><body><h1>Blocked</h1><p>Navigation to {} is not allowed by domain filter.</p></body></html>",
                            hostname
                        );
                        let encoded = base64::Engine::encode(
                            &base64::engine::general_purpose::STANDARD,
                            error_body.as_bytes(),
                        );
                        let _ = client
                            .send_command(
                                "Fetch.fulfillRequest",
                                Some(json!({
                                    "requestId": paused.request_id,
                                    "responseCode": 403,
                                    "responseHeaders": [
                                        { "name": "Content-Type", "value": "text/html" },
                                    ],
                                    "body": encoded,
                                })),
                                Some(session_id),
                            )
                            .await;
                    } else {
                        let _ = client
                            .send_command(
                                "Fetch.failRequest",
                                Some(json!({
                                    "requestId": paused.request_id,
                                    "errorReason": "BlockedByClient"
                                })),
                                Some(session_id),
                            )
                            .await;
                    }
                    return;
                }
            }
        }
    }

    for route in &rules.routes {
        let matches = url_pattern_matches(&route.url_pattern, &paused.url);

        if matches {
            if route.abort {
                let _ = client
                    .send_command(
                        "Fetch.failRequest",
                        Some(json!({
                            "requestId": paused.request_id,
                            "errorReason": "Failed"
                        })),
                        Some(session_id),
                    )
                    .await;
                return;
            }

            if let Some(ref resp) = route.response {
                let status = resp.status.unwrap_or(200);
                let body_str = resp.body.as_deref().unwrap_or("");
                let encoded = base64::Engine::encode(
                    &base64::engine::general_purpose::STANDARD,
                    body_str.as_bytes(),
                );
                let mut headers = vec![];
                if let Some(ct) = &resp.content_type {
                    headers.push(json!({ "name": "Content-Type", "value": ct }));
                }
                if let Some(h) = &resp.headers {
                    for (k, v) in h {
                        headers.push(json!({ "name": k, "value": v }));
                    }
                }

                let _ = client
                    .send_command(
                        "Fetch.fulfillRequest",
                        Some(json!({
                            "requestId": paused.request_id,
                            "responseCode": status,
                            "responseHeaders": headers,
                            "body": encoded,
                        })),
                        Some(session_id),
                    )
                    .await;
                return;
            }
        }
    }

    if let Some(rewrite) = rules.rewrites.iter().rev().find(|rewrite| {
        rewrite.session_id == paused.session_id
            && url_pattern_matches(&rewrite.url_pattern, &paused.url)
    }) {
        let mut params = json!({ "requestId": paused.request_id });
        if let Some(method) = &rewrite.method {
            params["method"] = json!(method);
        }
        let rewritten_post_data = if let Some(json_patch) = &rewrite.json_patch {
            paused
                .post_data
                .as_deref()
                .and_then(|post_data| serde_json::from_str::<Value>(post_data).ok())
                .map(|mut body| {
                    merge_json_value(&mut body, json_patch);
                    body.to_string()
                })
                .or_else(|| rewrite.post_data.clone())
        } else {
            rewrite.post_data.clone()
        };
        if let Some(post_data) = rewritten_post_data {
            params["postData"] = json!(base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                post_data.as_bytes(),
            ));
        }
        if !rewrite.headers.is_empty() {
            let mut headers: HashMap<String, String> = paused
                .headers
                .as_object()
                .into_iter()
                .flatten()
                .filter_map(|(name, value)| {
                    value
                        .as_str()
                        .map(|value| (name.clone(), value.to_string()))
                })
                .collect();
            for (name, value) in &rewrite.headers {
                headers.insert(name.clone(), value.clone());
            }
            params["headers"] = json!(headers
                .into_iter()
                .map(|(name, value)| json!({ "name": name, "value": value }))
                .collect::<Vec<_>>());
        }
        let _ = client
            .send_command("Fetch.continueRequest", Some(params), Some(session_id))
            .await;
        return;
    }

    let _ = client
        .send_command(
            "Fetch.continueRequest",
            Some(json!({ "requestId": paused.request_id })),
            Some(session_id),
        )
        .await;
}

fn url_pattern_matches(pattern: &str, url: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    if !pattern.contains('*') {
        return url.contains(pattern);
    }
    let mut remainder = url;
    let mut first = true;
    for part in pattern.split('*').filter(|part| !part.is_empty()) {
        let Some(index) = remainder.find(part) else {
            return false;
        };
        if first && !pattern.starts_with('*') && index != 0 {
            return false;
        }
        remainder = &remainder[index + part.len()..];
        first = false;
    }
    pattern.ends_with('*') || remainder.is_empty()
}

fn merge_json_value(target: &mut Value, patch: &Value) {
    let Value::Object(patch_object) = patch else {
        *target = patch.clone();
        return;
    };
    if !target.is_object() {
        *target = json!({});
    }
    let target_object = target.as_object_mut().expect("target converted to object");
    for (key, patch_value) in patch_object {
        if patch_value.is_null() {
            target_object.remove(key);
            continue;
        }
        merge_json_value(
            target_object.entry(key.clone()).or_insert(Value::Null),
            patch_value,
        );
    }
}

fn bounded_header_object(headers: Option<&Value>) -> Value {
    Value::Object(
        headers
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .take(MAX_TRACKED_HEADERS)
            .map(|(name, value)| {
                let (text, _) =
                    truncate_utf8(value.as_str().unwrap_or(""), MAX_TRACKED_HEADER_VALUE_BYTES);
                (name.clone(), Value::String(text))
            })
            .collect(),
    )
}

fn har_is_api_shaped(resource_type: &str, mime_type: &str) -> bool {
    if resource_type == "XHR" || resource_type == "Fetch" {
        return true;
    }
    let mime = mime_type.to_ascii_lowercase();
    mime.contains("json") || mime.contains("graphql")
}

fn har_extract_headers(headers_val: Option<&Value>) -> Vec<(String, String)> {
    headers_val
        .and_then(|v| v.as_object())
        .map(|obj| {
            obj.iter()
                .map(|(k, v)| (k.clone(), v.as_str().unwrap_or("").to_string()))
                .collect()
        })
        .unwrap_or_default()
}

fn har_cdp_protocol_to_http_version(protocol: &str) -> String {
    match protocol.to_ascii_lowercase().as_str() {
        "h2" => "HTTP/2.0".to_string(),
        "h3" => "HTTP/3.0".to_string(),
        "http/1.0" => "HTTP/1.0".to_string(),
        _ => "HTTP/1.1".to_string(),
    }
}

fn har_parse_query_string(url_str: &str) -> Vec<Value> {
    url::Url::parse(url_str)
        .map(|u| {
            u.query_pairs()
                .map(|(k, v)| json!({ "name": k.as_ref(), "value": v.as_ref() }))
                .collect()
        })
        .unwrap_or_default()
}

fn har_parse_request_cookies(cookie_header: &str) -> Vec<Value> {
    cookie_header
        .split(';')
        .filter_map(|pair| {
            let pair = pair.trim();
            if pair.is_empty() {
                return None;
            }
            let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
            Some(json!({ "name": name.trim(), "value": value.trim() }))
        })
        .collect()
}

fn har_compute_timings(
    cdp_timing: Option<&Value>,
    loading_finished_ts: Option<f64>,
) -> (Value, f64) {
    let Some(t) = cdp_timing else {
        return (json!({ "send": 0, "wait": 0, "receive": 0 }), 0.0);
    };

    let get = |key: &str| t.get(key).and_then(|v| v.as_f64()).unwrap_or(-1.0);

    let request_time = get("requestTime");
    let dns_start = get("dnsStart");
    let dns_end = get("dnsEnd");
    let connect_start = get("connectStart");
    let connect_end = get("connectEnd");
    let ssl_start = get("sslStart");
    let ssl_end = get("sslEnd");
    let send_start = get("sendStart");
    let send_end = get("sendEnd");
    let recv_headers_start = get("receiveHeadersStart");
    let recv_headers_end = get("receiveHeadersEnd");

    let dns = if dns_start >= 0.0 && dns_end >= 0.0 {
        dns_end - dns_start
    } else {
        -1.0
    };
    let connect = if connect_start >= 0.0 && connect_end >= 0.0 {
        connect_end - connect_start
    } else {
        -1.0
    };
    let ssl = if ssl_start >= 0.0 && ssl_end >= 0.0 {
        ssl_end - ssl_start
    } else {
        -1.0
    };
    let send = (send_end - send_start).max(0.0);

    let wait_end = if recv_headers_start >= 0.0 {
        recv_headers_start
    } else {
        recv_headers_end
    };
    let wait = if send_end >= 0.0 && wait_end >= send_end {
        wait_end - send_end
    } else {
        0.0
    };

    let receive = loading_finished_ts
        .filter(|_| request_time >= 0.0 && recv_headers_end >= 0.0)
        .map(|lf_ts| {
            let recv_start_abs = request_time + recv_headers_end / 1000.0;
            ((lf_ts - recv_start_abs) * 1000.0).max(0.0)
        })
        .unwrap_or(0.0);

    let blocked = if dns_start > 0.0 {
        dns_start
    } else if connect_start > 0.0 {
        connect_start
    } else if send_start > 0.0 {
        send_start
    } else {
        -1.0
    };

    let total: f64 = [
        if blocked > 0.0 { blocked } else { 0.0 },
        if dns >= 0.0 { dns } else { 0.0 },
        if connect >= 0.0 { connect } else { 0.0 },
        send,
        wait,
        receive,
    ]
    .iter()
    .sum();

    let mut timings = json!({ "send": send, "wait": wait, "receive": receive });
    if blocked > 0.0 {
        timings["blocked"] = json!(blocked);
    }
    if dns >= 0.0 {
        timings["dns"] = json!(dns);
    }
    if connect >= 0.0 {
        timings["connect"] = json!(connect);
    }
    if ssl >= 0.0 {
        timings["ssl"] = json!(ssl);
    }

    (timings, total)
}

fn har_wall_time_to_rfc3339(wall_time: f64) -> String {
    if wall_time > 0.0 {
        let nanos = (wall_time * 1_000_000_000.0).round() as i128;
        if let Ok(dt) = OffsetDateTime::from_unix_timestamp_nanos(nanos) {
            if let Ok(s) = dt.format(&Rfc3339) {
                return s;
            }
        }
    }
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}
