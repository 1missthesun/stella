import { Effect } from "effect";
import {
  METHOD_NAMES,
  type RuntimeVoiceChatPayload,
  type RuntimeVoiceOrchestratorConfig,
  type RuntimeVoiceToolCallResult,
} from "@stella/contracts/protocol";
import { VoiceUnavailableError } from "../errors.js";
import * as HostBus from "../host-bus.js";
import { piChatsFor } from "../pi-chats.js";
import { piVoiceChat } from "../pi-voice.js";
import * as WorkerSessions from "../sessions.js";
import { fromPromise, type WorkerRpcHandlers } from "../rpc.js";

const voiceSession = WorkerSessions.sessionOrFail(
  () => new VoiceUnavailableError(),
);

export const voiceHandlers: WorkerRpcHandlers = {
  // A voice call talks to the conversation's harness: what was said is
  // written into its transcript, the voice model's requests are hidden turns
  // of its orchestrator, and a call starts with its history.
  [METHOD_NAMES.INTERNAL_WORKER_VOICE_PERSIST_TRANSCRIPT]: (params) =>
    Effect.gen(function* () {
      const session = yield* voiceSession;
      const said = params as {
        conversationId: string;
        eventId: string;
        timestamp: number;
        role: "user" | "assistant";
        text: string;
        uiVisibility?: "visible" | "hidden";
        voiceSession?: { durationMs: number };
      };
      const hostBus = yield* HostBus.Service;
      return yield* fromPromise(async () => {
        await (await piChatsFor(session, hostBus)).voiceTranscript(said.conversationId, {
          eventId: said.eventId,
          role: said.role,
          text: said.text,
          timestamp: said.timestamp,
          ...(said.uiVisibility === "hidden" ? { hidden: true } : {}),
          ...(said.voiceSession ? { voiceSession: said.voiceSession } : {}),
        });
        return { ok: true as const };
      });
    }),

  [METHOD_NAMES.INTERNAL_WORKER_VOICE_ORCHESTRATOR_CHAT]: (params) =>
    Effect.gen(function* () {
      const session = yield* voiceSession;
      const payload = params as RuntimeVoiceChatPayload;
      const hostBus = yield* HostBus.Service;
      return yield* fromPromise(async () =>
        piVoiceChat(await piChatsFor(session, hostBus), hostBus, payload),
      );
    }),

  [METHOD_NAMES.INTERNAL_WORKER_VOICE_ORCHESTRATOR_CONFIG]: (params) =>
    Effect.gen(function* () {
      const session = yield* voiceSession;
      const request = params as { conversationId: string };
      // A call's voice model has no tools and writes its own brief; what it
      // reads from here is the conversation so far, from the transcript.
      const hostBus = yield* HostBus.Service;
      const history = yield* fromPromise(async () =>
        (await piChatsFor(session, hostBus)).voiceHistory(request.conversationId),
      );
      return {
        instructions: "",
        tools: [],
        ...(history.length > 0 ? { history } : {}),
      } satisfies RuntimeVoiceOrchestratorConfig;
    }),

  // A call hands its work to Stella (`voiceOrchestratorChat`), whose tools
  // run in the conversation; the voice model runs none.
  [METHOD_NAMES.INTERNAL_WORKER_VOICE_EXECUTE_TOOL]: () =>
    Effect.succeed<RuntimeVoiceToolCallResult>({
      output: "Voice calls run no tools here; ask Stella to do it.",
      error: "Voice tools are not available; the call delegates to Stella.",
    }),

};
