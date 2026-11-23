import type { Api, Model } from "@earendil-works/pi-ai";
import { ANTHROPIC_MODELS } from "@earendil-works/pi-ai/providers/anthropic.models";
import { CEREBRAS_MODELS } from "@earendil-works/pi-ai/providers/cerebras.models";
import { GITHUB_COPILOT_MODELS } from "@earendil-works/pi-ai/providers/github-copilot.models";
import { GOOGLE_MODELS } from "@earendil-works/pi-ai/providers/google.models";
import { HUGGINGFACE_MODELS } from "@earendil-works/pi-ai/providers/huggingface.models";
import { KIMI_CODING_MODELS } from "@earendil-works/pi-ai/providers/kimi-coding.models";
import { META_MODELS } from "@earendil-works/pi-ai/providers/meta.models";
import { MINIMAX_CN_MODELS } from "@earendil-works/pi-ai/providers/minimax-cn.models";
import { MINIMAX_MODELS } from "@earendil-works/pi-ai/providers/minimax.models";
import { OPENAI_CODEX_MODELS } from "@earendil-works/pi-ai/providers/openai-codex.models";
import { OPENAI_MODELS } from "@earendil-works/pi-ai/providers/openai.models";
import { OPENCODE_GO_MODELS } from "@earendil-works/pi-ai/providers/opencode-go.models";
import { OPENCODE_MODELS } from "@earendil-works/pi-ai/providers/opencode.models";
import { OPENROUTER_MODELS } from "@earendil-works/pi-ai/providers/openrouter.models";
import { VERCEL_AI_GATEWAY_MODELS } from "@earendil-works/pi-ai/providers/vercel-ai-gateway.models";
import { XAI_MODELS } from "@earendil-works/pi-ai/providers/xai.models";
import { XIAOMI_TOKEN_PLAN_AMS_MODELS } from "@earendil-works/pi-ai/providers/xiaomi-token-plan-ams.models";
import { XIAOMI_TOKEN_PLAN_CN_MODELS } from "@earendil-works/pi-ai/providers/xiaomi-token-plan-cn.models";
import { XIAOMI_TOKEN_PLAN_SGP_MODELS } from "@earendil-works/pi-ai/providers/xiaomi-token-plan-sgp.models";
import { XIAOMI_MODELS } from "@earendil-works/pi-ai/providers/xiaomi.models";
import { ZAI_MODELS } from "@earendil-works/pi-ai/providers/zai.models";

type Catalog = Record<string, object>;

const CATALOGS: Readonly<Record<string, Catalog>> = {
  anthropic: ANTHROPIC_MODELS,
  cerebras: CEREBRAS_MODELS,
  "github-copilot": GITHUB_COPILOT_MODELS,
  google: GOOGLE_MODELS,
  huggingface: HUGGINGFACE_MODELS,
  "kimi-coding": KIMI_CODING_MODELS,
  meta: META_MODELS,
  minimax: MINIMAX_MODELS,
  "minimax-cn": MINIMAX_CN_MODELS,
  openai: OPENAI_MODELS,
  opencode: OPENCODE_MODELS,
  "opencode-go": OPENCODE_GO_MODELS,
  openrouter: OPENROUTER_MODELS,
  "vercel-ai-gateway": VERCEL_AI_GATEWAY_MODELS,
  xai: XAI_MODELS,
  xiaomi: XIAOMI_MODELS,
  "xiaomi-token-plan-ams": XIAOMI_TOKEN_PLAN_AMS_MODELS,
  "xiaomi-token-plan-cn": XIAOMI_TOKEN_PLAN_CN_MODELS,
  "xiaomi-token-plan-sgp": XIAOMI_TOKEN_PLAN_SGP_MODELS,
  zai: ZAI_MODELS,
};

const CHATGPT_PROVIDER = "chatgpt";

const chatModels = (catalog: Catalog): Model<Api>[] =>
  (Object.values(catalog) as (Model<Api> & { type?: string })[]).filter(
    (model) => model.type === undefined || model.type === "chat",
  );

/**
 * The catalog this build ships with: pi-ai's own list for each provider
 * Stella offers. The ChatGPT plan is pi-ai's Codex list under Stella's
 * provider id; the plan's transport sets the real endpoint.
 */
export const bundledModels = (): Map<string, Model<Api>[]> => {
  const bundled = new Map<string, Model<Api>[]>();
  for (const [providerId, catalog] of Object.entries(CATALOGS)) {
    bundled.set(providerId, chatModels(catalog));
  }
  bundled.set(
    CHATGPT_PROVIDER,
    chatModels(OPENAI_CODEX_MODELS).map((model) => ({
      ...model,
      provider: CHATGPT_PROVIDER,
      api: "chatgpt-responses" as Api,
      baseUrl: "https://api.openai.com/v1",
    })),
  );
  return bundled;
};
