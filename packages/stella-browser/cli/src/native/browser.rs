use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::io::Write as _;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, Mutex};

use super::cdp::chrome::{auto_connect_cdp, launch_chrome, ChromeProcess, LaunchOptions};
use super::cdp::client::CdpClient;
use super::cdp::discovery::discover_cdp_url;
use super::cdp::lightpanda::{launch_lightpanda, LightpandaLaunchOptions, LightpandaProcess};
use super::cdp::types::*;
use super::dialogs::Dialogs;
use super::extension_pipe::{tab_session, PipeTab};

pub fn validate_launch_options(
    extensions: Option<&[String]>,
    has_cdp: bool,
    profile: Option<&str>,
    storage_state: Option<&str>,
    allow_file_access: bool,
    executable_path: Option<&str>,
) -> Result<(), String> {
    let has_extensions = extensions.map(|e| !e.is_empty()).unwrap_or(false);

    if has_extensions && has_cdp {
        return Err(
            "Cannot use extensions with cdp_url (extensions require local browser launch)"
                .to_string(),
        );
    }
    if profile.is_some() && has_cdp {
        return Err(
            "Cannot use profile with cdp_url (profile requires local browser launch)".to_string(),
        );
    }
    if storage_state.is_some() && profile.is_some() {
        return Err("Cannot use storage_state with profile".to_string());
    }
    if storage_state.is_some() && has_extensions {
        return Err("Cannot use storage_state with extensions".to_string());
    }
    if allow_file_access {
        if let Some(path) = executable_path {
            let lower = path.to_lowercase();
            if lower.contains("firefox") || lower.contains("webkit") || lower.contains("safari") {
                return Err(
                    "allow_file_access is not supported with non-Chromium browsers".to_string(),
                );
            }
        }
    }
    Ok(())
}

fn validate_lightpanda_options(options: &LaunchOptions) -> Result<(), String> {
    if options
        .extensions
        .as_ref()
        .map(|e| !e.is_empty())
        .unwrap_or(false)
    {
        return Err("Extensions are not supported with Lightpanda".to_string());
    }
    if options.profile.is_some() {
        return Err("Profiles are not supported with Lightpanda".to_string());
    }
    if options.storage_state.is_some() {
        return Err("Storage state is not supported with Lightpanda".to_string());
    }
    if options.allow_file_access {
        return Err("File access is not supported with Lightpanda".to_string());
    }
    if !options.headless {
        return Err("Headed mode is not supported with Lightpanda (headless only)".to_string());
    }
    if !options.args.is_empty() {
        return Err(
            "Custom Chrome arguments (--args) are not supported with Lightpanda".to_string(),
        );
    }
    Ok(())
}

fn is_internal_chrome_target(url: &str) -> bool {
    url.starts_with("chrome://")
        || url.starts_with("chrome-extension://")
        || url.starts_with("devtools://")
}

pub fn to_ai_friendly_error(error: &str) -> String {
    let lower = error.to_lowercase();
    if lower.starts_with("no element found with ") || lower.starts_with("element not found: ") {
        return error.to_string();
    }
    if lower.contains("strict mode violation") {
        return "Element matched multiple results. Use a more specific selector.".to_string();
    }
    if lower.contains("element is not visible") {
        return "Element exists but is not visible. Wait for it to become visible or scroll it into view."
            .to_string();
    }
    if lower.contains("intercept") {
        return "Another element is covering the target element. Try scrolling or closing overlays."
            .to_string();
    }
    if lower.contains("timeout") {
        return "Operation timed out. The page may still be loading or the element may not exist."
            .to_string();
    }
    if lower.contains("element not found") || lower.contains("no element") {
        return "Element not found. Verify the selector is correct and the element exists in the DOM."
            .to_string();
    }
    error.to_string()
}

#[derive(Debug, Clone)]
pub struct PageInfo {
    pub target_id: String,
    pub session_id: String,
    pub tab_id: u64,
    pub tab_generation: String,
    pub url: String,
    pub title: String,
    pub target_type: String,
}

#[derive(Debug, Clone, Copy)]
pub enum WaitUntil {
    None,
    Load,
    DomContentLoaded,
    NetworkIdle,
}

/// A page too busy to answer doesn't hold up the result of loading it.
const PAGE_ANSWER_TIMEOUT: Duration = Duration::from_secs(2);

/// How far a navigation got within its time.
#[derive(PartialEq)]
enum Progress {
    Reached,
    Committed,
    NotStarted,
}

impl WaitUntil {
    pub fn from_str(s: &str) -> Self {
        match s {
            "none" => Self::None,
            "domcontentloaded" => Self::DomContentLoaded,
            "networkidle" => Self::NetworkIdle,
            _ => Self::Load,
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Load => "load",
            Self::DomContentLoaded => "domcontentloaded",
            Self::NetworkIdle => "networkidle",
        }
    }
}

pub enum BrowserProcess {
    Chrome(ChromeProcess),
    Lightpanda(LightpandaProcess),
}

impl BrowserProcess {
    pub fn kill(&mut self) {
        match self {
            BrowserProcess::Chrome(p) => p.kill(),
            BrowserProcess::Lightpanda(p) => p.kill(),
        }
    }

    pub fn wait_or_kill(&mut self, timeout: std::time::Duration) {
        match self {
            BrowserProcess::Chrome(p) => p.wait_or_kill(timeout),
            BrowserProcess::Lightpanda(p) => p.kill(),
        }
    }
}

pub struct BrowserManager {
    pub client: Arc<CdpClient>,
    browser_process: Option<BrowserProcess>,
    ws_url: String,
    pages: Vec<PageInfo>,
    active_page_index: usize,
    default_timeout_ms: u64,
    target_tab_ids: HashMap<String, u64>,
    target_tab_generations: HashMap<String, String>,
    owner_tabs: OwnerTabRegistry,
    pub dialogs: Dialogs,
}

#[derive(Default)]
pub struct OwnerTabRegistry {
    tabs_by_owner: HashMap<String, Vec<u64>>,
    active_tab_by_owner: HashMap<String, u64>,
}

impl OwnerTabRegistry {
    pub fn record(&mut self, owner_id: &str, tab_id: u64) {
        let owner_id = owner_id.trim();
        if owner_id.is_empty() || tab_id == 0 {
            return;
        }
        let tabs = self.tabs_by_owner.entry(owner_id.to_string()).or_default();
        if !tabs.contains(&tab_id) {
            tabs.push(tab_id);
            self.active_tab_by_owner
                .insert(owner_id.to_string(), tab_id);
        }
    }

    pub fn tab_ids(&self, owner_id: &str) -> Vec<u64> {
        self.tabs_by_owner
            .get(owner_id.trim())
            .cloned()
            .unwrap_or_default()
    }

    pub fn owner_of(&self, tab_id: u64) -> Option<&str> {
        self.tabs_by_owner
            .iter()
            .find(|(_, tabs)| tabs.contains(&tab_id))
            .map(|(owner_id, _)| owner_id.as_str())
    }

    pub fn is_owned(&self, tab_id: u64) -> bool {
        self.tabs_by_owner
            .values()
            .any(|tabs| tabs.contains(&tab_id))
    }

    pub fn is_owned_by(&self, owner_id: &str, tab_id: u64) -> bool {
        self.tabs_by_owner
            .get(owner_id.trim())
            .is_some_and(|tabs| tabs.contains(&tab_id))
    }

    pub fn can_access(&self, owner_id: Option<&str>, tab_id: u64) -> bool {
        let Some(owner_id) = owner_id else {
            return true;
        };
        self.is_owned_by(owner_id, tab_id)
    }

    pub fn mark_active(&mut self, owner_id: &str, tab_id: u64) {
        let owner_id = owner_id.trim();
        if self.is_owned_by(owner_id, tab_id) {
            self.active_tab_by_owner
                .insert(owner_id.to_string(), tab_id);
        }
    }

    pub fn active_tab_id(&self, owner_id: &str) -> Option<u64> {
        self.active_tab_by_owner.get(owner_id.trim()).copied()
    }

    pub fn release(&mut self, owner_id: &str, tab_id: u64) {
        let owner_id = owner_id.trim();
        if let Some(tabs) = self.tabs_by_owner.get_mut(owner_id) {
            tabs.retain(|candidate| *candidate != tab_id);
            if tabs.is_empty() {
                self.tabs_by_owner.remove(owner_id);
                self.active_tab_by_owner.remove(owner_id);
            } else if self.active_tab_by_owner.get(owner_id) == Some(&tab_id) {
                if let Some(fallback) = tabs.last().copied() {
                    self.active_tab_by_owner
                        .insert(owner_id.to_string(), fallback);
                }
            }
        }
    }

    pub fn forget_tab(&mut self, tab_id: u64) {
        self.tabs_by_owner.retain(|owner_id, tabs| {
            tabs.retain(|candidate| *candidate != tab_id);
            if self.active_tab_by_owner.get(owner_id) == Some(&tab_id) {
                if let Some(fallback) = tabs.last().copied() {
                    self.active_tab_by_owner.insert(owner_id.clone(), fallback);
                } else {
                    self.active_tab_by_owner.remove(owner_id);
                }
            }
            !tabs.is_empty()
        });
    }
}

const LIGHTPANDA_CDP_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const LIGHTPANDA_CDP_CONNECT_POLL_INTERVAL: Duration = Duration::from_millis(100);
const LIGHTPANDA_TARGET_INIT_TIMEOUT: Duration = Duration::from_secs(10);

fn is_target_churn_error(error: &str) -> bool {
    let normalized = error.to_ascii_lowercase();
    normalized.contains("browser tab not found")
        || normalized.contains("browser target was not found")
        || normalized.contains("no target with given id")
        || normalized.contains("session with given id not found")
}

