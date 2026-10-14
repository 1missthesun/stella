import type { Context, JsonValue } from "@earendil-works/chord";
import type { TSchema } from "@sinclair/typebox";
import { defineExtension, type Extension } from "@earendil-works/pi-durable";
import { STELLA_CODING_EXTENSION } from "@stella/agent/stella/coding";
import type { SerializedAgentToolResult } from "@stella/executor-cloud/attached-tool-protocol";
import {
  APPLY_PATCH_TOOL_DESCRIPTION,
  APPLY_PATCH_TOOL_NAME,
  APPLY_PATCH_TOOL_PARAMETERS,
  APPLY_PATCH_TOOL_REPLAY,
} from "@stella/runtime/kernel/tools/defs/apply-patch-def.js";
import {
  EDIT_TOOL_DESCRIPTION,
  EDIT_TOOL_NAME,
  EDIT_TOOL_PARAMETERS,
  EDIT_TOOL_REPLAY,
} from "@stella/runtime/kernel/tools/defs/edit-def.js";
import {
  EXEC_COMMAND_TOOL_DESCRIPTION,
  EXEC_COMMAND_TOOL_NAME,
  EXEC_COMMAND_TOOL_PARAMETERS,
  EXEC_COMMAND_TOOL_REPLAY,
} from "@stella/runtime/kernel/tools/defs/exec-command-def.js";
import {
  GREP_TOOL_DESCRIPTION,
  GREP_TOOL_NAME,
  GREP_TOOL_PARAMETERS,
  GREP_TOOL_REPLAY,
} from "@stella/runtime/kernel/tools/defs/grep-def.js";
import {
  READ_TOOL_DESCRIPTION,
  READ_TOOL_NAME,
  READ_TOOL_PARAMETERS,
  READ_TOOL_REPLAY,
} from "@stella/runtime/kernel/tools/defs/read-def.js";
import {
  WRITE_STDIN_TOOL_DESCRIPTION,
  WRITE_STDIN_TOOL_NAME,
  WRITE_STDIN_TOOL_PARAMETERS,
  WRITE_STDIN_TOOL_REPLAY,
} from "@stella/runtime/kernel/tools/defs/write-stdin-def.js";
import {
  WRITE_TOOL_DESCRIPTION,
  WRITE_TOOL_NAME,
  WRITE_TOOL_PARAMETERS,
  WRITE_TOOL_REPLAY,
} from "@stella/runtime/kernel/tools/defs/write-def.js";

export type PiAttachedToolCall = {
  conversationId: number;
  callId: string;
  toolName: string;
  params: Record<string, unknown>;
};

export type PiAttachedToolRun = (call: PiAttachedToolCall, context: Context) => Promise<SerializedAgentToolResult>;

const TOOLS = [
  [EXEC_COMMAND_TOOL_NAME, EXEC_COMMAND_TOOL_DESCRIPTION, EXEC_COMMAND_TOOL_PARAMETERS, EXEC_COMMAND_TOOL_REPLAY],
  [WRITE_STDIN_TOOL_NAME, WRITE_STDIN_TOOL_DESCRIPTION, WRITE_STDIN_TOOL_PARAMETERS, WRITE_STDIN_TOOL_REPLAY],
  [READ_TOOL_NAME, READ_TOOL_DESCRIPTION, READ_TOOL_PARAMETERS, READ_TOOL_REPLAY],
  [WRITE_TOOL_NAME, WRITE_TOOL_DESCRIPTION, WRITE_TOOL_PARAMETERS, WRITE_TOOL_REPLAY],
  [EDIT_TOOL_NAME, EDIT_TOOL_DESCRIPTION, EDIT_TOOL_PARAMETERS, EDIT_TOOL_REPLAY],
  [GREP_TOOL_NAME, GREP_TOOL_DESCRIPTION, GREP_TOOL_PARAMETERS, GREP_TOOL_REPLAY],
  [APPLY_PATCH_TOOL_NAME, APPLY_PATCH_TOOL_DESCRIPTION, APPLY_PATCH_TOOL_PARAMETERS, APPLY_PATCH_TOOL_REPLAY],
] as const;

const asResult = (result: SerializedAgentToolResult) => {
  const text = result.outcome.kind === "ok" ? result.outcome.text : result.outcome.message;
  const images = result.authorizedImages.map((image) => ({
    type: "image" as const,
    data: image.data,
    mimeType: image.mimeType,
  }));
  let details: JsonValue | undefined;
  try {
    details = result.details === undefined ? undefined : (JSON.parse(JSON.stringify(result.details)) as JsonValue);
  } catch {
    details = undefined;
  }
  return {
    content: [{ type: "text" as const, text: text || "(no output)" }, ...images],
    ...(result.outcome.kind === "error" ? { isError: true } : {}),
    ...(details === undefined ? {} : { details }),
  };
};

export const piAttachedCoding = (run: PiAttachedToolRun): Extension =>
  defineExtension({
    name: STELLA_CODING_EXTENSION,
    tools: TOOLS.map(([name, description, parameters, replay]) => ({
      name,
      description,
      parameters: parameters as unknown as TSchema,
      // A command or a write may already have crossed into the world: a
      // rerun after an eviction must not run it twice.
      replay: replay === "safe" ? ("safe" as const) : ("unsafe" as const),
      async execute(args: unknown, api: { conversationId: number; callId: string }, context: Context) {
        return asResult(
          await run(
            {
              conversationId: api.conversationId,
              callId: api.callId,
              toolName: name,
              params: (args ?? {}) as Record<string, unknown>,
            },
            context,
          ),
        );
      },
    })),
  });
