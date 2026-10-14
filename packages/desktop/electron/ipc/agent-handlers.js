import {
  IPC_PI_CHAT_REQUEST,
  IPC_AGENT_SEND_INPUT,
} from "@stella/contracts/desktop/ipc-channels";
import { requireMatchingCloudConversationId } from "../cloud-conversation-mode.js";
import {
  handleIpc,
} from "./typed-ipc.js";
export const registerAgentHandlers = (options) => {
    handleIpc(IPC_AGENT_SEND_INPUT, async (event, payload) => {
        if (!options.assertPrivilegedSender(event, IPC_AGENT_SEND_INPUT)) {
            throw new Error("Blocked untrusted request.");
        }
        const stellaHostRunner = options.getStellaHostRunner();
        if (!stellaHostRunner) {
            throw new Error("Stella runtime not available");
        }
        const conversationId = requireMatchingCloudConversationId(payload?.conversationId, options.uiState?.conversationId);
        await stellaHostRunner.waitUntilConnected(5_000);
        return await stellaHostRunner.sendAgentInput({
            ...payload,
            conversationId,
        });
    });
    handleIpc(IPC_PI_CHAT_REQUEST, async (event, request) => {
        if (!options.assertPrivilegedSender(event, IPC_PI_CHAT_REQUEST)) {
            throw new Error("Blocked untrusted request.");
        }
        const stellaHostRunner = options.getStellaHostRunner();
        if (!stellaHostRunner) {
            throw new Error("Stella runtime not available");
        }
        const op = request?.op;
        const conversationId = op === "submit" || op === "abort" || op === "move"
            ? requireMatchingCloudConversationId(request?.conversationId, options.uiState?.conversationId)
            : typeof request?.conversationId === "string"
                ? request.conversationId.trim()
                : "";
        if (!conversationId) {
            throw new Error("conversationId is required.");
        }
        await stellaHostRunner.waitUntilConnected(5_000);
        return await stellaHostRunner.piChat({ ...request, conversationId });
    });
};