impl BrowserManager {
    pub async fn launch(options: LaunchOptions, engine: Option<&str>) -> Result<Self, String> {
        let engine = engine.unwrap_or("chrome");

        match engine {
            "chrome" => {
                validate_launch_options(
                    options.extensions.as_deref(),
                    false,
                    options.profile.as_deref(),
                    options.storage_state.as_deref(),
                    options.allow_file_access,
                    options.executable_path.as_deref(),
                )?;
            }
            "lightpanda" => {
                validate_lightpanda_options(&options)?;
            }
            _ => {
                return Err(format!(
                    "Unknown engine '{}'. Supported engines: chrome, lightpanda",
                    engine
                ));
            }
        }

        let ignore_https_errors = options.ignore_https_errors;
        let user_agent = options.user_agent.clone();
        let color_scheme = options.color_scheme.clone();
        let download_path = options.download_path.clone();

        let (ws_url, process) = match engine {
            "lightpanda" => {
                let lp_options = LightpandaLaunchOptions {
                    executable_path: options.executable_path.clone(),
                    proxy: options.proxy.clone(),
                    port: None,
                };
                let lp = launch_lightpanda(&lp_options).await?;
                let url = lp.ws_url.clone();
                (url, BrowserProcess::Lightpanda(lp))
            }
            _ => {
                let chrome = tokio::task::spawn_blocking(move || launch_chrome(&options))
                    .await
                    .map_err(|e| format!("Chrome launch task failed: {}", e))??;
                let url = chrome.ws_url.clone();
                (url, BrowserProcess::Chrome(chrome))
            }
        };

        let manager = if engine == "lightpanda" {
            initialize_lightpanda_manager(ws_url, process).await?
        } else {
            let client = Arc::new(CdpClient::connect(&ws_url).await?);
            let dialogs = Dialogs::answer_always(&client);
            let mut manager = Self {
                dialogs,
                client,
                browser_process: Some(process),
                ws_url,
                pages: Vec::new(),
                active_page_index: 0,
                default_timeout_ms: 25_000,
                target_tab_ids: HashMap::new(),
                target_tab_generations: HashMap::new(),
                owner_tabs: OwnerTabRegistry::default(),
            };
            manager.discover_and_attach_targets().await?;
            manager.ensure_page().await?;
            manager
        };

        let session_id = manager.active_session_id()?.to_string();

        if ignore_https_errors {
            let _ = manager
                .client
                .send_command(
                    "Security.setIgnoreCertificateErrors",
                    Some(json!({ "ignore": true })),
                    Some(&session_id),
                )
                .await;
        }

        if let Some(ref ua) = user_agent {
            let _ = manager
                .client
                .send_command(
                    "Emulation.setUserAgentOverride",
                    Some(json!({ "userAgent": ua })),
                    Some(&session_id),
                )
                .await;
        }

        if let Some(ref scheme) = color_scheme {
            let _ = manager
                .client
                .send_command(
                    "Emulation.setEmulatedMedia",
                    Some(json!({ "features": [{ "name": "prefers-color-scheme", "value": scheme }] })),
                    Some(&session_id),
                )
                .await;
        }

        if let Some(ref path) = download_path {
            let _ = manager
                .client
                .send_command(
                    "Browser.setDownloadBehavior",
                    Some(json!({ "behavior": "allow", "downloadPath": path })),
                    None,
                )
                .await;
        }

        Ok(manager)
    }

    pub async fn connect_cdp(url: &str) -> Result<Self, String> {
        let ws_url = resolve_cdp_url(url).await?;
        let client = Arc::new(CdpClient::connect(&ws_url).await?);
        let dialogs = Dialogs::answer_always(&client);
        let mut manager = Self {
            dialogs,
            client,
            browser_process: None,
            ws_url,
            pages: Vec::new(),
            active_page_index: 0,
            default_timeout_ms: 10_000,
            target_tab_ids: HashMap::new(),
            target_tab_generations: HashMap::new(),
            owner_tabs: OwnerTabRegistry::default(),
        };

        manager.discover_and_attach_targets().await?;
        Ok(manager)
    }

    /// Drives tabs the Stella Browser extension attaches, through `client`.
    pub fn over_pipe(client: Arc<CdpClient>) -> Self {
        let dialogs = Dialogs::answer_during_commands(&client);
        Self {
            dialogs,
            client,
            browser_process: None,
            ws_url: String::new(),
            pages: Vec::new(),
            active_page_index: 0,
            default_timeout_ms: 25_000,
            target_tab_ids: HashMap::new(),
            target_tab_generations: HashMap::new(),
            owner_tabs: OwnerTabRegistry::default(),
        }
    }

    /// Makes a tab of the user's browser the active page, without bringing it
    /// to the front. `known` is false when it was just attached.
    pub async fn show_pipe_tab(&mut self, tab: PipeTab, known: bool) -> Result<(), String> {
        let session_id = tab_session(tab.tab_id);
        if !known {
            self.remove_page_by_target_id(&session_id);
        }
        if let Some(index) = self.tab_index_by_id(tab.tab_id) {
            self.active_page_index = index;
            self.pages[index].url = tab.url;
            self.pages[index].title = tab.title;
            return Ok(());
        }
        self.enable_domains(&session_id).await?;
        self.target_tab_ids.insert(session_id.clone(), tab.tab_id);
        self.pages.push(PageInfo {
            target_id: session_id.clone(),
            session_id,
            tab_id: tab.tab_id,
            tab_generation: String::new(),
            url: tab.url,
            title: tab.title,
            target_type: "page".to_string(),
        });
        self.active_page_index = self.pages.len() - 1;
        Ok(())
    }

    pub fn forget_pages(&mut self) {
        self.pages.clear();
        self.active_page_index = 0;
    }

    pub async fn connect_auto() -> Result<Self, String> {
        let ws_url = auto_connect_cdp().await?;
        Self::connect_cdp(&ws_url).await
    }

    async fn discover_and_attach_targets(&mut self) -> Result<(), String> {
        self.client
            .send_command_typed::<_, Value>(
                "Target.setDiscoverTargets",
                &SetDiscoverTargetsParams { discover: true },
                None,
            )
            .await?;

        const MAX_DISCOVERY_PASSES: usize = 3;
        let mut last_error: Option<String> = None;
        let mut quarantined_target_ids = HashSet::new();

        for _ in 0..MAX_DISCOVERY_PASSES {
            let mut target_churn_observed = false;
            let result: GetTargetsResult = self
                .client
                .send_command_typed("Target.getTargets", &json!({}), None)
                .await?;
            let page_targets: Vec<TargetInfo> = result
                .target_infos
                .into_iter()
                .filter(|target| {
                    (target.target_type == "page" || target.target_type == "webview")
                        && !target.url.is_empty()
                        && !is_internal_chrome_target(&target.url)
                })
                .collect();
            let live_target_ids: HashSet<String> = page_targets
                .iter()
                .map(|target| target.target_id.clone())
                .collect();

            let stale_target_ids: Vec<String> = self
                .pages
                .iter()
                .filter(|page| !live_target_ids.contains(&page.target_id))
                .map(|page| page.target_id.clone())
                .collect();
            for target_id in stale_target_ids {
                self.remove_page_by_target_id(&target_id);
            }

            for target in page_targets {
                if quarantined_target_ids.contains(&target.target_id)
                    || self.has_target(&target.target_id)
                {
                    continue;
                }
                let attach_result: AttachToTargetResult = match self
                    .client
                    .send_command_typed(
                        "Target.attachToTarget",
                        &AttachToTargetParams {
                            target_id: target.target_id.clone(),
                            flatten: true,
                        },
                        None,
                    )
                    .await
                {
                    Ok(result) => result,
                    Err(error) => {
                        if !is_target_churn_error(&error) {
                            return Err(error);
                        }
                        last_error = Some(error);
                        target_churn_observed = true;
                        continue;
                    }
                };

                let tab_id = self.tab_id_for_target(&target.target_id);
                let tab_generation = self.tab_generation_for_target(&target.target_id);
                self.pages.push(PageInfo {
                    target_id: target.target_id,
                    session_id: attach_result.session_id,
                    tab_id,
                    tab_generation,
                    url: target.url,
                    title: target.title,
                    target_type: target.target_type,
                });
            }

            self.active_page_index = 0;
            if self.pages.is_empty() {
                if live_target_ids.is_empty() {
                    return Ok(());
                }
                continue;
            }
            let mut enabled = false;
            let mut unresponsive = Vec::new();
            let mut index = 0;
            while index < self.pages.len() {
                let target_id = self.pages[index].target_id.clone();
                let session_id = self.pages[index].session_id.clone();
                let mut attempt = self.enable_domains(&session_id).await;
                if attempt
                    .as_ref()
                    .is_err_and(|error| !is_target_churn_error(error))
                {
                    let dismissed = self
                        .client
                        .send_command(
                            "Page.handleJavaScriptDialog",
                            Some(json!({ "accept": false })),
                            Some(&session_id),
                        )
                        .await
                        .is_ok();
                    if dismissed {
                        let _ = writeln!(
                            std::io::stderr(),
                            "[stella-browser] dismissed a dialog that was blocking {}",
                            self.pages[index].url
                        );
                        attempt = self.enable_domains(&session_id).await;
                    }
                }
                match attempt {
                    Ok(()) => {
                        self.active_page_index = index;
                        enabled = true;
                        break;
                    }
                    Err(error) if is_target_churn_error(&error) => {
                        last_error = Some(error);
                        target_churn_observed = true;
                        self.remove_page_by_target_id(&target_id);
                        quarantined_target_ids.insert(target_id);
                    }
                    Err(error) => {
                        unresponsive.push(format!("{} ({})", self.pages[index].url, error));
                        last_error = Some(error);
                        index += 1;
                    }
                }
            }
            if !unresponsive.is_empty() {
                let _ = writeln!(
                    std::io::stderr(),
                    "[stella-browser] skipped unresponsive tabs while attaching: {}",
                    unresponsive.join("; ")
                );
            }
            if target_churn_observed {
                continue;
            }
            if enabled || !self.pages.is_empty() {
                return Ok(());
            }
        }

        Err(format!(
            "Failed to attach retained browser targets after {} rescans{}",
            MAX_DISCOVERY_PASSES,
            last_error
                .as_deref()
                .map(|error| format!(". Last error: {}", error))
                .unwrap_or_default(),
        ))
    }

