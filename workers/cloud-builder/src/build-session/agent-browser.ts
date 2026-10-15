import type { RpcResponse } from "@stella/contracts/backend/protocol";
import type { CloudBrowserHandoffResult } from "@stella/contracts/cloud-browser";
import {
  CLOUD_BROWSER_HANDOFF_POLL_MS,
  type CloudBrowserBrokerResponse,
} from "@stella/executor-cloud/cloud-browser-broker-protocol";
import {
  CloudBrowserSuspendedError,
  createCloudBrowserClient,
  gatewayBrowserTransport,
  type CloudBrowserAuthority,
} from "../cloud-browser.js";
import { BROWSER_BUDGET_MESSAGE } from "../browser-billing.js";
import {
  BROWSER_HANDOFF_GRACE_MS,
  BROWSER_HANDOFF_POLL_MS,
} from "../orchestrator/constants.js";
import { unwrapRpc } from "../owner-store/errors.js";
import { ownerGateStub } from "../rpc-release.js";
import { sleepWithAbort } from "@stella/runtime/kernel/tools/effect-runtime.js";
import { AGENT_WATCHDOG_DEADLINE_KEY, log } from "./shared/keys.js";
import type { TurnRequest } from "./shared/types.js";

type AgentBrowserTurn = Pick<
  TurnRequest,
  | "ownerId"
  | "ownerGeneration"
  | "turnId"
  | "attemptGeneration"
  | "threadId"
  | "conversationId"
  | "originConversationId"
>;

type AgentBrowserEnv = Pick<Cloudflare.Env, "OWNER_GATES" | "BROWSER_GATEWAY">;

const BUDGET_CHECK_MS = 60_000;
const budgetCheckedAt = new Map<string, number>();

const answer = (body: CloudBrowserBrokerResponse): Response =>
  Response.json(body, { headers: { "cache-control": "no-store" } });

const failed = (error: unknown): Response =>
  answer({ ok: false, error: error instanceof Error ? error.message : String(error) });

/** The handoff card shows in the chat the agent was started from. */
const authorityOf = (turn: AgentBrowserTurn): CloudBrowserAuthority => ({
  ownerId: turn.ownerId,
  ownerGeneration: turn.ownerGeneration,
  conversationId: turn.originConversationId ?? turn.conversationId ?? turn.turnId,
  threadId: turn.threadId ?? turn.turnId,
  turnId: turn.turnId,
  attemptGeneration: turn.attemptGeneration ?? 1,
});

const ownerInternal = (env: AgentBrowserEnv, turn: AgentBrowserTurn) =>
  async (name: string, args: unknown): Promise<unknown> =>
    unwrapRpc(
      (await ownerGateStub(env.OWNER_GATES, turn.ownerId).ownerInternal({
        name,
        args,
        ownerGeneration: turn.ownerGeneration,
      })) as RpcResponse,
    );

const checkBudget = async (env: AgentBrowserEnv, turn: AgentBrowserTurn): Promise<void> => {
  const key = `${turn.ownerId}\0${turn.turnId}`;
  if (Date.now() - (budgetCheckedAt.get(key) ?? 0) < BUDGET_CHECK_MS) return;
  const access = await ownerGateStub(env.OWNER_GATES, turn.ownerId).billingAccess();
  if (!access.allowed) throw new Error(access.usageLimit?.message || BROWSER_BUDGET_MESSAGE);
  budgetCheckedAt.set(key, Date.now());
  while (budgetCheckedAt.size > 64) budgetCheckedAt.delete(budgetCheckedAt.keys().next().value!);
};

const extendWatchdog = async (storage: DurableObjectStorage, until: number): Promise<void> => {
  const current = await storage.get<number>(AGENT_WATCHDOG_DEADLINE_KEY);
  if (typeof current === "number" && current >= until) return;
  await storage.put(AGENT_WATCHDOG_DEADLINE_KEY, until);
};

const HANDOFF_RESULTS: ReadonlySet<string> = new Set<CloudBrowserHandoffResult>([
  "approved",
  "canceled",
  "expired",
  "failed",
]);

