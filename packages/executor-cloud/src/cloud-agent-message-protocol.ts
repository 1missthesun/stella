export const CLOUD_AGENT_MESSAGE_PATH = "/api/cloud/agent-message";
export const CLOUD_AGENT_MESSAGE_TOOL = "send_message";

/** What a cloud task's `send_message` posts through its turn broker; the sender is the turn's own thread. */
export type CloudAgentMessageRequest = {
  turnId: string;
  /** The tool call's id: with the turn it keys the message, so a retried post is delivered once. */
  callId: string;
  to: string;
  /** Left out when `done`: a finished report is held in the executor and filed as the turn ends. */
  message?: string;
  done?: boolean;
};

export type CloudAgentMessageResponse =
  | {
      ok: true;
      text: string;
      /** It went to (or, with `done`, is for) whoever started the task. */
      starter: boolean;
    }
  | { ok: false; error: string };