    pub async fn enable_domains_pub(&self, session_id: &str) -> Result<(), String> {
        self.enable_domains(session_id).await
    }

    // Runtime.enable makes the page's console.log(error) read Error.prepareStackTrace, which bot
    // detectors use to spot an attached debugger, so it is only enabled when console output is asked for.
    async fn enable_domains(&self, session_id: &str) -> Result<(), String> {
        self.client
            .send_command_no_params("Page.enable", Some(session_id))
            .await?;
        Ok(())
    }

    pub async fn observe_console(&self) -> Result<(), String> {
        let session_id = self.active_session_id()?;
        self.client
            .send_command_no_params("Runtime.enable", Some(session_id))
            .await?;
        Ok(())
    }

    pub async fn ensure_network_domain(&self, session_id: &str) -> Result<(), String> {
        self.client
            .send_command_no_params("Network.enable", Some(session_id))
            .await?;
        Ok(())
    }

    pub async fn disable_network_domain(&self, session_id: &str) {
        let _ = self
            .client
            .send_command_no_params("Network.disable", Some(session_id))
            .await;
    }

    pub fn active_session_id(&self) -> Result<&str, String> {
        self.pages
            .get(self.active_page_index)
            .map(|p| p.session_id.as_str())
            .ok_or_else(|| {
                "No open tab in this browser session. Open one with browser.tabs.new().".to_string()
            })
    }

    pub async fn navigate(
        &mut self,
        url: &str,
        wait_until: WaitUntil,
        timeout_ms: Option<u64>,
    ) -> Result<Value, String> {
        let session_id = self.active_session_id()?.to_string();
        if matches!(wait_until, WaitUntil::NetworkIdle) {
            self.ensure_network_domain(&session_id).await?;
        }
        let mut events = self.client.subscribe();
        let deadline = Instant::now() + self.load_timeout(timeout_ms);

        let params = PageNavigateParams {
            url: url.to_string(),
            referrer: None,
        };
        let answered = tokio::time::timeout_at(
            deadline.into(),
            self.client
                .send_command_typed("Page.navigate", &params, Some(&session_id)),
        )
        .await;
        let Ok(started) = answered else {
            return self
                .navigated(url, wait_until, Progress::NotStarted, timeout_ms)
                .await;
        };
        let started: PageNavigateResult = started?;

        if let Some(ref error_text) = started.error_text {
            return Err(format!("Navigation failed: {}", error_text));
        }

        // A change of the page's fragment has no loader and fires no load event.
        let progress = if started.loader_id.is_none() || matches!(wait_until, WaitUntil::None) {
            Progress::Reached
        } else {
            self.wait_for_load(
                wait_until,
                &session_id,
                &mut events,
                Progress::Committed,
                deadline,
            )
            .await?
        };
        self.navigated(url, wait_until, progress, timeout_ms).await
    }

    pub async fn reload(&mut self, timeout_ms: Option<u64>) -> Result<Value, String> {
        let session_id = self.active_session_id()?.to_string();
        let mut events = self.client.subscribe();
        let deadline = Instant::now() + self.load_timeout(timeout_ms);
        self.client
            .send_command_no_params("Page.reload", Some(&session_id))
            .await?;
        let progress = self
            .wait_for_load(
                WaitUntil::Load,
                &session_id,
                &mut events,
                Progress::NotStarted,
                deadline,
            )
            .await?;
        let url = self.active_url_cached();
        self.navigated(&url, WaitUntil::Load, progress, timeout_ms)
            .await
    }

    fn load_timeout(&self, timeout_ms: Option<u64>) -> Duration {
        Duration::from_millis(timeout_ms.unwrap_or(self.default_timeout_ms))
    }

    async fn navigated(
        &mut self,
        url: &str,
        wait_until: WaitUntil,
        progress: Progress,
        timeout_ms: Option<u64>,
    ) -> Result<Value, String> {
        let waited = self.load_timeout(timeout_ms).as_millis();
        if progress == Progress::NotStarted {
            return Err(format!(
                "Navigation timeout after {waited}ms: the page never started loading"
            ));
        }
        let (page_url, title) = tokio::time::timeout(PAGE_ANSWER_TIMEOUT, async {
            (
                self.get_url().await.unwrap_or_else(|_| url.to_string()),
                self.get_title().await.unwrap_or_default(),
            )
        })
        .await
        .unwrap_or_else(|_| (url.to_string(), String::new()));
        if let Some(page) = self.pages.get_mut(self.active_page_index) {
            page.url = page_url.clone();
            page.title = title.clone();
        }
        let mut result = json!({ "url": page_url, "title": title });
        if progress == Progress::Committed {
            result["loadState"] = json!("committed");
            result["warning"] = json!(format!(
                "The page navigated but had not reached '{}' after {waited}ms; it is still loading. Wait for the element you need instead of navigating again.",
                wait_until.name()
            ));
        }
        Ok(result)
    }

    async fn wait_for_load(
        &self,
        wait_until: WaitUntil,
        session_id: &str,
        events: &mut broadcast::Receiver<CdpEvent>,
        mut progress: Progress,
        deadline: Instant,
    ) -> Result<Progress, String> {
        let timeout = deadline.saturating_duration_since(Instant::now());
        let reached = match wait_until {
            WaitUntil::NetworkIdle => {
                return Ok(
                    match poll_network_idle(session_id, events, timeout).await {
                        Ok(()) => Progress::Reached,
                        Err(_) => progress,
                    },
                )
            }
            WaitUntil::DomContentLoaded => "Page.domContentEventFired",
            WaitUntil::Load | WaitUntil::None => "Page.loadEventFired",
        };
        let waiting = async {
            loop {
                match events.recv().await {
                    Ok(event) if event.session_id.as_deref() == Some(session_id) => {
                        if event.method == reached && progress != Progress::NotStarted {
                            return Ok(());
                        }
                        if event.method == "Page.frameNavigated"
                            && event.params.pointer("/frame/parentId").is_none()
                        {
                            progress = Progress::Committed;
                        }
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        return Err("Event stream closed".to_string())
                    }
                    _ => continue,
                }
            }
        };
        match tokio::time::timeout(timeout, waiting).await {
            Ok(outcome) => outcome.map(|()| Progress::Reached),
            Err(_) => Ok(progress),
        }
    }

