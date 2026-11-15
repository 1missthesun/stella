# Browser and takeover

Tasks browse either in Stella's own in-app browser or, when the **Stella Browser** extension is connected, in the user's own Chrome (signed in as them, inside a "Stella" tab group). The Browser tab shows Stella's in-app browser to the user. Cloud tasks use a cloud browser and hand sensitive steps (logins, device codes) to the user.

## Sub-features

- `browser-tab`: + menu › **Browser** (`shell/sidebar-sections/BrowserSection.tsx`): "Stella Browser · Sign in to a site here once and Stella keeps you signed in, for you and your tasks", **Open a new tab**, and **Use my browser's logins** (sets up the extension). With the extension connected it reads "Sites open with your browser's logins".
- `extension`: the Stella Browser Chrome extension (`packages/stella-browser/extension`, Chrome Web Store) pairs with one Stella through the bridge (fixed port 39040). Settings › General "Stella for Chrome" lists browser profiles; the choice persists in `<data>/browser-extension-routing.json`. Without `browser.use()` a task's first call takes the extension when connected, else the in-app browser; the in-app browser does not share the user's logins.
- `tab-cleanup` (`packages/runtime/kernel/browser-use/task-tabs.ts`, ledger `<data>/browser-task-tabs.json`): a task's tabs close 5 minutes after its run ends (kept while it waits), and remembered URLs reopen on its first browser command after a resume (30 days). Never closed: tabs the task left for the user or handed off, tabs its final report names (URL or title), tabs the user viewed after the task's last touch or that are in front. The extension sweeps ownerless "Stella" groups a minute after start and hourly.
- `agent-tabs`: agent tabs open in the background by design and the panel never switches to them by itself; downloads from agent tabs go to `<data>/media/downloads/<owner>/`, and their native dialogs are suppressed.
- `takeover`: a cloud task that needs the user creates a browser interaction; the **Sign in** tab (`takeover`) and a chat card open Live View of the remote tab. On iOS a login can complete in a local WebView whose cookies are imported.

## Driving it with control-stella

Preconditions: the harness runs an isolated bridge, so by default the Browser tab offers **Use my browser's logins** and the user's extension can't reach the run; that is expected. For an extension claim launch with `--browser-extension` (private muted Chromium on the run's display with its own extension copy; Chromium required, not Google Chrome). `--browser-bridge shared` takes the user's real extension: only for a claim about their own Chrome, after asking.

- **Open.** `node .agents/skills/verify-stella/control-stella.mjs nav browser`.
- **Navigate.** **Open a new tab**, enter a safe URL, require its origin in the visible state.
- **Extension.** With `--browser-extension`, the test Chromium listens for CDP (port in `DevToolsActivePort` in its profile): inspect its tabs, the "Stella" group and the service worker there. Relaunch copies the extension again, so edits load.
- **Tab cleanup.** Prompts must say nothing about tabs ("don't close the tabs" makes the task keep them; "leave no tab" makes it close them itself; asking for page titles trips the report-names-the-page keep). Wait past 5 minutes after the run ends and read the group over CDP.
- **Takeover.** Only with a real pending interaction for the account; act through the card's controls.
- **Diagnose.** `diagnostics network-summary` and `diagnostics console` around failures.

## Gotchas

- Renderer screenshots omit the native in-app `WebContentsView`; on Linux agent tabs are offscreen and the panel shows a mirror. Use a compositor capture for what's on screen.
- A renderer reload leaves the native browser view at its old bounds.
- Extension state lives in `chrome.storage.session`: lost on a Chrome restart or extension update, and tab ids change. `chrome.runtime.reload()` disables a `--load-extension` copy; simulate a restart by stopping your Chromium and relaunching with `--restore-last-session`.
- On macOS without `--browser-extension` an agent's in-app browser socket path can exceed the limit under the run's home; the harness shortens it, and `--browser-extension` sidesteps it.
- Never log full URLs with credentials or capability tokens.
