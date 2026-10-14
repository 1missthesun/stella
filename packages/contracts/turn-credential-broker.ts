export const TURN_BROKER_VERSION = 1 as const;
export const TURN_BROKER_AUTH_SCHEME = "StellaTurnBroker";
export const TURN_BROKER_TURN_TOKEN_HEADER = "x-stella-turn-token";
export const TURN_BROKER_TURN_STATE_CHECKPOINT_PATH =
  "/internal/stella/turn/state-checkpoint";

export const TURN_BROKER_HEADERS = {
  ownerId: "x-stella-broker-owner-id",
  ownerGeneration: "x-stella-broker-owner-generation",
  turnId: "x-stella-broker-turn-id",
  attemptGeneration: "x-stella-broker-attempt-generation",
  sequence: "x-stella-broker-sequence",
  requestId: "x-stella-broker-request-id",
  targetPath: "x-stella-broker-target-path",
  targetMethod: "x-stella-broker-target-method",
} as const;

export const TURN_BROKER_RESPONSE_HEADERS = {
  denial: "x-stella-broker-denial",
  replayPending: "x-stella-broker-replay-pending",
} as const;

export type TurnBrokerIdentity = {
  sessionId: string;
  ownerId: string;
  ownerGeneration: string;
  turnId: string;
  attemptGeneration: number;
};

export type TurnBrokerHandoff = TurnBrokerIdentity & {
  version: typeof TURN_BROKER_VERSION;
  endpoint: string;
  capability: string;
  expiresAt: number;
  initialSequence: 1;
};

export type TurnBrokerInput = {
  credentialsPath: string;
};

export type TurnBrokerNativeStateCheckpoint = {
  engine: "anthropic";
  sessionId: string;
  cursor: string;
  tree: {
    algorithm: "sha256";
    digest: string;
    entries: number;
    bytes: number;
  };
  mac: string;
};

export type TurnBrokerTurnStateCheckpointRequest = {
  schemaVersion: 1;
  historyCursor: string;
  nativeCheckpoint?: TurnBrokerNativeStateCheckpoint;
};

export type TurnBrokerTurnStateCheckpointReceipt = {
  operationId: string;
  historyCursor: string;
  manifestId?: string;
};
