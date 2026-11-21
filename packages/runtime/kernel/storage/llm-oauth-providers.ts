import type {
  AuthEvent,
  AuthPrompt,
  OAuthAuth,
  OAuthCredential,
  OAuthCredentials,
} from "@earendil-works/pi-ai";
import { githubCopilotProvider } from "@earendil-works/pi-ai/providers/github-copilot";
import { xaiProvider } from "@earendil-works/pi-ai/providers/xai";
import { antigravityPlanName } from "@stella/agent/provider/antigravity/oauth";
import { antigravityProvider } from "@stella/agent/provider/antigravity/provider";

export type { OAuthCredentials } from "@earendil-works/pi-ai";

export type LlmOAuthProvider = {
  readonly id: string;
  readonly name: string;
  readonly oauth: OAuthAuth;
};

/**
 * GitHub Copilot and xAI sign in with a device code on the provider's own
 * site. pi-ai's browser-redirect sign-ins (Anthropic, Codex, ChatGPT,
 * OpenRouter) answer the redirect with Pi's own page, so a redirect sign-in
 * belongs in Stella's code with @stella/contracts/sign-in-page, the way
 * Google Antigravity's does.
 */
let providers: Map<string, LlmOAuthProvider> | undefined;
const registry = (): Map<string, LlmOAuthProvider> =>
  (providers ??= new Map(
    [githubCopilotProvider(), xaiProvider(), antigravityProvider()].flatMap((provider) =>
      provider.auth.oauth
        ? [[provider.id, { id: provider.id, name: provider.auth.oauth.name, oauth: provider.auth.oauth }] as const]
        : [],
    ),
  ));

export const getLlmOAuthProviders = (): LlmOAuthProvider[] => [...registry().values()];

export const getLlmOAuthProvider = (id: string): LlmOAuthProvider | undefined => registry().get(id);

export const OAUTH_REFRESH_SKEW_MS = 60_000;
const OAUTH_REFRESH_TIMEOUT_MS = 30_000;

const asCredential = (credentials: OAuthCredentials): OAuthCredential => ({ ...credentials, type: "oauth" });

const asStored = ({ type: _type, ...credentials }: OAuthCredential): OAuthCredentials => credentials;

export const getLlmOAuthApiKey = async (
  provider: LlmOAuthProvider,
  stored: OAuthCredentials,
  options: { forceRefresh?: boolean } = {},
): Promise<{ credentials: OAuthCredentials; apiKey: string }> => {
  let credentials = stored;
  if (options.forceRefresh || Date.now() + OAUTH_REFRESH_SKEW_MS >= credentials.expires) {
    try {
      credentials = asStored(
        await provider.oauth.refresh(asCredential(credentials), AbortSignal.timeout(OAUTH_REFRESH_TIMEOUT_MS)),
      );
    } catch (error) {
      throw new Error(
        `Failed to refresh OAuth token for ${provider.id}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
  const auth = await provider.oauth.toAuth(asCredential(credentials));
  if (!auth.apiKey) throw new Error(`${provider.name} gave no key to sign requests with.`);
  return { credentials, apiKey: auth.apiKey };
};

/** getLlmOAuthApiKey by provider id, in the shape the credential store takes. */
export const resolveLlmOAuthApiKey = async (
  providerId: string,
  credentials: OAuthCredentials,
  options: { forceRefresh?: boolean } = {},
): Promise<{ credentials: OAuthCredentials; apiKey: string }> => {
  const provider = getLlmOAuthProvider(providerId);
  if (!provider) throw new Error(`Unknown OAuth provider: ${providerId}`);
  return await getLlmOAuthApiKey(provider, credentials, options);
};

export type LlmOAuthLoginCallbacks = {
  prompt(prompt: AuthPrompt): Promise<string>;
  notify(event: AuthEvent): void;
  signal: AbortSignal;
};

export const loginLlmOAuth = async (
  provider: LlmOAuthProvider,
  callbacks: LlmOAuthLoginCallbacks,
): Promise<OAuthCredentials> => asStored(await provider.oauth.login(callbacks));

/** The account and plan a fresh sign-in belongs to, for Settings to show. */
export const describeLlmOAuthCredential = (
  providerId: string,
  credentials: OAuthCredentials,
): { account?: string; plan?: string } => {
  const account = typeof credentials.email === "string" ? credentials.email.trim() : "";
  const plan = providerId === "antigravity" ? antigravityPlanName(credentials) : undefined;
  return { ...(account ? { account } : {}), ...(plan ? { plan } : {}) };
};
