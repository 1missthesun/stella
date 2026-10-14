import { BackendRequestError } from "@stella/contracts/backend/client";
import type {
  VoiceFailureAction,
  VoiceSessionFailure,
} from "@stella/contracts/voice-failure";

export class VoiceSessionError extends Error {
  readonly action: VoiceFailureAction | null;
  constructor(failure: VoiceSessionFailure) {
    super(failure.message);
    this.name = "VoiceSessionError";
    this.action = failure.action;
  }
}

const backendFailureAction = (
  error: BackendRequestError,
): VoiceFailureAction | null => {
  switch (error.code) {
    case "UNAUTHENTICATED":
      return "sign-in";
    case "FORBIDDEN":
      return "settings";
    case "UNAVAILABLE":
      return error.retryable ? null : "settings";
    default:
      return null;
  }
};

export const voiceSessionFailureOf = (error: unknown): VoiceSessionFailure => {
  if (error instanceof VoiceSessionError) {
    return { message: error.message, action: error.action };
  }
  if (error instanceof BackendRequestError) {
    return { message: error.message, action: backendFailureAction(error) };
  }
  return {
    message: error instanceof Error ? error.message : String(error),
    action: null,
  };
};
