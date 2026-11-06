import type {
  RuntimeAutomationTurnRequest,
  RuntimeAutomationTurnResult,
} from "@stella/contracts/protocol";

export type PiRunnerAuthHandle = {
  setAuthToken: (value: string | null) => void;
  setHasConnectedAccount: (value: boolean) => void;
  setBackendUrl: (value: string | null) => void;
};

export type WindowManagerLike<TWindow = unknown> = {
  getFullWindow: () => TWindow | null;
};

export type WindowManagerTarget<TWindow = unknown> = {
  getWindowManager: () => WindowManagerLike<TWindow> | null;
};

export type StellaHostRunnerTarget = {
  getRunner: () => {
    runAutomationTurn: (
      payload: RuntimeAutomationTurnRequest,
    ) => Promise<RuntimeAutomationTurnResult>;
    startAgent?: (payload: {
      conversationId: string;
      key: string;
      description: string;
      prompt: string;
    }) => Promise<unknown>;
    messageAgent?: (payload: {
      threadId: string;
      messageId: string;
      text: string;
    }) => Promise<"steered" | "resumed" | "queued" | "not_found" | "refused">;
  } | null;
};

export type PiRunnerTarget = {
  getRunner: () => PiRunnerAuthHandle | null;
};
