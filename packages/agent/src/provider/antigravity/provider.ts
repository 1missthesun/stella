import { createProvider, type Provider } from "@earendil-works/pi-ai/models";
import { ANTIGRAVITY_API, ANTIGRAVITY_ENDPOINT, ANTIGRAVITY_PROVIDER_ID, antigravityModels } from "./models.ts";
import { antigravityOAuth } from "./oauth.ts";
import { antigravityStreams } from "./stream.ts";

export { ANTIGRAVITY_PROVIDER_ID } from "./models.ts";

/**
 * Gemini on the user's Google Antigravity plan: requests go from this
 * computer to Google's Cloud Code endpoint with the user's own Google sign-in.
 */
export function antigravityProvider(): Provider {
  return createProvider({
    id: ANTIGRAVITY_PROVIDER_ID,
    name: "Google Antigravity",
    baseUrl: ANTIGRAVITY_ENDPOINT,
    auth: {
      apiKey: {
        name: "Google Antigravity sign-in",
        resolve: async ({ credential }) =>
          credential?.key?.trim() ? { auth: { apiKey: credential.key.trim() }, source: "Stella" } : undefined,
      },
      oauth: antigravityOAuth(),
    },
    models: antigravityModels(),
    api: { [ANTIGRAVITY_API]: antigravityStreams },
  });
}
