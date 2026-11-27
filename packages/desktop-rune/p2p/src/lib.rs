//! Stella's direct device link. A computer listens on an Iroh endpoint (QUIC with hole punching,
//! public relays only as a fallback path) under a persistent key; devices pair to it once with a
//! one-time code and from then on connect by key alone. No account, no Stella server.
//!
//! One node is both sides: it can have devices paired to it (it is their computer) and computers
//! it paired to. Everything an embedder needs is [`Node::command`], JSON in and JSON out, and the
//! JSON events it passes to the `emit` callback; the desktop engine, the phone engine, the C API
//! and the CLI all expose exactly that surface.
//!
//! Commands: `status`, `rename {name}`, `pairing.create {ttlMs?}`, `pairing.short`,
//! `pairing.cancel`, `pairing.deny {request}`, `pair {code}`, `pair.short {code}`,
//! `nearby.start`, `nearby.stop`, `nearby.list`, `pair.nearby {id}`, `pair.nearby.confirm {id, code}`,
//! `pair.nearby.cancel {id}`, `peers`, `device.revoke {id}`, `computer.forget {id}`,
//! `computer.connect {id}`, `computer.disconnect {id}`, `computer.retry {id?}`,
//! `request {id, body, timeoutMs?}`, `respond {req, ok, body?, error?}`, `emit {id?, body}`, `stop`.
//! Events: `{kind:"request", req, from, body}`, `{kind:"event", from, body}`,
//! `{kind:"device", id, state: paired|connected|disconnected|revoked|rejected, ...}`,
//! `{kind:"computer", id, state: paired|connecting|online|offline|revoked|not_paired|forgotten, ...}`,
//! `{kind:"pairing", state: used|expired|withdrawn|short_ended|confirm|confirm_done, ...}`,
//! `{kind:"nearby", id, state: found|lost|ended, ...}`.

mod client;
mod host;
mod nearby;
pub mod pairing;
pub mod pake;
mod short;
pub mod store;
mod wire;

#[cfg(feature = "ffi")]
pub mod ffi;

use std::collections::HashMap;
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use iroh::endpoint::{BindOpts, QuicTransportConfig, presets};
use iroh::{Endpoint, RelayMode, RelayUrl, SecretKey};
use serde_json::{Value, json};
use tokio::sync::{mpsc, oneshot, watch};

pub use store::{Computer, Device};

pub const ALPN: &[u8] = b"stella/p2p/1";
pub const PAIR_ALPN: &[u8] = b"stella/pair/1";
/// Close codes a computer uses towards a device.
pub const CLOSE_NOT_PAIRED: u32 = 403;
pub const CLOSE_REVOKED: u32 = 4001;
pub const CLOSE_REPLACED: u32 = 4002;

pub type Emit = Arc<dyn Fn(Value) + Send + Sync>;

#[derive(Clone, Debug)]
pub enum Relay {
    /// Iroh's public relays and address lookup (n0): reachable across networks, free.
    Default,
    /// Your own relay (`iroh-relay`), with n0 address lookup.
    Custom(String),
    /// Direct paths only: same network, or addresses the pairing code carried.
    Off,
}

#[derive(Clone, Debug)]
pub struct Config {
    pub data_dir: PathBuf,
    pub name: String,
    pub platform: String,
    pub relay: Relay,
    /// The UDP port to listen on; `None` reuses the last one (else picks one).
    pub port: Option<u16>,
    /// Answer nearby devices on the local network. Phones, which are never computers, turn it off.
    pub discoverable: bool,
    /// The mailbox behind short codes; `None` turns them off.
    pub rendezvous: Option<String>,
}

pub const DEFAULT_RENDEZVOUS: &str = "https://p2p.stella.sh";

impl Config {
    /// `{dataDir, name, platform, relay?: "default"|"off"|<url>, port?, discoverable?,
    /// rendezvous?: "off"|<url>}`.
    pub fn from_json(v: &Value) -> Result<Config, String> {
        let s = |k: &str| v.get(k).and_then(|x| x.as_str()).map(str::to_owned);
        let data_dir = s("dataDir").filter(|d| !d.is_empty()).ok_or("dataDir is required")?;
        let relay = match s("relay").as_deref() {
            None | Some("") | Some("default") => Relay::Default,
            Some("off") => Relay::Off,
            Some(url) => Relay::Custom(url.to_owned()),
        };
        Ok(Config {
            data_dir: PathBuf::from(data_dir),
            name: s("name").unwrap_or_else(|| "Stella".into()),
            platform: s("platform").unwrap_or_else(|| std::env::consts::OS.into()),
            relay,
            port: v.get("port").and_then(|p| p.as_u64()).map(|p| p as u16),
            discoverable: v.get("discoverable").and_then(|d| d.as_bool()).unwrap_or(true),
            rendezvous: match s("rendezvous").as_deref() {
                None | Some("") | Some("default") => Some(DEFAULT_RENDEZVOUS.to_owned()),
                Some("off") => None,
                Some(url) => Some(url.to_owned()),
            },
        })
    }
}

