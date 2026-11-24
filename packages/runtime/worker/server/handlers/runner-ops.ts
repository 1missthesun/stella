import { METHOD_NAMES } from "@stella/contracts/protocol";
import { RunnerUnavailableError } from "../errors.js";
import { requireSession } from "../sessions.js";
import type { WorkerRpcHandlers } from "../rpc.js";
import { terminatePiChatCommands } from "../pi-chats.js";

const runnerNow = (ctx: Parameters<WorkerRpcHandlers[string]>[1]) =>
  requireSession(ctx.sessions, () => new RunnerUnavailableError()).runner.current();

export const runnerOpsHandlers: WorkerRpcHandlers = {
  [METHOD_NAMES.INTERNAL_WORKER_KILL_ALL_SHELLS]: async (_params, ctx) => {
    const session = requireSession(
      ctx.sessions,
      () => new RunnerUnavailableError(),
    );
    await Promise.all([
      session.runnerCell.get()?.killAllShells(),
      terminatePiChatCommands(session),
    ]);
    return { ok: true };
  },

  [METHOD_NAMES.INTERNAL_WORKER_GOOGLE_WORKSPACE_AUTH_STATUS]: (_params, ctx) =>
    runnerNow(ctx).googleWorkspaceGetAuthStatus(),

  [METHOD_NAMES.INTERNAL_WORKER_GOOGLE_WORKSPACE_CONNECT]: (_params, ctx) =>
    runnerNow(ctx).googleWorkspaceConnect(),

  [METHOD_NAMES.INTERNAL_WORKER_GOOGLE_WORKSPACE_DISCONNECT]: (_params, ctx) =>
    runnerNow(ctx).googleWorkspaceDisconnect(),
};
