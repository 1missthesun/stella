import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import { STELLA_RUNTIME_PROTOCOL_VERSION } from "@stella/contracts/protocol";

export class WorkerNotInitializedError extends Data.TaggedError(
  "@stella/runtime/worker/WorkerNotInitializedError",
) {
  override get message() {
    return "Worker has not been initialized.";
  }
}

export class RunnerUnavailableError extends Data.TaggedError(
  "@stella/runtime/worker/RunnerUnavailableError",
) {
  override get message() {
    return "Runtime worker is not ready.";
  }
}

export class ChatStoreUnavailableError extends Data.TaggedError(
  "@stella/runtime/worker/ChatStoreUnavailableError",
) {
  override get message() {
    return "Chat store is not available.";
  }
}

export class VoiceUnavailableError extends Data.TaggedError(
  "@stella/runtime/worker/VoiceUnavailableError",
) {
  override get message() {
    return "Voice runtime service is not available.";
  }
}

export class ProtocolMismatchError extends Data.TaggedError(
  "@stella/runtime/worker/ProtocolMismatchError",
)<{ readonly hostVersion: string }> {
  override get message() {
    return `Runtime protocol mismatch: host=${this.hostVersion} worker=${STELLA_RUNTIME_PROTOCOL_VERSION}.`;
  }
}

export class WorkerRequestError extends Data.TaggedError(
  "@stella/runtime/worker/WorkerRequestError",
)<{ readonly message: string }> {}

export const causeToThrowable = (cause: Cause.Cause<unknown>): unknown =>
  Cause.squash(cause);
