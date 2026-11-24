import {
  defineExtension,
  defineTask,
  GenerationTask,
  hook,
  hookTask,
  type AfterToolsDecision,
  type ConversationId,
  type Extension,
} from "@earendil-works/pi-durable";

const EndAfterRound = defineTask<null, { phase: "done" }, AfterToolsDecision>({
  name: "stella.end-after-round",
  version: 1,
  initial: () => ({ phase: "done" }),
  phases: {
    done: (_task, runtime, context) =>
      runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: { terminate: true } } }), context),
  },
  abort: (_task, runtime, context) => runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
});

export const nextMessageExtension = (waits: (conversation: ConversationId) => boolean): Extension =>
  defineExtension({
    name: "stella-next-message",
    tasks: [EndAfterRound],
    hooks: [
      hook(GenerationTask, {
        afterTools: (_assistant, _results, api) => (waits(api.conversationId) ? { tasks: [hookTask(EndAfterRound, null)] } : undefined),
      }),
    ],
  });
