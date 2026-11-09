/**
 * Test builds only: a model request whose messages name
 * `SAFEGUARD_TEST_TRIGGER` ends the way a provider's safety system ends one,
 * without sending anything. `stella-test-safeguard-block:<part>` stops only
 * models whose id contains `<part>`.
 */
import { createAssistantMessageEventStream, type AssistantMessage, type Message } from "@earendil-works/pi-ai";
import type { Models } from "@earendil-works/pi-ai/models";
import { SAFEGUARD_TEST_TRIGGER } from "@stella/contracts/safeguard-block";

type StreamArgs = Parameters<Models["streamSimple"]>;

const textOf = (message: Message): string =>
  typeof message.content === "string"
    ? message.content
    : message.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");

const triggers = (messages: readonly Message[], modelId: string): boolean => {
  const pattern = new RegExp(SAFEGUARD_TEST_TRIGGER.source, "gi");
  for (const message of messages) {
    if (message.role === "assistant") continue;
    for (const match of textOf(message).matchAll(pattern)) {
      if (!match[1] || modelId.toLowerCase().includes(match[1].toLowerCase())) return true;
    }
  }
  return false;
};

export const simulateSafeguardBlocks = (models: Models): Models =>
  new Proxy(models, {
    get(target, key, receiver) {
      if (key === "streamSimple") {
        return (...args: StreamArgs) => {
          const [model, context] = args;
          if (!triggers(context.messages, model.id)) return target.streamSimple(...args);
          const out = createAssistantMessageEventStream();
          const error: AssistantMessage = {
            role: "assistant",
            content: [],
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "error",
            rawStopReason: "refusal",
            errorMessage: "The model refused to complete the request",
            timestamp: Date.now(),
          };
          queueMicrotask(() => {
            out.push({ type: "error", reason: "error", error });
            out.end(error);
          });
          return out;
        };
      }
      const value = Reflect.get(target, key, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
