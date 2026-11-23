import { agentCursorHighlightParams } from "../lib/agent-cursor.js";

const overlayReady = new Map();
const idleHides = new Map();
const cursorTabsByOwner = new Map();
const IDLE_HIDE_MS = 20_000;

function cancelIdleHide(tabId) {
  clearTimeout(idleHides.get(tabId));
  idleHides.delete(tabId);
}

function enableOverlay(tabId) {
  let ready = overlayReady.get(tabId);
  if (!ready) {
    ready = (async () => {
      await chrome.debugger.sendCommand({ tabId }, "DOM.enable", {});
      await chrome.debugger.sendCommand({ tabId }, "Overlay.enable", {});
    })();
    overlayReady.set(tabId, ready);
    ready.catch(() => overlayReady.delete(tabId));
  }
  return ready;
}

export async function drawAgentCursor(tabId, point, overlayScale = 1) {
  cancelIdleHide(tabId);
  idleHides.set(
    tabId,
    setTimeout(() => void hideAgentCursor(tabId), IDLE_HIDE_MS),
  );
  await enableOverlay(tabId);
  await chrome.debugger.sendCommand(
    { tabId },
    "Overlay.highlightQuad",
    agentCursorHighlightParams(point, overlayScale),
  );
}

export async function hideAgentCursor(tabId) {
  cancelIdleHide(tabId);
  if (!overlayReady.has(tabId)) return;
  await chrome.debugger
    .sendCommand({ tabId }, "Overlay.hideHighlight", {})
    .catch(() => undefined);
}

chrome.debugger.onDetach.addListener((source) => {
  if (!source.tabId) return;
  overlayReady.delete(source.tabId);
  cancelIdleHide(source.tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  overlayReady.delete(tabId);
  cancelIdleHide(tabId);
});

export const trackAgentCursorTab = (ownerId, tabId) => {
  const key = typeof ownerId === "string" && ownerId ? ownerId : "default";
  let tabIds = cursorTabsByOwner.get(key);
  if (tabIds == null) {
    tabIds = new Set();
    cursorTabsByOwner.set(key, tabIds);
  }
  tabIds.add(tabId);
};

export const takeAgentCursorTabs = (ownerId) => {
  const key = typeof ownerId === "string" && ownerId ? ownerId : "default";
  const tabIds = [...(cursorTabsByOwner.get(key) ?? [])];
  cursorTabsByOwner.delete(key);
  return tabIds;
};
