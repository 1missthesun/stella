import type { Provider } from "@earendil-works/pi-ai/models";

const PROVIDER_LOADERS: Readonly<Record<string, () => Promise<Provider>>> = {
  "amazon-bedrock": () => import("@earendil-works/pi-ai/providers/amazon-bedrock").then((m) => m.amazonBedrockProvider()),
  "ant-ling": () => import("@earendil-works/pi-ai/providers/ant-ling").then((m) => m.antLingProvider()),
  anthropic: () => import("@earendil-works/pi-ai/providers/anthropic").then((m) => m.anthropicProvider()),
  azure: () => import("@earendil-works/pi-ai/providers/azure").then((m) => m.azureProvider()),
  baseten: () => import("@earendil-works/pi-ai/providers/baseten").then((m) => m.basetenProvider()),
  cerebras: () => import("@earendil-works/pi-ai/providers/cerebras").then((m) => m.cerebrasProvider()),
  "cloudflare-ai-gateway": () =>
    import("@earendil-works/pi-ai/providers/cloudflare-ai-gateway").then((m) => m.cloudflareAIGatewayProvider()),
  "cloudflare-workers-ai": () =>
    import("@earendil-works/pi-ai/providers/cloudflare-workers-ai").then((m) => m.cloudflareWorkersAIProvider()),
  deepseek: () => import("@earendil-works/pi-ai/providers/deepseek").then((m) => m.deepseekProvider()),
  fireworks: () => import("@earendil-works/pi-ai/providers/fireworks").then((m) => m.fireworksProvider()),
  "github-copilot": () => import("@earendil-works/pi-ai/providers/github-copilot").then((m) => m.githubCopilotProvider()),
  google: () => import("@earendil-works/pi-ai/providers/google").then((m) => m.googleProvider()),
  "google-vertex": () => import("@earendil-works/pi-ai/providers/google-vertex").then((m) => m.googleVertexProvider()),
  groq: () => import("@earendil-works/pi-ai/providers/groq").then((m) => m.groqProvider()),
  huggingface: () => import("@earendil-works/pi-ai/providers/huggingface").then((m) => m.huggingfaceProvider()),
  "kimi-coding": () => import("@earendil-works/pi-ai/providers/kimi-coding").then((m) => m.kimiCodingProvider()),
  meta: () => import("@earendil-works/pi-ai/providers/meta").then((m) => m.metaProvider()),
  minimax: () => import("@earendil-works/pi-ai/providers/minimax").then((m) => m.minimaxProvider()),
  "minimax-cn": () => import("@earendil-works/pi-ai/providers/minimax-cn").then((m) => m.minimaxCnProvider()),
  mistral: () => import("@earendil-works/pi-ai/providers/mistral").then((m) => m.mistralProvider()),
  moonshotai: () => import("@earendil-works/pi-ai/providers/moonshotai").then((m) => m.moonshotaiProvider()),
  "moonshotai-cn": () => import("@earendil-works/pi-ai/providers/moonshotai-cn").then((m) => m.moonshotaiCnProvider()),
  nvidia: () => import("@earendil-works/pi-ai/providers/nvidia").then((m) => m.nvidiaProvider()),
  openai: () => import("@earendil-works/pi-ai/providers/openai").then((m) => m.openaiProvider()),
  "openai-codex": () => import("@earendil-works/pi-ai/providers/openai-codex").then((m) => m.openaiCodexProvider()),
  opencode: () => import("@earendil-works/pi-ai/providers/opencode").then((m) => m.opencodeProvider()),
  "opencode-go": () => import("@earendil-works/pi-ai/providers/opencode-go").then((m) => m.opencodeGoProvider()),
  openrouter: () => import("@earendil-works/pi-ai/providers/openrouter").then((m) => m.openrouterProvider()),
  "qwen-token-plan": () =>
    import("@earendil-works/pi-ai/providers/qwen-token-plan").then((m) => m.qwenTokenPlanProvider()),
  "qwen-token-plan-cn": () =>
    import("@earendil-works/pi-ai/providers/qwen-token-plan-cn").then((m) => m.qwenTokenPlanCnProvider()),
  "qwen-token-plan-individual": () =>
    import("@earendil-works/pi-ai/providers/qwen-token-plan-individual").then((m) => m.qwenTokenPlanIndividualProvider()),
  "qwen-token-plan-individual-cn": () =>
    import("@earendil-works/pi-ai/providers/qwen-token-plan-individual-cn").then((m) =>
      m.qwenTokenPlanIndividualCnProvider(),
    ),
  radius: () => import("@earendil-works/pi-ai/providers/radius").then((m) => m.radiusProvider()),
  together: () => import("@earendil-works/pi-ai/providers/together").then((m) => m.togetherProvider()),
  typesafe: () => import("@earendil-works/pi-ai/providers/typesafe").then((m) => m.typesafeProvider()),
  "vercel-ai-gateway": () =>
    import("@earendil-works/pi-ai/providers/vercel-ai-gateway").then((m) => m.vercelAIGatewayProvider()),
  xai: () => import("@earendil-works/pi-ai/providers/xai").then((m) => m.xaiProvider()),
  xiaomi: () => import("@earendil-works/pi-ai/providers/xiaomi").then((m) => m.xiaomiProvider()),
  "xiaomi-token-plan-ams": () =>
    import("@earendil-works/pi-ai/providers/xiaomi-token-plan-ams").then((m) => m.xiaomiTokenPlanAmsProvider()),
  "xiaomi-token-plan-cn": () =>
    import("@earendil-works/pi-ai/providers/xiaomi-token-plan-cn").then((m) => m.xiaomiTokenPlanCnProvider()),
  "xiaomi-token-plan-sgp": () =>
    import("@earendil-works/pi-ai/providers/xiaomi-token-plan-sgp").then((m) => m.xiaomiTokenPlanSgpProvider()),
  zai: () => import("@earendil-works/pi-ai/providers/zai").then((m) => m.zaiProvider()),
  "zai-coding-cn": () => import("@earendil-works/pi-ai/providers/zai-coding-cn").then((m) => m.zaiCodingCnProvider()),
};

const loaded = new Map<string, Promise<Provider>>();

export const loadUpstreamProvider = (id: string): Promise<Provider | undefined> => {
  const cached = loaded.get(id);
  if (cached) return cached;
  const loader = PROVIDER_LOADERS[id];
  if (!loader) return Promise.resolve(undefined);
  const pending = loader().catch((error: unknown) => {
    loaded.delete(id);
    throw error;
  });
  loaded.set(id, pending);
  return pending;
};
