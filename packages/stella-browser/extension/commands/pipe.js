/**
 * The raw debugger pipe. The service decides what to do to a page and sends
 * debugger commands; this relays them to Chrome and the debugger's events
 * back, for tabs the command's owner holds and methods the policy allows.
 */
import { assertAllowedMethod } from "../lib/cdp-policy.js";
import { send } from "../lib/connection.js";
import { ensureDebugger, holdDebugger, releaseDebugger } from "../lib/debugger.js";
import { pipedTabs } from "../lib/piped-tabs.js";
import {
  authorizeOwnerLease,
  getActiveTab,
  requireOwnedTab,
} from "./tabs.js";

const MAX_BATCH = 200;

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
  await ensureDebugger(tabId);
  holdDebugger(tabId);
  if (!pipedTabs.has(tabId)) {
    pipedTabs.set(tabId, { buttons: new Map(), keys: new Map() });
  }
  return { tabId };
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
  releaseDebugger(tabId);
  await chrome.debugger.detach({ tabId }).catch(() => undefined);
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

async function sendBatch(tabId, commands) {
  if (commands.length > MAX_BATCH) {
    throw new Error(`A batch holds at most ${MAX_BATCH} commands`);
  }
  const results = [];
  for (const command of commands) {
    try {
      results.push({ result: await sendToDebugger(tabId, command) });
    } catch (error) {
      results.push({ error: error.message });
    }
  }
  return { results };
}

/** Commands run in the order they arrive: nothing may be awaited before the debugger is called. */
export const PIPE_HANDLERS = {
  pipe_tab: openTab,
  pipe_attach: attach,
  pipe_send: (command) => {
    const tabId = requireOwnedTab(command);
    return Array.isArray(command.commands)
      ? sendBatch(tabId, command.commands)
      : sendToDebugger(tabId, command);
  },
  pipe_release: async (command) => {
    await releaseHeldInput(requireOwnedTab(command));
    return {};
  },
  pipe_detach: async (command) => {
    await detach(requireOwnedTab(command));
    return {};
  },
};

/** The service is gone: nobody will release what it holds or use its tabs. */
export function closePipe() {
  for (const tabId of [...pipedTabs.keys()]) void detach(tabId);
}

export function closePipedTab(tabId) {
  void detach(tabId);
}

/** Debuggers a previous service worker left attached belong to nobody now. */
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
