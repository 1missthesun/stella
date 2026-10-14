export const ASK_STELLA_TOOL_NAME = "ask_stella";

export type RealtimeFunctionTool = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export const ASK_STELLA_TOOL: RealtimeFunctionTool = {
  type: "function",
  name: ASK_STELLA_TOOL_NAME,
  description:
    "Hand the user's request to Stella's backend, which is the only thing that can act: it reads and writes their files, opens and controls apps, drives the browser, searches the live web, reaches their connected accounts, remembers, and runs longer work in the background. Use it whenever the user wants something done, or when the answer depends on their machine, their accounts, or current information. Say one short preamble first, then call this. It returns the answer to tell the user.",
  parameters: {
    type: "object",
    properties: {
      request: {
        type: "string",
        description:
          "One plain-language sentence describing what the user wants, in your own words, with anything the backend needs that only came up in speech (names, which item they meant, the file or app in question). Do not include spoken filler.",
      },
    },
    required: ["request"],
    additionalProperties: false,
  },
};

export const ASK_STELLA_SESSION_TOOLS: readonly RealtimeFunctionTool[] = [
  ASK_STELLA_TOOL,
];

export const parseAskStellaRequest = (rawArguments: unknown): string => {
  if (typeof rawArguments !== "string" || !rawArguments.trim()) return "";
  try {
    const parsed = JSON.parse(rawArguments) as unknown;
    if (!parsed || typeof parsed !== "object") return "";
    const request = (parsed as Record<string, unknown>).request;
    return typeof request === "string" ? request.trim() : "";
  } catch {
    return "";
  }
};
