import type {
  OwnerFenceAssertInput,
  OwnerFenceAssertResult,
  OwnerFenceBeginInput,
  OwnerFenceBeginResult,
  OwnerFenceBlockedResult,
  OwnerFenceLeaseInput,
  OwnerFenceRefusal,
  OwnerFenceRegisterResult,
  OwnerFenceReleaseResult,
  OwnerFenceUnregisterInput,
  OwnerFenceUnregisterResult,
} from "./owner-fence.js";
import type { OwnerFenceLease } from "./owner-fence-store.js";
import {
  readTurnStateRequestJson,
  type TurnStateOwnerOp,
  type TurnStateOwnerResult,
} from "./turn-state-owner-routes.js";
import { json } from "./http/response.js";

export type LegacyOwnerFenceTarget = {
  register(input: OwnerFenceLeaseInput): Promise<OwnerFenceRegisterResult>;
  unregister(
    input: OwnerFenceUnregisterInput,
  ): Promise<OwnerFenceUnregisterResult>;
  assert(input: OwnerFenceAssertInput): Promise<OwnerFenceAssertResult>;
  begin(input: OwnerFenceBeginInput): Promise<OwnerFenceBeginResult>;
  assertBlocked(generation: string): Promise<OwnerFenceBlockedResult>;
  release(generation: string): Promise<OwnerFenceReleaseResult>;
  turnState(
    op: TurnStateOwnerOp,
    body: Record<string, unknown>,
  ): Promise<TurnStateOwnerResult>;
};

const TURN_STATE_OPS = new Set<string>([
  "prepare",
  "mark-uploaded",
  "commit",
  "publish-workspace",
  "abort-unpublished",
  "resolve",
  "confirm-restore",
  "drain",
  "purge",
]);

const legacyActive = (leases: OwnerFenceLease[]) =>
  Object.fromEntries(
    leases.map((lease) => [
      lease.leaseId,
      {
        leaseId: lease.leaseId,
        sessionId: lease.sessionId,
        turnId: lease.turnId,
        namespace: lease.namespace,
        role: lease.role,
        ownerGeneration: lease.ownerGeneration,
        reservationGeneration: lease.reservationGeneration,
        expiresAt: lease.expiresAt,
      },
    ]),
  );

const refusal = (result: OwnerFenceRefusal): Response =>
  json(
    { error: result.error, ...(result.code ? { code: result.code } : {}) },
    result.status,
  );

export const serveLegacyOwnerFenceRoute = async (
  target: LegacyOwnerFenceTarget,
  path: string,
  request: Request,
): Promise<Response> => {
  if (request.method !== "POST")
    return json({ error: "Method not allowed." }, 405);
  console.info(
    JSON.stringify({
      service: "stella-v2-cloud-builder",
      event: "owner_fence_legacy_route_served",
      path,
    }),
  );
  if (path.startsWith("turn-state/")) {
    const op = path.slice("turn-state/".length);
    if (!TURN_STATE_OPS.has(op)) return json({ error: "Not found." }, 404);
    let body: unknown;
    try {
      body = await readTurnStateRequestJson(request);
    } catch (error) {
      const status =
        error && typeof error === "object" && "status" in error
          ? Number(error.status)
          : 400;
      return json(
        { error: "Turn state request is invalid.", code: "invalid_request" },
        status,
      );
    }
    const result = await target.turnState(
      op as TurnStateOwnerOp,
      (body ?? {}) as Record<string, unknown>,
    );
    return result.ok
      ? json(result.value, result.status)
      : json({ error: result.error, code: result.code }, result.status);
  }
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) return json({ error: "JSON object required." }, 400);
  const input = body as never;
  switch (path) {
    case "register": {
      const result = await target.register(input);
      return result.ok
        ? json({ generation: result.generation, expiresAt: result.expiresAt })
        : refusal(result);
    }
    case "unregister": {
      const result = await target.unregister(input);
      return result.ok
        ? json({
            ok: true,
            ...(result.alreadyUnregistered ? { alreadyUnregistered: true } : {}),
          })
        : refusal(result);
    }
    case "assert": {
      const result = await target.assert(input);
      return result.ok
        ? json({ ok: true, expiresAt: result.expiresAt })
        : refusal(result);
    }
    case "begin": {
      const result = await target.begin(input);
      return result.ok
        ? json({
            generation: result.generation,
            mode: result.mode,
            active: legacyActive(result.active),
          })
        : refusal(result);
    }
    case "assert-blocked": {
      const result = await target.assertBlocked(String(body.generation ?? ""));
      return result.ok
        ? json({
            ok: true,
            active: legacyActive(result.active),
            ...(result.beginRequestId
              ? { beginRequestId: result.beginRequestId }
              : {}),
          })
        : refusal(result);
    }
    case "release": {
      const result = await target.release(String(body.generation ?? ""));
      return result.ok
        ? json({
            ok: true,
            generation: result.generation,
            ...(result.alreadyReleased ? { alreadyReleased: true } : {}),
          })
        : refusal(result);
    }
    default:
      return json({ error: "Not found." }, 404);
  }
};
