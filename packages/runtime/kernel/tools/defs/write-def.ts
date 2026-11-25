export const WRITE_TOOL_NAME = "Write";

export const WRITE_TOOL_DESCRIPTION =
  "Create or overwrite a text file. File tools take absolute paths and do not follow the shell's cwd.";

export const WRITE_TOOL_PARAMETERS: Record<string, unknown> = {
  type: "object",
  properties: {
    file_path: {
      type: "string",
      description:
        "Absolute path (~ and $HOME allowed).",
    },
    content: {
      type: "string",
      description: "Full text content to write to the file.",
    },
  },
  required: ["file_path", "content"],
};

export const WRITE_TOOL_REPLAY = "unsafe" as const;
