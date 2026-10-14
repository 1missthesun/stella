use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

pub const STORE_EXTENSION_ID: &str = "kfnchfpocpmdblhfgcnpfaaebaioojnl";

#[derive(Clone, Debug, Default)]
pub struct ClientInfo {
    pub browser: String,
    pub bundle_id: Option<String>,
    pub browser_pid: Option<u32>,
    pub extension_id: Option<String>,
    pub user_data_dir: Option<String>,
    pub extension_version: String,
    pub profile_dir: Option<PathBuf>,
    pub profile: Option<String>,
    pub email: Option<String>,
}

impl ClientInfo {
    pub fn from_hello(hello: &Value, extension_version: &str) -> Self {
        let client = hello.get("client");
        let text = |name: &str| {
            client
                .and_then(|c| c.get(name))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
        };
        let bundle_id = text("bundleId");
        let parent_exe = text("parentExe");
        let browser = text("browser")
            .or_else(|| parent_exe.as_deref().and_then(app_bundle_name))
            .or_else(|| parent_exe.as_deref().and_then(browser_name_for_exe))
            .or_else(|| bundle_id.as_deref().and_then(browser_name_for_bundle))
            .unwrap_or_else(|| "Browser".to_string());
        let extension_id = text("origin").and_then(|origin| {
            origin
                .strip_prefix("chrome-extension://")
                .map(|rest| rest.trim_end_matches('/').to_string())
                .filter(|id| !id.is_empty())
        });
        Self {
            browser,
            bundle_id,
            browser_pid: client
                .and_then(|c| c.get("parentPid"))
                .and_then(Value::as_u64)
                .and_then(|pid| u32::try_from(pid).ok()),
            extension_id,
            user_data_dir: text("userDataDir"),
            extension_version: extension_version.to_string(),
            profile_dir: None,
            profile: None,
            email: None,
        }
    }

    pub fn key(&self) -> String {
        if let Some(dir) = &self.profile_dir {
            return dir.to_string_lossy().into_owned();
        }
        format!("browser:{}", self.browser)
    }

    pub fn label(&self) -> String {
        let mut label = self.browser.clone();
        match (&self.profile, &self.email) {
            (Some(profile), Some(email)) if profile != email => {
                label.push_str(&format!(" · {} ({})", profile, email))
            }
            (Some(profile), _) => label.push_str(&format!(" · {}", profile)),
            (None, Some(email)) => label.push_str(&format!(" · {}", email)),
            (None, None) => {}
        }
        label
    }

    pub fn browser_root(&self) -> Option<PathBuf> {
        self.profile_dir
            .as_ref()
            .and_then(|dir| dir.parent())
            .map(Path::to_path_buf)
    }

    pub fn to_json(&self) -> Value {
        json!({
            "key": self.key(),
            "label": self.label(),
            "browser": self.browser,
            "bundleId": self.bundle_id,
            "browserPid": self.browser_pid,
            "profile": self.profile,
            "email": self.email,
            "profileDir": self.profile_dir.as_ref().map(|d| d.to_string_lossy().into_owned()),
            "extensionVersion": self.extension_version,
        })
    }
}

fn browser_name_for_bundle(bundle: &str) -> Option<String> {
    let name = match bundle {
        "com.google.Chrome" => "Google Chrome",
        "com.google.Chrome.beta" => "Google Chrome Beta",
        "com.google.Chrome.dev" => "Google Chrome Dev",
        "com.google.Chrome.canary" => "Google Chrome Canary",
        "com.google.chrome.for.testing" => "Google Chrome for Testing",
        "org.chromium.Chromium" => "Chromium",
        "com.brave.Browser" => "Brave",
        "com.brave.Browser.beta" => "Brave Beta",
        "com.brave.Browser.nightly" => "Brave Nightly",
        "com.microsoft.edgemac" => "Microsoft Edge",
        "company.thebrowser.Browser" => "Arc",
        "com.vivaldi.Vivaldi" => "Vivaldi",
        "com.operasoftware.Opera" => "Opera",
        _ => return None,
    };
    Some(name.to_string())
}

