import { getActiveTab } from "./tabs.js";
import { ensureDebugger } from "../lib/debugger.js";
import {
  markCommandMutationDispatched,
  markCommandMutationOutcomeKnown,
  throwIfCommandAborted,
} from "./cancellation.js";

/**
 * Subscribe before dispatching navigation, including cached loads that can
 * finish before chrome.tabs.update/reload resolves. A page that committed but
 * is still loading subresources when the deadline passes has navigated: that
 * resolves as `{ loaded: false }` so the caller learns the outcome instead of a
 * timeout with an unknown one.
 */
async function navigateAndWaitForLoad(command, tabId, navigate, waitUntil = "load") {
  throwIfCommandAborted(command);
  if (waitUntil === "none") {
    markCommandMutationDispatched(command);
    await navigate();
    return { loaded: false };
  }
  const timeout = command.timeout || 30000;
  const signal = command.signal;
  const waitForDomContentLoaded = waitUntil === "domcontentloaded";
  let dispose = () => {};
  let committed = false;
  const loaded = new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new Error("Navigation aborted"));
      return;
    }
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      chrome.webNavigation.onCommitted.removeListener(onCommitted);
      if (waitForDomContentLoaded) {
        chrome.webNavigation.onDOMContentLoaded.removeListener(
          onDOMContentLoaded,
        );
      }
      signal?.removeEventListener("abort", onAbort);
      callback();
    };
    dispose = () => finish(() => resolve(true));
    const timer = setTimeout(() => {
      finish(() =>
        committed
          ? resolve(false)
          : reject(
              new Error(
                "Navigation timeout after " +
                  timeout +
                  "ms: the page never started loading",
              ),
            ),
      );
    }, timeout);

    function onCommitted(details) {
      if (details.tabId === tabId && details.frameId === 0) committed = true;
    }

    const onAbort = () =>
      finish(() => {
        reject(signal.reason || new Error("Navigation aborted"));
      });

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId) return;
      if (changeInfo.url || changeInfo.status === "loading") committed = true;
      if (changeInfo.status === "complete") finish(() => resolve(true));
    }

    function onDOMContentLoaded(details) {
      if (details.tabId === tabId && details.frameId === 0) {
        finish(() => resolve(true));
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
    chrome.webNavigation.onCommitted.addListener(onCommitted);
    if (waitForDomContentLoaded) {
      chrome.webNavigation.onDOMContentLoaded.addListener(onDOMContentLoaded);
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  try {
    const [complete] = await Promise.all([
      loaded,
      Promise.resolve().then(() => {
        markCommandMutationDispatched(command);
        return navigate();
      }),
    ]);
    return { loaded: complete };
  } finally {
    dispose();
  }
}

function navigationResult(command, tab, waitUntil, outcome) {
  const data = { url: tab.url || tab.pendingUrl || "", title: tab.title || "" };
  if (outcome.loaded === false && waitUntil !== "none") {
    data.loadState = "committed";
    data.warning = `The page navigated but had not reached '${waitUntil}' after ${command.timeout || 30000}ms; it is still loading. Wait for the element you need instead of navigating again.`;
  }
  return { id: command.id, success: true, data };
}

export async function handleNavigate(command) {
  throwIfCommandAborted(command);
  const tab = await getActiveTab(command);
  const url = command.url;

  if (!url) throw new Error("URL is required for navigate");

  const outcome = await navigateAndWaitForLoad(
    command,
    tab.id,
    () => chrome.tabs.update(tab.id, { url }),
    command.waitUntil,
  );

  throwIfCommandAborted(command);
  const updated = await chrome.tabs.get(tab.id);
  markCommandMutationOutcomeKnown(command);

  try {
    await ensureDebugger(updated.id);
  } catch {}

  return navigationResult(command, updated, command.waitUntil || "load", outcome);
}

async function navigateHistory(command, navigate) {
  throwIfCommandAborted(command);
  const tab = await getActiveTab(command);
  const events = [
    chrome.webNavigation.onCommitted,
    chrome.webNavigation.onHistoryStateUpdated,
    chrome.webNavigation.onReferenceFragmentUpdated,
  ];
  let finish;
  const committed = new Promise((resolve) => { finish = resolve; });
  const listener = (details) => {
    if (details.tabId === tab.id && details.frameId === 0) finish();
  };
  for (const event of events) event.addListener(listener);
  const timer = setTimeout(finish, 500);
  command.signal?.addEventListener("abort", finish, { once: true });
  try {
    throwIfCommandAborted(command);
    markCommandMutationDispatched(command);
    await navigate(tab.id);
    await committed;
    throwIfCommandAborted(command);
    const updated = await chrome.tabs.get(tab.id);
    markCommandMutationOutcomeKnown(command);
    return {
      id: command.id,
      success: true,
      data: { url: updated.url, title: updated.title },
    };
  } finally {
    clearTimeout(timer);
    for (const event of events) event.removeListener(listener);
    command.signal?.removeEventListener("abort", finish);
  }
}

export async function handleBack(command) {
  return navigateHistory(command, (tabId) => chrome.tabs.goBack(tabId));
}

export async function handleForward(command) {
  return navigateHistory(command, (tabId) => chrome.tabs.goForward(tabId));
}

export async function handleReload(command) {
  throwIfCommandAborted(command);
  const tab = await getActiveTab(command);
  const outcome = await navigateAndWaitForLoad(command, tab.id, () =>
    chrome.tabs.reload(tab.id),
  );
  throwIfCommandAborted(command);
  const updated = await chrome.tabs.get(tab.id);
  markCommandMutationOutcomeKnown(command);

  try {
    await ensureDebugger(updated.id);
  } catch {}

  return navigationResult(command, updated, "load", outcome);
}

export async function handleUrl(command) {
  throwIfCommandAborted(command);
  const tab = await getActiveTab(command);
  return {
    id: command.id,
    success: true,
    data: { url: tab.url || "" },
  };
}

export async function handleTitle(command) {
  throwIfCommandAborted(command);
  const tab = await getActiveTab(command);
  return {
    id: command.id,
    success: true,
    data: { title: tab.title || "" },
  };
}
