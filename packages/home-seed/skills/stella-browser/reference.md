# Stella Browser reference

Details behind `SKILL.md`; read the section you need.

## Snapshots in detail

Semantic snapshots are bounded to 200 emitted entries and 20,000 characters. When a page exceeds that budget, metadata reports truncation and unavailable frames; narrow with `selector`, `interactive`, `compact`, or `maxDepth` instead of requesting repeated full-page snapshots. Selector-scoped captures omit descendant frames.

Frame-qualified refs are bound to the document they were observed in: a cross-origin ref rejects a detached node or a replaced document instead of falling back to a same-named control, and pointer geometry through a transformed or CSS-zoomed iframe is rejected when it cannot be mapped safely.

### Incremental AX observations

`tab.axSnapshot()` reads the browser accessibility tree, including accessible child frames. Its default `mode: "auto"` returns one of:

- `{ kind: "full", snapshotId, snapshot, reason }` on first use, a document/options change, when a diff would be larger than the full tree, or when the bounded diff computation would exceed its budget.
- `{ kind: "diff", snapshotId, baseSnapshotId, diff }` with unified line-diff hunks relative to the indicated previous observation. Deleted lines are prefixed `-`, added lines `+`, and nearby unchanged lines with a space. Refs on deleted lines are no longer evidence for an action.
- `{ kind: "unchanged", snapshotId }` when the bounded tree has not changed. This does not mean the page has finished loading or that pixels are unchanged.

The baseline is private to this persistent runtime, backend, tab generation and snapshot options. Document replacement and reload reset identity even when the URL is unchanged. Same-document history changes can appear as ordinary diffs. A failed capture clears the baseline. Only the observed bounded tree is compared; omitted content is not claimed unchanged.

```js
var observation = await tab.axSnapshot();
// Select a ref from the returned full tree or its subsequent changes.
await tab.playwright.locator("@e123").click(); // replace with an observed ref
await tab.axSnapshot();
```

Use `await tab.axSnapshot({ mode: "full" })` after context compaction, output pruning, or whenever the referenced baseline is no longer in context. `mode: "diff"` requests differences even if larger; a missing or incompatible baseline or exhausted computation budget still returns full output. AX options are `mode`, `interactive`, `compact`, `maxDepth`, and `selector`. Keep using the same options to retain the baseline. The DOM snapshot APIs remain full-output and do not share the AX baseline.

## Network

A tab you open records its own requests before its first page loads, so the page's initial calls are already there (a tab that a page opened records from your first command on it, and the first instants of a cross-origin frame or worker can be missing):

```js
await tab.goto("https://example.com/orders");
var calls = await tab.network.requests({ filter: "/api/" });
calls.map(({ method, status, url }) => [method, status, url]);
```

- `tab.network.requests({ filter?, after?, limit?, clear? })` returns the tab's newest 256 requests, oldest first: `url`, `method`, `status`, `resourceType`, `headers`, `postData`, `responseHeaders`, `mimeType`, `body`, `timestamp`, `completed`. `filter` matches part of the URL, `after` is a timestamp in milliseconds, and `clear: true` empties the log first.
- `tab.network.waitForResponse(urlPart, action?, { timeout? })` runs the action and returns the response it caused.
- `tab.network.fetch(url, { method?, headers?, body?, timeout?, maxBodyBytes? })` requests with the tab's session, on the tab's own origin; `fetchAll(requests, { concurrency?, timeout? })` sends up to 100 of them.
- `tab.network.rewriteRequest(urlPattern, { method?, postData?, jsonPatch?, headers? })` changes matching requests until `clearRequestRewrite(urlPattern?)`.

Bodies are cut at 128 KB, and each tab keeps 2 MB of them, newest first. JSON and API bodies are read as they arrive. The rest are read when you first call `requests()`, so a page you have already left no longer has them; after that call every body is read as it arrives. In the user's browser a tab you leave untouched for five minutes stops recording until your next command, unless you have called `requests()` on one of your tabs. If `requests()` is empty right after a load there, that browser has an older extension, which records from the first `requests()` call: reload and call it again.

To save everything a flow sends as a HAR file, record it with two `browser.chain()` steps (there is no other HAR method) and drive the tab normally in between:

```js
await browser.chain([{ action: "har_start", params: { tabId: tab.id } }]);
await tab.goto("https://example.com/orders");
await browser.chain([{ action: "har_stop", params: { tabId: tab.id, path: "~/.stella/tmp/orders.har" } }]);
```

The second call's result names the saved file's `path`. A HAR holds every request, with bodies for JSON and API calls only.

## Dialogs and Unresponsive Tabs

Page dialogs never block you:

