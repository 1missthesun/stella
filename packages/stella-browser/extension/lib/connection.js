import { STELLA_NATIVE_HOST_NAME } from "./native-host-name.js";

/** Must match the daemon's bridge port (STELLA_BROWSER_BRIDGE_PORT / DEFAULT_EXT_PORT). */
const BRIDGE_HEALTH_URL = "http://127.0.0.1:39040/healthz";
const PROBE_INTERVAL = 4000;
const MAX_PROBE_INTERVAL = 30000;
const PROBE_TIMEOUT = 1500;
const EXTENSION_PROTOCOL_VERSION = "2.1";

let nativePort = null;
let probeTimer = null;
const probesInFlight = new Set();
let commandHandler = null;
let statusCallback = null;
let shouldConnect = false;
let connectionGeneration = 0;
let failedAttaches = 0;

/**
 * Set the handler for incoming commands from the daemon.
 * @param {(command: object) => Promise<object>} handler
 */
export function onCommand(handler) {
  commandHandler = handler;
}

/**
 * Set the callback for connection status changes.
 * @param {(connected: boolean) => void} callback
 */
export function onStatus(callback) {
  statusCallback = callback;
}

export function connect() {
  if (
    shouldConnect &&
    (isConnected() || probesInFlight.has(connectionGeneration))
  ) {
    return;
  }
  shouldConnect = true;
  const generation = ++connectionGeneration;
  probeThenConnect(generation);
}

export function disconnect() {
  shouldConnect = false;
  connectionGeneration += 1;
  clearTimeout(probeTimer);
  probeTimer = null;
  const port = nativePort;
  nativePort = null;
  if (port) {
    try {
      port.disconnect();
    } catch {
      // ignore
    }
  }
  setStatus(false);
}

/**
 * @returns {boolean}
 */
export function isConnected() {
  return nativePort !== null;
}

/**
 * @param {object} message
 */
export function send(message) {
  if (nativePort) {
    try {
      nativePort.postMessage(message);
    } catch {
      // ignore
    }
  }
}

/**
 * Check whether the Stella daemon is listening on the bridge port. A 204 means
 * up and a refused connection means down. Chrome's Local Network Access check
 * can hold a service worker's loopback fetch with no prompt to answer, so a
 * probe that times out is unknown, not down: the native host then finds out.
 * @returns {Promise<"up" | "down" | "unknown">}
 */
async function probeDaemon() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT);
  try {
    const response = await fetch(BRIDGE_HEALTH_URL, {
      signal: controller.signal,
      cache: "no-store",
    });
    return response.status === 204 ? "up" : "down";
  } catch (error) {
    return error?.name === "AbortError" ? "unknown" : "down";
  } finally {
    clearTimeout(timer);
  }
}

async function probeThenConnect(generation = connectionGeneration) {
  if (
    !shouldConnect ||
    generation !== connectionGeneration ||
    probesInFlight.has(generation) ||
    isConnected()
  ) {
    return;
  }
  clearTimeout(probeTimer);
  probeTimer = null;

  probesInFlight.add(generation);
  let state = "down";
  try {
    state = await probeDaemon();
  } finally {
    probesInFlight.delete(generation);
  }

  if (!shouldConnect || generation !== connectionGeneration || isConnected())
    return;
  if (state !== "down") {
    doConnect(generation);
    return;
  }
  scheduleProbe(generation);
}

function scheduleProbe(generation = connectionGeneration) {
  if (!shouldConnect || generation !== connectionGeneration) return;
  clearTimeout(probeTimer);
  const delay = Math.min(PROBE_INTERVAL * 2 ** failedAttaches, MAX_PROBE_INTERVAL);
  probeTimer = setTimeout(() => {
    probeTimer = null;
    probeThenConnect(generation);
  }, delay);
}

function doConnect(generation) {
  if (!shouldConnect || generation !== connectionGeneration || nativePort)
    return;

  let port;
  try {
    port = chrome.runtime.connectNative(STELLA_NATIVE_HOST_NAME);
  } catch (err) {
    console.error("[connection] connectNative failed:", err);
    scheduleProbe(generation);
    return;
  }

  if (!shouldConnect || generation !== connectionGeneration) {
    try {
      port.disconnect();
    } catch {
      // ignore
    }
    return;
  }
  nativePort = port;
  let welcomed = false;

  port.onMessage.addListener(async (msg) => {
    if (generation !== connectionGeneration || nativePort !== port) return;

    if (msg.type === "welcome") {
      console.log("[connection] Authenticated, session:", msg.session);
      welcomed = true;
      failedAttaches = 0;
      setStatus(true);
      return;
    }

    if (msg.type === "pong") {
      return;
    }

    if (msg.type === "auth_error") {
      console.error("[connection] Auth failed:", msg.error);
      setStatus(false);
      return;
    }

    if (msg.type === "command" && welcomed && commandHandler) {
      try {
        const response = await commandHandler(msg);
        if (generation === connectionGeneration && nativePort === port) {
          port.postMessage(response);
        }
      } catch (err) {
        if (generation === connectionGeneration && nativePort === port) {
          port.postMessage({
            type: "response",
            id: msg.id,
            success: false,
            error: err.message || String(err),
          });
        }
      }
    }
  });

  port.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError;
    if (err?.message) {
      console.error("[connection] Native port disconnected:", err.message);
    }
    const wasActive =
      generation === connectionGeneration && nativePort === port;
    if (!wasActive) return;

    nativePort = null;
    setStatus(false);
    if (welcomed) {
      // A working link dropped (daemon restart, host crash): reattach at
      // once; the host itself waits briefly for the daemon to come back.
      doConnect(generation);
      return;
    }
    failedAttaches = Math.min(failedAttaches + 1, 4);
    scheduleProbe(generation);
  });

  const extensionVersion = chrome.runtime.getManifest().version;
  port.postMessage({
    type: "hello",
    version: extensionVersion,
    extensionVersion,
    protocolVersion: EXTENSION_PROTOCOL_VERSION,
    token: "",
  });
}

function setStatus(connected) {
  chrome.action.setBadgeText({ text: "" });

  if (statusCallback) {
    statusCallback(connected);
  }
}

chrome.alarms.create("keepalive", { periodInMinutes: 0.5 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "keepalive") {
    if (isConnected()) {
      send({ type: "ping" });
    } else {
      if (shouldConnect) probeThenConnect(connectionGeneration);
    }
  }
});
