export const MAX_BROWSER_CHAIN_STEPS = 100;
export const MAX_BROWSER_CHAIN_TIMEOUT_MS = 4 * 60_000;
export const MAX_BROWSER_CHAIN_WAIT_TIMEOUT_MS = 120_000;
export const DEFAULT_BROWSER_CHAIN_DELAY_MIN_MS = 300;
export const DEFAULT_BROWSER_CHAIN_DELAY_MAX_MS = 1_200;

export const WORKER_BOUND_BACKEND_PARAM = "__stellaBrowserBackend";

// Mirrors packages/stella-browser/protocol/actions.json ("chain": true):
// adding, removing, or renaming an entry needs the manifest and the Rust
// daemon (is_chain_allowed_action) to agree.
export const BROWSER_CHAIN_ACTIONS = [
  "healthcheck",
  "navigate",
  "back",
  "forward",
  "reload",
  "url",
  "title",
  "click",
  "fill",
  "type",
  "hover",
  "select",
  "press",
  "scroll",
  "clear",
  "check",
  "uncheck",
  "focus",
  "dblclick",
  "wait",
  "screenshot",
  "snapshot",
  "content",
  "evaluate",
  "gettext",
  "getattribute",
  "innertext",
  "innerhtml",
  "inputvalue",
  "boundingbox",
  "scrollintoview",
  "isvisible",
  "isenabled",
  "ischecked",
  "count",
  "styles",
  "waitforurl",
  "waitforfunction",
  "bringtofront",
  "requests",
  "responsebody",
  "route",
  "unroute",
  "har_start",
  "har_stop",
  "clipboard",
  "mousemove",
  "mousedown",
  "mouseup",
  "drag",
  "keydown",
  "keyup",
  "inserttext",
  "tab_new",
  "tab_list",
  "tab_switch",
  "tab_close",
  "cookies_get",
  "cookies_set",
  "cookies_clear",
  "upload",
] as const;

export const BROWSER_PROTOCOL_ACTIONS = [
  ...BROWSER_CHAIN_ACTIONS,
  "authenticated_request",
  "authenticated_request_batch",
  "evaluate_detached",
  "rewrite_request",
  "unrewrite_request",
  "mark_tab",
  "finalize_tabs",
  "close_owner",
  "release_owner_lease",
] as const;

export type BrowserChainAction = (typeof BROWSER_CHAIN_ACTIONS)[number];
export type BrowserProtocolAction = (typeof BROWSER_PROTOCOL_ACTIONS)[number];
export type BrowserSessionAction = BrowserProtocolAction;

export const requirePositiveInteger = (
  value: unknown,
  name: string,
): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer.`);
  }
  return value;
};

export const requireNonNegativeInteger = (
  value: unknown,
  name: string,
): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer.`);
  }
  return value;
};
