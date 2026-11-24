/**
 * Realtime (OpenAI BYOK, xAI): an unanswered function call wedges the
 * conversation, so a superseded call still gets its `function_call_output`,
 * just no `response.create`.
 */

import type { DelegationChannel } from "./delegation-controller";
import type { SessionAppendChannel } from "./session-append-channel";

export const createAppendDelegationChannel = (
  appends: SessionAppendChannel,
): DelegationChannel => ({
  announceStart: (taskId, text) => {
    appends.append("thinking", text, taskId);
  },
  reportProgress: (taskId, text) => {
    appends.append("thinking", text, taskId);
  },
  complete: (taskId, outcome) => {
    if (outcome.kind === "superseded") return;
    appends.append("commentary", outcome.text, taskId);
  },
});

export const createFunctionCallDelegationChannel = (
  send: (event: Record<string, unknown>) => void,
): DelegationChannel => ({
  complete: (taskId, outcome) => {
    send({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: taskId,
        output: outcome.text,
      },
    });
    if (outcome.kind === "superseded") return;
    send({ type: "response.create" });
  },
});
