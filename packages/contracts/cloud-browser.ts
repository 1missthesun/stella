export const CLOUD_BROWSER_INTERACTION_KINDS = [
  "login_takeover",
  "device_code",
] as const;

export type CloudBrowserInteractionKind =
  (typeof CLOUD_BROWSER_INTERACTION_KINDS)[number];

export const CLOUD_BROWSER_INTERACTION_STATES = [
  "pending",
  "human_control",
  "resuming",
  "completed",
  "canceled",
  "expired",
  "failed",
] as const;

export type CloudBrowserInteractionState =
  (typeof CLOUD_BROWSER_INTERACTION_STATES)[number];

export type CloudBrowserInteractionDecision = "done" | "cancel";

export type CloudBrowserInteractionSummary = Readonly<{
  schemaVersion: 1;
  interactionId: string;
  conversationId: string;
  threadId: string;
  turnId: string;
  kind: CloudBrowserInteractionKind;
  state: CloudBrowserInteractionState;
  displayOrigin: string;
  displayTitle?: string;
  revision: number;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
}>;

export type CloudBrowserLoginTakeoverDetail = CloudBrowserInteractionSummary &
  Readonly<{
    kind: "login_takeover";
    loginUrl: string;
  }>;

export type CloudBrowserDeviceCodeDetail = CloudBrowserInteractionSummary &
  Readonly<{
    kind: "device_code";
    verificationUri: string;
    verificationUriComplete?: string;
    userCode: string;
  }>;

export type CloudBrowserInteractionDetail =
  CloudBrowserLoginTakeoverDetail | CloudBrowserDeviceCodeDetail;

export type CloudBrowserLiveViewViewport = Readonly<{
  width: number;
  height: number;
}>;

const LIVE_VIEW_TOOLBAR_HEIGHT = 50;
const LIVE_VIEW_WIDTH = { min: 320, max: 1920 } as const;
const LIVE_VIEW_HEIGHT = { min: 320, max: 1600 } as const;

/**
 * The remote tab size that fills a Live View frame of this size. Live View
 * draws the tab 1:1 under its own toolbar and crops anything larger.
 */
export const cloudBrowserLiveViewViewport = (
  frameWidth: number,
  frameHeight: number,
): CloudBrowserLiveViewViewport | undefined => {
  if (!Number.isFinite(frameWidth) || !Number.isFinite(frameHeight)) {
    return undefined;
  }
  const clamp = (value: number, range: { min: number; max: number }) =>
    Math.min(range.max, Math.max(range.min, Math.floor(value)));
  if (frameWidth <= 0 || frameHeight <= LIVE_VIEW_TOOLBAR_HEIGHT) return undefined;
  return {
    width: clamp(frameWidth, LIVE_VIEW_WIDTH),
    height: clamp(frameHeight - LIVE_VIEW_TOOLBAR_HEIGHT, LIVE_VIEW_HEIGHT),
  };
};

export type CloudBrowserLiveViewCapability = Readonly<{
  schemaVersion: 1;
  interactionId: string;
  revision: number;
  url: string;
  expiresAt: number;
}>;

export const CLOUD_BROWSER_SESSION_TRANSFER_ALGORITHM =
  "x25519-hkdf-sha256-aes-256-gcm-v1" as const;

export type CloudBrowserSessionTransferCapability = Readonly<{
  schemaVersion: 1;
  algorithm: typeof CLOUD_BROWSER_SESSION_TRANSFER_ALGORITHM;
  capabilityId: string;
  interactionId: string;
  revision: number;
  publicKey: string;
  expiresAt: number;
}>;

export type CloudBrowserEncryptedSessionTransfer = Readonly<{
  schemaVersion: 1;
  algorithm: typeof CLOUD_BROWSER_SESSION_TRANSFER_ALGORITHM;
  capabilityId: string;
  clientPublicKey: string;
  iv: string;
  ciphertext: string;
}>;

export type CloudBrowserSuspension = Readonly<{
  schemaVersion: 1;
  outcome: "waiting_for_user";
  interactionId: string;
  interactionRevision: number;
  interactionKind: CloudBrowserInteractionKind;
  toolCallId: string;
  requestDigest: string;
  profileId: string;
  profileEpoch: number;
  displayOrigin: string;
  displayTitle?: string;
  expiresAt: number;
}>;

const hasOnlyKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean => {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
};

const isBoundedString = (
  value: unknown,
  maxBytes: number,
  allowEmpty = false,
): value is string =>
  typeof value === "string" &&
  (allowEmpty || value.length > 0) &&
  new TextEncoder().encode(value).byteLength <= maxBytes;

const isDisplayOrigin = (value: unknown): value is string => {
  if (!isBoundedString(value, 2_048)) return false;
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      !parsed.username &&
      !parsed.password &&
      value === parsed.origin
    );
  } catch {
    return false;
  }
};