/// A live connection from a paired device.
struct DeviceLink {
    conn: iroh::endpoint::Connection,
    events: mpsc::UnboundedSender<Value>,
}

/// This device's link to one paired computer: wanted until `computer.disconnect`.
struct ComputerLink {
    stop: watch::Sender<bool>,
    retry: Arc<tokio::sync::Notify>,
    conn: Option<iroh::endpoint::Connection>,
    state: Value,
}

pub(crate) struct Inner {
    endpoint: Endpoint,
    store: Mutex<store::Store>,
    emit: Emit,
    name: Mutex<String>,
    platform: String,
    offers: Mutex<Vec<pairing::Offer>>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>,
    next_rid: AtomicU64,
    devices: Mutex<HashMap<String, DeviceLink>>,
    computers: Mutex<HashMap<String, ComputerLink>>,
    mdns: Option<iroh_mdns_address_lookup::MdnsAddressLookup>,
    discoverable: bool,
    rendezvous: Option<String>,
    confirming: Mutex<Option<nearby::Confirming>>,
    nearby: Mutex<nearby::Nearby>,
    asking: Mutex<HashMap<String, nearby::Asking>>,
    short: Mutex<Option<short::Slot>>,
}

pub struct Node {
    runtime: tokio::runtime::Runtime,
    inner: Arc<Inner>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn transport_config() -> QuicTransportConfig {
    QuicTransportConfig::builder()
        .keep_alive_interval(Duration::from_secs(2))
        .max_idle_timeout(Some(Duration::from_secs(8).try_into().expect("idle timeout fits")))
        .build()
}

async fn bind(config: &Config, key: SecretKey, port: u16) -> Result<(Endpoint, Option<iroh_mdns_address_lookup::MdnsAddressLookup>), String> {
    let key_id = key.public();
    let mut builder = match &config.relay {
        Relay::Off => Endpoint::builder(presets::N0DisableRelay),
        Relay::Default => Endpoint::builder(presets::N0),
        Relay::Custom(url) => {
            let url: RelayUrl = url.parse().map_err(|e| format!("relay {url} isn't a URL: {e}"))?;
            Endpoint::builder(presets::N0).relay_mode(RelayMode::custom([url]))
        }
    };
    builder = builder
        .secret_key(key)
        .alpns(vec![ALPN.to_vec(), PAIR_ALPN.to_vec()])
        .transport_config(transport_config());
    let mdns = iroh_mdns_address_lookup::MdnsAddressLookup::builder().service_name("stella-p2p").advertise(config.discoverable).build(key_id);
    match &mdns {
        Ok(mdns) => builder = builder.address_lookup(mdns.clone()),
        Err(e) => eprintln!("stella-p2p: no local network discovery ({e})"),
    }
    if port != 0 {
        builder = builder
            .bind_addr(SocketAddr::from((Ipv4Addr::UNSPECIFIED, port)))
            .map_err(|e| e.to_string())?
            .bind_addr_with_opts(SocketAddr::from((Ipv6Addr::UNSPECIFIED, port)), BindOpts::default().set_is_required(false))
            .map_err(|e| e.to_string())?;
    }
    let endpoint = builder.bind().await.map_err(|e| e.to_string())?;
    Ok((endpoint, mdns.ok()))
}

impl Node {
    pub fn start(config: Config, emit: Emit) -> Result<Node, String> {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("stella-p2p")
            .enable_all()
            .build()
            .map_err(|e| format!("can't start the device link: {e}"))?;
        let (store, key) = store::Store::open(&config.data_dir)?;
        let port = config.port.or(store.peers.port).unwrap_or(0);
        let (endpoint, mdns) = runtime.block_on(async {
            match bind(&config, key.clone(), port).await {
                Ok(endpoint) => Ok(endpoint),
                Err(e) if port != 0 => {
                    eprintln!("stella-p2p: port {port} is taken ({e}); listening on another");
                    bind(&config, key, 0).await
                }
                Err(e) => Err(e),
            }
        })?;
        let inner = Arc::new(Inner {
            endpoint,
            store: Mutex::new(store),
            emit,
            name: Mutex::new(config.name.clone()),
            platform: config.platform.clone(),
            offers: Mutex::new(Vec::new()),
            pending: Mutex::new(HashMap::new()),
            next_rid: AtomicU64::new(1),
            devices: Mutex::new(HashMap::new()),
            computers: Mutex::new(HashMap::new()),
            mdns,
            discoverable: config.discoverable,
            rendezvous: config.rendezvous.clone(),
            confirming: Mutex::new(None),
            nearby: Mutex::new(nearby::Nearby::default()),
            asking: Mutex::new(HashMap::new()),
            short: Mutex::new(None),
        });
        let bound = inner.endpoint.bound_sockets().into_iter().find(|a| a.is_ipv4()).map(|a| a.port());
        {
            let mut store = lock(&inner.store);
            if bound.is_some() && store.peers.port != bound {
                store.peers.port = bound;
                let _ = store.save();
            }
        }
        runtime.spawn(host::accept_loop(inner.clone()));
        Ok(Node { runtime, inner })
    }

