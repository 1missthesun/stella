import { EDIT_TOOL_NAME } from "./defs/edit-def.js";
import { prepareEditArguments } from "./edit-text.js";

export type ToolArgumentPreparer = (args: unknown) => unknown;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const TOOL_ARGUMENT_PREPARERS: Readonly<Record<string, ToolArgumentPreparer>> =
  {
    [EDIT_TOOL_NAME]: (args) =>
      isRecord(args) ? prepareEditArguments(args) : args,
  };

export const getToolArgumentPreparer = (
  toolName: string,
): ToolArgumentPreparer | undefined =>
  Object.hasOwn(TOOL_ARGUMENT_PREPARERS, toolName)
    ? TOOL_ARGUMENT_PREPARERS[toolName]
    : undefined;
