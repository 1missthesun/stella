---
name: stella-computer
description: Control Windows desktop apps through Stella's persistent Computer Use runtime.
---

# Stella Computer for Windows

Use `code` for desktop-app work. The persistent JavaScript runtime is already initialized and exposes a frozen `sky` client. Bindings and delivered app instructions persist for this agent session.

## Observe

Start each desktop-app turn with fresh state:

```js
var state = await sky.get_app_state({
  app: "Spotify",
  screenshot_policy: "auto",
});
codeRuntime.write(state.text);
if (state.screenshot) await codeRuntime.emitImage(state.screenshot.url);
```

Every state includes an opaque semantic `state_id`, an immutable compound `observation_id`, `is_diff`, and, for a diff, `base_state_id`. A captured screenshot also has an independent `visual_state_id`; screenshot capture settings do not change `state_id`, while a different visual or resource generation changes `observation_id`. Treat a diff as valid only when its `base_state_id` matches the full state you are building on. Pass `disable_diff: true` whenever the base is unavailable or mismatched.

Use `await sky.list_apps()` only when an app name cannot be resolved. Use `await sky.list_windows()` when the app has multiple top-level windows, then pass `window_id` instead of `app` to state and action calls.

The default state is a UI Automation diff when sufficient. A screenshot is returned only when visual context is needed. Prefer numbered `element_index` values over coordinates.

Pass `disable_diff: true` only when you need a complete recovery tree.

## Act

Actions return a receipt after dispatch without rebuilding state or capturing a screenshot. Every action requires the `state_id` from the fresh state it was derived from, including element clicks, secondary actions, scrolling, selection, value/focus actions, coordinates, drags, and keyboard input. Missing or stale provenance is rejected before native dispatch instead of targeting changed UI:

```js
await sky.click({
  app: "Spotify",
  element_index: 42,
  state_id: state.state_id,
});
await sky.set_value({
  app: "Spotify",
  element_index: 18,
  value: "Daft Punk",
  state_id: state.state_id,
});
await sky.perform_secondary_action({
  app: "Spotify",
  element_index: 9,
  action: "Invoke",
  state_id: state.state_id,
});
await sky.scroll({
  app: "Spotify",
  element_index: 55,
  direction: "down",
  pages: 1,
  state_id: state.state_id,
});
await sky.drag({
  app: "Spotify",
  from_x: 420,
  from_y: 310,
  to_x: 720,
  to_y: 310,
  state_id: state.state_id,
  observation_id: state.observation_id,
});
await sky.press_key({
  app: "Spotify",
  key: "Return",
  state_id: state.state_id,
});
await sky.type_text({
  app: "Spotify",
  text: "hello",
  state_id: state.state_id,
});
```

`drag` also accepts `path: [{ x, y }, ...]` with at least two points. Drag
coordinates must come from the latest screenshot; observe again after the drag.

After any action attempt, observe again before sending another standalone action; a failed or interrupted dispatch may still have changed the app, so its prior observation is invalidated. When several ordered actions need the same starting observation and no intermediate result is needed, send them together with `sky.batch([...])`. When the next step depends on a mutation becoming observable, call:

```js
var nextState = await sky.wait_for_change({
  app: "Spotify",
  after_state_id: state.state_id,
  ...(state.visual_state_id
    ? { after_visual_state_id: state.visual_state_id }
    : {}),
  timeout_ms: 10000,
  screenshot_policy: "auto",
});
```

It polls without advancing the saved diff baseline and returns a final diff anchored exactly to `after_state_id`. Pass `after_visual_state_id` when screenshot-only changes matter; omit it to wait only for semantic UI Automation changes. Then re-derive fresh indices. `sky.batch([...])` validates every action at the native dispatch boundary, then executes ordered actions. A stale action rejects the entire batch before command 0 is dispatched. Give every item the `state_id` from the same fresh starting state when they target the same app; do not batch across decision points, permission prompts, or navigation-policy boundaries. After any failed or partially completed batch, discard its starting state and observe again.

## Text Selection

Use semantic selection when the target exposes a UI Automation text range:

```js
await sky.select_text({
  app: "Notepad",
  element_index: 7,
  text: "matching text",
  prefix: "optional text before",
  suffix: "optional text after",
  selection_type: "text",
  state_id: state.state_id,
});
```

`selection_type` may be `text`, `cursor-before`, or `cursor-after`. Prefix and suffix disambiguate repeated matches.

## Coordinates And Input

For a visible control missing from the tree, use screenshot pixel coordinates from the latest attached screenshot:

```js
await sky.click({
  window_id: 123456,
  x: 620,
  y: 412,
  state_id: state.state_id,
  observation_id: state.observation_id,
});
```

