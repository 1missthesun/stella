//! Stand-ins for Scrawl's app config (`handoff.rs`): Stella has no `config.json`, so
//! experiments are off and auto-crop uses its defaults.

use std::path::{Path, PathBuf};

pub const AGENT_CONTEXT: &str = "agentContext";

#[derive(Default)]
pub struct Config {
    pub autocrop: Option<serde_json::Value>,
}

pub fn experiment(_name: &str) -> bool {
    false
}

pub fn default_config_path() -> PathBuf {
    PathBuf::new()
}

pub fn load_config_from(_path: &Path) -> Config {
    Config::default()
}
