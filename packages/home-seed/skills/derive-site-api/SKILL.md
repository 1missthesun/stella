---
name: derive-site-api
description: Make repeated access to a website fast and reliable by learning the private API behind it, instead of clicking through the site every time. Reach for this on your own whenever the user wants something from a site again and again (checking orders, pulling their data, tracking prices or statuses, automating a routine) and the site has no public API. The user won't ask for an "API"; they'll just ask for the outcome.
---

# Derive a site's API

Most sites are a thin frontend over a private JSON API. Driving the page works,
but it is slow and fragile. If the user will want the same thing more than
once, watch the site's own traffic once and call those endpoints directly from
then on. For a one-off, just use the browser.

Record the shortest flow that produces the data, in the user's browser so their
session is present. If a login is needed, let the user sign in themselves.
Recording is two `browser.chain()` steps around the flow (`har_start` and
`har_stop` exist nowhere else in the browser API):

```js
var tab = await browser.tabs.new();
await browser.chain([{ action: "har_start", params: { tabId: tab.id } }]);
await tab.goto("https://example.com/orders"); // and whatever else produces the data
await browser.chain([{ action: "har_stop", params: { tabId: tab.id, path: "~/.stella/tmp/site.har" } }]);
```

HAR files are huge, so don't read them; run
`bun ~/.stella/skills/derive-site-api/scripts/program.js <har> --out <report.md>`,
which strips noise, groups endpoints, infers shapes, and redacts credentials.
Pick the two or three endpoints the task actually needs. For one quick look,
`tab.network.requests({ filter: "/api/" })` already holds what a tab has sent
since you opened it.

The session is the auth. Make calls from the site's own origin with `evaluate`
so the browser attaches cookies itself. Captured cookies, tokens and CSRF
values reach you only as `stella-secret-…` placeholders; to test a call that
needs one, pass the placeholder in its headers, URL or body through the browser
on that site (a `page.evaluate` fetch or `tab.network.fetch`) and the real
value goes in on the way. Placeholders last only for the task, so a saved
client reads each such header live from the page (localStorage, a meta tag, a
bootstrap response) instead of storing it.

Check each endpoint with a real call before relying on it, then save the result
as a small skill of its own (`~/.stella/skills/<site>-client/`) noting the
operations, any live header source, and the date recorded. When it later
breaks, re-record rather than guess. If the site blocks non-browser requests,
say so and fall back to the browser; never try to get around bot protection.
