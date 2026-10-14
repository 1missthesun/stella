export const ACCOUNT_PROVIDER_IDS = [
  "anthropic",
  "openai",
  "google",
  "openrouter",
  "github-copilot",
  "xai",
  "meta",
  "kimi-coding",
  "zai",
  "cerebras",
  "vercel-ai-gateway",
  "opencode",
] as const;

export type AccountProviderId = (typeof ACCOUNT_PROVIDER_IDS)[number];

export const isAccountProviderId = (value: unknown): value is AccountProviderId =>
  typeof value === "string" && (ACCOUNT_PROVIDER_IDS as readonly string[]).includes(value);

export type ProviderAuthMethod =
  | {
      kind: "api_key";
      placeholder: string;
      keyUrl?: string;
    }
  | {
      kind: "oauth";
      flow: "device_code" | "redirect_paste";
      label: string;
      subscription?: boolean;
    };

export type ProviderConnection = {
  method: "api_key" | "oauth";
  status: "ok" | "invalid" | "reauth_required";
  label: string;
  last4?: string;
  checkedAt?: number;
  updatedAt: number;
};

export type AccountProvider = {
  id: string;
  label: string;
  authMethods: ProviderAuthMethod[];
  connection: ProviderConnection | null;
};

export type ProviderSettings = {
  providers: AccountProvider[];
};

export type ProviderModel = {
  id: string;
  name: string;
  reasoning: boolean;
  supportsImages: boolean;
  contextWindow?: number;
};

export type ProviderOAuthFlow = {
  flowId: string;
  provider: string;
  status: "pending" | "complete" | "failed" | "expired";
  step?:
    | {
        kind: "device_code";
        userCode: string;
        verificationUri: string;
        intervalMs: number;
      }
    | {
        kind: "open_url";
        url: string;
        instructions?: string;
      }
    | {
        kind: "working";
        message?: string;
      };
  error?: string;
  expiresAt: number;
};

export type ProviderCalls = {
  "providers.setApiKey": {
    args: { provider: string; apiKey: string };
    result: { connection: ProviderConnection };
  };
  "providers.remove": {
    args: { provider: string };
    result: null;
  };
  "providers.startOAuth": {
    args: { provider: string };
    result: ProviderOAuthFlow;
  };
  "providers.finishOAuth": {
    args: { flowId: string; input?: string };
    result: ProviderOAuthFlow;
  };
  "providers.cancelOAuth": {
    args: { flowId: string };
    result: null;
  };
  "providers.listModels": {
    args: { provider: string };
    result: { models: ProviderModel[] };
  };
};

export type ProviderViews = {
  "providers.get": { args: Record<string, never>; result: ProviderSettings };
};

export const PROVIDER_OAUTH_CALLBACK_PATH = "/api/providers/oauth/callback";
