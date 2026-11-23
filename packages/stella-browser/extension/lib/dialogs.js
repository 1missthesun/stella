/**
 * JavaScript dialogs (alert, confirm, prompt) in agent tabs, answered through
 * the debugger's Page domain the moment they open, the way a dismissing
 * person would: alert is acknowledged, confirm and prompt are cancelled.
 * Nothing in the page is replaced, so the page still sees its native dialog
 * functions. Answered dialogs are kept per tab until the command that caused
 * them collects them. In tabs driven over the pipe the service answers them.
 */

import { pipedTabs } from "./piped-tabs.js";

const answered = new Map();

export async function enableDialogHandling(tabId) {
  await chrome.debugger.sendCommand({ tabId }, "Page.enable", {});
}

export function takeAnsweredDialogs(tabId) {
  const dialogs = answered.get(tabId) ?? [];
  answered.delete(tabId);
  return dialogs;
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (method !== "Page.javascriptDialogOpening" || !source.tabId) return;
  if (pipedTabs.has(source.tabId)) return;
  const type = params?.type;
  if (type !== "alert" && type !== "confirm" && type !== "prompt") return;
  const accept = type === "alert";
  const list = answered.get(source.tabId) ?? [];
  list.push({
    type,
    message: String(params?.message ?? "").slice(0, 300),
    answer: type === "alert" ? "ok" : type === "confirm" ? false : null,
  });
  answered.set(source.tabId, list.slice(-20));
  void chrome.debugger
    .sendCommand(source, "Page.handleJavaScriptDialog", { accept })
    .catch(() => undefined);
});

chrome.tabs.onRemoved.addListener((tabId) => answered.delete(tabId));
