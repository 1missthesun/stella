const attached = new Set();

export async function attachDebugger(tabId) {
  if (attached.has(tabId)) return;
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
  } catch (error) {
    // A service worker restart forgets attachments Chrome still holds.
    if (!/already attached/i.test(String(error?.message || error))) throw error;
    await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
      expression: "1",
      returnByValue: true,
    });
  }
  attached.add(tabId);
  await keepPageRunning(tabId);
}

export async function detachDebugger(tabId) {
  attached.delete(tabId);
  await chrome.debugger.detach({ tabId }).catch(() => undefined);
}

/**
 * Chrome throttles timers and stops requestAnimationFrame in background tabs,
 * and freezes or discards them under memory or energy saving, so a page the
 * agent drives without showing it stops reacting. Focus emulation makes
 * Chrome treat the tab as visible and focused for as long as the debugger is
 * attached; the lifecycle call unfreezes a frozen page.
 */
async function keepPageRunning(tabId) {
  await Promise.all([
    chrome.debugger
      .sendCommand({ tabId }, 'Emulation.setFocusEmulationEnabled', { enabled: true })
      .catch(() => undefined),
    chrome.debugger
      .sendCommand({ tabId }, 'Page.setWebLifecycleState', { state: 'active' })
      .catch(() => undefined),
    chrome.tabs.update(tabId, { autoDiscardable: false }).catch(() => undefined),
  ]);
}

chrome.tabs.onRemoved.addListener((tabId) => attached.delete(tabId));

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId && !source.sessionId) attached.delete(source.tabId);
});
