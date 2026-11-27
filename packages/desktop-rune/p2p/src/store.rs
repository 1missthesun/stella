//! What a node keeps on disk, in `<dataDir>`: its secret key (`identity.key`, 32 bytes) and who
//! it trusts (`peers.json`): the devices paired to it and the computers it paired to. Both files
//! are owner-only and replaced atomically.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use iroh::SecretKey;
use serde::{Deserialize, Serialize};

/// A device allowed to connect to this computer.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub id: String,
    pub name: String,
    pub platform: String,
    pub paired_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_seen_at: Option<u64>,
}

/// A computer this device paired to, with where it was last reachable.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Computer {
    pub id: String,
    pub name: String,
    pub platform: String,
    pub paired_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relay: Option<String>,
    #[serde(default)]
    pub addrs: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_seen_at: Option<u64>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Peers {
    #[serde(default)]
    pub devices: Vec<Device>,
    #[serde(default)]
    pub computers: Vec<Computer>,
    /// The UDP port this node listened on last, so paired devices find it at the same address after a restart.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
}

pub struct Store {
    dir: PathBuf,
    pub peers: Peers,
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension(format!("tmp-{}", std::process::id()));
    {
        let mut options = fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }
    fs::rename(&tmp, path)
}

impl Store {
    pub fn open(dir: &Path) -> Result<(Store, SecretKey), String> {
        fs::create_dir_all(dir).map_err(|e| format!("can't create {}: {e}", dir.display()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(dir, fs::Permissions::from_mode(0o700));
        }
        let key_path = dir.join("identity.key");
        let key = match fs::read(&key_path) {
            Ok(bytes) if bytes.len() == 32 => {
                let mut raw = [0u8; 32];
                raw.copy_from_slice(&bytes);
                SecretKey::from_bytes(&raw)
            }
            Ok(_) => return Err(format!("{} is damaged; remove it to give this device a new identity", key_path.display())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let key = SecretKey::generate();
                write_private(&key_path, &key.to_bytes()).map_err(|e| format!("can't save the device key: {e}"))?;
                key
            }
            Err(e) => return Err(format!("can't read the device key: {e}")),
        };
        let peers_path = dir.join("peers.json");
        let peers = match fs::read(&peers_path) {
            Ok(bytes) => match serde_json::from_slice::<Peers>(&bytes) {
                Ok(peers) => peers,
                Err(e) => {
                    let damaged = dir.join(format!("peers.json.damaged-{}", now_ms()));
                    let _ = fs::rename(&peers_path, &damaged);
                    eprintln!("stella-p2p: peers.json was unreadable ({e}); kept as {}", damaged.display());
                    Peers::default()
                }
            },
            Err(_) => Peers::default(),
        };
        Ok((Store { dir: dir.to_owned(), peers }, key))
    }

    pub fn save(&self) -> Result<(), String> {
        let bytes = serde_json::to_vec_pretty(&self.peers).map_err(|e| e.to_string())?;
        write_private(&self.dir.join("peers.json"), &bytes).map_err(|e| format!("can't save paired devices: {e}"))
    }

    pub fn device(&self, id: &str) -> Option<&Device> {
        self.peers.devices.iter().find(|d| d.id == id)
    }

    pub fn computer(&self, id: &str) -> Option<&Computer> {
        self.peers.computers.iter().find(|c| c.id == id)
    }

    pub fn put_device(&mut self, device: Device) {
        self.peers.devices.retain(|d| d.id != device.id);
        self.peers.devices.push(device);
    }

    pub fn put_computer(&mut self, computer: Computer) {
        self.peers.computers.retain(|c| c.id != computer.id);
        self.peers.computers.push(computer);
    }
}
