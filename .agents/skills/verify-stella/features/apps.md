# Apps

Apps is Stella's library for cloud-backed user apps. The surface can be signed out, loading, empty, populated, or unavailable ("Couldn't load your apps" with Try again).

## Sub-features

- `apps-open` enters the library from New tab.
- `apps-library` opens populated app cards in the sidebar.
- `apps-empty` hands a create-app request into chat.
- `apps-cloud` opens a cloud app in its retained sidebar frame.

## How to get to it (user POV)

- Choose **New tab**, then **Apps**.
- Choose an app card to open it.
- On an empty library, choose an example request ("Build a habit tracker", "Suggest apps for me"); it fills the composer.

## Driving it with control-stella

Preconditions:

- The verifier is healthy and signed in. The library loads cloud apps for the signed-in account.
- A populated test needs an existing cloud app. Do not create one merely to make the state non-empty unless that mutation is in scope.

- **Open.** Run `node .agents/skills/verify-stella/control-stella.mjs apps open`.
- **Observe.** Run `node .agents/skills/verify-stella/control-stella.mjs apps state`. Read the returned surface text and inspect the visible content to assess loading, empty, populated, or error behavior. The helper does not infer readiness from absent error text.
- **Empty handoff.** Only in an empty state, run `node .agents/skills/verify-stella/control-stella.mjs apps ask` (clicks the first example). Require its request in the real composer. Do not send it unless generation is in scope.
- **Loading and failure.** Hold or fail `*/owners/me/apps` with CDP `Fetch` on the full-window page target, then `Page.reload` (the list is remembered in memory until a reload). The list only loads while the window is visible.
- **Populated library.** Inspect a named card in the sidebar, open it, and capture the selected app tab.

## Gotchas

- `No apps yet` is the empty state, not the entire feature.
- Signed out ("Use without an account") shows "Apps Stella builds for you" with Sign in. A cloud session that is not ready after 15 s shows the load-failure state.
- Empty states pause only their looping art while the window is unfocused. To make one appear unfocused: `STELLA_VERIFY_INSPECT_MAIN=<port>` at launch, reload, then in main `w.focus(); w.blur(); w.showInactive()` (a reload alone leaves the page believing it has focus; `drive` clicks and `inspect screenshot` refocus the window).
