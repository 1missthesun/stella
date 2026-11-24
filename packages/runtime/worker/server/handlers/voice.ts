import {
  METHOD_NAMES,
  type RuntimeVoiceChatPayload,
  type RuntimeVoiceOrchestratorConfig,
  type RuntimeVoiceToolCallResult,
} from "@stella/contracts/protocol";
import { VoiceUnavailableError } from "../errors.js";
import { piChatsFor } from "../pi-chats.js";
import { piVoiceChat } from "../pi-voice.js";
import { requireSession } from "../sessions.js";
import type { WorkerRpcHandlers } from "../rpc.js";

export const voiceHandlers: WorkerRpcHandlers = {
  [METHOD_NAMES.INTERNAL_WORKER_VOICE_PERSIST_TRANSCRIPT]: async (
    params,
    ctx,
  ) => {
    const session = requireSession(
      ctx.sessions,
      () => new VoiceUnavailableError(),
    );
    const said = params as {
      conversationId: string;
      eventId: string;
      timestamp: number;
      role: "user" | "assistant";
      text: string;
      uiVisibility?: "visible" | "hidden";
      voiceSession?: { durationMs: number };
    };
    await (await piChatsFor(session, ctx.hostBus)).voiceTranscript(
      said.conversationId,
      {
        eventId: said.eventId,
        role: said.role,
        text: said.text,
        timestamp: said.timestamp,
        ...(said.uiVisibility === "hidden" ? { hidden: true } : {}),
        ...(said.voiceSession ? { voiceSession: said.voiceSession } : {}),
      },
    );
    return { ok: true as const };
  },

  [METHOD_NAMES.INTERNAL_WORKER_VOICE_ORCHESTRATOR_CHAT]: async (
    params,
    ctx,
  ) => {
    const session = requireSession(
      ctx.sessions,
      () => new VoiceUnavailableError(),
    );
    const payload = params as RuntimeVoiceChatPayload;
    return await piVoiceChat(
      await piChatsFor(session, ctx.hostBus),
      ctx.hostBus,
      payload,
    );
  },

  [METHOD_NAMES.INTERNAL_WORKER_VOICE_ORCHESTRATOR_CONFIG]: async (
    params,
    ctx,
  ) => {
    const session = requireSession(
      ctx.sessions,
      () => new VoiceUnavailableError(),
    );
    const request = params as { conversationId: string };
    const history = await (await piChatsFor(session, ctx.hostBus)).voiceHistory(
      request.conversationId,
    );
    return {
      instructions: "",
      tools: [],
      ...(history.length > 0 ? { history } : {}),
    } satisfies RuntimeVoiceOrchestratorConfig;
  },

  [METHOD_NAMES.INTERNAL_WORKER_VOICE_EXECUTE_TOOL]: () =>
    ({
      output: "Voice calls run no tools here; ask Stella to do it.",
      error: "Voice tools are not available; the call delegates to Stella.",
    }) satisfies RuntimeVoiceToolCallResult,
};
