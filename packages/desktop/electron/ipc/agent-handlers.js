import { promises as fs } from "fs";
import path from "path";
import {
  IPC_AGENT_ONE_SHOT_COMPLETION,
  IPC_PI_CHAT_REQUEST,
  IPC_AGENT_SEND_INPUT,
  IPC_DEVTEST_TRIGGER_VITE_ERROR,
  IPC_DEVTEST_FIX_VITE_ERROR,
} from "@stella/contracts/desktop/ipc-channels";
import { requireMatchingCloudConversationId } from "../cloud-conversation-mode.js";
import {
  handleIpc,
} from "./typed-ipc.js";
export const registerAgentHandlers = (options) => {
    handleIpc(IPC_AGENT_ONE_SHOT_COMPLETION, async (_event, payload) => {
        const stellaHostRunner = options.getStellaHostRunner();
        if (!stellaHostRunner) {
            throw new Error("Stella runtime is not ready.");
        }
        return await stellaHostRunner.runOneShotCompletion(payload);
    });
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
    // The desktop chat: the renderer submits to and watches one
    // conversation's harness in the runtime.
    handleIpc(IPC_PI_CHAT_REQUEST, async (event, request) => {
        if (!options.assertPrivilegedSender(event, IPC_PI_CHAT_REQUEST)) {
            throw new Error("Blocked untrusted request.");
        }
        const stellaHostRunner = options.getStellaHostRunner();
        if (!stellaHostRunner) {
            throw new Error("Stella runtime not available");
        }
        const op = request?.op;
        // Sending and stopping act on the selected conversation only; a
        // window may stop watching one it has left.
        const conversationId = op === "submit" || op === "abort"
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
    // Dev-only: trigger/fix a Vite compile error for testing the error overlay
    const TEST_BROKEN_FILE = path.join(options.stellaAppDir, "src", "testing", "__vite_error_trigger.tsx");
    handleIpc(IPC_DEVTEST_TRIGGER_VITE_ERROR, async (event) => {
        if (!options.assertPrivilegedSender(event, IPC_DEVTEST_TRIGGER_VITE_ERROR)) {
            throw new Error("Blocked untrusted request.");
        }
        await fs.mkdir(path.dirname(TEST_BROKEN_FILE), { recursive: true });
        await fs.writeFile(TEST_BROKEN_FILE, "const x: number = {\n// deliberately broken syntax\n", "utf-8");
        return { ok: true };
    });
    handleIpc(IPC_DEVTEST_FIX_VITE_ERROR, async (event) => {
        if (!options.assertPrivilegedSender(event, IPC_DEVTEST_FIX_VITE_ERROR)) {
            throw new Error("Blocked untrusted request.");
        }
        try {
            await fs.unlink(TEST_BROKEN_FILE);
        }
        catch {
            // Ignore missing temp files during cleanup.
        }
        return { ok: true };
    });
};
