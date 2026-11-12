import type { TSchema } from "@sinclair/typebox";
import type { AgentToolResult } from "@stella/runtime/kernel/agent-core/types.js";
import {
  EMAIL_TOOL_DESCRIPTOR,
  EMAIL_TOOL_SEARCH_TERMS,
  formatEmailInstructions,
  type EmailInstructionRule,
} from "@stella/runtime/kernel/tools/defs/email-tool-def.js";
import type { CloudCodeSourceAgentTool } from "./cloud-code-tool.js";
import type { OwnerInternalCall } from "./owner-store/registry.js";

const text = (value: string, details: unknown): AgentToolResult<unknown> => ({
  content: [{ type: "text", text: value }],
  details,
});

export const createCloudEmailTools = (context: { ownerInternal: OwnerInternalCall }): CloudCodeSourceAgentTool[] => [
  {
    name: EMAIL_TOOL_DESCRIPTOR.name,
    label: EMAIL_TOOL_DESCRIPTOR.label,
    workingText: EMAIL_TOOL_DESCRIPTOR.workingText,
    description: EMAIL_TOOL_DESCRIPTOR.description,
    parameters: EMAIL_TOOL_DESCRIPTOR.parameters as unknown as TSchema,
    demoted: { searchTerms: EMAIL_TOOL_SEARCH_TERMS },
    replay: "keyed",
    execute: async (_toolCallId, params) => {
      try {
        const payload = (await context.ownerInternal("email.tool", params ?? {})) as {
          text?: string;
          rules?: { ruleId: string; text: string; when: string; action: string }[];
          note?: string;
          added?: { ruleId: string };
        };
        if (typeof payload.text === "string") return text(payload.text, null);
        const rules: EmailInstructionRule[] = payload.rules ?? [];
        const head = payload.added ? `Saved instruction ${payload.added.ruleId}.\n` : "";
        return text(`${head}${formatEmailInstructions(rules, payload.note ?? "")}`, payload);
      } catch (error) {
        return { ...text(error instanceof Error ? error.message : "Email failed.", null), isError: true };
      }
    },
  },
];
