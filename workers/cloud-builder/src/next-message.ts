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

/**
 * Each message is a turn of its own here, queued behind the one under way. A
 * run one waits behind ends once its step's calls have finished, so the model
 * reads their results and the message together before it chooses the next
 * step, as a message sent on a computer is read.
 */
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
