import {
  connect,
  disconnect,
  isConnected,
  onCommand,
  onStatus,
  send,
} from "./lib/connection.js";
import {
  authorizeOwnerLease,
  releaseOwnerLease,
  handleTabNew,
  handleTabList,
  handleTabSwitch,
  handleTabClose,
  handleMarkTab,
  closeAgentWindow,
  finalizeOwnerTabs,
  cleanupStaleGroups,
  cleanupStaleTabs,
  closeStrayStellaTabs,
} from "./commands/tabs.js";
import {
  handleCookiesGet,
  handleCookiesExportAll,
  regularCookieStoreIds,
  handleCookiesSet,
  handleCookiesClear,
} from "./commands/cookies.js";
import {
  handleBringToFront,
  handleTitle,
  handleUrl,
} from "./commands/tab-info.js";
import { handleDownload } from "./commands/downloads.js";
import {
  PIPE_HANDLERS,
  closePipe,
  detachLeftoverDebuggers,
} from "./commands/pipe.js";
import {
  handleProfileMark,
  handleProfileUnmark,
} from "./commands/profile-mark.js";
import { hideOwnerAgentCursors, legacyHandlers } from "./legacy/index.js";

const HANDLERS = {
  healthcheck: async (cmd) => ({ id: cmd.id, success: true, data: {} }),

  url: handleUrl,
  title: handleTitle,
  bringtofront: handleBringToFront,

  download: handleDownload,

  tab_new: handleTabNew,
  tab_list: handleTabList,
  tab_switch: handleTabSwitch,
  tab_close: handleTabClose,
  mark_tab: handleMarkTab,
  finalize_tabs: async (cmd) => {
    await hideOwnerAgentCursors(cmd);
    const data = await finalizeOwnerTabs(cmd);
    await releaseOwnerLease(cmd);
    return { id: cmd.id, success: true, data };
  },
  close_owner: async (cmd) => {
    await hideOwnerAgentCursors(cmd);
    const data = await finalizeOwnerTabs(cmd, []);
    await releaseOwnerLease(cmd);
    return { id: cmd.id, success: true, data };
  },
  release_owner_lease: async (cmd) => {
    await hideOwnerAgentCursors(cmd);
    await releaseOwnerLease(cmd);
    return { id: cmd.id, success: true, data: { released: true } };
  },

  cookies_get: handleCookiesGet,
  cookies_export_all: handleCookiesExportAll,
  cookies_set: handleCookiesSet,
  cookies_clear: handleCookiesClear,

  profile_mark: handleProfileMark,
  profile_unmark: handleProfileUnmark,
};

const LEGACY_HANDLERS = legacyHandlers(HANDLERS);

async function handleCommand(message) {
  const { action, id } = message;

  if (Object.hasOwn(PIPE_HANDLERS, action)) {
    try {
      const data = await PIPE_HANDLERS[action](message);
      return { type: "response", id, success: true, data };
    } catch (err) {
      return {
        type: "response",
        id,
        success: false,
        error: err.message || String(err),
      };
    }
  }

  if (action === "close") {
    if (typeof message.ownerId === "string" && message.ownerId.trim()) {
      await authorizeOwnerLease(message);
      const result = await finalizeOwnerTabs(message, []);
      await releaseOwnerLease(message);
      return { type: "response", id, success: true, data: result };
    }

    await closeAgentWindow();
    return { type: "response", id, success: true, data: { closed: true } };
  }

  if (action === "launch") {
    return {
      type: "response",
      id,
      success: true,
      data: { launched: true, provider: "extension" },
    };
  }

  const handler = HANDLERS[action] ?? LEGACY_HANDLERS[action];
  if (handler) {
    try {
      if (
        action !== "healthcheck" &&
        (message.ownerId || message.ownerLeaseId)
      ) {
        await authorizeOwnerLease(message);
      }
      const result = await handler(message);
      return { type: "response", ...result };
    } catch (err) {
      return {
        type: "response",
        id,
        success: false,
        error: err.message || String(err),
      };
    }
  }

  return {
    type: "response",
    id,
    success: false,
    error: `Command '${action}' is not supported in extension mode`,
  };
}

onCommand(handleCommand);

onStatus((connected) => {
  console.log(
    "[background] Connection status:",
    connected ? "connected" : "disconnected",
  );
  if (!connected) closePipe();
});
// Keep service worker alive via offscreen document port
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "keepalive") {
    // Port keeps the service worker alive - nothing else needed
  }
});

// Create offscreen document to maintain keepalive port
async function ensureOffscreen() {
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [chrome.runtime.getURL("offscreen.html")],
    });
    if (contexts.length === 0) {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["WORKERS"],
        justification: "Keep service worker alive for the browser bridge",
      });
      console.log("[background] Offscreen keepalive document created");
    }
  } catch (err) {
    console.error("[background] Failed to create offscreen document:", err);
  }
}

ensureOffscreen();

detachLeftoverDebuggers().catch(() => {});
cleanupStaleGroups();
cleanupStaleTabs();

chrome.alarms.create("stale-tabs", { periodInMinutes: 60 });
chrome.alarms.create("stray-tabs", { delayInMinutes: 1, periodInMinutes: 60 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "stale-tabs") {
    void cleanupStaleTabs();
  } else if (alarm.name === "stray-tabs") {
    void closeStrayStellaTabs().catch(() => {});
  }
});

const COOKIE_EVENT_DEBOUNCE_MS = 120;
const COOKIE_EVENT_MAX_BATCH = 200;
let pendingCookieChanges = [];
let cookieFlushTimer = null;

let regularStoreIds = null;

async function forwardableCookieChanges(changes) {
  if (!regularStoreIds) {
    regularStoreIds = await regularCookieStoreIds().catch(() => null);
  }
  const allowed = regularStoreIds;
  return allowed ? changes.filter((change) => allowed.has(change.cookie.storeId)) : [];
}

async function flushCookieChanges() {
  cookieFlushTimer = null;
  if (pendingCookieChanges.length === 0) return;
  if (!isConnected()) {
    pendingCookieChanges = [];
    return;
  }
  const changes = await forwardableCookieChanges(pendingCookieChanges.splice(0));
  if (changes.length === 0 || !isConnected()) return;
  send({ type: "event", event: "cookies_changed", changes });
}

function queueCookieChange(changeInfo) {
  const cookie = changeInfo?.cookie;
  if (!cookie || !cookie.name) return;
  pendingCookieChanges.push({
    removed: changeInfo.removed === true,
    cause: changeInfo.cause,
    cookie,
  });
  if (pendingCookieChanges.length >= COOKIE_EVENT_MAX_BATCH) {
    if (cookieFlushTimer) {
      clearTimeout(cookieFlushTimer);
      cookieFlushTimer = null;
    }
    void flushCookieChanges();
    return;
  }
  if (!cookieFlushTimer) {
    cookieFlushTimer = setTimeout(flushCookieChanges, COOKIE_EVENT_DEBOUNCE_MS);
  }
}

chrome.cookies.onChanged.addListener(queueCookieChange);

async function autoConnect() {
  console.log("[background] Auto-connecting via native messaging");
  connect();
}

autoConnect();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "connect") {
    connect();
    sendResponse({ ok: true });
  } else if (message.type === "disconnect") {
    disconnect();
    sendResponse({ ok: true });
  } else if (message.type === "getStatus") {
    sendResponse({ connected: isConnected() });
  }
});
