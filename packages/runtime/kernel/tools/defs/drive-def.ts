export const DRIVE_TOOL_NAME = "drive";

export const DRIVE_TOOL_DESCRIPTION =
  "Read the user's Stella Drive — the files they uploaded from any device and the files agents saved there. `list` finds files by drive path; `fetch` puts one on this machine and returns an absolute path to Read. Attachments on the current turn are already provided to you, so use this for a file nobody handed you: something attached earlier in the conversation, or saved by previous work. Read-only; it cannot write, move, or delete.";

export const DRIVE_TOOL_PARAMETERS: Record<string, unknown> = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["list", "fetch"],
      description:
        "`list` to find files, `fetch` to bring one here and get a path to Read.",
    },
    path: {
      type: "string",
      description:
        "fetch: the file's drive path, relative to the drive root and never absolute (`uploads/2026-08-29/photo.jpg`).",
    },
    prefix: {
      type: "string",
      description:
        "list: restrict to a drive folder (`uploads/`). Omit to list newest first across the whole drive.",
    },
    limit: { type: "number", description: "list: how many rows, default 50." },
  },
  required: ["action"],
};

export const DRIVE_TOOL_REPLAY = "safe" as const;
