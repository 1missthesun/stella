#[cfg(unix)]
use std::time::Duration;

const PARENT_PID_ENV: &str = "STELLA_BROWSER_PARENT_PID";

pub fn parent_from_env() -> Option<u32> {
    std::env::var(PARENT_PID_ENV)
        .ok()?
        .trim()
        .parse::<u32>()
        .ok()
        .filter(|&pid| pid > 1)
}

#[cfg(unix)]
pub async fn parent_exited(parent: u32) {
    // An exited parent hands its children to another process, so the parent
    // pid stops matching. Unlike probing the pid, this cannot be fooled by a
    // new process reusing it.
    let is_child = || unsafe { libc::getppid() } as u32 == parent;
    if !is_child() {
        return std::future::pending().await;
    }
    let mut interval = tokio::time::interval(Duration::from_secs(1));
    loop {
        interval.tick().await;
        if !is_child() {
            return;
        }
    }
}

#[cfg(windows)]
pub async fn parent_exited(parent: u32) {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, INFINITE, PROCESS_SYNCHRONIZE,
    };

    // The handle is taken at startup, so the wait follows this very process
    // even if its pid is later reused.
    let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, parent) };
    if handle == 0 {
        return std::future::pending().await;
    }
    let raw = handle as isize;
    let waited = tokio::task::spawn_blocking(move || unsafe {
        let handle = raw as HANDLE;
        WaitForSingleObject(handle, INFINITE);
        CloseHandle(handle);
    })
    .await;
    if waited.is_err() {
        std::future::pending::<()>().await;
    }
}

pub fn spawn_parent_watch(shutdown: tokio::sync::mpsc::UnboundedSender<()>) {
    let Some(parent) = parent_from_env() else {
        return;
    };
    tokio::spawn(async move {
        parent_exited(parent).await;
        let _ = shutdown.send(());
    });
}