/**
 * A container agent's cloud browser, behind its turn broker: commands go to
 * the Browser Gateway as the pi agents' do, and a login handoff is opened in
 * the owner store (card + push on the user's devices) and waited on through
 * bounded `wait` requests. The agent's watchdog is held past the handoff's
 * expiry while the user signs in.
 */
export const serveAgentBrowserRequest = async (
  env: AgentBrowserEnv,
  storage: DurableObjectStorage,
  turn: AgentBrowserTurn,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Response> => {
  const gateway = env.BROWSER_GATEWAY;
  if (!gateway) return failed("The cloud browser is not available in this deployment.");
  const authority = authorityOf(turn);
  const internal = ownerInternal(env, turn);
  try {
    if (body.op === "call") {
      const method = typeof body.method === "string" ? body.method : "";
      const args = Array.isArray(body.args) ? body.args : [];
      if (method !== "close") await checkBudget(env, turn);
      const client = createCloudBrowserClient(gatewayBrowserTransport(gateway, authority));
      try {
        const started = Date.now();
        const value = await client.call(method, args, signal);
        log("info", "agent_browser_command", {
          turnId: turn.turnId,
          threadId: authority.threadId,
          method,
          ms: Date.now() - started,
        });
        return answer({ ok: true, value });
      } catch (error) {
        const suspension = client.suspension();
        if (!(error instanceof CloudBrowserSuspendedError) || !suspension) throw error;
        await extendWatchdog(storage, suspension.expiresAt + BROWSER_HANDOFF_GRACE_MS);
        await internal("browser.handoffOpen", {
          conversationId: authority.conversationId,
          threadId: authority.threadId,
          turnId: authority.turnId,
          attemptGeneration: authority.attemptGeneration,
          toolCallId: suspension.toolCallId,
          suspension,
        });
        log("info", "agent_browser_handoff_started", {
          turnId: turn.turnId,
          threadId: authority.threadId,
          interactionId: suspension.interactionId,
          kind: suspension.interactionKind,
        });
        return answer({
          ok: true,
          handoff: {
            interactionId: suspension.interactionId,
            displayOrigin: suspension.displayOrigin,
            expiresAt: suspension.expiresAt,
          },
        });
      }
    }
    if (body.op === "wait" && typeof body.interactionId === "string") {
      const interaction = { interactionId: body.interactionId };
      const until = Date.now() + CLOUD_BROWSER_HANDOFF_POLL_MS;
      while (!signal.aborted && Date.now() < until) {
        const state = (await internal("browser.handoffState", interaction).catch(() => undefined)) as
          | { state: string; result?: string; safeMessage?: string }
          | undefined;
        if (
          state &&
          state.state !== "pending" &&
          state.state !== "human_control" &&
          state.result &&
          HANDOFF_RESULTS.has(state.result)
        ) {
          log("info", "agent_browser_handoff_ended", {
            turnId: turn.turnId,
            interactionId: interaction.interactionId,
            result: state.result,
          });
          return answer({
            ok: true,
            ended: {
              result: state.result as CloudBrowserHandoffResult,
              message: state.safeMessage ?? "Browser access ended.",
            },
          });
        }
        await sleepWithAbort(
          BROWSER_HANDOFF_POLL_MS,
          signal,
          () => new Error("Browser handoff wait aborted."),
        ).catch(() => undefined);
      }
      return answer({ ok: true, waiting: true });
    }
    if (body.op === "cancel" && typeof body.interactionId === "string") {
      await internal("browser.handoffCancel", { interactionId: body.interactionId });
      return answer({ ok: true, value: null });
    }
    if (body.op === "checkpoint") {
      const transport = gatewayBrowserTransport(gateway, authority);
      const client = createCloudBrowserClient(transport);
      await client.checkpoint(signal, { force: true });
      return answer({ ok: true, value: null });
    }
    return failed("Unknown cloud browser request.");
  } catch (error) {
    return failed(error);
  }
};