Coordinates are screenshot pixels and require a state captured with `screenshot_policy: "always"`, its semantic `state_id`, and its immutable `observation_id` from the latest observation of that window. They are relative to the window, so they still land right if the window moved. Before sending, Stella checks that the window has the same size and that the pixels around each point (and most of the window) look the same as in that screenshot; small animations pass, a dialog over the point or a different screen does not.

For a window that never stops changing (a game, a video, an animated launcher), pass `stale_check: "window"`: only the same window at the same size is required. You accept that what is under the point may have moved, so observe again after each action.

```js
await sky.click({ window_id: 123456, x: 512, y: 300, state_id: state.state_id, observation_id: state.observation_id, stale_check: "window" });
```

### Delivery

Stella works in the background: the user keeps their pointer, keyboard focus and the window they are using. Never take over the screen unless the user asked for that in this task.

`delivery` is `"background"` (default) or `"foreground"`. `"auto"` is still accepted and means `"background"`.

Background picks a route per app framework, and every receipt names it (`route`, `delivery`, `delivery_reason`):

- Element actions go through UI Automation (Invoke, Toggle, Select, Expand, Scroll, Value). Scrolling without an element scrolls the UI Automation container under the point.
- Clicks UI Automation can't do, and drags: posted window messages for ordinary Win32 apps. Chromium/Electron/Edge (and Chromium views inside other apps, like CEF launchers) skip UI Automation for clicks and get single left clicks as posted messages, which land even when the window is covered; double and right clicks and drags there, and clicks in WPF, UWP/XAML, Tk, GTK and Delphi apps, go as synthetic pen input at the point, which needs the point to be visible on screen (not covered by another app's window, not minimized).
- Keys and text: typed text goes into the focused edit control directly when there is one, into UWP/XAML, WinUI and WPF text fields through UI Automation (appended to what is there), and otherwise as posted characters to the focused control. Shortcuts with Ctrl, Shift or Win can't be sent in the background (apps read those keys from the real keyboard); use the menu item or button instead. Alt shortcuts work in ordinary Win32 and GTK apps.
- Some input can't reach a window in the background at all: WPF drags, clicks and drags by position in WinUI 3 apps, middle clicks wherever pen input would be needed, `press_key` in WPF, UWP/XAML, WinUI 3, Tk and LibreOffice apps, typed text in WPF, UWP/XAML, WinUI 3 and Tk apps when no text field takes it through UI Automation, mouse-wheel scrolling in Chromium, WPF, UWP/XAML and WinUI 3 where no element under the point scrolls, and pen input where another app's window covers the point. Stella refuses those with `background_unavailable` instead of sending input that would be lost.
- If a background action changed nothing, the next state says so. Stella does not switch to foreground on its own.
- Foreground brings the window to the front, sends real OS input at the pointer, then puts the user's previous window and pointer back (the receipt's `restored` says whether both came back). Switching back closes menus the action opened and can minimize a fullscreen game. Use it only when the user asked Stella to take over the screen (for example "go ahead and use my screen"); otherwise tell the user what you could not do in the background.

### Windows that expose no elements

When the state says the window draws its own content or its Chromium accessibility tree stayed empty, element indices will not appear: work from `screenshot_policy: "always"` screenshots with x/y clicks, drags, `press_key` and `type_text`. Stella already asked Chromium windows to turn their accessibility tree on; when that works the web content is listed as elements and you should use them.

A state without a screenshot says why (minimized, off-screen, or black pixels from exclusive fullscreen or protected content). Do not guess coordinates without a screenshot.

### Errors that mean input was refused

These come back as errors with a specific `code`; nothing (or only what the message says) was delivered. Do not retry them blindly and never work around them with your own input tools:

- `background_unavailable`: this window would ignore this background input, or the point is covered or minimized; the message names the framework, the input and your options. Use an element (UI Automation) route or `set_value` if there is one, otherwise tell the user. Retry with `delivery: "foreground"` only if the user asked Stella to take over the screen.
- `uipi_blocked`: the app runs as administrator; Windows drops Stella's input to it.
- `input_desktop_unavailable`: the screen is locked or a UAC/secure prompt is showing.
- `input_partially_injected`: Windows took part of the input and refused the rest (the message says what was delivered).
- Foreground only: `input_refused` (SendInput accepted none of the events, commonly a game's anti-cheat), `pointer_not_moved` (the pointer was intercepted on the way to the point; no button was pressed), `foreground_refused` (Windows would not bring the window to the front; the message names the window that kept focus), `point_covered` (another app's window, such as an always-on-top one, still covers the point). Tell the user; Stella cannot drive that part of the app.

Do not add sleeps. `get_app_state` performs adaptive settling and extends its wait only while UI Automation events indicate continued changes.

Do not use PowerShell, registry edits, app-bundle paths, or app-specific scripting to drive desktop apps. Use `Bash` only to diagnose the Computer Use runtime itself.
