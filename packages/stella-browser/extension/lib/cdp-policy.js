/**
 * Debugger methods the service may not send, even to a tab its owner holds:
 * they reach beyond the tab. The list is Playwright's extension's
 * (packages/extension/src/cdpPolicy.ts, Apache-2.0) plus the remaining methods
 * that read, clear or attach outside it.
 */
const BLOCKED_METHODS = new Set([
  "Storage.setCookies",
  "Storage.clearCookies",
  "Network.clearBrowserCookies",
  "Network.clearBrowserCache",
  "Browser.grantPermissions",
  "Browser.resetPermissions",
  "Browser.setPermission",
  "Browser.setDownloadBehavior",
  "Target.createTarget",
  "Target.closeTarget",
  "Target.attachToTarget",
  "Target.activateTarget",

  "Storage.getCookies",
  "Network.getAllCookies",
  "Target.attachToBrowserTarget",
  "Target.autoAttachRelated",
  "Target.createBrowserContext",
  "Target.disposeBrowserContext",
  "Target.exposeDevToolsProtocol",
  "Target.getTargets",
  "Target.sendMessageToTarget",
  "Target.setDiscoverTargets",
  "Target.setRemoteLocations",
]);

export function assertAllowedMethod(method, params) {
  if (typeof method !== "string" || !/^[A-Z][A-Za-z]*\.[a-z][A-Za-z]*$/.test(method)) {
    throw new Error("Invalid debugger method");
  }
  if (BLOCKED_METHODS.has(method)) {
    throw new Error(`${method} is not allowed through the Stella Browser extension`);
  }
  if (
    method === "Target.setAutoAttach" &&
    params?.autoAttach === true &&
    (params.flatten !== true || params.waitForDebuggerOnStart === true)
  ) {
    throw new Error("Target.setAutoAttach must be flat and must not pause targets");
  }
}
