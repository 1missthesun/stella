import type {
  CloudExecutionSelection,
  LegacyCloudExecutionSelection,
} from "../agent-engine.js";

export const ENGINE_PROVIDERS = ["anthropic", "chatgpt"] as const;
export type EngineProvider = (typeof ENGINE_PROVIDERS)[number];

export type ClaudeLoginPlace =
  | { kind: "cloud"; active?: boolean; updatedAt: number }
  | {
      kind: "device";
      deviceId: string;
      deviceName?: string;
      isDefault?: boolean;
      active?: boolean;
      updatedAt: number;
    };

export type EngineConnection = {
  provider: EngineProvider;
  accountId: string;
  label: string;
  email?: string;
  plan?: string;
  name?: string;
  status?: "signed_out" | "reauth_required";
  planUsage?: boolean;
  clientId?: string;
  active: boolean;
  places?: ClaudeLoginPlace[];
  updatedAt: number;
};

export type ClaudeInUseReason = "selected" | "own_login" | "other_login";

export type ClaudePlaceStatus = {
  kind: "cloud" | "device";
  deviceId?: string;
  deviceName?: string;
  cliInstalled?: boolean;
  inUse: { accountId: string; email?: string; reason: ClaudeInUseReason } | null;
  ownLogin?: { accountId: string; email?: string };
  missingChosen: boolean;
  updatedAt: number;
};

export type ClaudeOverview = {
  chosenAccountId: string | null;
  places: ClaudePlaceStatus[];
};

export type ChatGptSharedRegistration = {
  clientId: string;
  email?: string;
  name?: string;
  updatedAt: number;
};

export type EngineSettings = {
  execution: LegacyCloudExecutionSelection;
  selection?: CloudExecutionSelection;
  selectedAt: number | null;
  connections: EngineConnection[];
  chatGptRegistrations: ChatGptSharedRegistration[];
  claude?: ClaudeOverview;
};

export const isEngineConnectionUsable = (connection: EngineConnection): boolean =>
  connection.provider === "anthropic"
    ? (connection.places ?? []).some((place) => place.kind === "cloud")
    : !connection.status && connection.planUsage !== false;

export type ClaudeLocalLogin = { email: string; plan?: string; isDefault?: boolean };

export type EngineCalls = {
  "engines.cancelConnect": {
    args: { connectId: string };
    result: null;
  };
  "engines.startConnect": {
    args: {
      provider: "chatgpt";
      redirectPort?: number;
      accountId?: string;
      clientId?: string;
      enablePlanUsage?: boolean;
    };
    result: { connectId: string; authorizeUrl: string; redirectUri: string };
  };
  "engines.finishConnect": {
    args: { connectId: string; pastedInput: string };
    result: { accountId: string; planUsage: boolean };
  };
  "engines.shareChatGptRegistration": {
    args: { clientId: string; email?: string; name?: string };
    result: null;
  };
  "engines.reportClaudeLogins": {
    args: {
      deviceId: string;
      deviceName?: string;
      logins: ClaudeLocalLogin[];
      cliInstalled?: boolean;
    };
    result: null;
  };
  "engines.chooseClaudeAccount": {
    args: { accountId?: string };
    result: null;
  };
  "engines.startClaudeDeviceLogin": {
    args: { deviceId: string; email?: string };
    result: { loginId: string; authorizeUrl: string };
  };
  "engines.finishClaudeDeviceLogin": {
    args: { deviceId: string; loginId: string; code: string };
    result: { email?: string };
  };
  "engines.cancelClaudeDeviceLogin": {
    args: { deviceId: string; loginId: string };
    result: null;
  };
  "engines.startClaudeCloudLogin": {
    args: { email?: string };
    result: { loginId: string; authorizeUrl: string };
  };
  "engines.finishClaudeCloudLogin": {
    args: { loginId: string; code: string };
    result: { accountId: string; email: string };
  };
  "engines.cancelClaudeCloudLogin": {
    args: { loginId: string };
    result: null;
  };
  "engines.signOutClaudeCloud": {
    args: { accountId: string };
    result: null;
  };
  "engines.disconnect": {
    args: { provider: EngineProvider; accountId?: string; forget?: boolean };
    result: { revoked: boolean } | null;
  };
  "engines.setActiveAccount": {
    args: { provider: EngineProvider; accountId: string; deviceId?: string };
    result: null;
  };
  "engines.setExecution": {
    args: { execution: CloudExecutionSelection };
    result: null;
  };
  "engines.listModels": {
    args: { provider: "chatgpt" };
    result: { models: Array<{ id: string; name: string }> } | null;
  };
};

export type EngineViews = {
  "engines.get": { args: Record<string, never>; result: EngineSettings };
};
