export const WRITE_TOOL_NAME = "Write";

export const WRITE_TOOL_DESCRIPTION =
  "Create or overwrite a text file. Use for new files or when replacing the full file content. file_path MUST be an absolute path (e.g. /Users/you/projects/foo/bar.ts); relative paths are rejected and the file tools do NOT follow the shell's cwd. Required: file_path, content.";

export const WRITE_TOOL_PARAMETERS: Record<string, unknown> = {
  type: "object",
  properties: {
    file_path: {
      type: "string",
      description:
        "Absolute path to write. Must be absolute (~ / $HOME expansion allowed); relative paths are rejected.",
    },
    content: {
      type: "string",
      description: "Full text content to write to the file.",
    },
  },
  required: ["file_path", "content"],
};

export const WRITE_TOOL_REPLAY = "unsafe" as const;
