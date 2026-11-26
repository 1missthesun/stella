---
name: stella-computer
description: Control Windows desktop apps through Stella's persistent Computer Use runtime.
---

# Stella Computer for Windows

Use `code` for desktop-app work: its persistent runtime exposes a frozen `sky` client, and bindings and delivered app instructions persist for this agent session.

## Observe

Start each desktop-app turn with fresh state:

```js
var state = await sky.get_app_state({ app: "Spotify", screenshot_policy: "auto" });
codeRuntime.write(state.text);
if (state.screenshot) await codeRuntime.emitImage(state.screenshot.url);
```

- The state is a UI Automation diff when that suffices, with a screenshot only when visual context is needed. Prefer numbered `element_index` values over coordinates.
- Every state has an opaque `state_id`, an immutable `observation_id`, `is_diff` and, for a diff, `base_state_id`; a screenshot adds `visual_state_id`. A diff is valid only on top of the full state its `base_state_id` names; pass `disable_diff: true` when that base is unavailable or you need the complete tree.
- `list_apps()` only when an app name doesn't resolve. When the app has several top-level windows, call `list_windows()` and pass `window_id` instead of `app`.
- Don't add sleeps: `get_app_state` settles adaptively, waiting longer only while UI Automation events show the app still changing.

## Act

Every action takes `app` (or `window_id`) and the `state_id` of the fresh state it was derived from; an action against a stale state is refused before anything is sent. Actions return a receipt, not a new state.

```js
sky.click({ app, element_index, state_id })                 // or x, y + observation_id
sky.set_value({ app, element_index, value, state_id })
sky.perform_secondary_action({ app, element_index, action: "Invoke", state_id })
sky.scroll({ app, element_index, direction: "down", pages: 1, state_id })
sky.press_key({ app, key: "ctrl+shift+t", state_id })
sky.type_text({ app, text, state_id })
sky.select_text({ app, element_index, text, prefix?, suffix?, selection_type?, state_id })  // "text" | "cursor-before" | "cursor-after"
sky.drag({ app, from_x, from_y, to_x, to_y, state_id, observation_id })                  // or path: [{ x, y }, …]
sky.batch([{ type: "click", app, element_index, state_id }, …])
```

- After any action attempt, observe again before another standalone action: a failed or interrupted dispatch may still have changed the app. Ordered actions from one observation, with no result needed in between, go together in `batch`.
- `wait_for_change({ app, after_state_id: state.state_id, after_visual_state_id?, timeout_ms })` when the next step depends on the change showing (pass `after_visual_state_id` when only pixels change), then re-derive indices.
- `batch` validates every item first, so one stale item rejects the whole batch before anything runs. Give every item the same fresh `state_id`; never batch across a decision point or a permission prompt. After a failed or partial batch, observe again.
- `select_text` works where the target exposes a UI Automation text range; prefix and suffix disambiguate repeated matches.

## Coordinates and delivery

For a visible control missing from the tree, click screenshot pixel coordinates from the latest screenshot.

Coordinates are screenshot pixels and require a state captured with `screenshot_policy: "always"`, its semantic `state_id`, and its immutable `observation_id` from the latest observation of that window. They are relative to the window, so they still land right if the window moved. Before sending, Stella checks that the window has the same size and that the pixels around each point (and most of the window) look the same as in that screenshot; small animations pass, a dialog over the point or a different screen does not.

For a window that never stops changing (a game, a video, an animated launcher), pass `stale_check: "window"`: only the same window at the same size is required. You accept that what is under the point may have moved, so observe again after each action.

```js
await sky.click({ window_id: 123456, x: 512, y: 300, state_id: state.state_id, observation_id: state.observation_id, stale_check: "window" });
```

### Delivery

Stella works in the background: the user keeps their pointer, keyboard focus and the window they are using. Never take over the screen unless the user asked for that in this task.

`delivery` is `"background"` (default) or `"foreground"`. `"auto"` is still accepted and means `"background"`.

- Background: element actions go through UI Automation (Invoke, Toggle, Select, Expand, Scroll, Value); other input is posted to the window as messages. The pointer and focus do not move.
- Some windows ignore posted input: Chromium/Electron/Edge content (pointer: coordinate clicks, drags, scrolling), UWP/XAML apps, GTK and Delphi/VCL apps (pointer and keys). Stella refuses those actions with `background_unavailable` instead of sending input that would be lost. Element clicks still work there through UI Automation, so prefer `element_index` over coordinates.
- If a background action changed nothing, the next state says so. Stella does not switch to foreground on its own.
- Foreground brings the window to the front, sends real OS input at the pointer, then puts the user's previous window and pointer back. Use it only when the user asked Stella to take over the screen (for example "go ahead and use my screen"); otherwise tell the user what you could not do in the background.

### Windows that expose no elements

When the state says the window draws its own content or its Chromium accessibility tree stayed empty, element indices will not appear: work from `screenshot_policy: "always"` screenshots with x/y clicks, drags, `press_key` and `type_text`. Stella already asked Chromium windows to turn their accessibility tree on; when that works the web content is listed as elements and you should use them.

A state without a screenshot says why (minimized, off-screen, or black pixels from exclusive fullscreen or protected content). Do not guess coordinates without a screenshot.

### Errors that mean input was refused

Nothing (or only what the message says) was delivered. Do not retry them blindly and never work around them with your own input tools:

- `background_unavailable`: this window would ignore background input of this kind; the message names the reason and your options. Use an element (UI Automation) route or `set_value` if there is one, otherwise tell the user. Retry with `delivery: "foreground"` only if the user asked Stella to take over the screen.
- Other refusals name their cause in the message: the app runs as administrator (Windows drops Stella's input to it), or Windows would not bring the window to the front for foreground input. Tell the user.

Don't drive desktop apps with PowerShell, registry edits, app-bundle paths or app-specific scripting; `Bash` is only for diagnosing the Computer Use runtime itself.