fn app_bundle_name(exe: &str) -> Option<String> {
    let index = exe.find(".app/Contents/MacOS/")?;
    let app = &exe[..index];
    let name = app.rsplit('/').next()?.trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

fn browser_name_for_exe(exe: &str) -> Option<String> {
    let stem = Path::new(exe).file_stem()?.to_string_lossy().to_string();
    let lower = stem.to_lowercase();
    let name = if lower.contains("brave") {
        "Brave"
    } else if lower.contains("edge") {
        "Microsoft Edge"
    } else if lower.contains("vivaldi") {
        "Vivaldi"
    } else if lower.contains("chromium") {
        "Chromium"
    } else if lower == "arc" {
        "Arc"
    } else if lower.contains("chrome") {
        "Google Chrome"
    } else {
        return Some(stem);
    };
    Some(name.to_string())
}

fn known_browser_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    #[cfg(target_os = "macos")]
    if let Some(home) = dirs::home_dir() {
        let support = home.join("Library/Application Support");
        for rel in [
            "Google/Chrome",
            "Google/Chrome Beta",
            "Google/Chrome Dev",
            "Google/Chrome Canary",
            "Google/Chrome for Testing",
            "Chromium",
            "BraveSoftware/Brave-Browser",
            "BraveSoftware/Brave-Browser-Beta",
            "BraveSoftware/Brave-Browser-Nightly",
            "Microsoft Edge",
            "Microsoft Edge Beta",
            "Arc/User Data",
            "Vivaldi",
            "com.operasoftware.Opera",
        ] {
            roots.push(support.join(rel));
        }
    }
    #[cfg(target_os = "linux")]
    if let Some(config) = dirs::config_dir() {
        for rel in [
            "google-chrome",
            "google-chrome-beta",
            "google-chrome-unstable",
            "chromium",
            "BraveSoftware/Brave-Browser",
            "BraveSoftware/Brave-Browser-Beta",
            "microsoft-edge",
            "vivaldi",
        ] {
            roots.push(config.join(rel));
        }
    }
    #[cfg(windows)]
    if let Some(local) = dirs::data_local_dir() {
        for rel in [
            "Google/Chrome/User Data",
            "Google/Chrome Beta/User Data",
            "Google/Chrome SxS/User Data",
            "Chromium/User Data",
            "BraveSoftware/Brave-Browser/User Data",
            "Microsoft/Edge/User Data",
            "Vivaldi/User Data",
        ] {
            roots.push(local.join(rel));
        }
    }
    roots
}

pub fn probe_marker() -> String {
    format!("stella-profile-probe-{}", uuid::Uuid::new_v4().simple())
}

pub fn find_profile_with_marker(info: &ClientInfo, marker: &str) -> Option<PathBuf> {
    let extension_id = info
        .extension_id
        .clone()
        .unwrap_or_else(|| STORE_EXTENSION_ID.to_string());
    let mut roots = Vec::new();
    if let Some(dir) = &info.user_data_dir {
        roots.push(PathBuf::from(dir));
    }
    roots.extend(known_browser_roots());
    let needle = marker.as_bytes();
    for root in roots {
        let Ok(entries) = fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            let profile_dir = entry.path();
            let settings = profile_dir
                .join("Local Extension Settings")
                .join(&extension_id);
            let Ok(files) = fs::read_dir(&settings) else {
                continue;
            };
            for file in files.flatten() {
                let path = file.path();
                if path.extension().and_then(|e| e.to_str()) != Some("log") {
                    continue;
                }
                let Ok(bytes) = fs::read(&path) else {
                    continue;
                };
                if bytes.windows(needle.len()).any(|w| w == needle) {
                    return Some(profile_dir);
                }
            }
        }
    }
    None
}

