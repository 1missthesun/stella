---
name: stella-browser
description: Control browser tabs through the persistent code runtime and its frozen browser API, in the user's own browser (signed in as them; the default while the Stella Browser extension is connected) or in Stella's own browser. Use for navigation, page interaction, semantic locators, state inspection, new-tab flows, and browser screenshots. The user's Browser panel never switches to your tab by itself: when the user asked to see a page, call `tab.show()` on it.
---

# Stella Browser

Drive browsers from `code`: its persistent runtime has a frozen `browser` object, and `Tab` and `Locator` handles persist across calls, so create them once (with `var`, since `let`/`const` can't be redeclared in a later cell) and reuse them. There is no browser access through `Bash`.

`reference.md` beside this file covers snapshots and incremental AX diffs, network capture and HAR files, dialogs and stuck tabs, downloads and file inputs, new tabs, explicit tab finalizing, and the full API tables.

## Which browser

- **The user's own browser**, `browser.use("external")`, the default while the Stella Browser extension is connected: their real Chrome, Brave, Edge or Arc, signed in exactly as they are. Your tabs open in the background in a "Stella" tab group.
- **Stella's browser**, `browser.use("in-app")`: when the extension isn't connected, or for work that should stay out of the user's browser (test sessions, anything that would disturb their tabs or sign them out). Its own profile, signed in only where someone signed in inside it.

Without a `browser.use()` call the first browser call picks the user's browser if the extension is connected, else Stella's; `await browser.use()` returns the resolved `{ backend }`. Each handle keeps the backend that created it, so one task can use both.

The extension can be connected in several browsers and profiles; `await browser.browsers()` lists them and `browser.use("external", { browser: "Brave" })` targets one (a label, id, browser or profile name). Leave the default unless the task needs a particular account. If your browser closes mid-task, commands fail naming it: `browser.tabs.new()` continues in another connected browser.

In the user's browser you are a guest: work only in tabs you opened, never reading, using or closing theirs; keep to one tab; and call `tab.show()` there only when they asked to see the page, since it brings their window to the front.

When the extension isn't connected, the first command in the user's browser fails with "Extension not connected" and Stella offers the user a card to connect it. If it stays unconnected, continue in Stella's browser; for a step that needs their account, open its sign-in page in a Stella browser tab, `show()` it, and ask them to sign in once in Stella's Browser panel (never ask for or type their password yourself). If a site in Stella's browser is signed out and the task needs the user's account, switch to their browser for that site instead.

## Working in a tab

Open one tab for the task and navigate it with `tab.goto()` for every page; close any extra tab once it has served its purpose. Don't loop on `tabs.new()` when navigation fails: reuse the handle.

```js
var tab = await browser.tabs.new();
await tab.goto("https://example.com/search");
var page = tab.playwright;
var rows = page.locator("[data-testid='result-row']");
await page.getByPlaceholder("Search").fill("quarterly report");
await page.getByPlaceholder("Search").press("Enter");
await rows.first().waitFor({ state: "visible" });
await rows.count();
```

- Batch dependent actions in one cell; split only where a result changes the plan.
- `goto()`, `click()` and Enter already wait for the page to settle (up to 3 s). Wait for state, never for time: `locator.waitFor()`, `page.waitForURL("**/done")`.
- `tab.playwright` is a small Playwright-like subset (see the reference); patterns are strings, not regular expressions. `evaluate()` gets data only through its JSON argument.
- Locators resolve when called, so a DOM change doesn't invalidate them. Selectors reach same-origin iframes and open shadow roots; act inside a cross-origin frame with a ref from the latest snapshot.
- There is no `page.keyboard`: `tab.press("Control+a")` sends a key to the focus, `tab.keyboard.type(text)` inserts text (emoji, CJK, canvas editors), and `locator.press(key)` focuses first.
- Wrap an action that opens a tab: `var t2 = await tab.expectNewTab(async () => await link.click())`.
- A file input opens no picker: `locator.setInputFiles([absolutePath])`. Downloads: `await tab.waitForDownload(async () => …)` returns the saved file's path.
- Page dialogs never block: alerts are dismissed, confirms answer Cancel. To accept one, set `window.confirm = () => true` with `page.evaluate` just before the click.
- After a timeout on a mutating action, check the page before repeating it. A tab that stops answering usually recovers with `goto(url)`; otherwise close it and open a new one.

## Observing

Use the cheapest observation that answers the question: `url()`/`title()` (async), `count()`/`isVisible()`/`isEnabled()`, `innerText()`/`inputValue()`/`getAttribute()`; `tab.axSnapshot()` (incremental diffs; not in cloud sessions, where `tab.snapshot()` serves) when you need structure to decide; `tab.screenshot()` when pixels matter. Don't snapshot after every action.

A screenshot is attached to the tool result; its return value is a receipt with a `path` that later `Bash`, `Read` or `drive_upload` calls can use. Default copies are deleted after 7 days; pass `path` (e.g. `"~/.stella/outputs/report/home.png"`) for one that is kept.

## Secrets in browser output

Passwords, cookies, auth headers, tokens and API keys in anything the browser returns come back as placeholders such as `stella-secret-k3j9x2m4q7ab`, stable within the task. Send a placeholder back through the browser to the site it came from (`tab.network.fetch()`, `page.evaluate()`, a `goto()` URL) and the real value goes out; any other site is refused, and a page script using one may only name URLs on that site. Passwords and one-time codes are typed with `use_secure_value`. Nothing reveals a value.

## Showing and leaving tabs

The user's Browser panel never switches to your tab on its own. When they want to see a page (they asked to open or be shown something, or to take over a sign-in), call `await tab.show()` once it's worth looking at.

A few minutes after your task ends its tabs close, except those the user has looked at or taken over. Whenever your report points the user at a tab (a page to review, a form to finish, a sign-in), call `await tab.leaveForUser()` first; Stella never closes it. When you are resumed after your tabs closed, they reopen by URL at your first browser command, but in-page state is gone and old handles point at closed tabs: get fresh ones from `browser.tabs.list()` or `browser.tabs.selected()`.

## Failures

"Extension not connected" is handled above. On any other bridge or transport failure, don't fall back to shell commands or to driving a browser window yourself: report the exact error, park the browser step, and carry on with work that doesn't need it.
