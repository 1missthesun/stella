/**
 * Engine accounts: the owner's Claude (Pro/Max) and ChatGPT subscriptions,
 * plus the account-wide cloud execution selection every client picker reads
 * and writes.
 *
 * Claude: Stella never holds a Claude credential. Every place that runs
 * Claude (each of the owner's computers, and the owner's cloud container)
 * runs the real `claude` CLI on that CLI's own login. Signing in is always
 * the CLI's own `claude auth login`, against Anthropic's own page; the code
 * Anthropic shows is pasted back into that CLI. This list keeps only
 * identities (email, plan) and, per account, the places where a Claude Code
 * login for it exists (`places`). The owner makes one choice for every place
 * (`claude.chosenAccountId`, or none for "each computer's own login"). Each
 * place (the cloud, each computer) runs the chosen account while it holds a
 * login for it, else its Claude Code default login, else its oldest
 * (`places[].active`, explained per place in `claude.places`).
 *
 * - A computer reports the logins its Claude Code configs hold
 *   (`engines.reportClaudeLogins`), which adds their identities here.
 * - Another computer signs in remotely: `engines.startClaudeDeviceLogin`
 *   asks that computer (over its presence socket) to start its own
 *   `claude auth login` and returns Anthropic's sign-in URL to the asking
 *   client; `engines.finishClaudeDeviceLogin` hands the pasted code to that
 *   CLI. Nothing is stored on the way.
 * - The cloud signs in inside the owner's container:
 *   `engines.startClaudeCloudLogin` starts `claude auth login` there and
 *   returns Anthropic's sign-in URL; `engines.finishClaudeCloudLogin` hands
 *   the code the user pasted to that CLI. The credential stays in the
 *   container's own disk state.
 *
 * ChatGPT follows Sign in with ChatGPT for open-source apps
 * (`@stella/contracts/chatgpt-siwc`). Every install is its own agent host
 * with its own ChatGPT sign-ins (kept on that computer, never here); the
 * owner's cloud is one more host, with its own persisted host id in this
 * store. One issued client id can be reused by every host of the same user
 * and workspace, each with its own host id, so the hosts share plan usage
 * settings and limits: hosts publish the issued client ids they registered
 * (`engines.shareChatGptRegistration`, identifiers only, never tokens) and
 * another host signs in with one of them instead of registering again.
 *
 * Each provider can hold several accounts; the user picks the active one.
 * A usage limit is reported to the user and never switches accounts.
 */

import type {
  CloudExecutionSelection,
  LegacyCloudExecutionSelection,
} from "../agent-engine.js";

export const ENGINE_PROVIDERS = ["anthropic", "chatgpt"] as const;
export type EngineProvider = (typeof ENGINE_PROVIDERS)[number];

/** Where a Claude Code login for an account exists. */
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

/** One connected account of a provider. */
export type EngineConnection = {
  provider: EngineProvider;
  /** Stella's id for this account; stable across sign-ins of the same login. */
  accountId: string;
  label: string;
  /** The provider login's email, when the provider shares it. */
  email?: string;
  /** The subscription plan, when known (e.g. "max", "pro", "Plus"). */
  plan?: string;
  /** The account holder's name, when the provider shares it (ChatGPT). */
  name?: string;
  /**
   * ChatGPT only (the cloud's sign-in). Absent while signed in; `signed_out`
   * keeps the registration (issued client id) for a later sign-in;
   * `reauth_required` means its tokens stopped working and it must sign in
   * again.
   */
  status?: "signed_out" | "reauth_required";
  /** ChatGPT only: false when the sign-in didn't grant ChatGPT plan usage. */
  planUsage?: boolean;
  /** ChatGPT only: the registration's issued client id (an identifier, not a credential). */
  clientId?: string;
  /**
   * The account the owner's cloud uses for this provider. Claude: each
   * computer's own is on its place (`places[].active`).
   */
  active: boolean;
  /** Claude only: the places that hold a Claude Code login for this account. */
  places?: ClaudeLoginPlace[];
  updatedAt: number;
};

