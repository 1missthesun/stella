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
