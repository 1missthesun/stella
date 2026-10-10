/**
 * Account-wide LLM provider credentials ("bring your own key", kept on the
 * account): API keys and provider sign-ins saved once and used by the cloud
 * and by every one of the owner's computers that has no key of its own for
 * that provider.
 *
 * Secrets never come back to a client. The server keeps them encrypted and
 * hands them only to the model gateway's BYOK lane, which puts them on the
 * owner's requests to the provider; a client sees a label, the key's last
 * four characters and a status.
 *
 * The catalog is the server's: `providers.get` lists every provider an
 * account can connect, each with the ways it can be connected, so a client
 * renders it without a list of its own. Provider ids are pi-ai's (the same
 * keys the desktop uses for its local keys), so a selection names the same
 * provider everywhere.
 *
 * Choosing one of these models for the account is `engines.setExecution` with
 * `{ engine: "provider", provider, model, reasoningEffort }`
 * (`CloudExecutionSelection` in `@stella/contracts/agent-engine`).
 *
 * Sign-ins run on the server and fit a phone:
 * - `device_code`: `providers.startOAuth` returns a code and a page to enter
 *   it on; the client then calls `providers.finishOAuth` without input every
 *   `intervalMs` until the flow is `complete` or `failed`.
 * - `redirect_paste`: `providers.startOAuth` returns a page to open; the
 *   provider sends the browser to a page that shows a code (or the client's
 *   web-auth session catches the redirect); `providers.finishOAuth` takes
 *   that code or the whole URL.
 * A flow lives on the server for at most `expiresAt`; one left idle for a few
 * minutes may be dropped and reads as `expired` (start it again).
 */

/** Every provider an account can keep a credential for (pi-ai ids), in display order. */
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
      /** Shown in the empty key field, e.g. "sk-or-...". */
      placeholder: string;
      /** Where the user creates a key. */
      keyUrl?: string;
    }
  | {
      kind: "oauth";
      flow: "device_code" | "redirect_paste";
      /** Button text, e.g. "Sign in with GitHub". */
      label: string;
      /** True when the sign-in uses a paid plan rather than per-token billing. */
      subscription?: boolean;
    };

/**
 * The saved credential. `ok`: it worked when checked (or there is no cheap
 * check for this provider: `checkedAt` is absent). `invalid`: the provider
 * refused the key. `reauth_required`: a sign-in ended; connect again.
 */
export type ProviderConnection = {
  method: "api_key" | "oauth";
  status: "ok" | "invalid" | "reauth_required";
  /** e.g. "API key ending 1a2b" or "GitHub Copilot". */
  label: string;
  /** API keys: the last four characters. */
  last4?: string;
  /** When the provider last confirmed the credential; absent if never checked. */
  checkedAt?: number;
  updatedAt: number;
};

export type AccountProvider = {
  /** pi-ai provider id, e.g. "openrouter", "github-copilot". */
  id: string;
  label: string;
  /** In the order a client should offer them. */
  authMethods: ProviderAuthMethod[];
  connection: ProviderConnection | null;
};

export type ProviderSettings = {
  /** Every provider an account can connect, in display order. */
  providers: AccountProvider[];
};

export type ProviderModel = {
  /** The id `engines.setExecution` takes as `model`. */
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
  /** What the user does next, while `pending`. */
  step?:
    | {
        kind: "device_code";
        userCode: string;
        /** Open this and enter `userCode`. */
        verificationUri: string;
        /** Poll `providers.finishOAuth` this often. */
        intervalMs: number;
      }
    | {
        kind: "open_url";
        url: string;
        /** The code or URL the provider shows afterwards goes to `providers.finishOAuth`. */
        instructions?: string;
      }
    | {
        /** The server is finishing the sign-in; poll again. */
        kind: "working";
        message?: string;
      };
  /** Why a `failed` flow failed. */
  error?: string;
  expiresAt: number;
};

export type ProviderCalls = {
  /**
   * Save (or replace) the provider's API key. Checked against the provider
   * when it offers a cheap check; a key the provider refuses is not saved
   * (BAD_REQUEST, reason `invalid_api_key`). Replaces a sign-in for the same
   * provider.
   */
  "providers.setApiKey": {
    args: { provider: string; apiKey: string };
    result: { connection: ProviderConnection };
  };
  /**
   * Forget the provider's credential. A selection on it falls back to
   * Stella's default model.
   */
  "providers.remove": {
    args: { provider: string };
    result: null;
  };
  /** Begin a sign-in (`authMethods` with `kind: "oauth"`). */
  "providers.startOAuth": {
    args: { provider: string };
    result: ProviderOAuthFlow;
  };
  /**
   * Advance a sign-in: with `input` (the pasted code or redirect URL) for
   * `open_url`, without it to poll a `device_code` or `working` flow.
   */
  "providers.finishOAuth": {
    args: { flowId: string; input?: string };
    result: ProviderOAuthFlow;
  };
  "providers.cancelOAuth": {
    args: { flowId: string };
    result: null;
  };
  /**
   * The models a connected provider can run for this account (for GitHub
   * Copilot, the ones its plan enables). NOT_FOUND when not connected.
   */
  "providers.listModels": {
    args: { provider: string };
    result: { models: ProviderModel[] };
  };
};

export type ProviderViews = {
  "providers.get": { args: Record<string, never>; result: ProviderSettings };
};

/**
 * Where a `redirect_paste` sign-in lands on the backend's origin: a page
 * that shows the code to paste. A client that opens the sign-in in a
 * web-auth session can catch this redirect and pass its URL to
 * `providers.finishOAuth` itself.
 */
export const PROVIDER_OAUTH_CALLBACK_PATH = "/api/providers/oauth/callback";