/**
 * Why a place runs the Claude account it runs:
 * - `selected`: the account chosen in Stella.
 * - `own_login`: the computer's own Claude Code login (the CLI's default
 *   config), used when nothing is chosen or the chosen account has no login
 *   there.
 * - `other_login`: another login the place holds (a login added in Stella on
 *   that computer, or the cloud's), for the same reasons.
 */
export type ClaudeInUseReason = "selected" | "own_login" | "other_login";

/** One place that runs Claude Code, and what it runs right now. */
export type ClaudePlaceStatus = {
  kind: "cloud" | "device";
  /** Devices only. */
  deviceId?: string;
  deviceName?: string;
  /** Devices only: whether the computer found a `claude` CLI, when it said. */
  cliInstalled?: boolean;
  /** The account Claude Code runs on here now; null while no login here. */
  inUse: { accountId: string; email?: string; reason: ClaudeInUseReason } | null;
  /** Devices only: the account the computer's own Claude Code login (`~/.claude`) is signed in to. */
  ownLogin?: { accountId: string; email?: string };
  /** An account is chosen and this place has no login for it. */
  missingChosen: boolean;
  updatedAt: number;
};

/** The owner's one Claude choice and what each place runs because of it. */
export type ClaudeOverview = {
  /** The account every place uses; null for each place's own login. */
  chosenAccountId: string | null;
  /** The cloud first (when it holds a login), then computers by name. */
  places: ClaudePlaceStatus[];
};

/**
 * A ChatGPT registration one of the owner's hosts made: the issued client id
 * (an identifier, not a credential) and who it belongs to. Another host signs
 * in with it under its own host id.
 */
export type ChatGptSharedRegistration = {
  clientId: string;
  email?: string;
  name?: string;
  updatedAt: number;
};

export type EngineSettings = {
  /**
   * The saved selection, whether or not its engine is still connected.
   * Clients that know `selection` read that instead: when the account runs
   * on a provider key, this stays the last selection older clients
   * understand, so they keep what they had rather than misreading it.
   */
  execution: LegacyCloudExecutionSelection;
  /**
   * The saved selection, including a model on an account provider key
   * (`engine: "provider"`). Absent from servers older than provider keys;
   * fall back to `execution`.
   */
  selection?: CloudExecutionSelection;
  /** When the account last saved a selection; null until the first save. */
  selectedAt: number | null;
  /** Every connected account, grouped by provider in connection order. */
  connections: EngineConnection[];
  /** ChatGPT registrations the owner's hosts made, newest first. */
  chatGptRegistrations: ChatGptSharedRegistration[];
  /** Claude: the one choice and each place's account. Absent from older servers. */
  claude?: ClaudeOverview;
};

/** Whether an account can serve the cloud's turns. */
export const isEngineConnectionUsable = (connection: EngineConnection): boolean =>
  connection.provider === "anthropic"
    ? (connection.places ?? []).some((place) => place.kind === "cloud")
    : !connection.status && connection.planUsage !== false;

/** One login a computer's Claude Code configs hold (identity only). */
export type ClaudeLocalLogin = { email: string; plan?: string; isDefault?: boolean };

