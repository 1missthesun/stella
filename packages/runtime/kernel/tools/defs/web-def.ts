export type WebSearchCapability = (
  query: string,
  options?: { category?: string },
) => Promise<{
  text: string;
  results?: Array<{
    title: string;
    url: string;
    snippet: string;
    image?: string;
    favicon?: string;
  }>;
}>;

export const WEB_TOOL_NAME = "web";

export const WEB_TOOL_DESCRIPTION =
  "Search the web (query) or fetch a page as text (url); pass exactly one.";

export const WEB_TOOL_PROMPT_SNIPPET = "Search the web or fetch a URL";

export const WEB_TOOL_PARAMETERS: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  description:
    "Either search the live web (provide query) or fetch a known URL (provide url). Pass exactly one of query or url.",
  properties: {
    query: {
      type: "string",
      description:
        "Web search query. Returns ranked results with title, URL, and snippet.",
    },
    url: {
      type: "string",
      description:
        "URL to fetch. Returns the page rendered as readable text with HTML stripped.",
    },
    category: {
      type: "string",
      enum: ["company", "people", "research paper"],
      description:
        "Optional focus hint when using query. Most searches should omit it.",
    },
    prompt: {
      type: "string",
      description:
        "Optional follow-up prompt used by the local fetcher to extract just the relevant slice of a long page.",
    },
    format: {
      type: "string",
      enum: ["text", "markdown", "html"],
      description:
        "Fetch output format. Defaults to text. Only applies when url is provided.",
    },
  },
  oneOf: [
    { required: ["query"], not: { required: ["url"] } },
    { required: ["url"], not: { required: ["query"] } },
  ],
};

export const WEB_TOOL_REPLAY = "safe" as const;
