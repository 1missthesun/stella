export const APPLY_PATCH_TOOL_NAME = "apply_patch";

export const APPLY_PATCH_TOOL_DESCRIPTION =
  "Edit files with a *** Begin Patch / *** End Patch envelope: Add File, Update File (optionally Move to), Delete File; each Update hunk carries 3 lines of context above and below. Paths in the envelope are absolute; file tools do not follow the shell's cwd.";


export const APPLY_PATCH_TOOL_PARAMETERS: Record<string, unknown> = {
  type: "object",
  properties: {
    input: {
      type: "string",
      description:
        "The entire contents of the apply_patch envelope. All file paths inside must be absolute.",
    },
  },
  required: ["input"],
};

export const APPLY_PATCH_TOOL_REPLAY = "unsafe" as const;
