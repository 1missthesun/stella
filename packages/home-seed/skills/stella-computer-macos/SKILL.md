---
name: stella-computer
description: Control macOS desktop apps through Stella's persistent Computer Use runtime.
---

# Stella Computer for macOS

Use `code` for desktop-app work: its persistent runtime exposes a frozen `sky` client, and bindings and delivered app instructions persist for this agent session. The `sky` methods are exactly `list_apps`, `list_windows`, `get_app_state`, `wait_for_change`, `click`, `drag`, `perform_secondary_action`, `press_key`, `scroll`, `select_text`, `set_value`, `type_text` and `batch`; there is no `documentation`, `activate_app` or `open_app`.

## Observe

Start each desktop-app turn with fresh state for the app, by name:

```js
var state = await sky.get_app_state({ app: "Spotify", screenshot_policy: "auto" });
codeRuntime.write(state.text);
if (state.screenshot) await codeRuntime.emitImage(state.screenshot.url);
```

- The state is an accessibility-tree diff when that suffices, with a screenshot only when visual context is needed. Prefer its text and numbered `element_index` values; look at the screenshot when the tree is sparse or a visible control is missing from it.
- Every state has an opaque `state_id`, an immutable `observation_id`, `is_diff` and, for a diff, `base_state_id`; a screenshot adds `visual_state_id`. A diff is valid only on top of the full state its `base_state_id` names; pass `disable_diff: true` when that base is unavailable or you need the complete tree.
- `list_apps()` only when an app name doesn't resolve. When the app runs more than once or has several windows (two Chrome profiles, several simulators), pass `window_id` from `list_windows()`.
- A hidden or minimized app, or one with no window on the current Space, fails observation saying so; `raise: true` unhides it and brings it on screen, so use it only when the task needs that app. An app with no windows at all (the Dock, a menu-bar app) returns its app-level elements.
- Stella's own app and password or system-security apps are always refused. To look at Stella's UI, use the verify-stella skill's isolated instance.
- Chromium/Electron apps can briefly expose a sparse tree. Don't add sleeps: `get_app_state` settles adaptively.

## Act

Every action takes `app` (or `window_id`) and the `state_id` of the fresh state it was derived from; an action against a stale state is refused before anything is sent. Actions return a receipt, not a new state.

```js
sky.click({ app, element_index, state_id })                 // or x, y + observation_id
sky.set_value({ app, element_index, value, state_id })
sky.perform_secondary_action({ app, element_index, action: "Show Menu", state_id })
sky.scroll({ app, element_index, direction: "down", pages: 1, state_id })
sky.press_key({ app, key: "cmd+shift+t", state_id })
sky.type_text({ app, text, state_id })
sky.select_text({ app, element_index, text, prefix?, suffix?, selection_type?, state_id })  // "text" | "cursor-before" | "cursor-after"
sky.drag({ app, from_x, from_y, to_x, to_y, state_id, observation_id })                  // or path: [{ x, y }, …]
sky.batch([{ type: "click", app, element_index, state_id }, …])
```

- Keys: `Return`, `Escape`, `Tab`, `Space`, `Delete`, `Up`/`ArrowUp`, `PageDown`, `F5`, a letter, digit or punctuation, with `cmd`, `ctrl`, `alt` or `shift` joined by `+`.
- Use `select_text` rather than repeated arrow keys; prefix and suffix disambiguate repeated matches.
- After acting, `wait_for_change({ app, after_state_id: state.state_id, after_visual_state_id?, timeout_ms })` when the next step depends on the change showing (pass `after_visual_state_id` when only pixels change); otherwise `get_app_state`. Always re-derive element indices from the latest state.
- `batch` validates every item against its observation first, so one stale item rejects the whole batch before anything runs. Give every item the same fresh `state_id`, and never batch across a decision point, a permission prompt or a step whose result decides the next.
- A rejection saying the app changed means nothing was sent: observe again and act with the new `state_id` straight away. If the app keeps changing (animations, loading), `wait_for_change` first. Retrying with the old `state_id` never succeeds.
- A native dialog or sheet is listed first in the state, with a `[warning]` naming it: click its button, or press `Return` (default) or `Escape` (cancel), then observe again. A browser may ignore a click in the first instant after its dialog appears; if it's still there, act again.

## Coordinates

Prefer elements. For a visible control missing from the tree, click screenshot pixel coordinates (not macOS screen points) from a state captured with `screenshot_policy: "always"`, passing its `state_id` and `observation_id`. Never reuse coordinates with a later observation, even when its `state_id` is unchanged. Coordinates, drags and keys can affect the active input, so use them only when no element route exists, and verify with one final state read.

Don't drive desktop apps with AppleScript, `osascript`, `open -a`, app-bundle internals or shell commands; `Bash` is only for diagnosing the Computer Use runtime itself.