    pub fn id(&self) -> String {
        self.inner.endpoint.id().to_string()
    }

    /// Runs one command; `done` gets its reply, on a runtime thread. `emit` and `respond` run right
    /// here instead, so a chat's events reach the device in the order they were emitted.
    pub fn command(&self, cmd: &str, args: Value, done: impl FnOnce(Result<Value, String>) + Send + 'static) {
        if let Some(result) = run_now(&self.inner, cmd, &args) {
            return done(result);
        }
        let inner = self.inner.clone();
        let cmd = cmd.to_owned();
        self.runtime.spawn(async move { done(run(inner, &cmd, args).await) });
    }

    pub fn command_blocking(&self, cmd: &str, args: Value) -> Result<Value, String> {
        self.runtime.block_on(run(self.inner.clone(), cmd, args))
    }

    /// Closes every connection and the endpoint.
    pub fn shutdown(self) {
        let inner = self.inner.clone();
        short::withdraw(&inner);
        nearby::stop(&inner);
        self.runtime.block_on(async move {
            for (_, link) in lock(&inner.computers).drain() {
                let _ = link.stop.send(true);
            }
            inner.endpoint.close().await;
        });
        self.runtime.shutdown_timeout(Duration::from_secs(1));
    }
}

fn str_arg<'a>(v: &'a Value, k: &str) -> Result<&'a str, String> {
    v.get(k).and_then(|x| x.as_str()).filter(|x| !x.is_empty()).ok_or_else(|| format!("{k} is required"))
}

/// The commands that only hand something to a queue, run on the caller's thread.
fn run_now(inner: &Arc<Inner>, cmd: &str, args: &Value) -> Option<Result<Value, String>> {
    match cmd {
        "respond" => Some((|| {
            let rid = args.get("req").and_then(|r| r.as_u64()).ok_or("req is required")?;
            let Some(waiting) = lock(&inner.pending).remove(&rid) else { return Ok(json!(false)) };
            let ok = args.get("ok").and_then(|o| o.as_bool()).unwrap_or(true);
            let result = if ok { Ok(args.get("body").cloned().unwrap_or(Value::Null)) } else { Err(args.get("error").and_then(|e| e.as_str()).unwrap_or("failed").to_owned()) };
            Ok(json!(waiting.send(result).is_ok()))
        })()),
        "emit" => Some(Ok(json!(host::emit(inner, args.get("id").and_then(|x| x.as_str()), args.get("body").cloned().unwrap_or(Value::Null))))),
        _ => None,
    }
}

