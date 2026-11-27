import type { CloudExecutionSelection } from "@stella/contracts/agent-engine";
import { VIEW_ASK_LIMITS } from "@stella/contracts/backend/views";
import { gatewayRelayBaseUrl } from "@stella/contracts/gateway/api";
import { mintTurnCapability } from "../../capability-signer.js";
import { object, optional, string } from "../args.js";
import { RpcError } from "../errors.js";
import { enforceOwnerRateLimit } from "../rate-limit.js";
import type { OwnerContext, OwnerDomain } from "../registry.js";

const MODEL = "stella/light";
const RUN_BUDGET_MICRO_CENTS = 5_000_000;
const DEFAULT_SYSTEM =
  "You answer requests from a small app the user is running inside Stella. Reply with only the answer the app asked for: no preamble, no follow-up questions.";

const ask = async (
  ctx: OwnerContext,
  args: { prompt: string; system?: string },
): Promise<{ text: string; model: string }> => {
  const prompt = args.prompt.trim();
  if (!prompt) throw new RpcError("BAD_REQUEST", "ask needs a prompt.");
  enforceOwnerRateLimit(
    ctx.db,
    ctx.now,
    "views.ask",
    { count: VIEW_ASK_LIMITS.perHour, windowMs: 60 * 60_000 },
    "Views asked Stella too often. Try again in a few minutes.",
  );
  const gateway = ctx.env.MODEL_GATEWAY;
  const origin = ctx.env.MODEL_GATEWAY_URL?.trim() ?? "";
  if (!gateway || !origin) throw new RpcError("UNAVAILABLE", "Stella's model isn't reachable right now.");
  const snapshot = await ctx.host.snapshot();
  const execution: Extract<CloudExecutionSelection, { engine: "stella" }> = {
    engine: "stella",
    provider: "stella",
    model: MODEL,
    reasoningEffort: "low",
  };
  const capability = await mintTurnCapability(ctx.env, {
    ownerId: ctx.ownerId,
    ownerGeneration: snapshot.ownerGeneration,
    turnId: `view-ask-${crypto.randomUUID()}`,
    conversationId: "view-ask",
    execution,
    audience: snapshot.allowance.audience,
    budgetMicroCents: Math.min(snapshot.allowance.budgetMicroCents, RUN_BUDGET_MICRO_CENTS),
    agentTypes: ["general"],
  });
  const [{ createModels }, { stellaModel, stellaProvider }, { piModelSpec }] = await Promise.all([
    import("@earendil-works/pi-ai/models"),
    import("@stella/agent/provider/stella"),
    import("../../orchestrator/support.js"),
  ]);
  const spec = piModelSpec("general", execution, snapshot.allowance.audience);
  const relayBaseUrl = gatewayRelayBaseUrl(origin);
  const models = createModels();
  models.setProvider(
    stellaProvider({
      access: {
        relayBaseUrl,
        capability: async () => capability.token,
        fetch: async (outgoingRequest, init) => {
          const outgoing =
            outgoingRequest instanceof Request
              ? new Request(outgoingRequest, init)
              : new Request(String(outgoingRequest), init);
          outgoing.headers.set("authorization", `Bearer ${capability.token}`);
          return await gateway.fetch(outgoing);
        },
      },
      models: [spec],
    }),
  );
  const answer = await models.completeSimple(
    stellaModel(spec, relayBaseUrl),
    {
      systemPrompt: args.system?.trim() || DEFAULT_SYSTEM,
      messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
    },
    { maxTokens: VIEW_ASK_LIMITS.maxOutputTokens, signal: AbortSignal.timeout(VIEW_ASK_LIMITS.timeoutMs) },
  );
  if (answer.stopReason === "error" || answer.stopReason === "aborted") {
    const reason = (answer.errorMessage ?? "").replace(/\s+/gu, " ").trim().slice(0, 300);
    throw new RpcError("UNAVAILABLE", reason || "Stella's model didn't answer.");
  }
  const text = answer.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("").trim();
  return { text, model: MODEL };
};

export const viewsDomain = {
  name: "views",
  calls: {
    "views.ask": {
      scope: "owner",
      maxBodyBytes: (VIEW_ASK_LIMITS.maxPromptChars + VIEW_ASK_LIMITS.maxSystemChars) * 4 + 1024,
      parse: object({
        prompt: string({ max: VIEW_ASK_LIMITS.maxPromptChars }),
        system: optional(string({ max: VIEW_ASK_LIMITS.maxSystemChars })),
      }),
      handler: ask,
    },
  },
} satisfies OwnerDomain;
