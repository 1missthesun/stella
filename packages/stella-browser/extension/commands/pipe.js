import { assertAllowedMethod } from "../lib/cdp-policy.js";
import { send } from "../lib/connection.js";
import { attachDebugger, detachDebugger } from "../lib/debugger.js";
import { pipedTabs } from "../lib/piped-tabs.js";
import {
  authorizeOwnerLease,
  getActiveTab,
  onForgotten,
  requireOwnedTab,
} from "./tabs.js";

async function openTab(command) {
  await authorizeOwnerLease(command);
  const tab = await getActiveTab(command);
  return {
    tabId: tab.id,
    url: tab.url || tab.pendingUrl || "",
    title: tab.title || "",
  };
}

async function attach(command) {
  const tabId = requireOwnedTab(command);
  await attachDebugger(tabId);
  if (!pipedTabs.has(tabId)) {
    pipedTabs.set(tabId, { buttons: new Map(), keys: new Map() });
  }
  return { tabId };
}

/** Chrome refuses to debug its own pages; an empty page can take over from one. */
async function blank(command) {
  const tabId = requireOwnedTab(command);
  await chrome.tabs.update(tabId, { url: "about:blank" });
  const deadline = Date.now() + 5_000;
  for (;;) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url === "about:blank" && tab.status === "complete") return {};
    if (Date.now() > deadline) throw new Error("The tab did not leave its page");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function noteHeldInput(held, method, params) {
  if (method === "Input.dispatchMouseEvent") {
    if (params.type === "mousePressed") {
      held.buttons.set(params.button ?? "left", params);
    } else if (params.type === "mouseReleased") {
      held.buttons.delete(params.button ?? "left");
    } else if (params.type === "mouseMoved") {
      for (const [button, at] of held.buttons) {
        held.buttons.set(button, { ...at, x: params.x, y: params.y });
      }
    }
  } else if (method === "Input.dispatchKeyEvent") {
    const key = params.code || params.key;
    if (params.type === "keyDown" || params.type === "rawKeyDown") {
      held.keys.set(key, params);
    } else if (params.type === "keyUp") {
      held.keys.delete(key);
    }
  }
}

async function releaseHeldInput(tabId) {
  const held = pipedTabs.get(tabId);
  if (!held) return;
  const buttons = [...held.buttons];
  const keys = [...held.keys.values()];
  held.buttons.clear();
  held.keys.clear();
  for (const [button, { x, y }] of buttons) {
    await chrome.debugger
      .sendCommand({ tabId }, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x,
        y,
        button,
        buttons: 0,
        clickCount: 1,
      })
      .catch(() => undefined);
  }
  for (const { key, code, windowsVirtualKeyCode } of keys) {
    await chrome.debugger
      .sendCommand({ tabId }, "Input.dispatchKeyEvent", {
        type: "keyUp",
        key,
        code,
        windowsVirtualKeyCode,
      })
      .catch(() => undefined);
  }
}

async function detach(tabId) {
  if (!pipedTabs.has(tabId)) return;
  await releaseHeldInput(tabId);
  pipedTabs.delete(tabId);
  await detachDebugger(tabId);
}

function debuggerError(error) {
  const text = String(error?.message || error);
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.message === "string") return new Error(parsed.message);
  } catch {
    // Not every debugger error is JSON.
  }
  return new Error(text);
}

async function sendToDebugger(tabId, { method, params, debuggerSession }) {
  const held = pipedTabs.get(tabId);
  if (!held) throw new Error("Debugger is not attached to this tab");
  const methodParams = params ?? {};
  assertAllowedMethod(method, methodParams);
  noteHeldInput(held, method, methodParams);
  const target =
    typeof debuggerSession === "string" && debuggerSession
      ? { tabId, sessionId: debuggerSession }
      : { tabId };
  try {
    return (await chrome.debugger.sendCommand(target, method, methodParams)) ?? {};
  } catch (error) {
    throw debuggerError(error);
  }
}

export const PIPE_HANDLERS = {
  pipe_tab: openTab,
  pipe_attach: attach,
  pipe_blank: blank,
  pipe_send: (command) => sendToDebugger(requireOwnedTab(command), command),
  pipe_release: async (command) => {
    await releaseHeldInput(requireOwnedTab(command));
    return {};
  },
  pipe_detach: async (command) => {
    await detach(requireOwnedTab(command));
    return {};
  },
};

onForgotten((ownerId, tabId) => {
  if (tabId != null) void detach(tabId);
});

export function closePipe() {
  for (const tabId of [...pipedTabs.keys()]) void detach(tabId);
}

export async function detachLeftoverDebuggers() {
  const targets = await chrome.debugger.getTargets();
  for (const { attached, tabId } of targets) {
    if (!attached || !Number.isInteger(tabId) || pipedTabs.has(tabId)) continue;
    await chrome.debugger.detach({ tabId }).catch(() => undefined);
  }
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (!source.tabId || !pipedTabs.has(source.tabId)) return;
  send({
    type: "event",
    event: "pipe",
    tabId: source.tabId,
    ...(source.sessionId ? { debuggerSession: source.sessionId } : {}),
    method,
    params: params ?? {},
  });
});

chrome.debugger.onDetach.addListener((source, reason) => {
  if (!source.tabId || source.sessionId || !pipedTabs.delete(source.tabId)) return;
  send({ type: "event", event: "pipe", tabId: source.tabId, detached: reason });
});