async fn run(inner: Arc<Inner>, cmd: &str, args: Value) -> Result<Value, String> {
    match cmd {
        "status" => Ok(status(&inner).await),
        "rename" => {
            *lock(&inner.name) = str_arg(&args, "name")?.to_owned();
            Ok(Value::Null)
        }
        "pairing.create" => host::create_offer(&inner, args.get("ttlMs").and_then(|t| t.as_u64())).await,
        "pairing.short" => short::create(&inner).await,
        "pairing.deny" => Ok(json!(nearby::deny(&inner, args.get("request").and_then(|r| r.as_u64()).ok_or("request is required")?))),
        "pair.short" => short::pair(&inner, str_arg(&args, "code")?).await,
        "nearby.start" => nearby::start(&inner),
        "nearby.stop" => {
            nearby::stop(&inner);
            Ok(Value::Null)
        }
        "nearby.list" => Ok(nearby::list(&inner)),
        "pair.nearby" => nearby::ask(&inner, str_arg(&args, "id")?).await,
        "pair.nearby.confirm" => nearby::confirm(&inner, str_arg(&args, "id")?, str_arg(&args, "code")?).await,
        "pair.nearby.cancel" => {
            nearby::cancel(&inner, str_arg(&args, "id")?);
            Ok(Value::Null)
        }
        "pairing.cancel" => {
            short::withdraw(&inner);
            lock(&inner.offers).clear();
            (inner.emit)(json!({ "kind": "pairing", "state": "withdrawn" }));
            Ok(Value::Null)
        }
        "pair" => client::pair(&inner, str_arg(&args, "code")?).await,
        "peers" => Ok(peers(&inner)),
        "device.revoke" => host::revoke(&inner, str_arg(&args, "id")?),
        "computer.forget" => client::forget(&inner, str_arg(&args, "id")?),
        "computer.connect" => client::connect(&inner, str_arg(&args, "id")?),
        "computer.disconnect" => client::disconnect(&inner, str_arg(&args, "id")?),
        "computer.retry" => {
            client::retry(&inner, args.get("id").and_then(|x| x.as_str()));
            Ok(Value::Null)
        }
        "request" => {
            let timeout = Duration::from_millis(args.get("timeoutMs").and_then(|t| t.as_u64()).unwrap_or(60_000).clamp(1_000, 600_000));
            client::request(&inner, str_arg(&args, "id")?, args.get("body").cloned().unwrap_or(Value::Null), timeout).await
        }
        "respond" | "emit" => run_now(&inner, cmd, &args).unwrap_or(Ok(Value::Null)),
        "stop" => {
            for (_, link) in lock(&inner.computers).drain() {
                let _ = link.stop.send(true);
            }
            inner.endpoint.close().await;
            Ok(Value::Null)
        }
        _ => Err(format!("unknown p2p command {cmd}")),
    }
}

fn reachable(inner: &Inner) -> (Option<String>, Vec<String>) {
    let addr = inner.endpoint.addr();
    let relay = addr.relay_urls().next().map(|u| u.to_string());
    let mut ips: Vec<SocketAddr> = addr.ip_addrs().copied().filter(|a| !a.ip().is_loopback() && !a.ip().is_unspecified()).collect();
    // Home networks first (most pairing happens on one), then other private ranges (often VPNs and
    // containers), then public addresses.
    ips.sort_by_key(|a| match a.ip() {
        std::net::IpAddr::V4(v4) if v4.octets()[..2] == [192, 168] => 0,
        std::net::IpAddr::V4(v4) if v4.octets()[0] == 10 => 1,
        std::net::IpAddr::V4(v4) if v4.is_private() => 2,
        std::net::IpAddr::V4(_) => 3,
        std::net::IpAddr::V6(_) => 4,
    });
    ips.truncate(6);
    (relay, ips.into_iter().map(|a| a.to_string()).collect())
}

async fn status(inner: &Inner) -> Value {
    let _ = tokio::time::timeout(Duration::from_secs(3), inner.endpoint.online()).await;
    let (relay, addrs) = reachable(inner);
    json!({
        "id": inner.endpoint.id().to_string(),
        "name": *lock(&inner.name),
        "platform": inner.platform,
        "relay": relay,
        "addrs": addrs,
        "port": lock(&inner.store).peers.port,
    })
}

fn peers(inner: &Inner) -> Value {
    let store = lock(&inner.store);
    let live = lock(&inner.devices);
    let links = lock(&inner.computers);
    let devices: Vec<Value> = store
        .peers
        .devices
        .iter()
        .map(|d| {
            let mut v = serde_json::to_value(d).unwrap_or(Value::Null);
            v["connected"] = json!(live.contains_key(&d.id));
            v
        })
        .collect();
    let computers: Vec<Value> = store
        .peers
        .computers
        .iter()
        .map(|c| {
            let mut v = serde_json::to_value(c).unwrap_or(Value::Null);
            v["link"] = links.get(&c.id).map(|l| l.state.clone()).unwrap_or(json!({ "state": "idle" }));
            v
        })
        .collect();
    json!({ "devices": devices, "computers": computers })
}
