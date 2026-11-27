//! glibc's allocator keeps what a launch without a driver shader cache leaves behind: the NVIDIA
//! driver compiles every pipeline then, and its large scratch blocks raise the dynamic mmap
//! threshold, so later ones land in the arenas and stay there fragmented (~60 MB until restart).

/// Fixed thresholds: blocks of 1 MB and up are mapped and unmapped on their own, and arenas give
/// back their top past 128 KB.
#[cfg(all(target_os = "linux", target_env = "gnu"))]
pub fn init() {
    unsafe {
        libc::mallopt(libc::M_MMAP_THRESHOLD, 1 << 20);
        libc::mallopt(libc::M_TRIM_THRESHOLD, 128 << 10);
    }
}

/// Returns the free pages inside the arenas once the startup burst (first pipelines, effect warm)
/// is over.
#[cfg(all(target_os = "linux", target_env = "gnu"))]
pub fn after_startup() {
    let _ = std::thread::Builder::new().name("stella-trim".into()).spawn(|| {
        std::thread::sleep(std::time::Duration::from_secs(10));
        unsafe { libc::malloc_trim(0) };
    });
}

#[cfg(not(all(target_os = "linux", target_env = "gnu")))]
pub fn init() {}

#[cfg(not(all(target_os = "linux", target_env = "gnu")))]
pub fn after_startup() {}