    pub async fn navigate_history(&self, delta: i32) -> Result<Value, String> {
        let session_id = self.active_session_id()?;
        let frame_tree = self
            .client
            .send_command_no_params("Page.getFrameTree", Some(session_id))
            .await?;
        let main_frame_id = frame_tree
            .pointer("/frameTree/frame/id")
            .and_then(Value::as_str)
            .ok_or("Browser did not return its main frame")?;
        let mut events = self.client.subscribe();
        self.evaluate(&format!("history.go({delta})"), None).await?;
        let _ = tokio::time::timeout(Duration::from_millis(500), async {
            loop {
                match events.recv().await {
                    Ok(event) if event.session_id.as_deref() == Some(session_id) => {
                        let frame_id = match event.method.as_str() {
                            "Page.frameNavigated" => event.params.pointer("/frame/id"),
                            "Page.navigatedWithinDocument" => event.params.get("frameId"),
                            _ => None,
                        };
                        if frame_id.and_then(Value::as_str) == Some(main_frame_id) {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                    _ => continue,
                }
            }
        })
        .await;
        Ok(json!({
            "url": self.get_url().await?,
            "title": self.get_title().await.unwrap_or_default(),
        }))
    }

    pub async fn get_url(&self) -> Result<String, String> {
        let result = self.evaluate_simple("location.href").await?;
        Ok(result.as_str().unwrap_or("").to_string())
    }

    pub fn active_url_cached(&self) -> String {
        self.pages
            .get(self.active_page_index)
            .map(|page| page.url.clone())
            .unwrap_or_default()
    }

    pub async fn active_url_protocol(&self) -> Result<String, String> {
        let session_id = self.active_session_id()?.to_string();
        let history = self
            .client
            .send_command_no_params("Page.getNavigationHistory", Some(&session_id))
            .await?;
        let index = history
            .get("currentIndex")
            .and_then(Value::as_u64)
            .ok_or("Page navigation history did not include a current entry")?
            as usize;
        history
            .get("entries")
            .and_then(Value::as_array)
            .and_then(|entries| entries.get(index))
            .and_then(|entry| entry.get("url"))
            .and_then(Value::as_str)
            .map(String::from)
            .ok_or_else(|| "Page navigation history did not include a current URL".to_string())
    }

    pub async fn get_title(&self) -> Result<String, String> {
        let result = self.evaluate_simple("document.title").await?;
        Ok(result.as_str().unwrap_or("").to_string())
    }

    pub async fn get_content(&self) -> Result<String, String> {
        let result = self
            .evaluate_simple("document.documentElement.outerHTML")
            .await?;
        Ok(result.as_str().unwrap_or("").to_string())
    }

    pub async fn evaluate(&self, script: &str, _args: Option<Value>) -> Result<Value, String> {
        self.evaluate_in(script, false).await
    }

    /// Evaluates in Stella's isolated world, or the page's own when
    /// `main_world` (see `world::agent_script_in_main_world`).
    pub async fn evaluate_in(&self, script: &str, main_world: bool) -> Result<Value, String> {
        let session_id = self.active_session_id()?.to_string();
        let result = self
            .client
            .send_command(
                "Runtime.evaluate",
                Some(Self::evaluate_params(script, true, true, main_world)),
                Some(&session_id),
            )
            .await?;
        if let Some(message) = exception_message(&result) {
            return Err(format!("Evaluation error: {}", message));
        }
        Ok(result
            .pointer("/result/value")
            .cloned()
            .unwrap_or(Value::Null))
    }

    pub async fn evaluate_detached(&self, script: &str, main_world: bool) -> Result<(), String> {
        let session_id = self.active_session_id()?.to_string();
        let result = self
            .client
            .send_command(
                "Runtime.evaluate",
                Some(Self::evaluate_params(script, false, false, main_world)),
                Some(&session_id),
            )
            .await?;
        if let Some(message) = exception_message(&result) {
            return Err(format!("Detached evaluation error: {}", message));
        }
        Ok(())
    }

    fn evaluate_params(
        script: &str,
        by_value: bool,
        await_promise: bool,
        main_world: bool,
    ) -> Value {
        let mut params = serde_json::json!({
            "expression": script,
            "returnByValue": by_value,
            "awaitPromise": await_promise,
        });
        if main_world {
            params[super::cdp::client::MAIN_WORLD_PARAM] = Value::Bool(true);
        }
        params
    }

    async fn evaluate_simple(&self, expression: &str) -> Result<Value, String> {
        self.evaluate(expression, None).await
    }

    pub async fn wait_for_lifecycle_external(
        &self,
        wait_until: WaitUntil,
        session_id: &str,
    ) -> Result<(), String> {
        if matches!(wait_until, WaitUntil::NetworkIdle) {
            self.ensure_network_domain(session_id).await?;
        }
        let mut events = self.client.subscribe();
        match self
            .wait_for_load(
                wait_until,
                session_id,
                &mut events,
                Progress::Committed,
                Instant::now() + self.load_timeout(None),
            )
            .await?
        {
            Progress::Reached => Ok(()),
            _ => Err(format!("Timeout waiting for {}", wait_until.name())),
        }
    }

    pub async fn close(&mut self) -> Result<(), String> {
        if self.browser_process.is_some() {
            let _ = self
                .client
                .send_command_no_params("Browser.close", None)
                .await;
        }

        if let Some(mut process) = self.browser_process.take() {
            let timeout = std::time::Duration::from_secs(5);
            let _ = tokio::task::spawn_blocking(move || {
                process.wait_or_kill(timeout);
            })
            .await;
        }

        Ok(())
    }

    pub fn has_pages(&self) -> bool {
        !self.pages.is_empty()
    }

    pub async fn is_connection_alive(&self) -> bool {
        let timeout = tokio::time::Duration::from_secs(3);
        let result = tokio::time::timeout(
            timeout,
            self.client
                .send_command_no_params("Browser.getVersion", None),
        )
        .await;

        match result {
            Ok(Ok(_)) => true,
            Ok(Err(_)) | Err(_) => false,
        }
    }

    pub fn get_cdp_url(&self) -> &str {
        &self.ws_url
    }

    pub fn chrome_host_port(&self) -> &str {
        let stripped = self
            .ws_url
            .strip_prefix("ws://")
            .or_else(|| self.ws_url.strip_prefix("wss://"))
            .unwrap_or(&self.ws_url);
        stripped.split('/').next().unwrap_or(stripped)
    }

    pub fn active_target_id(&self) -> Result<&str, String> {
        self.pages
            .get(self.active_page_index)
            .map(|p| p.target_id.as_str())
            .ok_or_else(|| {
                "No open tab in this browser session. Open one with browser.tabs.new().".to_string()
            })
    }

    pub fn is_cdp_connection(&self) -> bool {
        self.browser_process.is_none()
    }

    pub async fn ensure_page(&mut self) -> Result<Option<u64>, String> {
        if !self.pages.is_empty() {
            return Ok(None);
        }

        let result: CreateTargetResult = self
            .client
            .send_command_typed(
                "Target.createTarget",
                &CreateTargetParams {
                    url: "about:blank".to_string(),
                },
                None,
            )
            .await?;

        let attach_result: AttachToTargetResult = self
            .client
            .send_command_typed(
                "Target.attachToTarget",
                &AttachToTargetParams {
                    target_id: result.target_id.clone(),
                    flatten: true,
                },
                None,
            )
            .await?;

        let tab_id = self.tab_id_for_target(&result.target_id);
        let tab_generation = self.tab_generation_for_target(&result.target_id);
        self.pages.push(PageInfo {
            target_id: result.target_id,
            session_id: attach_result.session_id.clone(),
            tab_id,
            tab_generation: tab_generation.clone(),
            url: "about:blank".to_string(),
            title: String::new(),
            target_type: "page".to_string(),
        });
        self.active_page_index = 0;
        self.enable_domains(&attach_result.session_id).await?;

        Ok(Some(tab_id))
    }

    pub fn update_active_page_if_needed(&mut self) {
        if self.pages.is_empty() {
            self.active_page_index = 0;
            return;
        }
        if self.active_page_index >= self.pages.len() {
            self.active_page_index = self.pages.len() - 1;
        }
    }

    fn tab_id_for_target(&mut self, target_id: &str) -> u64 {
        if let Some(id) = self.target_tab_ids.get(target_id) {
            return *id;
        }
        for attempt in 0_u32..=u32::MAX {
            let mut hasher = Sha256::new();
            hasher.update(b"stella-browser-tab-id\0");
            hasher.update(target_id.as_bytes());
            hasher.update(attempt.to_be_bytes());
            let digest = hasher.finalize();
            let candidate =
                (u32::from_be_bytes(digest[..4].try_into().unwrap()) & 0x7fff_ffff) as u64;
            if candidate == 0 {
                continue;
            }
            let collision = self.target_tab_ids.iter().any(|(known_target, known_id)| {
                *known_id == candidate && known_target != target_id
            });
            if !collision {
                self.target_tab_ids.insert(target_id.to_string(), candidate);
                return candidate;
            }
        }
        unreachable!("SHA-256 tab id space exhausted")
    }

    fn tab_generation_for_target(&mut self, target_id: &str) -> String {
        if let Some(generation) = self.target_tab_generations.get(target_id) {
            return generation.clone();
        }
        let mut hasher = Sha256::new();
        hasher.update(b"stella-browser-tab-generation\0");
        hasher.update(target_id.as_bytes());
        let generation = format!("target:{:x}", hasher.finalize());
        self.target_tab_generations
            .insert(target_id.to_string(), generation.clone());
        generation
    }

    pub fn active_tab_id(&self) -> Option<u64> {
        self.pages.get(self.active_page_index).map(|p| p.tab_id)
    }

    pub fn tab_index_by_id(&self, tab_id: u64) -> Option<usize> {
        self.pages.iter().position(|p| p.tab_id == tab_id)
    }

    pub async fn select_tab_by_id(&mut self, tab_id: u64) -> Result<(), String> {
        let index = self.tab_index_by_id(tab_id).ok_or_else(|| {
            format!(
                "Unknown tabId {}. The tab may have been closed; run tab_list to see current tabs.",
                tab_id
            )
        })?;
        if index != self.active_page_index {
            self.tab_switch(index).await?;
        }
        Ok(())
    }

    /// Brings the pages' URLs and titles up to date with the browser.
    pub async fn refresh_pages(&mut self) {
        let Ok(targets) = self
            .client
            .send_command_typed::<_, GetTargetsResult>("Target.getTargets", &json!({}), None)
            .await
        else {
            return;
        };
        for target in targets.target_infos {
            if let Some(page) = self
                .pages
                .iter_mut()
                .find(|page| page.target_id == target.target_id)
            {
                page.url = target.url;
                page.title = target.title;
            }
        }
    }

    pub fn known_tab_id_for_target(&self, target_id: &str) -> Option<u64> {
        self.target_tab_ids.get(target_id).copied()
    }

    pub fn tab_generation_by_id(&self, tab_id: u64) -> Option<&str> {
        self.pages
            .iter()
            .find(|page| page.tab_id == tab_id)
            .map(|page| page.tab_generation.as_str())
    }

    pub fn record_owner_tab(&mut self, owner_id: &str, tab_id: u64) {
        self.owner_tabs.record(owner_id, tab_id);
    }

    pub fn adopt_all_tabs_for_owner(&mut self, owner_id: &str) {
        let tab_ids: Vec<u64> = self.pages.iter().map(|page| page.tab_id).collect();
        for tab_id in tab_ids {
            self.owner_tabs.record(owner_id, tab_id);
        }
    }

    pub fn owner_tab_ids(&self, owner_id: &str) -> Vec<u64> {
        self.owner_tabs.tab_ids(owner_id)
    }

    pub fn mark_owner_tab_active(&mut self, owner_id: &str, tab_id: u64) {
        self.owner_tabs.mark_active(owner_id, tab_id);
    }

    pub fn owner_of_tab(&self, tab_id: u64) -> Option<String> {
        self.owner_tabs.owner_of(tab_id).map(str::to_string)
    }

    pub fn has_session_id(&self, session_id: &str) -> bool {
        self.pages.iter().any(|page| page.session_id == session_id)
    }

    pub fn can_owner_access_tab(&self, owner_id: Option<&str>, tab_id: u64) -> bool {
        self.owner_tabs.can_access(owner_id, tab_id)
    }

    pub fn release_owner_tab(&mut self, owner_id: &str, tab_id: u64) {
        self.owner_tabs.release(owner_id, tab_id);
    }

    pub async fn close_tab_by_id(&mut self, tab_id: u64) -> Result<bool, String> {
        let Some(index) = self.tab_index_by_id(tab_id) else {
            self.owner_tabs.forget_tab(tab_id);
            return Ok(false);
        };

        let page = self.pages.remove(index);
        self.owner_tabs.forget_tab(page.tab_id);
        let _ = self
            .client
            .send_command_typed::<_, Value>(
                "Target.closeTarget",
                &CloseTargetParams {
                    target_id: page.target_id,
                },
                None,
            )
            .await;

        self.update_active_page_if_needed();
        if !self.pages.is_empty() {
            let session_id = self.pages[self.active_page_index].session_id.clone();
            let _ = self.enable_domains(&session_id).await;
        }
        Ok(true)
    }

    pub fn tab_list(&self) -> Vec<Value> {
        self.pages
            .iter()
            .enumerate()
            .map(|(i, p)| {
                json!({
                    "tabId": p.tab_id,
                    "tabGeneration": p.tab_generation,
                    "index": i,
                    "title": p.title,
                    "url": p.url,
                    "type": p.target_type,
                    "active": i == self.active_page_index,
                })
            })
            .collect()
    }

    pub fn tab_list_for_owner(&self, owner_id: Option<&str>) -> Vec<Value> {
        let Some(owner_id) = owner_id else {
            return self.tab_list();
        };
        let active_tab_id = self.owner_tabs.active_tab_id(owner_id);
        self.tab_list()
            .into_iter()
            .filter_map(|mut tab| {
                let tab_id = tab.get("tabId").and_then(Value::as_u64)?;
                if !self.owner_tabs.is_owned_by(owner_id, tab_id) {
                    return None;
                }
                tab["active"] = json!(active_tab_id == Some(tab_id));
                Some(tab)
            })
            .collect()
    }

    pub fn active_tab_id_for_owner(&self, owner_id: Option<&str>) -> Option<u64> {
        match owner_id {
            Some(owner_id) => self.owner_tabs.active_tab_id(owner_id),
            None => self.active_tab_id(),
        }
    }

    pub async fn tab_new(&mut self, url: Option<&str>) -> Result<Value, String> {
        let target_url = url.unwrap_or("about:blank");

        let result: CreateTargetResult = self
            .client
            .send_command_typed(
                "Target.createTarget",
                &CreateTargetParams {
                    url: target_url.to_string(),
                },
                None,
            )
            .await?;

        let attach: AttachToTargetResult = self
            .client
            .send_command_typed(
                "Target.attachToTarget",
                &AttachToTargetParams {
                    target_id: result.target_id.clone(),
                    flatten: true,
                },
                None,
            )
            .await?;

        self.enable_domains(&attach.session_id).await?;

        let index = self.pages.len();
        let tab_id = self.tab_id_for_target(&result.target_id);
        let tab_generation = self.tab_generation_for_target(&result.target_id);
        self.pages.push(PageInfo {
            target_id: result.target_id,
            session_id: attach.session_id,
            tab_id,
            tab_generation: tab_generation.clone(),
            url: target_url.to_string(),
            title: String::new(),
            target_type: "page".to_string(),
        });
        self.active_page_index = index;

        Ok(
            json!({ "tabId": tab_id, "tabGeneration": tab_generation, "index": index, "url": target_url }),
        )
    }

    pub async fn tab_switch(&mut self, index: usize) -> Result<Value, String> {
        if index >= self.pages.len() {
            return Err(format!(
                "Tab index {} out of range (0-{})",
                index,
                self.pages.len().saturating_sub(1)
            ));
        }

        self.active_page_index = index;
        let session_id = self.pages[index].session_id.clone();
        self.enable_domains(&session_id).await?;

        let _ = self
            .client
            .send_command("Page.bringToFront", None, Some(&session_id))
            .await;

        let url = self.get_url().await.unwrap_or_default();
        let title = self.get_title().await.unwrap_or_default();

        if let Some(page) = self.pages.get_mut(index) {
            page.url = url.clone();
            page.title = title.clone();
        }

        let tab_id = self.pages.get(index).map(|p| p.tab_id);
        let tab_generation = self.pages.get(index).map(|p| p.tab_generation.clone());
        Ok(
            json!({ "tabId": tab_id, "tabGeneration": tab_generation, "index": index, "url": url, "title": title }),
        )
    }

    pub async fn tab_close(&mut self, index: Option<usize>) -> Result<Value, String> {
        let target_index = index.unwrap_or(self.active_page_index);

        if target_index >= self.pages.len() {
            return Err(format!("Tab index {} out of range", target_index));
        }

        if self.pages.len() <= 1 {
            return Err("Cannot close the last tab: it is your only open tab in Stella's browser, so it stays open. Reuse it with tab.goto(), or leave it: unmarked tabs close automatically when your turn ends (browser.tabs.finalize([]) closes them now).".to_string());
        }

        let page = self.pages.remove(target_index);
        self.owner_tabs.forget_tab(page.tab_id);
        let _ = self
            .client
            .send_command_typed::<_, Value>(
                "Target.closeTarget",
                &CloseTargetParams {
                    target_id: page.target_id,
                },
                None,
            )
            .await;

        if self.active_page_index >= self.pages.len() {
            self.active_page_index = self.pages.len() - 1;
        }

        let session_id = self.pages[self.active_page_index].session_id.clone();
        self.enable_domains(&session_id).await?;

        Ok(json!({
            "closed": target_index,
            "closedTabId": page.tab_id,
            "closedTabGeneration": page.tab_generation,
            "activeIndex": self.active_page_index,
            "activeTabId": self.active_tab_id(),
        }))
    }

    pub async fn set_viewport(
        &self,
        width: i32,
        height: i32,
        device_scale_factor: f64,
        mobile: bool,
    ) -> Result<(), String> {
        let session_id = self.active_session_id()?;
        self.client
            .send_command(
                "Emulation.setDeviceMetricsOverride",
                Some(json!({
                    "width": width,
                    "height": height,
                    "deviceScaleFactor": device_scale_factor,
                    "mobile": mobile,
                })),
                Some(session_id),
            )
            .await?;
        Ok(())
    }

    pub async fn set_user_agent(&self, user_agent: &str) -> Result<(), String> {
        let session_id = self.active_session_id()?;
        self.client
            .send_command(
                "Emulation.setUserAgentOverride",
                Some(json!({ "userAgent": user_agent })),
                Some(session_id),
            )
            .await?;
        Ok(())
    }

    pub async fn set_emulated_media(
        &self,
        media: Option<&str>,
        features: Option<Vec<(String, String)>>,
    ) -> Result<(), String> {
        let session_id = self.active_session_id()?;
        let mut params = json!({});
        if let Some(m) = media {
            params["media"] = Value::String(m.to_string());
        }
        if let Some(feats) = features {
            let features_arr: Vec<Value> = feats
                .iter()
                .map(|(name, value)| json!({ "name": name, "value": value }))
                .collect();
            params["features"] = Value::Array(features_arr);
        }
        self.client
            .send_command("Emulation.setEmulatedMedia", Some(params), Some(session_id))
            .await?;
        Ok(())
    }

    pub async fn bring_to_front(&self) -> Result<(), String> {
        let session_id = self.active_session_id()?;
        if let Some(page) = self.pages.get(self.active_page_index) {
            self.client
                .send_command(
                    "Target.activateTarget",
                    Some(json!({ "targetId": page.target_id })),
                    None,
                )
                .await?;
        }
        self.client
            .send_command("Page.bringToFront", None, Some(session_id))
            .await?;
        Ok(())
    }

    pub async fn set_timezone(&self, timezone_id: &str) -> Result<(), String> {
        let session_id = self.active_session_id()?;
        self.client
            .send_command(
                "Emulation.setTimezoneOverride",
                Some(json!({ "timezoneId": timezone_id })),
                Some(session_id),
            )
            .await?;
        Ok(())
    }

    pub async fn set_locale(&self, locale: &str) -> Result<(), String> {
        let session_id = self.active_session_id()?;
        self.client
            .send_command(
                "Emulation.setLocaleOverride",
                Some(json!({ "locale": locale })),
                Some(session_id),
            )
            .await?;
        Ok(())
    }

    pub async fn set_geolocation(
        &self,
        latitude: f64,
        longitude: f64,
        accuracy: Option<f64>,
    ) -> Result<(), String> {
        let session_id = self.active_session_id()?;
        self.client
            .send_command(
                "Emulation.setGeolocationOverride",
                Some(json!({
                    "latitude": latitude,
                    "longitude": longitude,
                    "accuracy": accuracy.unwrap_or(1.0),
                })),
                Some(session_id),
            )
            .await?;
        Ok(())
    }

    pub async fn grant_permissions(&self, permissions: &[String]) -> Result<(), String> {
        self.client
            .send_command(
                "Browser.grantPermissions",
                Some(json!({ "permissions": permissions })),
                None,
            )
            .await?;
        Ok(())
    }

    pub async fn handle_dialog(
        &self,
        accept: bool,
        prompt_text: Option<&str>,
    ) -> Result<(), String> {
        let session_id = self.active_session_id()?;
        let mut params = json!({ "accept": accept });
        if let Some(text) = prompt_text {
            params["promptText"] = Value::String(text.to_string());
        }
        self.client
            .send_command(
                "Page.handleJavaScriptDialog",
                Some(params),
                Some(session_id),
            )
            .await?;
        Ok(())
    }

    pub async fn upload_files(&self, selector: &str, files: &[String]) -> Result<(), String> {
        let session_id = self.active_session_id()?;

        let result: EvaluateResult = self
            .client
            .send_command_typed(
                "Runtime.evaluate",
                &EvaluateParams {
                    expression: format!(
                        "document.querySelector({})",
                        serde_json::to_string(selector).unwrap_or_default()
                    ),
                    return_by_value: Some(false),
                    await_promise: Some(false),
                },
                Some(session_id),
            )
            .await?;

        let object_id = result
            .result
            .object_id
            .ok_or("File input element not found")?;

        let describe: Value = self
            .client
            .send_command(
                "DOM.describeNode",
                Some(json!({ "objectId": object_id })),
                Some(session_id),
            )
            .await?;

        let backend_node_id = describe
            .get("node")
            .and_then(|n| n.get("backendNodeId"))
            .and_then(|v| v.as_i64())
            .ok_or("Could not get backendNodeId for file input")?;

        self.client
            .send_command(
                "DOM.setFileInputFiles",
                Some(json!({
                    "files": files,
                    "backendNodeId": backend_node_id,
                })),
                Some(session_id),
            )
            .await?;

        Ok(())
    }

    pub async fn add_script_to_evaluate(&self, source: &str) -> Result<String, String> {
        let session_id = self.active_session_id()?;
        let result = self
            .client
            .send_command(
                "Page.addScriptToEvaluateOnNewDocument",
                Some(json!({ "source": source })),
                Some(session_id),
            )
            .await?;
        Ok(result
            .get("identifier")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string())
    }

    pub fn add_page(&mut self, mut page: PageInfo) -> u64 {
        page.tab_id = self.tab_id_for_target(&page.target_id);
        page.tab_generation = self.tab_generation_for_target(&page.target_id);
        let tab_id = page.tab_id;
        let index = self.pages.len();
        self.pages.push(page);
        self.active_page_index = index;
        tab_id
    }

    pub fn remove_page_by_target_id(&mut self, target_id: &str) {
        if let Some(pos) = self.pages.iter().position(|p| p.target_id == target_id) {
            let page = self.pages.remove(pos);
            self.owner_tabs.forget_tab(page.tab_id);
            self.update_active_page_if_needed();
        }
    }

    pub fn has_target(&self, target_id: &str) -> bool {
        self.pages.iter().any(|p| p.target_id == target_id)
    }

    pub fn page_count(&self) -> usize {
        self.pages.len()
    }

    pub fn pages_list(&self) -> Vec<PageInfo> {
        self.pages.clone()
    }

    pub async fn set_download_behavior(&self, download_path: &str) -> Result<(), String> {
        let session_id = self.active_session_id()?;
        self.client
            .send_command(
                "Browser.setDownloadBehavior",
                Some(json!({
                    "behavior": "allowAndName",
                    "downloadPath": download_path,
                    "eventsEnabled": true,
                })),
                Some(session_id),
            )
            .await?;
        Ok(())
    }
}

async fn poll_network_idle(
    session_id: &str,
    rx: &mut broadcast::Receiver<CdpEvent>,
    overall_timeout: tokio::time::Duration,
) -> Result<(), String> {
    let pending = Arc::new(Mutex::new(HashSet::<String>::new()));

    tokio::time::timeout(overall_timeout, async {
        let mut idle_start: Option<tokio::time::Instant> = None;

        loop {
            let recv_result =
                tokio::time::timeout(tokio::time::Duration::from_millis(600), rx.recv()).await;

            match recv_result {
                Ok(Ok(event)) if event.session_id.as_deref() == Some(session_id) => {
                    let mut p = pending.lock().await;
                    match event.method.as_str() {
                        "Network.requestWillBeSent" => {
                            if let Some(id) = event.params.get("requestId").and_then(|v| v.as_str())
                            {
                                p.insert(id.to_string());
                                idle_start = None;
                            }
                        }
                        "Network.loadingFinished" | "Network.loadingFailed" => {
                            if let Some(id) = event.params.get("requestId").and_then(|v| v.as_str())
                            {
                                p.remove(id);
                                if p.is_empty() {
                                    idle_start = Some(tokio::time::Instant::now());
                                }
                            }
                        }
                        "Page.loadEventFired" => {
                            if p.is_empty() {
                                idle_start = Some(tokio::time::Instant::now());
                            }
                        }
                        _ => {}
                    }
                }
                Ok(Ok(_)) => {}
                Ok(Err(tokio::sync::broadcast::error::RecvError::Lagged(_))) => continue,
                Ok(Err(_)) => break,
                Err(_) => {
                    let p = pending.lock().await;
                    if p.is_empty() && idle_start.is_none() {
                        idle_start = Some(tokio::time::Instant::now());
                    }
                }
            }

            if let Some(start) = idle_start {
                if start.elapsed() >= tokio::time::Duration::from_millis(500) {
                    return Ok(());
                }
            }
        }

        Ok(())
    })
    .await
    .map_err(|_| "Timeout waiting for networkidle".to_string())?
}

async fn connect_cdp_with_retry(
    ws_url: &str,
    total_timeout: Duration,
    poll_interval: Duration,
) -> Result<CdpClient, String> {
    let deadline = Instant::now() + total_timeout;

    loop {
        match CdpClient::connect(ws_url).await {
            Ok(client) => return Ok(client),
            Err(err) => {
                if Instant::now() >= deadline {
                    return Err(err);
                }
            }
        }

        tokio::time::sleep(poll_interval).await;
    }
}

async fn initialize_lightpanda_manager(
    ws_url: String,
    process: BrowserProcess,
) -> Result<BrowserManager, String> {
    let deadline = Instant::now() + LIGHTPANDA_TARGET_INIT_TIMEOUT;
    let mut process = Some(process);

    loop {
        let client = match connect_cdp_with_retry(
            &ws_url,
            LIGHTPANDA_CDP_CONNECT_TIMEOUT,
            LIGHTPANDA_CDP_CONNECT_POLL_INTERVAL,
        )
        .await
        {
            Ok(client) => client,
            Err(err) => {
                if Instant::now() >= deadline {
                    return Err(lightpanda_target_init_timeout(Some(&err)));
                }
                tokio::time::sleep(LIGHTPANDA_CDP_CONNECT_POLL_INTERVAL).await;
                continue;
            }
        };

        let mut manager = BrowserManager {
            dialogs: Dialogs::default(),
            client: Arc::new(client),
            browser_process: None,
            ws_url: ws_url.clone(),
            pages: Vec::new(),
            active_page_index: 0,
            default_timeout_ms: 25_000,
            target_tab_ids: HashMap::new(),
            target_tab_generations: HashMap::new(),
            owner_tabs: OwnerTabRegistry::default(),
        };

        match discover_and_attach_lightpanda_targets(&mut manager, deadline).await {
            Ok(()) => {
                manager.browser_process = process.take();
                return Ok(manager);
            }
            Err(err) => {
                if Instant::now() >= deadline {
                    return Err(lightpanda_target_init_timeout(Some(&err)));
                }
                tokio::time::sleep(LIGHTPANDA_CDP_CONNECT_POLL_INTERVAL).await;
            }
        }
    }
}

async fn discover_and_attach_lightpanda_targets(
    manager: &mut BrowserManager,
    deadline: Instant,
) -> Result<(), String> {
    run_with_lightpanda_deadline(
        deadline,
        manager.discover_and_attach_targets(),
        "Target domain initialization attempt exceeded the remaining startup deadline",
    )
    .await
}

fn remaining_until(deadline: Instant) -> Option<Duration> {
    deadline.checked_duration_since(Instant::now())
}

async fn run_with_lightpanda_deadline<F, T>(
    deadline: Instant,
    operation: F,
    timeout_context: &'static str,
) -> Result<T, String>
where
    F: Future<Output = Result<T, String>>,
{
    let remaining = remaining_until(deadline)
        .ok_or_else(|| lightpanda_target_init_timeout(Some("deadline expired before retry")))?;

    match tokio::time::timeout(remaining, operation).await {
        Ok(result) => result,
        Err(_) => Err(lightpanda_target_init_timeout(Some(timeout_context))),
    }
}

fn lightpanda_target_init_timeout(last_error: Option<&str>) -> String {
    let mut message = format!(
        "Timed out after {}ms waiting for Lightpanda Target domain to initialize",
        LIGHTPANDA_TARGET_INIT_TIMEOUT.as_millis(),
    );
    if let Some(last_error) = last_error {
        message.push_str(&format!("\nLast error: {}", last_error));
    }
    message
}

async fn resolve_cdp_url(input: &str) -> Result<String, String> {
    if input.starts_with("ws://") || input.starts_with("wss://") {
        return Ok(input.to_string());
    }

    if input.starts_with("http://") || input.starts_with("https://") {
        let parsed = url::Url::parse(input).map_err(|e| format!("Invalid CDP URL: {}", e))?;
        let host = parsed
            .host_str()
            .ok_or_else(|| format!("No host in CDP URL: {}", input))?;
        let port = parsed.port().unwrap_or(9222);
        return discover_cdp_url(host, port).await;
    }

    if let Ok(port) = input.parse::<u16>() {
        return discover_cdp_url("127.0.0.1", port).await;
    }

    Err(format!(
        "Invalid CDP target: {}. Use ws://, http://, or a port number.",
        input
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::{SinkExt, StreamExt};
    use tokio::net::TcpListener;
    use tokio::time::sleep;
    use tokio_tungstenite::{accept_async, tungstenite::Message};

    async fn serve_disappearing_retained_target(listener: TcpListener) {
        let (stream, _) = listener.accept().await.unwrap();
        let mut socket = accept_async(stream).await.unwrap();
        let mut target_lists = 0;

        while let Some(Ok(Message::Text(text))) = socket.next().await {
            let request: Value = serde_json::from_str(&text).unwrap();
            let id = request["id"].as_u64().unwrap();
            let method = request["method"].as_str().unwrap();
            let session_id = request.get("sessionId").and_then(Value::as_str);
            let response = match (method, session_id) {
                ("Target.setDiscoverTargets", _) => json!({ "id": id, "result": {} }),
                ("Target.getTargets", _) => {
                    target_lists += 1;
                    if target_lists == 1 {
                        json!({
                            "id": id,
                            "result": { "targetInfos": [
                                { "targetId": "tab-a", "type": "page", "title": "A", "url": "https://a.example" },
                                { "targetId": "tab-b", "type": "page", "title": "B", "url": "https://b.example" }
                            ] }
                        })
                    } else {
                        json!({
                            "id": id,
                            "result": { "targetInfos": [
                                { "targetId": "tab-b", "type": "page", "title": "B", "url": "https://b.example" }
                            ] }
                        })
                    }
                }
                ("Target.attachToTarget", _) => {
                    let target_id = request["params"]["targetId"].as_str().unwrap();
                    json!({ "id": id, "result": { "sessionId": format!("session-{target_id}") } })
                }
                ("Page.enable", Some("session-tab-a")) => json!({
                    "id": id,
                    "error": { "code": -32000, "message": "Browser tab not found: tab-a" }
                }),
                ("Page.enable" | "Runtime.enable" | "Network.enable", Some("session-tab-b")) => {
                    json!({ "id": id, "result": {} })
                }
                _ => panic!("unexpected CDP request: {request}"),
            };
            socket
                .send(Message::Text(response.to_string()))
                .await
                .unwrap();
        }
    }

    #[tokio::test]
    async fn replacement_bootstrap_rescans_when_a_retained_target_disappears() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(serve_disappearing_retained_target(listener));

        let manager = BrowserManager::connect_cdp(&format!("ws://{address}"))
            .await
            .unwrap();
        let pages = manager.pages_list();
        assert_eq!(pages.len(), 1);
        assert_eq!(pages[0].target_id, "tab-b");
        let mut identity_check = BrowserManager {
            client: manager.client.clone(),
            browser_process: None,
            ws_url: String::new(),
            pages: Vec::new(),
            active_page_index: 0,
            default_timeout_ms: 10_000,
            target_tab_ids: HashMap::new(),
            target_tab_generations: HashMap::new(),
            owner_tabs: OwnerTabRegistry::default(),
        };
        assert_eq!(pages[0].tab_id, identity_check.tab_id_for_target("tab-b"));
        assert_eq!(
            pages[0].tab_generation,
            identity_check.tab_generation_for_target("tab-b")
        );

        drop(manager);
        server.abort();
    }

    async fn serve_recording_target(
        listener: TcpListener,
        records: std::sync::Arc<std::sync::Mutex<Vec<String>>>,
        fail_network: bool,
    ) {
        let (stream, _) = listener.accept().await.unwrap();
        let mut socket = accept_async(stream).await.unwrap();

        while let Some(Ok(Message::Text(text))) = socket.next().await {
            let request: Value = serde_json::from_str(&text).unwrap();
            let id = request["id"].as_u64().unwrap();
            let method = request["method"].as_str().unwrap();
            records.lock().unwrap().push(method.to_string());
            let response = if method.starts_with("Network.") && fail_network {
                json!({
                    "id": id,
                    "error": { "code": -32000, "message": "Network domain must stay detached by default" }
                })
            } else {
                match method {
                    "Target.getTargets" => json!({
                        "id": id,
                        "result": { "targetInfos": [
                            { "targetId": "tab-a", "type": "page", "title": "A", "url": "https://a.example" }
                        ] }
                    }),
                    "Target.attachToTarget" => {
                        json!({ "id": id, "result": { "sessionId": "session-tab-a" } })
                    }
                    _ => json!({ "id": id, "result": {} }),
                }
            };
            socket
                .send(Message::Text(response.to_string()))
                .await
                .unwrap();
        }
    }

    #[tokio::test]
    async fn default_bootstrap_leaves_network_domain_detached() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let records = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let server = tokio::spawn(serve_recording_target(listener, records.clone(), true));

        let manager = BrowserManager::connect_cdp(&format!("ws://{address}"))
            .await
            .expect("bootstrap must succeed without touching the Network domain");

        let seen = records.lock().unwrap().clone();
        assert!(
            seen.iter().any(|method| method == "Page.enable"),
            "bootstrap should still enable the Page domain, saw {seen:?}"
        );
        assert!(
            !seen.iter().any(|method| method.starts_with("Network.")),
            "default bootstrap must not attach the Network domain, saw {seen:?}"
        );

        drop(manager);
        server.abort();
    }

    #[tokio::test]
    async fn network_domain_attaches_on_demand_and_detaches() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let records = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let server = tokio::spawn(serve_recording_target(listener, records.clone(), false));

        let manager = BrowserManager::connect_cdp(&format!("ws://{address}"))
            .await
            .unwrap();

        manager
            .ensure_network_domain("session-tab-a")
            .await
            .expect("on-demand Network.enable should succeed");
        manager.disable_network_domain("session-tab-a").await;

        let seen = records.lock().unwrap().clone();
        let enable_index = seen.iter().position(|method| method == "Network.enable");
        let disable_index = seen.iter().position(|method| method == "Network.disable");
        assert!(
            enable_index.is_some() && disable_index.is_some(),
            "expected on-demand Network.enable then Network.disable, saw {seen:?}"
        );
        assert!(enable_index < disable_index);

        drop(manager);
        server.abort();
    }

    #[test]
    fn test_owner_tab_registry_records_in_order_and_dedupes() {
        let mut registry = OwnerTabRegistry::default();
        registry.record("worker-1", 3);
        registry.record("worker-1", 1);
        registry.record("worker-1", 3);
        registry.record("worker-2", 7);

        assert_eq!(registry.tab_ids("worker-1"), vec![3, 1]);
        assert_eq!(registry.tab_ids("worker-2"), vec![7]);
        assert_eq!(registry.tab_ids("unknown"), Vec::<u64>::new());
        assert_eq!(registry.owner_of(1), Some("worker-1"));
        assert_eq!(registry.owner_of(7), Some("worker-2"));
        assert_eq!(registry.owner_of(99), None);

        registry.record(" worker-1 ", 5);
        assert_eq!(registry.tab_ids("worker-1"), vec![3, 1, 5]);
    }

    #[test]
    fn test_owner_tab_registry_ignores_blank_owner_and_zero_tab() {
        let mut registry = OwnerTabRegistry::default();
        registry.record("", 1);
        registry.record("   ", 2);
        registry.record("worker-1", 0);
        assert_eq!(registry.tab_ids(""), Vec::<u64>::new());
        assert_eq!(registry.tab_ids("worker-1"), Vec::<u64>::new());
    }

    #[test]
    fn test_owner_tab_registry_release_and_forget_are_idempotent() {
        let mut registry = OwnerTabRegistry::default();
        registry.record("worker-1", 1);
        registry.record("worker-1", 2);
        registry.record("worker-2", 2);

        registry.release("worker-1", 2);
        assert_eq!(registry.tab_ids("worker-1"), vec![1]);
        assert_eq!(registry.tab_ids("worker-2"), vec![2]);
        assert_eq!(registry.active_tab_id("worker-1"), Some(1));
        registry.release("worker-1", 2);
        registry.release("unknown", 2);
        assert_eq!(registry.tab_ids("worker-2"), vec![2]);

        registry.forget_tab(2);
        registry.forget_tab(2);
        assert_eq!(registry.tab_ids("worker-2"), Vec::<u64>::new());
        assert_eq!(registry.owner_of(2), None);
        assert_eq!(registry.active_tab_id("worker-2"), None);

        registry.release("worker-1", 1);
        assert_eq!(registry.owner_of(1), None);
        assert_eq!(registry.tab_ids("worker-1"), Vec::<u64>::new());
    }

    #[test]
    fn test_owner_tab_registry_distinguishes_own_foreign_and_unowned_tabs() {
        let mut registry = OwnerTabRegistry::default();
        registry.record("worker-1", 1);
        registry.record("worker-2", 2);

        assert!(registry.is_owned(1));
        assert!(registry.is_owned(2));
        assert!(!registry.is_owned(3));
        assert!(registry.is_owned_by("worker-1", 1));
        assert!(!registry.is_owned_by("worker-1", 2));
        assert!(!registry.is_owned_by("worker-1", 3));
        assert!(registry.can_access(Some("worker-1"), 1));
        assert!(!registry.can_access(Some("worker-1"), 2));
        assert!(!registry.can_access(Some("worker-1"), 3));
        assert!(registry.can_access(None, 2));
        assert_eq!(registry.active_tab_id("worker-1"), Some(1));
        assert_eq!(registry.active_tab_id("worker-2"), Some(2));

        registry.mark_active("worker-1", 1);
        assert_eq!(registry.active_tab_id("worker-1"), Some(1));
        registry.mark_active("worker-1", 2);
        assert_eq!(registry.active_tab_id("worker-1"), Some(1));

        registry.release("worker-1", 1);
        assert_eq!(registry.active_tab_id("worker-1"), None);
    }

    #[test]
    fn test_validate_launch_options_extensions_and_cdp() {
        let ext = vec!["/path/to/ext".to_string()];
        assert!(validate_launch_options(Some(&ext), true, None, None, false, None,).is_err());
    }

    #[test]
    fn test_validate_launch_options_profile_and_cdp() {
        assert!(validate_launch_options(None, true, Some("/path"), None, false, None,).is_err());
    }

    #[test]
    fn test_validate_launch_options_storage_state_and_profile() {
        assert!(validate_launch_options(
            None,
            false,
            Some("/profile"),
            Some("/state.json"),
            false,
            None,
        )
        .is_err());
    }

    #[test]
    fn test_validate_launch_options_storage_state_and_extensions() {
        let ext = vec!["/ext".to_string()];
        assert!(
            validate_launch_options(Some(&ext), false, None, Some("/state.json"), false, None,)
                .is_err()
        );
    }

    #[test]
    fn test_validate_launch_options_allow_file_access_firefox() {
        assert!(
            validate_launch_options(None, false, None, None, true, Some("/usr/bin/firefox"),)
                .is_err()
        );
    }

    #[test]
    fn test_to_ai_friendly_error_strict_mode() {
        assert_eq!(
            to_ai_friendly_error("Strict mode violation: multiple elements"),
            "Element matched multiple results. Use a more specific selector."
        );
    }

    #[test]
    fn test_to_ai_friendly_error_not_visible() {
        assert_eq!(
            to_ai_friendly_error("element is not visible"),
            "Element exists but is not visible. Wait for it to become visible or scroll it into view."
        );
    }

    #[test]
    fn test_to_ai_friendly_error_intercept() {
        assert_eq!(
            to_ai_friendly_error("element intercepted by another element"),
            "Another element is covering the target element. Try scrolling or closing overlays."
        );
    }

    #[test]
    fn test_to_ai_friendly_error_timeout() {
        assert_eq!(
            to_ai_friendly_error("Timeout waiting for element"),
            "Operation timed out. The page may still be loading or the element may not exist."
        );
    }

    #[test]
    fn test_to_ai_friendly_error_not_found() {
        assert_eq!(
            to_ai_friendly_error("Element not found"),
            "Element not found. Verify the selector is correct and the element exists in the DOM."
        );
    }

    #[test]
    fn test_to_ai_friendly_error_unknown() {
        let msg = "Some custom error message";
        assert_eq!(to_ai_friendly_error(msg), msg);
    }

    #[test]
    fn test_to_ai_friendly_error_ignores_non_element_not_found() {
        let err = "Chrome not found. Install Chrome or use --executable-path.";
        assert_eq!(to_ai_friendly_error(err), err);
    }

    #[test]
    fn test_to_ai_friendly_error_catches_no_element() {
        let mapped =
            "Element not found. Verify the selector is correct and the element exists in the DOM.";
        assert_eq!(to_ai_friendly_error("No element found for css 'x'"), mapped);
    }

    #[test]
    fn test_remaining_until_returns_none_for_past_deadline() {
        let deadline = Instant::now()
            .checked_sub(Duration::from_millis(1))
            .expect("past instant should be representable");
        assert!(remaining_until(deadline).is_none());
    }

    #[tokio::test]
    async fn test_run_with_lightpanda_deadline_enforces_timeout() {
        let deadline = Instant::now() + Duration::from_millis(25);
        let err = tokio::time::timeout(
            Duration::from_secs(1),
            run_with_lightpanda_deadline(
                deadline,
                async {
                    sleep(Duration::from_millis(100)).await;
                    Ok::<(), String>(())
                },
                "Target domain initialization attempt exceeded the remaining startup deadline",
            ),
        )
        .await
        .expect("outer timeout should not fire")
        .unwrap_err();

        assert!(err.contains(
            "Timed out after 10000ms waiting for Lightpanda Target domain to initialize"
        ));
        assert!(err.contains("remaining startup deadline"));
    }

    #[tokio::test]
    async fn test_run_with_lightpanda_deadline_returns_operation_error() {
        let deadline = Instant::now() + Duration::from_secs(1);
        let err = run_with_lightpanda_deadline(
            deadline,
            async { Err::<(), String>("Target.getTargets failed".to_string()) },
            "unused timeout context",
        )
        .await
        .unwrap_err();

        assert_eq!(err, "Target.getTargets failed");
    }

    #[test]
    fn test_lightpanda_target_init_timeout_includes_last_error() {
        let err = lightpanda_target_init_timeout(Some("Target.setDiscoverTargets failed"));
        assert!(err.contains(
            "Timed out after 10000ms waiting for Lightpanda Target domain to initialize"
        ));
        assert!(err.contains("Target.setDiscoverTargets failed"));
    }

    #[test]
    fn test_is_internal_chrome_target() {
        assert!(is_internal_chrome_target("chrome://newtab/"));
        assert!(is_internal_chrome_target(
            "chrome://omnibox-popup.top-chrome/"
        ));
        assert!(is_internal_chrome_target(
            "chrome-extension://abc123/popup.html"
        ));
        assert!(is_internal_chrome_target(
            "devtools://devtools/bundled/inspector.html"
        ));
        assert!(!is_internal_chrome_target("https://example.com"));
        assert!(!is_internal_chrome_target("http://localhost:3000"));
        assert!(!is_internal_chrome_target("about:blank"));
    }

    fn cdp_event(method: &str, session_id: &str, params: Value) -> CdpEvent {
        CdpEvent {
            method: method.to_string(),
            params,
            session_id: Some(session_id.to_string()),
        }
    }

    #[tokio::test]
    async fn test_network_idle_no_events_does_not_return_instantly() {
        let (tx, mut rx) = broadcast::channel::<CdpEvent>(16);
        let session = "s1";

        let start = tokio::time::Instant::now();
        let result = tokio::time::timeout(
            Duration::from_secs(5),
            poll_network_idle(session, &mut rx, Duration::from_secs(5)),
        )
        .await
        .expect("outer timeout should not fire");

        assert!(result.is_ok());
        let elapsed = start.elapsed();
        assert!(
            elapsed >= Duration::from_millis(500),
            "network idle returned in {:?}, expected >= 500ms",
            elapsed
        );

        drop(tx);
    }

    #[tokio::test]
    async fn test_network_idle_after_requests_complete() {
        let (tx, mut rx) = broadcast::channel::<CdpEvent>(16);
        let session = "s1";

        let _keep_alive = tx.clone();
        tokio::spawn(async move {
            sleep(Duration::from_millis(50)).await;
            let _ = tx.send(cdp_event(
                "Network.requestWillBeSent",
                session,
                json!({ "requestId": "r1" }),
            ));
            sleep(Duration::from_millis(100)).await;
            let _ = tx.send(cdp_event(
                "Network.loadingFinished",
                session,
                json!({ "requestId": "r1" }),
            ));
        });

        let start = tokio::time::Instant::now();
        let result = tokio::time::timeout(
            Duration::from_secs(5),
            poll_network_idle(session, &mut rx, Duration::from_secs(5)),
        )
        .await
        .expect("outer timeout should not fire");

        assert!(result.is_ok());
        let elapsed = start.elapsed();
        assert!(
            elapsed >= Duration::from_millis(500),
            "should wait >= 500ms after last request finishes, got {:?}",
            elapsed
        );
    }

    #[tokio::test]
    async fn test_network_idle_resets_on_new_request() {
        let (tx, mut rx) = broadcast::channel::<CdpEvent>(16);
        let session = "s1";

        let _keep_alive = tx.clone();
        tokio::spawn(async move {
            sleep(Duration::from_millis(50)).await;
            let _ = tx.send(cdp_event(
                "Network.requestWillBeSent",
                session,
                json!({ "requestId": "r1" }),
            ));
            sleep(Duration::from_millis(50)).await;
            let _ = tx.send(cdp_event(
                "Network.loadingFinished",
                session,
                json!({ "requestId": "r1" }),
            ));
            sleep(Duration::from_millis(200)).await;
            let _ = tx.send(cdp_event(
                "Network.requestWillBeSent",
                session,
                json!({ "requestId": "r2" }),
            ));
            sleep(Duration::from_millis(100)).await;
            let _ = tx.send(cdp_event(
                "Network.loadingFinished",
                session,
                json!({ "requestId": "r2" }),
            ));
        });

        let start = tokio::time::Instant::now();
        let result = tokio::time::timeout(
            Duration::from_secs(5),
            poll_network_idle(session, &mut rx, Duration::from_secs(5)),
        )
        .await
        .expect("outer timeout should not fire");

        assert!(result.is_ok());
        let elapsed = start.elapsed();
        assert!(
            elapsed >= Duration::from_millis(800),
            "should wait for idle after second request, got {:?}",
            elapsed
        );
    }

    #[tokio::test]
    async fn test_network_idle_overall_timeout() {
        let (tx, mut rx) = broadcast::channel::<CdpEvent>(16);
        let session = "s1";

        tokio::spawn(async move {
            for i in 0u64.. {
                let _ = tx.send(cdp_event(
                    "Network.requestWillBeSent",
                    session,
                    json!({ "requestId": format!("r{}", i) }),
                ));
                sleep(Duration::from_millis(100)).await;
            }
        });

        let result = poll_network_idle(session, &mut rx, Duration::from_millis(800)).await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("Timeout waiting for networkidle"));
    }
}

fn exception_message(result: &Value) -> Option<String> {
    let details = result.get("exceptionDetails")?;
    Some(
        details
            .pointer("/exception/description")
            .or_else(|| details.get("text"))
            .and_then(Value::as_str)
            .unwrap_or("Uncaught")
            .to_string(),
    )
}
