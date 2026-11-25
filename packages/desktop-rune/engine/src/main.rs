//! stella-engine: a compiled Rune engine whose whole app is TypeScript in one Bun process.
//!
//! The binary knows nothing about Stella's screens. It spawns the Bun host (`host/main.tsx`),
//! reads length-prefixed binary frames of tree mutations and commands from it, keeps a retained
//! mirror tree, and turns that tree into Rune `El`s per window on each commit. Layout, text,
//! scrolling, hover, springs and painting stay native; only state changes cross the bridge.
//! Events go back to the host as JSON lines. The protocol is in `host/ELEMENTS.md`.

mod commands;
mod control;
mod engine;
mod input;
mod keys;
mod markdown;
mod media;
mod metrics;
mod props;
mod protocol;
mod services;
mod style;
mod surface;
mod text;
mod tree;
mod view;
#[cfg(feature = "webview")]
mod webview;
mod windows;

use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, mpsc};

use rune::{App, Waker};

use crate::metrics::METRICS;
use crate::windows::Win;

struct Boot {
    rx: mpsc::Receiver<protocol::Msg>,
    to_host: Box<dyn std::io::Write>,
    child: Child,
    waker: Arc<Mutex<Option<Waker>>>,
}

/// On Unix the bridge gets its own pipes (host fd 4 → engine frames, engine → host fd 5) so
/// anything the host or its children print on stdout can't corrupt it; an inherited fd 3 (the
/// launcher's socket) passes through untouched. Windows uses the host's stdio for now.
#[cfg(unix)]
fn spawn_host(cmd: &mut Command) -> (Child, Box<dyn std::io::Read + Send>, Box<dyn std::io::Write>) {
    use std::os::fd::{AsFd, AsRawFd};
    use std::os::unix::process::CommandExt;
    let (from_host, host_out) = std::io::pipe().expect("bridge pipe");
    let (host_in, to_host) = std::io::pipe().expect("bridge pipe");
    let (out_fd, in_fd) = (host_out.as_raw_fd(), host_in.as_raw_fd());
    let stderr = std::io::stderr().as_fd().try_clone_to_owned().expect("dup stderr");
    cmd.env("STELLA_RUNE_BRIDGE_OUT_FD", "4").env("STELLA_RUNE_BRIDGE_IN_FD", "5").stdin(Stdio::null()).stdout(Stdio::from(stderr));
    // SAFETY: only async-signal-safe fcntl/dup2 calls between fork and exec. Both ends move
    // above 9 first so neither is clobbered when it already sits on 4 or 5.
    unsafe {
        cmd.pre_exec(move || {
            let hi_out = libc::fcntl(out_fd, libc::F_DUPFD, 10);
            let hi_in = libc::fcntl(in_fd, libc::F_DUPFD, 10);
            if hi_out < 0 || hi_in < 0 || libc::dup2(hi_out, 4) < 0 || libc::dup2(hi_in, 5) < 0 {
                return Err(std::io::Error::last_os_error());
            }
            libc::close(hi_out);
            libc::close(hi_in);
            libc::setpgid(0, 0);
            #[cfg(target_os = "linux")]
            libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM);
            Ok(())
        });
    }
    let child = cmd.spawn().unwrap_or_else(|e| panic!("could not start the TS host: {e}"));
    HOST_GROUP.store(child.id() as i32, std::sync::atomic::Ordering::Relaxed);
    end_host_on_signals();
    drop(host_out);
    drop(host_in);
    (child, Box::new(from_host), Box::new(to_host))
}

/// The host's process group: the host and everything it starts (Bun workers, build children).
#[cfg(unix)]
static HOST_GROUP: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(0);

#[cfg(unix)]
pub fn end_host_group() {
    let g = HOST_GROUP.load(std::sync::atomic::Ordering::Relaxed);
    if g > 0 {
        // SAFETY: signals a process group this process created.
        unsafe { libc::killpg(g, libc::SIGTERM) };
    }
}

