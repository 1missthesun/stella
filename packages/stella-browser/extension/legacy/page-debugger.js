import { attachDebugger, detachDebugger } from "../lib/debugger.js";
import { pipedTabs } from "../lib/piped-tabs.js";
import { enableDialogHandling } from "./dialogs.js";

const DETACH_TIMEOUT = 300000;
const drivenTabs = new Set();
/**
 * Tabs that must stay attached regardless of idle time. A long-running capture
 * (HAR recording) receives CDP events without issuing commands, so the idle
 * timer would otherwise detach mid-recording and silently end it.
 */
const detachHolds = new Set();
let detachTimer = null;

function scheduleIdleDetach() {
  clearTimeout(detachTimer);
  detachTimer = setTimeout(() => detachIdleTabs(), DETACH_TIMEOUT);
}

/**
 * Keep a tab attached until the matching release. Safe to call repeatedly.
 * @param {number} tabId
 */
export function holdDebugger(tabId) {
  detachHolds.add(tabId);
}

/**
 * Drop a hold taken by `holdDebugger` and let the tab idle out again.
 * @param {number} tabId
 */
export function releaseDebugger(tabId) {
  detachHolds.delete(tabId);
}

async function detachIdleTabs() {
  detachTimer = null;
  for (const tabId of [...drivenTabs]) {
    if (detachHolds.has(tabId)) continue;
    drivenTabs.delete(tabId);
    if (!pipedTabs.has(tabId)) await detachDebugger(tabId);
  }
  if (detachHolds.size > 0) scheduleIdleDetach();
}

/**
 * Ensure chrome.debugger is attached to the given tab.
 * @param {number} tabId
 */
export async function ensureDebugger(tabId) {
  if (!drivenTabs.has(tabId)) {
    await attachDebugger(tabId);
    drivenTabs.add(tabId);
    await enableDialogHandling(tabId).catch(() => undefined);
  }
  scheduleIdleDetach();
}

export const ISOLATED_WORLD = "stella-observation";
const isolatedContexts = new Map();
const CONTEXT_GONE =
  /Cannot find context with specified id|Execution context was destroyed|Cannot find default execution context|Inspected target navigated or closed/i;

/**
 * The execution context of Stella's isolated world in the tab's main frame.
 * It shares the page's DOM but not its JavaScript, so the page cannot observe
 * Stella's scripts through patched prototypes, globals or stack traces.
 */
async function isolatedContext(tabId, fresh = false) {
  if (!fresh && isolatedContexts.has(tabId)) return isolatedContexts.get(tabId);
  const pending = (async () => {
    const tree = await chrome.debugger.sendCommand(
      { tabId },
      "Page.getFrameTree",
      {},
    );
    const frameId = tree?.frameTree?.frame?.id;
    if (!frameId) throw new Error("The page has no main frame yet");
    const created = await chrome.debugger.sendCommand(
      { tabId },
      "Page.createIsolatedWorld",
      { frameId, worldName: ISOLATED_WORLD },
    );
    return created.executionContextId;
  })();
  isolatedContexts.set(tabId, pending);
  pending.catch(() => {
    if (isolatedContexts.get(tabId) === pending) isolatedContexts.delete(tabId);
  });
  return pending;
}

/**
 * Evaluate an expression in the page and await promise results. Runs in
 * Stella's isolated world unless `world: "main"` asks for the page's own
 * JavaScript (its globals and framework state).
 * @param {number} tabId
 * @param {string} expression
 * @param {{userGesture?: boolean, timeoutMs?: number, world?: "isolated" | "main"}} [options]
 * @returns {Promise<unknown>}
 */
