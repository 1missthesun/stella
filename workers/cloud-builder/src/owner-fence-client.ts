import type {
  OwnerFenceAssertInput,
  OwnerFenceAssertResult,
  OwnerFenceLeaseInput,
  OwnerFenceRegisterResult,
  OwnerFenceUnregisterInput,
  OwnerFenceUnregisterResult,
} from "./owner-fence.js";
import type {
  TurnStateOwnerOp,
  TurnStateOwnerResult,
} from "./turn-state-owner-routes.js";
import { releasingStub } from "./rpc-release.js";

/**
 * How objects other than OwnerGate reach the owner fence: typed RPC methods
 * on the owner's OwnerGate.
 *
 * Mixed-version window: after a deploy an OwnerGate instance can keep running
 * the previous Worker for minutes, and that Worker only serves the old
 * `/owner-fence/*` fetch routes. A call that the old instance does not
 * implement falls back to that route. Remove `legacy` (and OwnerGate's route
 * adapter, owner-fence-legacy-route.ts) once no deployed Worker predates the
 * typed methods.
 */

type OwnerGateFenceRpc = {
  fenceRegister(input: OwnerFenceLeaseInput): Promise<OwnerFenceRegisterResult>;
  fenceUnregister(
    input: OwnerFenceUnregisterInput,
  ): Promise<OwnerFenceUnregisterResult>;
  fenceAssert(input: OwnerFenceAssertInput): Promise<OwnerFenceAssertResult>;
  turnStateOperation(
    op: TurnStateOwnerOp,
    body: Record<string, unknown>,
  ): Promise<TurnStateOwnerResult>;
  fetch(input: string, init?: RequestInit): Promise<Response>;
};

export type OwnerFenceClient = {
  register(
    input: Omit<OwnerFenceLeaseInput, "ownerId">,
  ): Promise<OwnerFenceRegisterResult>;
  unregister(
    input: Omit<OwnerFenceUnregisterInput, "ownerId">,
  ): Promise<OwnerFenceUnregisterResult>;
  assert(
    input: Omit<OwnerFenceAssertInput, "ownerId">,
  ): Promise<OwnerFenceAssertResult>;
  turnState(
    op: TurnStateOwnerOp,
    body: Record<string, unknown>,
  ): Promise<TurnStateOwnerResult>;
};

const LEGACY_OWNER_FENCE_ID_HEADER = "x-stella-owner-fence-id";
const TURN_STATE_RESPONSE_MAX_BYTES = 256 * 1024;

const notImplemented = (error: unknown): boolean =>
  error instanceof Error &&
  /RPC receiver does not implement the method/u.test(error.message);

const legacyFetch = async (
  gate: OwnerGateFenceRpc,
  ownerId: string,
  path: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> => {
  const response = await gate.fetch(`https://owner-gate/owner-fence/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [LEGACY_OWNER_FENCE_ID_HEADER]: ownerId,
    },
    body: JSON.stringify({ ...body, ownerId }),
  });
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > TURN_STATE_RESPONSE_MAX_BYTES)
    throw new Error("Owner fence response exceeded its bound.");
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { status: response.status, body: parsed };
};

const field = (value: unknown, key: string): unknown =>
  value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;

const legacyRefusal = (status: number, body: unknown) => ({
  ok: false as const,
  status: (status === 400 || status === 503 ? status : 409) as 400 | 409 | 503,
  ...(typeof field(body, "code") === "string"
    ? { code: field(body, "code") as string }
    : {}),
  error:
    typeof field(body, "error") === "string"
      ? (field(body, "error") as string)
      : `Owner fence refused (${status}).`,
});

const withLegacy = async <T>(
  rpc: () => Promise<T>,
  legacy: () => Promise<T>,
): Promise<T> => {
  try {
    return await rpc();
  } catch (error) {
    if (!notImplemented(error)) throw error;
    return await legacy();
  }
};

export const ownerFenceClient = (
  namespace: DurableObjectNamespace<Rpc.DurableObjectBranded | undefined>,
  ownerId: string,
): OwnerFenceClient => {
  const gate = (): OwnerGateFenceRpc =>
    releasingStub(namespace.getByName(ownerId)) as unknown as OwnerGateFenceRpc;
  return {
    register: (input) =>
      withLegacy(
        () => gate().fenceRegister({ ...input, ownerId }),
        async () => {
          const { status, body } = await legacyFetch(gate(), ownerId, "register", input);
          const generation = field(body, "generation");
          const expiresAt = field(body, "expiresAt");
          return status === 200 &&
            typeof generation === "string" &&
            typeof expiresAt === "number"
            ? { ok: true, generation, expiresAt }
            : legacyRefusal(status, body);
        },
      ),
    unregister: (input) =>
      withLegacy(
        () => gate().fenceUnregister({ ...input, ownerId }),
        async () => {
          const { status, body } = await legacyFetch(gate(), ownerId, "unregister", input);
          return status === 200 ? { ok: true } : legacyRefusal(status, body);
        },
      ),
    assert: (input) =>
      withLegacy(
        () => gate().fenceAssert({ ...input, ownerId }),
        async () => {
          const { status, body } = await legacyFetch(gate(), ownerId, "assert", input);
          const expiresAt = field(body, "expiresAt");
          return status === 200 && typeof expiresAt === "number"
            ? { ok: true, expiresAt }
            : legacyRefusal(status, body);
        },
      ),
    turnState: (op, body) =>
      withLegacy(
        () => gate().turnStateOperation(op, body),
        async () => {
          const result = await legacyFetch(gate(), ownerId, `turn-state/${op}`, body);
          if (result.status === 200 || result.status === 202)
            return { ok: true, status: result.status, value: result.body };
          const code = field(result.body, "code");
          const error = field(result.body, "error");
          return {
            ok: false,
            status: result.status,
            code: typeof code === "string" ? code : "internal_error",
            error: typeof error === "string" ? error : "Turn state owner route failed.",
          };
        },
      ),
  };
};
