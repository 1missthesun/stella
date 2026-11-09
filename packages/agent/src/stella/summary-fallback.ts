/**
 * A context summary the model's safety system stops would fail every time it
 * is tried, and the conversation would grow until no request fits. The
 * summary then becomes a plain notice: the summarized part leaves the
 * model's context the way a fresh start does, and the recent messages stay.
 */
import type { Models } from "@earendil-works/pi-ai/models";
import { isSafeguardBlock, SAFEGUARD_UNSUMMARIZED_CONTEXT_NOTICE } from "@stella/contracts/safeguard-block";

type CompleteArgs = Parameters<Models["completeSimple"]>;

export const summariesSurviveSafeguardBlocks = (models: Models): Models =>
  new Proxy(models, {
    get(target, key, receiver) {
      if (key === "completeSimple") {
        return async (...args: CompleteArgs) => {
          const message = await target.completeSimple(...args);
          if (!isSafeguardBlock(message)) return message;
          const { errorMessage: _error, rawStopReason: _raw, ...rest } = message as typeof message & { rawStopReason?: string };
          return {
            ...rest,
            content: [{ type: "text" as const, text: SAFEGUARD_UNSUMMARIZED_CONTEXT_NOTICE }],
            stopReason: "stop" as const,
          };
        };
      }
      const value = Reflect.get(target, key, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
