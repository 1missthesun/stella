import type { ToolMetadata, ToolResult } from "@stella/runtime/kernel/tools/types.js";
import { AGENT_MESSAGE_MAX_CHARS, STELLA_MESSAGE_TARGET } from "@stella/contracts/agent-directory";
import {
  DONE_ACCEPTED_TEXT,
  SEND_MESSAGE_DONE_DESCRIPTION,
  SEND_MESSAGE_DONE_PARAMETER,
} from "@stella/contracts/agent-messaging";
import {
  CLOUD_AGENT_MESSAGE_PATH,
  CLOUD_AGENT_MESSAGE_TOOL,
  type CloudAgentMessageRequest,
  type CloudAgentMessageResponse,
} from "./cloud-agent-message-protocol.js";

export { CLOUD_AGENT_MESSAGE_PATH, CLOUD_AGENT_MESSAGE_TOOL };

export const cloudAgentMessageTool: ToolMetadata = {
  name: CLOUD_AGENT_MESSAGE_TOOL,
  description: `Message whoever started you ("${STELLA_MESSAGE_TARGET}", or your lead's thread_id), or another agent or session by thread_id. It is the only way your words reach anyone: what you write outside it stays in your own thread. With done: true to whoever started you, it is your finished report: it goes out as this turn ends and closes your task. Without done it goes out at once: a question, a blocker, an answer mid-task, a note to a teammate.`,
  parameters: {
    type: "object",
    properties: {
      thread_id: { type: "string", description: `Whoever started you ("${STELLA_MESSAGE_TARGET}" or your lead's thread_id), or another agent's or session's thread_id.` },
      message: { type: "string", description: "The message, or with done your whole report, self-contained." },
      [SEND_MESSAGE_DONE_PARAMETER]: { type: "boolean", description: SEND_MESSAGE_DONE_DESCRIPTION },
    },
    required: ["thread_id", "message"],
    additionalProperties: false,
  },
};

/** One turn's `send_message`: messages go out at once; a `done` report is held for the turn's end. */
export type CloudAgentMessenger = {
  run: (callId: string, params: Record<string, unknown>) => Promise<ToolResult>;
  /** The finished report the turn sent with done, if any. */
  report: () => string | undefined;
  /** Whether the turn sent anything (a message or its report) to whoever started it. */
  sentToStarter: () => boolean;
  /** Everything the turn sent, its report included. */
  sent: () => readonly string[];
};

export const createCloudAgentMessenger = (
  post: (route: string, body: unknown) => Promise<Response>,
  turnId: string,
): CloudAgentMessenger => {
  let report: string | undefined;
  let toStarter = false;
  const sent: string[] = [];
  return {
    run: async (callId, params) => {
      const to = typeof params.thread_id === "string" ? params.thread_id.trim() : "";
      const message = typeof params.message === "string" ? params.message.trim() : "";
      const done = params[SEND_MESSAGE_DONE_PARAMETER] === true;
      if (!to) return { error: `thread_id is required: "${STELLA_MESSAGE_TARGET}", your lead's thread_id, or another agent's.` };
      if (!message) return { error: "message is required." };
      if (!done && message.length > AGENT_MESSAGE_MAX_CHARS) {
        return { error: `A message can be at most ${AGENT_MESSAGE_MAX_CHARS} characters; send a longer report with done: true, or split it.` };
      }
      const request: CloudAgentMessageRequest = {
        turnId,
        callId,
        to,
        ...(done ? { done: true } : { message }),
      };
      const response = await post(CLOUD_AGENT_MESSAGE_PATH, request);
      const body = (await response.json().catch(() => null)) as CloudAgentMessageResponse | null;
      if (!body || !body.ok) {
        return { error: body?.error ?? `Your message could not be sent (${response.status}). Try again.` };
      }
      if (body.starter) toStarter = true;
      sent.push(message);
      if (done) {
        // A second one adds to the first (something arrived as it was sent).
        report = report === undefined || report === message ? message : `${report}\n\n${message}`;
        return { result: DONE_ACCEPTED_TEXT };
      }
      return { result: body.text };
    },
    report: () => report,
    sentToStarter: () => toStarter,
    sent: () => sent,
  };
};