- `alert()` is dismissed, `confirm()` answers Cancel and `prompt()` returns null. In the user's browser, actions that may trigger one (`click`, `press`, `check`, `selectOption`, …) return `{ dialogs: [{ type, message, answer }] }` when one fired, so read it to learn what the page said.
- To accept a confirm (for example "Delete this item?"), override it just before the click: `await page.evaluate(() => { window.confirm = () => true; })`. The page can see that, so do it only when the task needs the dialog accepted.
- "Leave site?" (beforeunload) prompts are accepted while one of your commands runs; in the user's browser, a dialog at any other time is left for the user until your next command on that tab.

If a tab stops answering (a command times out with a message saying the page may be blocked), don't retry the same command on it. `await tab.goto(url)` usually recovers it; if not, `await tab.close()` and continue in `await browser.tabs.new()`. After a timeout on a mutating action, check the page state before repeating it.

## Downloads and File Pickers

In Stella's browser nothing opens a native dialog. A download saves straight to `~/.stella/media/downloads/<agent or conversation>/`; wrap the action that starts it to get the file:

```js
var file = await tab.waitForDownload(async () => await page.getByRole("button", { name: "Export MP4" }).click());
file.path; // absolute path of the saved file, e.g. for Bash, Read or drive_upload
```

`waitForDownload()` resolves once a download started after the action finishes (default timeout 60 s, `{ timeoutMs }` up to 600 s) and throws if it was cancelled. `await browser.downloads()` lists this session's recent downloads, newest first. Clicking a file input opens no picker: use `locator.setInputFiles([absolutePath])`. `window.print()` does nothing; take `tab.screenshot({ fullPage: true })` instead. In the user's own browser, downloads go to their browser's Downloads folder as usual.

## Synchronize on Browser State

Wait for the state caused by the action:

```js
await submit.click();
await page.waitForURL("**/complete", { timeout: 30000 });

var confirmation = page.getByText("Saved", { exact: true });
await confirmation.waitFor({ state: "visible", timeout: 30000 });
```

`Locator.waitFor()` supports `attached`, `detached`, `visible`, and `hidden`. Prefer it, `waitForURL()` (`*` matches anything; a pattern without one matches any URL containing it), or `expectNewTab()` over fixed delays. Although `page.waitForTimeout(ms)` exists, do not use it for routine synchronization or insert sleeps between deterministic actions.

## New Tabs

Wrap the action that opens a tab with `expectNewTab()`. Calling it after the click misses the before-state used to identify the new owned tab.

```js
var openReport = page.getByRole("link", { name: "Open report", exact: true });
var reportTab = await tab.expectNewTab(async () => await openReport.click(), {
  timeoutMs: 10000,
});
var reportPage = reportTab.playwright;
await reportPage.getByRole("heading", { name: "Report" }).waitFor();
```

`expectNewTab()` succeeds only when exactly one newly adopted owned tab appears. Its default timeout is 10 seconds and its maximum is 60 seconds. The same method is available as `page.expectNewTab()`.

## Finalizing tabs explicitly

Leaving a tab for the user (`leaveForUser()`, or its aliases `markHandoff()` and `markDeliverable()`) moves it out of the Stella group when your other tabs close; it is the user's from then on. A tab your final report names by address or title is kept the same way as a safety net, but don't rely on that.

`browser.tabs.finalize()` remains the explicit authoritative cleanup operation. List only tabs intentionally retained; unlisted task-owned tabs are closed even if previously marked.

```js
await browser.tabs.finalize([
  { tab, status: "handoff" },
  { tab: reportTab, status: "deliverable" },
]);
```

Entries may be a `Tab`, tab ID, or `{ tab, status }`/`{ tabId, status }`. Status must be `"handoff"` or `"deliverable"`; a bare tab defaults to `"deliverable"`. Use `await browser.tabs.finalize([])` when no task-owned tab should remain.

When you are resumed after your tabs closed, they come back by URL at your first browser command, in the same order with the same tab selected. Only their pages reload: scroll position, form input and other in-page state are gone, and handles you kept from before point at closed tabs. Get fresh ones with `browser.tabs.list()` or `browser.tabs.selected()`, then check the page before continuing.

## Frozen Browser API

The public object graph is frozen. Do not mutate it or attach properties. This reference and `SKILL.md` are the runtime documentation. For lightweight discovery, inspect `browser.capabilities`, `Object.keys(browser)`, `Object.keys(tab)`, or `Object.keys(locator)`; there is no runtime documentation command.

### Browser and Tabs

| Object         | Supported API                                                        |
| -------------- | -------------------------------------------------------------------- |
| `browser`      | `capabilities`, `use(backend?, { browser? })`, `browsers()`, `downloads()`, `chain(steps, options)`, `tabs` |
| `browser.tabs` | `list()`, `new(url?)`, `selected()`, `get(id)`, `finalize(entries?)` |

For a new task, call `tabs.new()` once and then navigate that handle with `tab.goto(url)`. If navigation fails, reuse the same handle or inspect `tabs.list()`; do not loop on `tabs.new()` because a delayed response can otherwise create a pileup of blank tabs. Use `tabs.selected()` only when the user's currently selected owned tab is the target, and `tabs.list()` when tab choice is itself a decision.