export async function evaluateRuntime(tabId, expression, options = {}) {
  await ensureDebugger(tabId);
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) {
    throw new TypeError('Runtime evaluation timeout must be between 1 and 30000ms');
  }
  const params = {
    expression,
    returnByValue: true,
    awaitPromise: true,
    timeout: timeoutMs,
  };
  if (options.userGesture === true) params.userGesture = true;
  const isolated = options.world !== "main";
  const run = async (fresh) => {
    if (isolated) params.contextId = await isolatedContext(tabId, fresh);
    // Runtime.evaluate's own timeout stops running script only; it never ends
    // the wait for a promise the page does not settle.
    let timer;
    return await Promise.race([
      chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', params),
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `The page did not finish evaluating within ${timeoutMs}ms; it may be frozen, blocked by a dialog, or waiting on something that never settles.`,
              ),
            ),
          timeoutMs + 1_000,
        );
      }),
    ]).finally(() => clearTimeout(timer));
  };
  let result;
  try {
    result = await run(false);
  } catch (error) {
    if (!isolated || !CONTEXT_GONE.test(String(error?.message || error))) throw error;
    result = await run(true);
  }

  if (result.exceptionDetails) {
    const message =
      result.exceptionDetails.exception?.description ||
      result.exceptionDetails.text ||
      'Runtime evaluation failed';
    throw new Error(message);
  }

  return result.result?.value;
}

const eventListeners = new Map();
const attachedFrameSessions = new Map();

export function getAttachedFrameSessions(tabId) {
  return new Map(attachedFrameSessions.get(tabId) || []);
}

/**
 * Register a listener for a CDP event on a specific tab.
 * @param {number} tabId
 * @param {string} method - CDP event method (e.g. 'Network.requestWillBeSent')
 * @param {(params: any) => void} callback
 */
export function onCdpEvent(tabId, method, callback) {
  const key = `${tabId}:${method}`;
  if (!eventListeners.has(key)) {
    eventListeners.set(key, new Set());
  }
  eventListeners.get(key).add(callback);
}

/**
 * Remove a listener for a CDP event on a specific tab.
 * @param {number} tabId
 * @param {string} method
 * @param {(params: any) => void} callback
 */
export function offCdpEvent(tabId, method, callback) {
  const key = `${tabId}:${method}`;
  const listeners = eventListeners.get(key);
  if (listeners) {
    listeners.delete(callback);
    if (listeners.size === 0) eventListeners.delete(key);
  }
}

/**
 * Remove all CDP event listeners for a specific tab.
 * @param {number} tabId
 */
export function clearCdpEvents(tabId) {
  for (const key of eventListeners.keys()) {
    if (key.startsWith(`${tabId}:`)) {
      eventListeners.delete(key);
    }
  }
}

// Global CDP event listener - dispatches to registered per-tab listeners.
// `source` is forwarded as a second argument because auto-attached targets
// (cross-origin iframes, workers) deliver events under the same tabId with a
// `sessionId`, and commands about those requests must carry it back.
chrome.debugger.onEvent.addListener((source, method, params) => {
  if (!source.tabId) return;
  if (
    method === "Target.attachedToTarget" &&
    params?.targetInfo?.type === "iframe"
  ) {
    if (!attachedFrameSessions.has(source.tabId))
      attachedFrameSessions.set(source.tabId, new Map());
    attachedFrameSessions
      .get(source.tabId)
      .set(params.sessionId, params.targetInfo.targetId);
  } else if (method === "Target.detachedFromTarget") {
    attachedFrameSessions.get(source.tabId)?.delete(params.sessionId);
  }
  const key = `${source.tabId}:${method}`;
  const listeners = eventListeners.get(key);
  if (listeners) {
    for (const cb of listeners) {
      try {
        cb(params, source);
      } catch (err) {
        console.error(`[debugger] Event listener error for ${method}:`, err);
      }
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  forgetTab(tabId);
  clearCdpEvents(tabId);
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId) forgetTab(source.tabId);
});

function forgetTab(tabId) {
  isolatedContexts.delete(tabId);
  attachedFrameSessions.delete(tabId);
  drivenTabs.delete(tabId);
  // A closed tab that stayed held would keep the idle timer running for good.
  releaseDebugger(tabId);
}
