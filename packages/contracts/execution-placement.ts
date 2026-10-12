/**
 * Provider-neutral execution placement protocol.
 *
 * `subject` describes what the work is about. `target` is the independent,
 * user-facing executor choice. Keeping those two concepts separate prevents a
 * portable prompt from silently changing meaning when it is sent elsewhere.
 */

export const EXECUTION_PLACEMENT_PROTOCOL_VERSION = 1 as const;

export type ExecutionIngress =
  "desktop" | "mobile" | "browser" | "cloud" | "schedule";

export type ExecutionRequestKind = "chat" | "agent";
export type ExecutionPlacement = "computer" | "cloud";
export type ExecutionSubject = "portable" | "computer" | "cloud";
export type ExecutionTargetMode = "automatic" | "cloud" | "device";
export type ExecutionTarget =
  | { mode: "automatic" }
  | { mode: "cloud" }
  | { mode: "device"; deviceId: string };

export type ExecutionDispatchState =
  | "queued"
  | "offering"
  | "computer_claimed"
  | "computer_accepted"
  | "computer_running"
  | "cloud_committed"
  | "cloud_running"
  | "cancel_pending"
  | "reconciliation_required"
  | "completed"
  | "failed"
  | "canceled";

export type ExecutionTerminalState = "completed" | "failed" | "canceled";

export type ExecutionPlacementDecision =
  | {
      kind: "commit";
      placement: ExecutionPlacement;
      reason: string;
    }
  | {
      kind: "offer-computer";
      onNoEligibleComputer: "cloud" | "blocked";
      reason: string;
    }
  | {
      kind: "blocked";
      reason: string;
    };

export type ExecutionRoutingInput = {
  ingress: ExecutionIngress;
  requestKind: ExecutionRequestKind;
  subject: ExecutionSubject;
  target?: ExecutionTarget;
};

/** Ingresses with no local device behind them, so no claim to local work. */
export const ingressMayClaimComputerSubject = (
  ingress: ExecutionIngress,
): boolean => ingress === "desktop" || ingress === "mobile";

export type ExecutionDeviceProofOperation =
  | "presence-register"
  | "presence-heartbeat"
  | "presence-drain"
  | "presence-clear"
  | "claim"
  | "claim-release"
  | "claim-ack"
  | "running"
  | "renew"
  | "complete";

export type ExecutionDeviceProofInput = {
  operation: ExecutionDeviceProofOperation;
  ownerGeneration: string;
  deviceId: string;
  presenceSessionId: string;
  sequence: number;
  bodyHash: string;
};

