//! Display changes: `{t:"display"}` whenever monitors, their scale or their work areas change, so
//! the host refreshes `screen` and emits Electron's display events. Windows watches the messages
//! Chromium's display observer listens for, on a hidden top-level window of its own thread.

#[cfg(windows)]
pub fn start() {
    std::thread::spawn(win::run);
}

#[cfg(not(windows))]
pub fn start() {}

#[cfg(windows)]
mod win {
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, MSG, RegisterClassW, SPI_SETWORKAREA, TranslateMessage,
        WINDOW_EX_STYLE, WM_DISPLAYCHANGE, WM_DPICHANGED, WM_SETTINGCHANGE, WNDCLASSW, WS_OVERLAPPED,
    };
    use windows::core::w;

    pub fn run() {
        // SAFETY: a window class and a never-shown window owned by this thread, pumped until exit.
        unsafe {
            let Ok(module) = GetModuleHandleW(None) else { return };
            let class = WNDCLASSW { lpfnWndProc: Some(proc), hInstance: module.into(), lpszClassName: w!("StellaRuneDisplayWatch"), ..Default::default() };
            if RegisterClassW(&class) == 0 {
                return;
            }
            let hwnd = CreateWindowExW(
                WINDOW_EX_STYLE(0),
                class.lpszClassName,
                w!(""),
                WS_OVERLAPPED,
                0,
                0,
                0,
                0,
                None,
                None,
                Some(module.into()),
                None,
            );
            if hwnd.is_err() {
                return;
            }
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
    }

    unsafe extern "system" fn proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        let changed = match msg {
            WM_DISPLAYCHANGE | WM_DPICHANGED => true,
            WM_SETTINGCHANGE => wparam.0 as u32 == SPI_SETWORKAREA.0,
            _ => false,
        };
        if changed {
            crate::windows::send_any_thread(serde_json::json!({ "t": "display" }));
        }
        // SAFETY: forwarding this window's own message.
        unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
    }
}