export type EngineCalls = {
  "engines.cancelConnect": {
    args: { connectId: string };
    result: null;
  };
  /**
   * Start signing the owner's cloud in to ChatGPT. `redirectPort`: the
   * caller's loopback listener (desktop); without it the redirect goes to
   * the documented default port and the user pastes the URL it lands on.
   * `accountId` signs a saved cloud account in again; `clientId` reuses a
   * registration another host of the owner made (`chatGptRegistrations`)
   * instead of registering a new one; `enablePlanUsage` asks for consent
   * again after plan usage was declined.
   */
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
  /** The redirect URL (or its query) the browser landed on. */
  "engines.finishConnect": {
    args: { connectId: string; pastedInput: string };
    result: { accountId: string; planUsage: boolean };
  };
  /**
   * A host registered (or signed in with) a ChatGPT client: record its issued
   * client id so the owner's other hosts can reuse it. Never tokens.
   */
  "engines.shareChatGptRegistration": {
    args: { clientId: string; email?: string; name?: string };
    result: null;
  };
  /**
   * A computer's current Claude Code logins (identities only). Adds unknown
   * identities as accounts and replaces this device's places.
   * `cliInstalled`: whether the computer found a `claude` CLI.
   */
  "engines.reportClaudeLogins": {
    args: {
      deviceId: string;
      deviceName?: string;
      logins: ClaudeLocalLogin[];
      cliInstalled?: boolean;
    };
    result: null;
  };
  /**
   * The account every place uses (the cloud and every computer), or with no
   * `accountId` each place's own login. A place without a login for the
   * chosen account keeps running its own until it signs in.
   */
  "engines.chooseClaudeAccount": {
    args: { accountId?: string };
    result: null;
  };
  /**
   * Ask another of the owner's computers to start its own `claude auth
   * login` (a new Claude Code config there) and return Anthropic's sign-in
   * URL, to open on the device the user is holding. That computer must be
   * online and accept work from the owner's other devices.
   */
  "engines.startClaudeDeviceLogin": {
    args: { deviceId: string; email?: string };
    result: { loginId: string; authorizeUrl: string };
  };
  /** Hand the code Anthropic showed to that computer's waiting CLI. */
  "engines.finishClaudeDeviceLogin": {
    args: { deviceId: string; loginId: string; code: string };
    result: { email?: string };
  };
  "engines.cancelClaudeDeviceLogin": {
    args: { deviceId: string; loginId: string };
    result: null;
  };
  /**
   * Start `claude auth login` in the owner's cloud container and return
   * Anthropic's sign-in URL. `email` pre-fills the login page.
   */
  "engines.startClaudeCloudLogin": {
    args: { email?: string };
    result: { loginId: string; authorizeUrl: string };
  };
  /**
   * Hand the code Anthropic showed to the cloud's waiting CLI. A wrong code
   * fails with the CLI's own error.
   */
  "engines.finishClaudeCloudLogin": {
    args: { loginId: string; code: string };
    result: { accountId: string; email: string };
  };
  "engines.cancelClaudeCloudLogin": {
    args: { loginId: string };
    result: null;
  };
  /** `claude auth logout` for this account in the cloud container. */
  "engines.signOutClaudeCloud": {
    args: { accountId: string };
    result: null;
  };
  /**
   * Remove one account (or, without `accountId`, every account of the
   * provider). Claude: forgets the identity and signs the cloud out of it;
   * computers keep their own Claude Code logins. Falls back to the managed
   * engine when the provider's last usable account goes while it was
   * selected. ChatGPT: the session is revoked and its registration kept for
   * a later sign-in unless `forget`; `revoked` is false when the revocation
   * couldn't be confirmed (the user can disconnect Stella in ChatGPT
   * Settings).
   */
  "engines.disconnect": {
    args: { provider: EngineProvider; accountId?: string; forget?: boolean };
    result: { revoked: boolean } | null;
  };
  /**
   * Make one account the one in use. ChatGPT: the cloud's. Claude: the one
   * every place uses (`engines.chooseClaudeAccount`); `deviceId` is ignored
   * (older clients sent it for a per-computer choice).
   */
  "engines.setActiveAccount": {
    args: { provider: EngineProvider; accountId: string; deviceId?: string };
    result: null;
  };
  /**
   * Save the account-wide selection. Not checked against connections: a
   * paired computer runs Claude Code or Codex on its own login, and cloud
   * turns fall back to the managed engine when the credential is missing.
   */
  "engines.setExecution": {
    args: { execution: CloudExecutionSelection };
    result: null;
  };
  /**
   * The models the cloud's active ChatGPT account may use (`GET /v1/models`),
   * for the cloud picker; null when no usable account is signed in.
   */
  "engines.listModels": {
    args: { provider: "chatgpt" };
    result: { models: Array<{ id: string; name: string }> } | null;
  };
};

export type EngineViews = {
  "engines.get": { args: Record<string, never>; result: EngineSettings };
};
