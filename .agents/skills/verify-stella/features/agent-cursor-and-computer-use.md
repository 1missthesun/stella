# Agent cursor and computer use

Tasks control desktop apps through `sky` in the `code` tool (skills `stella-computer-macos`, `stella-computer-windows`, `stella-computer-linux`) and browsers through `browser`. The agent cursor shows where an action will land before it happens; it is passive presentation, the real browser or OS action is the input.

## Computer use by platform

- **macOS**: the native helper `desktop_automation` (Accessibility tree, ScreenCaptureKit; `packages/native/src/desktop_automation.swift`), one helper per task session, released at the task's run end and self-exiting after 15 idle minutes. Needs Accessibility (and Screen Recording) for the helper's identity; a call costs about half a second.
- **Windows**: the native helper `stella_computer_helper` (`packages/native/src/stella_computer_helper.cpp`). Background by default (`delivery: "background"`: UI Automation patterns, PostMessage, PrintWindow; the user's pointer and focus stay put). Chromium/Electron, XAML, GTK and VCL mouse input need `delivery: "foreground"`, which a task uses only when the user asked Stella to take over the screen; otherwise it gets a message saying nothing was sent. Coordinate actions are pixel-checked around their points.
- **Linux (Hyprland only)**: pure TypeScript, no native helper (`packages/runtime/kernel/computer-use/linux-session.ts` + `linux/`): its own D-Bus client to AT-SPI, Hyprland IPC, `grim` window capture, and a `zwlr_virtual_pointer` client for foreground input. Chromium needs `--force-renderer-accessibility`, Qt `QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1`. Windows on hidden workspaces stop drawing (their pictures go stale while AT-SPI stays live).

## Agent cursor

- The cursor is Stella's pink-to-cyan gradient pointer (one 46×48 PNG drawn at 23×24 with a blue glow), the same bytes in the browser script and the macOS and Windows helpers; a white vector arrow means a stale native helper. Short moves scoot, longer ones curve; arrival wobbles once; clicks have no ring or badge.
- In-app browser: drawn inside the page. Extension tabs: drawn in the top document. macOS/Windows: a click-through overlay attached to the target window that never takes focus. The real click waits for arrival (fails open on protected pages); a hidden page runs no animation frames, so the cursor jumps there.

## Live verification

- **In-app browser.** Open Browser in a test copy, load a safe page with two separated buttons, have a task click both, and record the compositor (the renderer screenshot can't see the native view). Each arrival must precede its page change.
- **Extension tabs.** `--browser-extension`, the same journey, captured from the test Chromium.
- **macOS.** On the Mac with `--own-app-identity`, have a task snapshot and click a safe app (Calculator, TextEdit, a throwaway Chrome profile; never the user's Chrome; System Settings is forbidden). Worktrees lack the gitignored `packages/native/out/darwin`; copy it from the main checkout. A quick native A/B: run `desktop_automation snapshot --pid <pid> --state <file> --no-inline-screenshot` directly.
- **Windows.** On the Windows test machine (anym), Notepad or Calculator in background and foreground delivery; background must leave the physical pointer and focus alone.
- **Linux.** Never on the user's workspace: run the target app in a nested Hyprland on a special workspace (or a special workspace of the real session with `render_unfocused`), drive it through a test task, and capture with `grim`.
- Preserve frames for start, in flight, arrival and the changed target; a command receipt is not visual proof.

## Gotchas

- Installs fetch native helpers from R2 whenever HEAD changes; `packages/native/out/<platform>/.stella-native-helpers.json` names the installed build. A master push of `packages/native` publishes to every install and needs the user's go; never `cp` over a running macOS helper (it gets SIGKILLed), stage and `mv`.
- macOS helpers launched from a new path may lack Accessibility even when the user's installed helper is trusted.
- The Windows overlay is excluded from OS capture, so Stella's own screenshots never show it.
- On Linux, AT-SPI GrabFocus on Chromium makes it activate itself and, with omarchy's `focus_on_activate`, steal focus.