pub fn read_profile_identity(profile_dir: &Path) -> (Option<String>, Option<String>) {
    let Some(root) = profile_dir.parent() else {
        return (None, None);
    };
    let Some(dir_name) = profile_dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
    else {
        return (None, None);
    };
    let Ok(raw) = fs::read_to_string(root.join("Local State")) else {
        return (Some(dir_name), None);
    };
    let Ok(state) = serde_json::from_str::<Value>(&raw) else {
        return (Some(dir_name), None);
    };
    let entry = state
        .pointer("/profile/info_cache")
        .and_then(|cache| cache.get(&dir_name));
    let text = |name: &str| {
        entry
            .and_then(|e| e.get(name))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    let name = text("name")
        .or_else(|| text("gaia_given_name"))
        .or(Some(dir_name));
    (name, text("user_name"))
}

fn last_used_profile(root: &Path) -> Option<String> {
    let raw = fs::read_to_string(root.join("Local State")).ok()?;
    let state: Value = serde_json::from_str(&raw).ok()?;
    state
        .pointer("/profile/last_used")
        .and_then(Value::as_str)
        .map(str::to_string)
}

pub struct ActivityRanker {
    front_order: HashMap<u32, Option<usize>>,
    last_used: HashMap<PathBuf, Option<String>>,
}

impl ActivityRanker {
    pub fn new() -> Self {
        Self {
            front_order: HashMap::new(),
            last_used: HashMap::new(),
        }
    }

    pub fn rank(&mut self, info: &ClientInfo) -> (usize, usize) {
        let app_rank = match info.browser_pid {
            Some(pid) => self
                .front_order
                .entry(pid)
                .or_insert_with(|| front_rank_for_pid(pid))
                .unwrap_or(usize::MAX - 1),
            None => usize::MAX,
        };
        let profile_rank = match (info.browser_root(), info.profile_dir.as_ref()) {
            (Some(root), Some(dir)) => {
                let last = self
                    .last_used
                    .entry(root.clone())
                    .or_insert_with(|| last_used_profile(&root))
                    .clone();
                let name = dir.file_name().map(|n| n.to_string_lossy().to_string());
                if last.is_some() && last == name {
                    0
                } else {
                    1
                }
            }
            _ => 1,
        };
        (app_rank, profile_rank)
    }
}

#[cfg(target_os = "macos")]
fn lsappinfo(args: &[&str]) -> Option<String> {
    std::process::Command::new("/usr/bin/lsappinfo")
        .args(args)
        .output()
        .ok()
        .map(|out| String::from_utf8_lossy(&out.stdout).into_owned())
}

#[cfg(target_os = "macos")]
fn visible_asns() -> Vec<String> {
    static CACHE: std::sync::Mutex<Option<(Instant, Vec<String>)>> = std::sync::Mutex::new(None);
    if let Ok(cache) = CACHE.lock() {
        if let Some((at, asns)) = cache.as_ref() {
            if at.elapsed() < Duration::from_secs(2) {
                return asns.clone();
            }
        }
    }
    let asns: Vec<String> = lsappinfo(&["visibleProcessList"])
        .unwrap_or_default()
        .split_whitespace()
        .filter_map(|token| {
            let start = token.find("ASN:")?;
            let rest = &token[start..];
            let end = rest.find("-\"").unwrap_or(rest.len());
            Some(rest[..end].trim_end_matches(':').to_string())
        })
        .collect();
    if let Ok(mut cache) = CACHE.lock() {
        *cache = Some((Instant::now(), asns.clone()));
    }
    asns
}

#[cfg(target_os = "macos")]
fn front_rank_for_pid(pid: u32) -> Option<usize> {
    let info = lsappinfo(&["info", "-only", "asn", &pid.to_string()])?;
    let asn = info
        .split('=')
        .nth(1)?
        .trim()
        .trim_end_matches(':')
        .to_string();
    if asn.is_empty() {
        return None;
    }
    visible_asns()
        .iter()
        .position(|candidate| *candidate == asn)
}

#[cfg(not(target_os = "macos"))]
fn front_rank_for_pid(_pid: u32) -> Option<usize> {
    let _ = (Instant::now(), Duration::from_secs(0));
    None
}