/// The host runs main's own quit on SIGTERM (before-quit cleanups, the runtime told to quit);
/// it is killed only if that outlasts `HOST_QUIT_GRACE`.
pub fn end_host(mut c: std::process::Child) {
    const HOST_QUIT_GRACE: std::time::Duration = std::time::Duration::from_secs(8);
    #[cfg(unix)]
    {
        end_host_group();
        let until = std::time::Instant::now() + HOST_QUIT_GRACE;
        while std::time::Instant::now() < until {
            if !matches!(c.try_wait(), Ok(None)) {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    }
    let _ = c.kill();
    let _ = c.wait();
}

/// A launcher's terminate (SIGTERM), Ctrl+C or a closed terminal ends the host's whole group
/// with the engine; `on_quit` runs only on a graceful quit.
#[cfg(unix)]
fn end_host_on_signals() {
    extern "C" fn on_signal(sig: libc::c_int) {
        let g = HOST_GROUP.load(std::sync::atomic::Ordering::Relaxed);
        // SAFETY: killpg and _exit are async-signal-safe.
        unsafe {
            if g > 0 {
                libc::killpg(g, libc::SIGTERM);
            }
            libc::_exit(128 + sig);
        }
    }
    for sig in [libc::SIGTERM, libc::SIGINT, libc::SIGHUP] {
        // SAFETY: installs a handler that only calls async-signal-safe functions.
        unsafe { libc::signal(sig, on_signal as *const () as libc::sighandler_t) };
    }
}

#[cfg(not(unix))]
fn spawn_host(cmd: &mut Command) -> (Child, Box<dyn std::io::Read + Send>, Box<dyn std::io::Write>) {
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped());
    let mut child = cmd.spawn().unwrap_or_else(|e| panic!("could not start the TS host: {e}"));
    let out = child.stdout.take().expect("piped stdout");
    let inp = child.stdin.take().expect("piped stdin");
    (child, Box::new(out), Box::new(inp))
}

fn spawn_ts() -> Boot {
    let root = std::env::var("STELLA_RUNE_ROOT").unwrap_or_else(|_| {
        let exe = std::env::current_exe().ok();
        exe.and_then(|p| p.ancestors().nth(4).map(|p| p.to_string_lossy().into_owned())).unwrap_or_else(|| ".".into())
    });
    let bun = std::env::var("STELLA_RUNE_BUN").unwrap_or_else(|_| "bun".into());
    let host = format!("{root}/host/main.tsx");
    let mut cmd = Command::new(&bun);
    cmd.arg(&host).args(std::env::args_os().skip(1)).current_dir(&root).stderr(Stdio::inherit());
    let (child, from_host, to_host) = spawn_host(&mut cmd);
    let (tx, rx) = mpsc::channel();
    let waker: Arc<Mutex<Option<Waker>>> = Arc::new(Mutex::new(None));
    let w2 = waker.clone();
    std::thread::Builder::new().name("ts-bridge".into()).spawn(move || protocol::read_loop(from_host, tx, w2)).expect("bridge thread");
    Boot { rx, to_host, child, waker }
}

/// Linux: native child WebViews need an X11 parent, so with webviews built in the engine runs on
/// X11 (XWayland under a Wayland session) unless `STELLA_RUNE_BACKEND=wayland`.
#[cfg(all(target_os = "linux", feature = "webview"))]
fn linux_backend() {
    let want = std::env::var("STELLA_RUNE_BACKEND").unwrap_or_default();
    if want != "wayland" && std::env::var_os("DISPLAY").is_some() {
        // SAFETY: before any thread that reads the environment starts.
        unsafe {
            std::env::remove_var("WAYLAND_DISPLAY");
            std::env::set_var("GDK_BACKEND", "x11");
        }
    }
}

fn main() {
    metrics::mark_process_start();
    #[cfg(all(target_os = "linux", feature = "webview"))]
    linux_backend();
    // Start the TS host before the window and GPU: Bun boots while Rune prewarms the GPU.
    let boot = spawn_ts();
    engine::set_out(boot.to_host);
    engine::with(|e| {
        e.rx = Some(boot.rx);
        e.child = Some(boot.child);
        e.main_waker = boot.waker;
    });
    let w = std::env::var("STELLA_RUNE_W").ok().and_then(|v| v.parse().ok()).unwrap_or(1280.0);
    let h = std::env::var("STELLA_RUNE_H").ok().and_then(|v| v.parse().ok()).unwrap_or(820.0);
    let main_props: props::Props = std::env::var("STELLA_RUNE_WINDOW").ok().and_then(|j| serde_json::from_str(&j).ok()).unwrap_or_default();
    let mut p = main_props.clone();
    if p.w.is_none() {
        p.w = Some(props::Size::Pt(w));
        p.h = Some(props::Size::Pt(h));
    }
    if p.title.is_none() {
        p.title = Some("Stella".into());
    }
    let mut spec = windows::app_spec(&p);
    spec.min_size = p.min_size.map(|[w, h]| (w, h)).or(Some((640.0, 480.0)));
    let app = App::new(spec).init(|| Win { node: 0, main: true, inputs: Default::default(), bg: None }).keep_running();
    let app = windows::decorate_main(app, &p).window_options(windows::options(&p));
    let schemes = std::env::var("STELLA_RUNE_URL_SCHEMES").unwrap_or_else(|_| "stella".into());
    rune::url_schemes(schemes.split(',').map(str::trim).filter(|s| !s.is_empty()));
    let app = app.on_open_url(|_s: &mut Win, url: &str, _tx| engine::send(serde_json::json!({ "t": "open-url", "url": url })));
    let _ = services::APP.set(app.handle());
    app.on_ready(|h| {
        let h = h.clone();
        engine::with(|e| {
            e.main_handle = Some(h.clone());
            if let Some(n) = e.main_node
                && let Some(slot) = e.windows.get_mut(&n)
            {
                slot.handle = Some(h);
            }
        });
    })
    .on_frame_encoded(|f| METRICS.lock().unwrap_or_else(|e| e.into_inner()).on_frame(f))
    .on_quit(|_s: &mut Win, _| {
        if let Some(c) = engine::with(|e| e.child.take()) {
            end_host(c);
        }
    })
    .run();
}
