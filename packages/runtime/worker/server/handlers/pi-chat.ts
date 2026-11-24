import { METHOD_NAMES } from "@stella/contracts/protocol";
import type { PiChatRequest, PiChatUsageRequest } from "@stella/contracts/pi-chat";
import { RunnerUnavailableError } from "../errors.js";
import { piChatRequest } from "../pi-chats.js";
import { requireSession } from "../sessions.js";
import type { WorkerRpcHandlers } from "../rpc.js";

export const piChatHandlers: WorkerRpcHandlers = {
  [METHOD_NAMES.INTERNAL_WORKER_PI_CHAT]: async (params, ctx) => {
    const session = requireSession(
      ctx.sessions,
      () => new RunnerUnavailableError(),
    );
    await session.runner.ensureInitialized();
    return await piChatRequest(
      session,
      ctx.hostBus,
      params as PiChatRequest | PiChatUsageRequest,
    );
  },
};
