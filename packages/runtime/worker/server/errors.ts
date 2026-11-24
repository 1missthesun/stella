import { STELLA_RUNTIME_PROTOCOL_VERSION } from "@stella/contracts/protocol";

export class WorkerNotInitializedError extends Error {
  readonly _tag = "@stella/runtime/worker/WorkerNotInitializedError";

  constructor() {
    super("Worker has not been initialized.");
    this.name = "WorkerNotInitializedError";
  }
}

export class RunnerUnavailableError extends Error {
  readonly _tag = "@stella/runtime/worker/RunnerUnavailableError";

  constructor() {
    super("Runtime worker is not ready.");
    this.name = "RunnerUnavailableError";
  }
}

export class ChatStoreUnavailableError extends Error {
  readonly _tag = "@stella/runtime/worker/ChatStoreUnavailableError";

  constructor() {
    super("Chat store is not available.");
    this.name = "ChatStoreUnavailableError";
  }
}

export class VoiceUnavailableError extends Error {
  readonly _tag = "@stella/runtime/worker/VoiceUnavailableError";

  constructor() {
    super("Voice runtime service is not available.");
    this.name = "VoiceUnavailableError";
  }
}

export class ProtocolMismatchError extends Error {
  readonly _tag = "@stella/runtime/worker/ProtocolMismatchError";
  readonly hostVersion: string;

  constructor(args: { readonly hostVersion: string }) {
    super(
      `Runtime protocol mismatch: host=${args.hostVersion} worker=${STELLA_RUNTIME_PROTOCOL_VERSION}.`,
    );
    this.name = "ProtocolMismatchError";
    this.hostVersion = args.hostVersion;
  }
}

export class WorkerRequestError extends Error {
  readonly _tag = "@stella/runtime/worker/WorkerRequestError";

  constructor(args: { readonly message: string }) {
    super(args.message);
    this.name = "WorkerRequestError";
  }
}
