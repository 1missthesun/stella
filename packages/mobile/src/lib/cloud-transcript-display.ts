import type { ChatMessage } from "../types";

export type CloudTranscriptDisplayInput = {
  caughtUp: boolean;
  /** The window is still fetching earlier records because nothing in it can be shown yet. */
  fillingEarlier: boolean;
  settledFailure: boolean;
  cacheVisible: boolean;
  cached: readonly ChatMessage[] | null;
  projected: readonly ChatMessage[];
  lastShown: readonly ChatMessage[] | null;
  everShown: boolean;
};

export type CloudTranscriptDisplayPlan = {
  messages: readonly ChatMessage[];
  shown: boolean;
  holding: boolean;
};

export const planCloudTranscriptDisplay = (
  input: CloudTranscriptDisplayInput,
): CloudTranscriptDisplayPlan => {
  const source =
    input.cacheVisible && input.cached ? input.cached : input.projected;
  const holding =
    (!input.caughtUp || input.fillingEarlier) &&
    !input.settledFailure &&
    source.length === 0 &&
    input.lastShown !== null &&
    input.lastShown.length > 0;
  const messages = holding ? input.lastShown! : source;
  const shown =
    input.everShown ||
    (input.caughtUp && !input.fillingEarlier) ||
    input.settledFailure ||
    input.cacheVisible ||
    holding;
  return { messages, shown, holding };
};
