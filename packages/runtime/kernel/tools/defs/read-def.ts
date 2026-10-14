export const READ_TOOL_NAME = "Read";

export const READ_TOOL_DESCRIPTION =
  "Read a text file, or view a PNG/JPG/GIF/WEBP image.";

export const READ_TOOL_PARAMETERS: Record<string, unknown> = {
  type: "object",
  properties: {
    file_path: {
      type: "string",
      description:
        "Absolute path (~ and $HOME allowed); relative paths are rejected.",
    },
    offset: { type: "number" },
    limit: { type: "number" },
  },
  required: ["file_path"],
};

export const READ_TOOL_REPLAY = "safe" as const;
