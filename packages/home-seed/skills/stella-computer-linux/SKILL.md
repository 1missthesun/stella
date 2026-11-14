---
name: stella-computer
description: Control Linux desktop apps (Hyprland) through Stella's persistent Computer Use runtime.
---

# Stella Computer for Linux

Use `code` for desktop-app work. The persistent JavaScript runtime is already initialized and exposes a frozen `sky` client. Bindings persist for this agent session. The `sky` methods are exactly `list_apps`, `list_windows`, `get_app_state`, `wait_for_change`, `click`, `drag`, `perform_secondary_action`, `press_key`, `scroll`, `select_text`, `set_value`, `type_text` and `batch`.

Linux computer use currently needs Hyprland (Omarchy). Elsewhere every call fails with `desktop_unsupported`; tell the user.

## How it works, and what that means for you

Stella reads apps through accessibility (AT-SPI) and acts on their elements in the background: the user keeps their pointer, their focused window and their workspace. Windows on other workspaces, or covered by others, are read, captured and driven where they are. Never switch workspaces or move windows yourself.

What exposes elements:

- GTK 3/4 apps (Files/Nautilus, most GNOME apps): always.
- Qt apps: only when started with `QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1` in their environment.
- Chromium, Chrome, Electron apps: only when started with `--force-renderer-accessibility` (and `ACCESSIBILITY_ENABLED=1` in the environment). A running instance launched without it shows its toolbar at most. For web pages, Stella's browser tools are usually the better route.
- X11 (XWayland) windows, games and canvas apps: no elements; screenshot only.

When you start an app for a task, start it with those flags, on a workspace that is not the user's, so it never lands on their screen:

```bash
hyprctl dispatch 'hl.dsp.exec_cmd("env QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1 someqtapp", { workspace = "9 silent" })'
```

## Observe

```js
var state = await sky.get_app_state({
  app: "org.gnome.Nautilus",
  screenshot_policy: "auto",
});
codeRuntime.write(state.text);
if (state.screenshot) await codeRuntime.emitImage(state.screenshot.url);
```

`app` matches the window's app id (`hyprctl clients` class), its last dotted part, the process name, or the title. When an app has several windows, call `await sky.list_windows()` and pass `window_id`. `list_windows` also marks the user's focused window and windows whose app exposes no accessibility tree.

On a workspace that is not on screen, Hyprland tells apps they are suspended, and Qt and Chromium apps stop drawing: their screenshot can be older than the element list (the state says so). Trust the elements. Some apps keep text out of the tree (Omacalc's display, for example); when the answer is only in a possibly old picture, tell the user it may be out of date rather than guessing.

Every state has an opaque `state_id`, an immutable `observation_id`, `is_diff` and, for a diff, `base_state_id`; a screenshot adds `visual_state_id`. Pass `disable_diff: true` when you need the full tree. `screenshot_policy: "auto"` returns a picture only when the tree cannot describe the window; ask for `"always"` when you need to see it. Screenshots are window pixels at the window's logical size (what x/y refer to).

Right after an action, `get_app_state` waits briefly for the app to show its effect (a GTK button reports its click after its 250 ms press animation). Do not add sleeps. In a `batch`, a repeated click on the same element waits for the previous one to show. To wait for something slower, use `wait_for_change` with `after_state_id` (and `after_visual_state_id` when only pixels change).

The state ends with the element that typing goes to. In an inactive window that is the field Stella last clicked or edited there, since apps report no focus while the user is elsewhere.

## Act

Every action needs the `state_id` of the fresh state it came from; stale ones are refused with `stale_observation` before anything is sent. Observe again after each action (or use `batch` for ordered actions from one observation).

```js
await sky.click({
  app: "org.gnome.Nautilus",
  element_index: 40,
  state_id: state.state_id,
});
await sky.set_value({
  app: "gedit",
  element_index: 7,
  value: "Hello",
  state_id: state.state_id,
});
await sky.click({ app: "gedit", element_index: 7, state_id: state.state_id }); // field takes typing
await sky.type_text({ app: "gedit", text: " world", state_id: state.state_id });
await sky.press_key({
  app: "gedit",
  key: "BackSpace",
  state_id: state.state_id,
});
await sky.select_text({
  app: "gedit",
  element_index: 7,
  text: "world",
  state_id: state.state_id,
});
await sky.scroll({
  app: "gedit",
  element_index: 7,
  direction: "down",
  pages: 2,
  state_id: state.state_id,
});
await sky.perform_secondary_action({
  app: "org.gnome.Nautilus",
  element_index: 3,
  action: "slot.reload",
  state_id: state.state_id,
});
```

What works in the background:

- `click` with `element_index`: the element's accessibility action (press, click, check, activate, open). List and grid items are selected; text fields become the typing target. Right-click opens the context menu where the app exposes one (`showContextMenu`, `menu`).
- `click` with x/y: Stella finds the element under the point and uses its action. Needs a state with `screenshot_policy: "always"` and its `observation_id`.
- `set_value`: text fields (GTK, Qt) and sliders/spin buttons (numbers).
- `type_text`, and `press_key` for editing keys (BackSpace, Delete, arrows, Home/End, Ctrl+A, Return in a field or on a button, space on a button), into the typing target.
- `select_text`, `scroll` (moves the element's scroll bar; web pages scroll by the page, and the receipt says `at_edge` when there is no further to go).
- `perform_secondary_action` with any action name the state lists, plus `focus` and `scroll_to`. GTK 4 apps also accept their internal action names (`slot.reload`, `view.show-hidden-files`).

What cannot be done in the background on Hyprland (refused with `background_unavailable`, nothing sent):

- Pointer input to a spot with no accessible element, drags, and wheel scrolling: Hyprland only gives real pointer input to the window under the user's pointer.
- Keyboard shortcuts (Ctrl+S, Alt+F4) and keys to an app with no typing target: Hyprland only gives keys to the focused window. Use the menu item or button for the command instead.
- Text in Chromium/Electron fields (they publish no editable-text interface on Linux).
- GTK 4 check buttons and some other widgets that publish no action.

The error says why and what to try. Use an element route if there is one, otherwise tell the user what you could not do.

### delivery: "foreground"

Only when the user asked Stella to take over the screen for this task (for example "go ahead and use my screen"). Then the action brings the window forward, sends real pointer input (wlr virtual pointer) or keys, and puts back the user's workspaces, focused window and pointer. The receipt's `restored` says whether both came back. If the user's pointer rested over a different window than the one they had focused, keyboard focus wins and the pointer ends on their window.

```js
await sky.click({
  window_id: "5605c59e60d0",
  element_index: 4,
  state_id: state.state_id,
  delivery: "foreground",
});
```

Coordinate actions in an animated window can pass `stale_check: "window"` (same window and size only).

## Protected apps

Stella's own windows and password/security apps (keyrings, password managers, polkit prompts) are always refused. To look at Stella's UI, use the verify-stella skill's isolated instance.

Do not drive apps with `wtype`, `ydotool`, `hyprctl dispatch sendshortcut`, `grim` or your own scripts: they take over the user's screen or keyboard. Use `Bash` only to launch apps (as above) or to diagnose the runtime itself.
