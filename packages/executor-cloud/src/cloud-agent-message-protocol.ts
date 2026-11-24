export const CLOUD_AGENT_MESSAGE_PATH = "/api/cloud/agent-message";
export const CLOUD_AGENT_MESSAGE_TOOL = "send_message";

export type CloudAgentMessageRequest = {
  turnId: string;
  callId: string;
  to: string;
  message?: string;
  done?: boolean;
};

export type CloudAgentMessageResponse =
  | {
      ok: true;
      text: string;
      starter: boolean;
    }
  | { ok: false; error: string };