`browser.chain()` is a low-level JSON action batch, limited to 100 steps. Prefer normal method calls with multiple awaits in one REPL cell because they preserve typed handles and are easier to branch and debug. Chains reject unknown actions, options, arbitrary values, and nested chains. Supported chain options are `timeout` (milliseconds, at most 240000), `delay`, `waitForSelector`, `waitTimeout`, `abortOnError`, `returnSnapshot`, and `returnScreenshot`; do not add `delay` or automatic snapshots without a concrete need.

### Tab

| API                                                                   | Notes                                    |
| --------------------------------------------------------------------- | ---------------------------------------- |
| `id`                                                                  | Positive numeric owned-tab ID.           |
| `playwright`                                                          | Frozen page facade, cached for this tab. |
| `goto(url, { waitUntil?, timeout? })`                                 | Navigate the tab.                        |
| `back({ timeout? })`, `forward({ timeout? })`, `reload({ timeout? })` | History navigation.                      |
| `close()`                                                             | Close this tab (Stella's browser keeps your only one until you finish). |
| `leaveForUser()`, `markHandoff()`, `markDeliverable()`                | Keep open for the user; never closed.    |
| `show()`                                                              | Bring this tab forward for the user.     |
| `url()`, `title()`                                                    | Async methods, not strings: `(await tab.url()).includes(…)`. |
| `snapshot(options?)`                                                  | Structural observation.                  |
| `axSnapshot({ mode?, interactive?, compact?, maxDepth?, selector? })`   | AX tree, incremental; not in cloud sessions. |
| `screenshot(options?)`                                                | Pixel observation.                       |
| `press(key)`                                                          | Page-level key press to current focus.   |
| `keyboard.type(text)`, `keyboard.press(key)`                          | Raw text insertion / key press.          |
| `network`                                                             | Requests, responses, fetch; see Network. |
| `scroll(options?)`                                                    | Scroll page or element.                  |
| `expectNewTab(action, { timeoutMs? })`                                | Capture exactly one new owned tab.       |
| `waitForDownload(action, { timeoutMs? })`                             | The file a download saved (Stella's browser). |

Snapshot options are `interactive`, `cursor`, `maxDepth` (or `depth`), `compact`, and `selector`. Screenshot options are `fullPage`, `selector`, `format` (`"png"` or `"jpeg"`), `quality` (0-100), `annotate`, and `path` (where to save the file). Scroll options are pixel deltas `x`/`y` (negative scrolls up/left) or `selector` + `direction` + `amount`; prefer `locator.scrollIntoViewIfNeeded()` before acting on an element.

### Page Facade

`tab.playwright` supports only this Playwright-like subset:

```text
domSnapshot(options?)
evaluate(pageFunction, arg?)
locator(css)
getByRole(role, { name?, exact? })
getByText(text, { exact? })
getByLabel(text, { exact? })
getByPlaceholder(text, { exact? })
getByTestId(testId, { exact? })
waitForURL(url, { timeout? })
waitForTimeout(ms)
expectNewTab(action, { timeoutMs? })
```

This is not the full Playwright API. Locator values and URL patterns are strings; regular expressions are rejected. `evaluate()` accepts a function or source string. Pass external data through its JSON-serializable argument because page functions do not retain REPL closures.

### Locator

Locators support:

```text
locator(css)
filter({ hasText?, hasNotText?, has?, hasNot? })
nth(index), first(), last(), count()
click(), dblclick(), fill(value), type(text), press(key)
hover(), focus(), check(), uncheck(), setChecked(boolean)
selectOption(valueOrValues), setInputFiles(absolutePaths)
scrollIntoViewIfNeeded()
innerText(), textContent(), inputValue(), getAttribute(name)
isVisible(), isEnabled(), isChecked(), boundingBox()
evaluate(pageFunction, arg?), waitFor(options?), allTextContents()
```

`setInputFiles` requires absolute file paths and targets `<input type=file>`.

`locator()` chaining is supported only from an unfiltered CSS locator. `filter({ has, hasNot })` requires same-tab CSS locators. `nth()` is zero-based. Semantic locators use the frozen API's small role mapping and string matching; they do not provide every Playwright accessibility behavior.

Timeouts are non-negative milliseconds and are capped at 120 seconds unless a smaller `expectNewTab()` limit applies. Locator actions retry transient not-found/not-actionable state for one shared three-second deadline, then add a bounded five-match diagnostic; unknown-outcome transport failures are never replayed. A low-level `browser.chain()` has its own overall `timeout` option capped at 240 seconds. Unknown option keys fail fast. A timeout error states whether its deadline was the caller's override or the runtime default and whether the request had already been dispatched; if dispatch occurred, treat the remote outcome as unknown and inspect state before retrying a mutating action.
