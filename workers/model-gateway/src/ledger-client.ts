import type { GatewayCapabilityClaims } from "@stella/contracts/gateway/capability";
import type {
  OwnerAdmissionRefusal,
  OwnerRelayGate,
} from "./gates/owner-relay-gate.js";
import type {
  LedgerReserveArgs,
  LedgerReserveResult,
  LedgerSettleArgs,
  LedgerSettleResult,
} from "./ledger-store.js";

export type OwnerRelayAccounting = Pick<
  OwnerRelayGate,
  "admitRelay" | "admitAndReserve" | "settleCapability" | "releaseRelay"
>;

export type RelaySettlement = Omit<LedgerSettleArgs, "requestId" | "attempt">;

export type HeldReservation = {
  remainingMicroCents: number | null;
  settle: (args: RelaySettlement) => Promise<LedgerSettleResult>;
};

export type RelayReservation =
  | Exclude<LedgerReserveResult, { kind: "reserved" }>
  | ({ kind: "refused" } & OwnerAdmissionRefusal)
  | { kind: "reserved"; held: HeldReservation };

/**
 * The single budget and replay authority for one capability: owner-scoped
 * capabilities reserve together with owner admission on the owner's gate,
 * legacy ones on their own CapabilityLedger. Only a reserved outcome can
 * settle, and only for the attempt it reserved.
 */
export type RelayAccounting = {
  authority: "owner" | "capability";
  reserve: (args: LedgerReserveArgs) => Promise<RelayReservation>;
};

export const relayAccounting = (
  env: Env,
  claims: GatewayCapabilityClaims,
  ownerGate: OwnerRelayAccounting,
  admission: { audience: GatewayCapabilityClaims["audience"]; throttled: boolean },
): RelayAccounting => {
  if (claims.ledgerScope === "owner-relay-v2") {
    return {
      authority: "owner",
      reserve: async (args) => {
        const result = await ownerGate.admitAndReserve({
          audience: admission.audience,
          requestId: args.requestId,
          throttled: admission.throttled,
          generation: claims.gen,
          reservation: args,
        });
        if (result.kind !== "reserved") return result;
        return {
          kind: "reserved",
          held: {
            remainingMicroCents: result.remainingMicroCents,
            settle: async (settlement) =>
              await ownerGate.settleCapability({
                ...settlement,
                requestId: args.requestId,
                attempt: result.attempt,
                jti: claims.jti,
                generation: claims.gen,
              }),
          },
        };
      },
    };
  }
  const ledger = env.CAPABILITY_LEDGER.get(
    env.CAPABILITY_LEDGER.idFromName(claims.jti),
  );
  return {
    authority: "capability",
    reserve: async (args) => {
      const result = await ledger.reserve(args);
      if (result.kind !== "reserved") return result;
      return {
        kind: "reserved",
        held: {
          remainingMicroCents: result.remainingMicroCents,
          settle: async (settlement) =>
            await ledger.settle({
              ...settlement,
              requestId: args.requestId,
              attempt: result.attempt,
            }),
        },
      };
    },
  };
};
