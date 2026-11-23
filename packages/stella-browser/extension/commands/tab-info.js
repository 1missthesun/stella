import { getActiveTab } from "./tabs.js";

export async function handleUrl(command) {
  const tab = await getActiveTab(command);
  return { id: command.id, success: true, data: { url: tab.url || "" } };
}

export async function handleTitle(command) {
  const tab = await getActiveTab(command);
  return { id: command.id, success: true, data: { title: tab.title || "" } };
}

export async function handleBringToFront(command) {
  const tab = await getActiveTab(command);
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  return { id: command.id, success: true, data: { focused: true } };
}
