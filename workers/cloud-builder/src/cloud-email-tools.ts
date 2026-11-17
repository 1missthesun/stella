import type { TSchema } from "@sinclair/typebox";
import { EMAIL_TOOL_DESCRIPTOR } from "@stella/runtime/kernel/tools/defs/email-tool-def.js";
import type { CloudCodeSourceAgentTool } from "./cloud-code-tool.js";
import type { OwnerInternalCall } from "./owner-store/registry.js";

export const createCloudEmailTools = (context: { ownerInternal: OwnerInternalCall }): CloudCodeSourceAgentTool[] => [
  {
    name: EMAIL_TOOL_DESCRIPTOR.name,
    label: EMAIL_TOOL_DESCRIPTOR.label,
    workingText: EMAIL_TOOL_DESCRIPTOR.workingText,
    description: EMAIL_TOOL_DESCRIPTOR.description,
    parameters: EMAIL_TOOL_DESCRIPTOR.parameters as unknown as TSchema,
    replay: "keyed",
    execute: async (_toolCallId, params) => {
      try {
        const payload = (await context.ownerInternal("email.tool", params ?? {})) as { text?: string };
        return { content: [{ type: "text", text: payload.text ?? "" }], details: null };
      } catch (error) {
        return { content: [{ type: "text", text: error instanceof Error ? error.message : "Email failed." }], details: null, isError: true };
      }
    },
  },
];
