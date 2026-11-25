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
            Ok(())
        });
    }
    let child = cmd.spawn().unwrap_or_else(|e| panic!("could not start the TS host: {e}"));
    drop(host_out);
    drop(host_in);
    (child, Box::new(from_host), Box::new(to_host))
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
    cmd.arg(&host).current_dir(&root).stderr(Stdio::inherit());
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
    let app = App::new(spec).init(|| Win { node: 0, main: true, inputs: Default::default() }).keep_running();
    let app = windows::decorate(app, &p).window_options(windows::options(&p));
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
        let child = engine::with(|e| e.child.take());
        if let Some(mut c) = child {
            let _ = c.kill();
            let _ = c.wait();
        }
    })
    .run();
}
