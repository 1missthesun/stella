import { BackendClient } from "@stella/contracts/backend/client";
import { AGENT_IDS } from "@stella/contracts/agent-runtime";
import type { ToolDefinition, ToolResult } from "../types.js";
import {
  EMAIL_TOOL_DESCRIPTOR,
  EMAIL_TOOL_SEARCH_TERMS,
  formatEmailInstructions,
  isEmailMailAction,
} from "./email-tool-def.js";

const failure = (message: string): ToolResult => ({ error: message });

const field = (args: Record<string, unknown>, key: string): string =>
  typeof args[key] === "string" ? (args[key] as string).trim() : "";

/**
 * The email tool on this computer. Everything runs on Stella's backend, with
 * the Gmail connected through Stella, so it works whether or not Google is
 * also signed in here.
 */
export const createEmailTool = (options: {
  getCloudBackendAuth?: () => { baseUrl: string; authToken: string } | null;
}): ToolDefinition => ({
  ...EMAIL_TOOL_DESCRIPTOR,
  parameters: EMAIL_TOOL_DESCRIPTOR.parameters as unknown as Record<string, unknown>,
  replay: "unsafe",
  agentTypes: [AGENT_IDS.ORCHESTRATOR, AGENT_IDS.GENERAL],
  demoted: { searchTerms: EMAIL_TOOL_SEARCH_TERMS },
  execute: async (rawArgs) => {
    const auth = options.getCloudBackendAuth?.();
    if (!auth) return failure("Email needs this computer signed in to Stella.");
    const args = (rawArgs ?? {}) as Record<string, unknown>;
    const client = new BackendClient({ baseUrl: auth.baseUrl, getToken: async () => auth.authToken });
    try {
      const action = field(args, "action");
      if (isEmailMailAction(action)) {
        const messageId = field(args, "message_id");
        if (!messageId) return failure("message_id is required.");
        const account = field(args, "account");
        const body = typeof args.body === "string" ? args.body : "";
        const result = await client.call("email.mail", {
          action,
          messageId,
          ...(account ? { account } : {}),
          ...(body ? { body } : {}),
          ...(args.all === true ? { all: true } : {}),
        });
        return { result: result.text };
      }
      let head = "";
      if (action === "add") {
        const added = await client.call("email.addRule", {
          text: field(args, "text"),
          when: field(args, "when"),
          action: field(args, "do") === "act" ? "act" : "tell",
        });
        head = `Saved instruction ${added.rule.ruleId}.\n`;
      } else if (action === "remove") {
        await client.call("email.removeRule", { ruleId: field(args, "ruleId") });
      } else if (action === "note") {
        await client.call("email.setNote", { note: field(args, "note") });
      } else if (action !== "list") {
        return failure("action must be read, reply, draft, add, list, remove or note.");
      }
      const { rules, note } = await client.call("email.rules", {});
      return { result: `${head}${formatEmailInstructions(rules, note)}` };
    } catch (error) {
      return failure(error instanceof Error ? error.message : "Email failed.");
    }
  },
});
