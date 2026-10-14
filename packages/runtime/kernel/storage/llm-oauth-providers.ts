import type {
  AuthEvent,
  AuthPrompt,
  OAuthAuth,
  OAuthCredential,
  OAuthCredentials,
} from "@earendil-works/pi-ai";
import { githubCopilotProvider } from "@earendil-works/pi-ai/providers/github-copilot";
import { xaiProvider } from "@earendil-works/pi-ai/providers/xai";

export type { OAuthCredentials } from "@earendil-works/pi-ai";

export type LlmOAuthProvider = {
  readonly id: string;
  readonly name: string;
  readonly oauth: OAuthAuth;
};

let providers: Map<string, LlmOAuthProvider> | undefined;
const registry = (): Map<string, LlmOAuthProvider> =>
  (providers ??= new Map(
    [githubCopilotProvider(), xaiProvider()].flatMap((provider) =>
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

export type LlmOAuthLoginCallbacks = {
  prompt(prompt: AuthPrompt): Promise<string>;
  notify(event: AuthEvent): void;
  signal: AbortSignal;
};

export const loginLlmOAuth = async (
  provider: LlmOAuthProvider,
  callbacks: LlmOAuthLoginCallbacks,
): Promise<OAuthCredentials> => asStored(await provider.oauth.login(callbacks));