export const isCloudBrowserSuspension = (
  value: unknown,
): value is CloudBrowserSuspension => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    hasOnlyKeys(candidate, [
      "schemaVersion",
      "outcome",
      "interactionId",
      "interactionRevision",
      "interactionKind",
      "toolCallId",
      "requestDigest",
      "profileId",
      "profileEpoch",
      "displayOrigin",
      "displayTitle",
      "expiresAt",
    ]) &&
    candidate.schemaVersion === 1 &&
    candidate.outcome === "waiting_for_user" &&
    isBoundedString(candidate.interactionId, 256) &&
    Number.isSafeInteger(candidate.interactionRevision) &&
    (candidate.interactionRevision as number) >= 1 &&
    CLOUD_BROWSER_INTERACTION_KINDS.includes(
      candidate.interactionKind as CloudBrowserInteractionKind,
    ) &&
    isBoundedString(candidate.toolCallId, 256) &&
    typeof candidate.requestDigest === "string" &&
    /^[a-f0-9]{64}$/.test(candidate.requestDigest) &&
    candidate.profileId === "default" &&
    Number.isSafeInteger(candidate.profileEpoch) &&
    (candidate.profileEpoch as number) >= 1 &&
    isDisplayOrigin(candidate.displayOrigin) &&
    (candidate.displayTitle === undefined ||
      isBoundedString(candidate.displayTitle, 256, true)) &&
    Number.isSafeInteger(candidate.expiresAt) &&
    (candidate.expiresAt as number) > 0
  );
};

export type CloudBrowserCommandRequest = Readonly<{
  schemaVersion: 1;
  requestId: string;
  action: string;
  params: Readonly<Record<string, unknown>>;
}>;

export type CloudBrowserResumeReceipt = Readonly<{
  schemaVersion: 1;
  interactionId: string;
  interactionRevision: number;
  profileId: string;
  profileEpoch: number;
  toolCallId: string;
  requestDigest: string;
  result: "approved" | "canceled" | "expired" | "failed";
  safeMessage: string;
}>;

export const CLOUD_BROWSER_METHODS = [
  "open",
  "navigate",
  "observe",
  "click",
  "fill",
  "press",
  "select",
  "wait",
  "tabs",
  "focusTab",
  "back",
  "forward",
  "reload",
  "hover",
  "scroll",
  "check",
  "uncheck",
  "text",
  "screenshot",
  "evaluate",
  "cookies",
  "setCookies",
  "clearCookies",
  "requests",
  "responseBody",
  "close",
  "requestLoginTakeover",
  "requestDeviceCodeFixture",
] as const;

export type CloudBrowserMethod = (typeof CLOUD_BROWSER_METHODS)[number];

/** Methods that hand the browser to the user and wait until they finish. */
export const CLOUD_BROWSER_HANDOFF_METHODS: ReadonlySet<string> = new Set<CloudBrowserMethod>([
  "requestLoginTakeover",
  "requestDeviceCodeFixture",
]);

/** How a sign-in handed to the user ended. */
export type CloudBrowserHandoffResult = "approved" | "canceled" | "expired" | "failed";

/**
 * The `browser` global of a cloud agent's `code`, for its tool description.
 * `screenshots` says where a screenshot goes; `handoffEnd` what the agent
 * sees once the user finishes a sign-in.
 */
export const cloudBrowserCodeSentence = (options: {
  screenshots: string;
  handoffEnd: string;
}): string =>
  `browser drives Stella's private cloud browser (one persistent signed-in profile, kept between turns; it is not the user's own browser). Each method is one awaited command. browser.open(url, { allowedOrigins? }) starts at an https URL and limits navigation to its origin plus allowedOrigins. browser.open, navigate(url), observe(), back(), forward(), and reload() return { url, title, text, elements }: text is the page's visible text, and elements lists the visible controls as { ref, role, name, selector?, href?, checked?, disabled?, sensitive? } (sensitive marks password, email, code, and card fields). Selectors are Playwright selectors (CSS, text=, role=, xpath=, chains) or ref=eN from the latest observation; refs change after navigation, so observe again. Actions: click(selector), fill(selector, value), press(selector, key), select(selector, value), check(selector), uncheck(selector), hover(selector), text(selector), wait(selector, timeoutMs?), and scroll({ direction?, amount?, selector? }). browser.evaluate(script, arg?) runs a JavaScript expression, or a function source string called with arg, in the page and returns its JSON result (use it for DOM reads, localStorage, or same-origin fetch with the page's session). browser.cookies(urls?), setCookies(cookies), and clearCookies() manage the profile's cookies. browser.requests({ limit? }) lists recent network requests and responseBody(url) returns one response's body. browser.screenshot({ fullPage? }) ${options.screenshots}. Also tabs(), focusTab(tabId), and close(). For signing in, hand the login to the user: call browser.requestLoginTakeover({ allowedOrigins: [origin], displayOrigin: origin, startUrl?, displayTitle?, verification: { expectedOrigin: origin, authenticatedSelector, loggedOutSelector, resumeUrl } }) with one exact https origin everywhere. loggedOutSelector names something visible now only when signed out; authenticatedSelector names something that appears only once signed in (such as text=Sign out); they must differ and cannot be refs. It shows the login screen to the user on their phone or desktop and waits until they finish. ${options.handoffEnd} Type a password or card number yourself only when the user gave it to you in this conversation.`;
