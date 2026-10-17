const STRING_METHODS =
  "includes|slice|startsWith|endsWith|replace|replaceAll|match|split|toLowerCase|toUpperCase|indexOf|trim|substring|length";

const METHOD_HINTS: Readonly<Record<string, string>> = {
  screenshot:
    "Screenshots live on the Tab: await tab.screenshot({ fullPage, selector, path }). The image attaches to the result automatically and the returned .path stays on disk.",
  title: "title() and url() are async methods on the Tab: await tab.title(), await tab.url().",
  url: "title() and url() are async methods on the Tab: await tab.title(), await tab.url().",
  goto: "Navigate with the Tab: await tab.goto(url). tab.back(), tab.forward() and tab.reload() are there too.",
  reload: "Use await tab.reload() on the Tab.",
  goBack: "Use await tab.back() on the Tab.",
  goForward: "Use await tab.forward() on the Tab.",
  close: "Close tabs with await tab.close() on the Tab.",
  content:
    "There is no page.content(); read text with page.locator(css).innerText(), or page.evaluate(() => document.body.innerText).",
  waitForSelector: "Use page.locator(css).waitFor({ state: \"visible\" }).",
  waitForLoadState:
    "There is no waitForLoadState: wait for what the load produces, with locator.waitFor() or page.waitForURL(pattern).",
  waitForNavigation: "Use page.waitForURL(pattern) after the action.",
  waitForFunction:
    "There is no waitForFunction: wait on a locator (locator.waitFor()) or page.waitForURL().",
  setViewportSize: "The viewport size can't be changed through this API.",
  setViewport: "The viewport size can't be changed through this API.",
  viewportSize: "The viewport size can't be read or changed through this API.",
  pdf: "PDF export isn't supported; take tab.screenshot({ fullPage: true }) instead.",
  on: "Page events aren't exposed. Wait on state instead: locator.waitFor(), page.waitForURL(), tab.expectNewTab(action).",
  once: "Page events aren't exposed. Wait on state instead: locator.waitFor(), page.waitForURL(), tab.expectNewTab(action).",
  keyboard: "The keyboard is on the Tab: tab.keyboard.type(text), tab.press(key).",
  mouse: "There is no mouse object; use locator.click(), locator.hover() or locator.dblclick().",
  pressSequentially: "Use locator.type(text) or locator.fill(value).",
  evaluateAll:
    "Use page.evaluate(() => [...document.querySelectorAll(css)].map(...)) or locator.allTextContents().",
  allInnerTexts: "Use locator.allTextContents().",
  frames: "Frames aren't exposed; selectors already search same-origin iframes, and snapshot refs reach cross-origin ones.",
  mainFrame: "Frames aren't exposed; use the page facade directly.",
  newTab: "Open tabs with var tab = await browser.tabs.new(url).",
  newPage: "Open tabs with var tab = await browser.tabs.new(url).",
  tabs: "browser.tabs is an object: browser.tabs.list(), browser.tabs.new(url), browser.tabs.get(id), browser.tabs.selected().",
  capabilities: "browser.capabilities is a property, not a function.",
  getByAltText: "Supported finders: getByRole, getByText, getByLabel, getByPlaceholder, getByTestId, locator(css).",
  getByTitle: "Supported finders: getByRole, getByText, getByLabel, getByPlaceholder, getByTestId, locator(css).",
  setInputFiles: "setInputFiles(absolutePaths) is a Locator method: page.locator('input[type=file]').setInputFiles([path]).",
  waitForEvent:
    "Page events aren't exposed. For a download in Stella's browser: var file = await tab.waitForDownload(() => locator.click()); file.path is where it was saved.",
  waitForDownload:
    "waitForDownload is on the Tab: var file = await tab.waitForDownload(() => locator.click()). It works in Stella's browser (browser.use(\"in-app\")).",
};

const API_NOTE =
  "tab.playwright is a small Playwright-like facade (locator, getBy*, evaluate, waitForURL); page-level actions (goto, url, title, screenshot, press, keyboard) are on the Tab. See the stella-browser skill.";

const GENERIC_METHODS = new Set([
  "close",
  "on",
  "once",
  "url",
  "title",
  "content",
  "reload",
  "tabs",
  "capabilities",
  "keyboard",
  "mouse",
  "frames",
]);

export const browserApiHint = (message: string): string | undefined => {
  if (
    new RegExp(`\\.(?:url|title)\\??\\.(?:${STRING_METHODS})\\b`).test(message) ||
    new RegExp(`\\.(?:url|title)\\s*\\|\\|\\s*""\\)\\.(?:${STRING_METHODS})\\b`).test(message)
  ) {
    return "tab.url and tab.title are async methods, not strings: use (await tab.url()).includes(...). browser.tabs.list() returns Tab handles; read each with await t.url().";
  }
  if (/does not support RegExp/.test(message)) {
    return "Locator text and URL patterns must be strings; use { exact: false } for a substring match and glob patterns like \"**/path\" for waitForURL.";
  }
  if (/Unknown or unsafe chain option/.test(message)) {
    return "Prefer plain awaited calls over browser.chain(). Chain options are timeout, delay, waitForSelector, waitTimeout, abortOnError, returnSnapshot and returnScreenshot.";
  }
  if (/Identifier '[^']+' has already been declared/.test(message)) {
    return "Bindings persist between cells: use var (not let or const) for names you may set again.";
  }
  const missing = message.match(/([\w$.?()]+?)\??\.([\w$]+) is not a function/);
  if (missing) {
    const [, receiver = "", method = ""] = missing;
    const browserish = /browser|tab|page|playwright|locator|^p$|^pg$|^t\d*$|^b$/i.test(receiver);
    const hint = METHOD_HINTS[method];
    if (hint && (browserish || !GENERIC_METHODS.has(method))) return `${hint} ${API_NOTE}`;
    if (browserish) return API_NOTE;
  }
  const undefinedRead = message.match(/Cannot read properties of undefined \(reading '([\w$]+)'\)/);
  if (undefinedRead && METHOD_HINTS[undefinedRead[1] ?? ""] && /playwright|tab|page/i.test(message)) {
    return `${METHOD_HINTS[undefinedRead[1] ?? ""]} ${API_NOTE}`;
  }
  return undefined;
};
