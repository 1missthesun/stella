export const EDIT_TOOL_NAME = "Edit";

export const EDIT_TOOL_DESCRIPTION =
  "Edit an existing text file, addressing lines by the LINE#HASH anchors from Read output (anchor, optional end_anchor) or by exact old_string. For several changes in one file pass `edits`: every entry matches the original file, entries must not overlap, and all apply together or none do. File tools take absolute paths and do not follow the shell's cwd.";

export const EDIT_TOOL_PARAMETERS: Record<string, unknown> = {
  type: "object",
  properties: {
    file_path: {
      type: "string",
      description:
        "Absolute path (~ and $HOME allowed).",
    },
    anchor: {
      type: "string",
      description:
        "LINE#HASH anchor from Read output (e.g. '42#a4f') of the first line to replace. When set, old_string is ignored.",
    },
    end_anchor: {
      type: "string",
      description:
        "LINE#HASH anchor of the last line of the range (inclusive). Omit to target only the anchor line.",
    },
    insert_after: {
      type: "boolean",
      description:
        "Anchor mode only: insert new_string after the anchor line instead of replacing it. Defaults to false.",
    },
    old_string: {
      type: "string",
      description:
        "Exact text currently in the file to replace.",
    },
    new_string: {
      type: "string",
      description:
        "Replacement text; '' deletes. Required unless edits is used.",
    },
    replace_all: {
      type: "boolean",
      description:
        "Exact-match mode only: replace every occurrence of old_string. Defaults to false.",
    },
    edits: {
      type: "array",
      description:
        "Several disjoint changes in one atomic call, instead of the top-level fields.",
      items: {
        type: "object",
        properties: {
          old_string: {
            type: "string",
            description:
              "Exact current text for this entry; must be unique in the original file.",
          },
          anchor: {
            type: "string",
            description:
              "LINE#HASH anchor from Read output for this entry's first line (instead of old_string).",
          },
          end_anchor: {
            type: "string",
            description: "Anchor entries only: last line of the range (inclusive).",
          },
          insert_after: {
            type: "boolean",
            description:
              "Anchor entries only: insert new_string after the anchor line.",
          },
          new_string: {
            type: "string",
            description: "Replacement text for this entry ('' deletes).",
          },
        },
        required: ["new_string"],
      },
    },
  },
  required: ["file_path"],
};

export const EDIT_TOOL_REPLAY = "unsafe" as const;
