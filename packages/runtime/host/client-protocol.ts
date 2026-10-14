export const RUNTIME_HOST_CALLS = [
  "health",
  "healthCheck",
  "configure",
  "ensureWorkerStarted",
  "requestRuntimeRestart",
  "listModels",
  "sendAgentInput",
  "piChat",
  "runAutomationTurn",
  "createBackgroundAgent",
  "persistVoiceTranscript",
  "voiceOrchestratorChat",
  "voiceOrchestratorConfig",
  "voiceExecuteTool",
  "webSearch",
  "runOneShotCompletion",
  "listCronJobs",
  "listHeartbeats",
  "runCronJob",
  "removeCronJob",
  "updateCronJob",
  "upsertHeartbeat",
  "runHeartbeat",
  "listConversationEvents",
  "killAllShells",
  "collectAllSignals",
  "writeCoreMemory",
  "detectPreferredBrowserProfile",
  "listBrowserProfiles",
  "googleWorkspaceGetAuthStatus",
  "googleWorkspaceConnect",
  "googleWorkspaceDisconnect",
  "answerRemoteExecutionRequest",
] as const;

export type RuntimeHostCall = (typeof RUNTIME_HOST_CALLS)[number];

const callable = new Set<string>(RUNTIME_HOST_CALLS);

export const isRuntimeHostCall = (name: unknown): name is RuntimeHostCall =>
  typeof name === "string" && callable.has(name);

export const RUNTIME_HOST_HANDLERS = [
  "getActiveConversationId",
  "getDeviceIdentity",
  "clearSupersededDeviceId",
  "signDeviceInput",
  "requestRuntimeAuthRefresh",
  "getChallengeToken",
  "getScheduleScriptAuth",
  "askUser",
  "requestSecureInput",
  "useSecureValue",
  "getSecureValueFingerprints",
  "revealSecureValueForFill",
  "cancelUserAsk",
  "requestLlmCredentials",
  "requestConnectorTokenStore",
  "requestConnectorCredential",
  "requestConnectorConnection",
  "cancelConnectorConnection",
  "requestBrowserExtensionConnect",
  "displayUpdate",
  "showNotification",
  "requestDesktopPermission",
  "notifyRemoteExecutionRequest",
  "setExecutionTarget",
  "serveDeviceRequest",
  "spawnAutomationDaemon",
  "openExternal",
  "showWindow",
  "focusWindow",
] as const;

export type RuntimeHostHandler = (typeof RUNTIME_HOST_HANDLERS)[number];

const handlers = new Set<string>(RUNTIME_HOST_HANDLERS);

export const isRuntimeHostHandler = (
  name: unknown,
): name is RuntimeHostHandler => typeof name === "string" && handlers.has(name);

export const RUNTIME_SERVER_MISMATCH = "runtime-server-mismatch";
export const RUNTIME_ATTACHMENT_STALE = "runtime-attachment-stale";

export type RuntimeAttachFence = {
  attachmentId?: string;
  expectedServerId?: string;
  expectedRootHash?: string;
};

export type FencedRuntimeAttachResult = {
  pid: number;
  hostCreated: boolean;
  serverId?: string;
  attachmentId?: string;
};

export type FencedRuntimeEventParams = {
  name: string;
  payload: unknown;
  attachmentId?: string;
};

export type FencedRuntimeHostHandlerParams = {
  name: string;
  args: unknown[];
  attachmentId?: string;
};

export type FencedRuntimeCallParams = {
  method: string;
  args: unknown[];
  attachmentId?: string;
};

const MAX_ATTACHMENT_ID_LENGTH = 128;

export const readAttachmentId = (value: unknown): string | undefined =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= MAX_ATTACHMENT_ID_LENGTH
    ? value
    : undefined;
