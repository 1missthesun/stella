export const GREP_TOOL_NAME = "Grep";

export const GREP_TOOL_DESCRIPTION =
  "Search file contents using ripgrep (internal).";

export const GREP_TOOL_PARAMETERS: Record<string, unknown> = {
  type: "object",
  properties: {
    pattern: { type: "string" },
    path: { type: "string" },
    glob: { type: "string" },
    type: { type: "string" },
    output_mode: {
      type: "string",
      enum: ["content", "files_with_matches", "count"],
    },
    case_insensitive: { type: "boolean" },
    context_lines: { type: "number" },
    max_results: { type: "number" },
  },
  required: ["pattern"],
};

export const GREP_TOOL_REPLAY = "safe" as const;
