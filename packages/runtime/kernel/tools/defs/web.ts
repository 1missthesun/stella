import { localWebFetch } from "../local-tool-overrides.js";
import type { ToolDefinition } from "../types.js";
import {
  WEB_TOOL_DESCRIPTION,
  WEB_TOOL_NAME,
  WEB_TOOL_PARAMETERS,
  WEB_TOOL_PROMPT_SNIPPET,
  type WebSearchCapability,
  WEB_TOOL_REPLAY,
} from "./web-def.js";

export type WebToolOptions = {
  webSearch?: WebSearchCapability;
};

export const createWebTool = (options: WebToolOptions = {}): ToolDefinition => ({
  name: WEB_TOOL_NAME,
  replay: WEB_TOOL_REPLAY,
  description: WEB_TOOL_DESCRIPTION,
  promptSnippet: WEB_TOOL_PROMPT_SNIPPET,
  parameters: WEB_TOOL_PARAMETERS,
  execute: async (args, _context, extras) => {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    const url = typeof args.url === "string" ? args.url.trim() : "";
    const prompt =
      typeof args.prompt === "string"
        ? args.prompt.trim() || undefined
        : undefined;
    const hasExplicitFormat = typeof args.format === "string";
    const format =
      args.format === "markdown" ||
      args.format === "html" ||
      args.format === "text"
        ? args.format
        : "text";

    if (hasExplicitFormat && format !== args.format) {
      return { error: "format must be one of: text, markdown, html." };
    }

    if (!query && !url) {
      return { error: "Either query or url is required." };
    }
    if (query && url) {
      return { error: "Pass either query or url, not both." };
    }

    if (query) {
      if (prompt || hasExplicitFormat) {
        return { error: "prompt and format only apply when url is provided." };
      }
      if (!options.webSearch) {
        return { error: "web search is not available on this device." };
      }
      const category =
        typeof args.category === "string"
          ? args.category.trim() || undefined
          : undefined;
      try {
        const result = await options.webSearch(query, {
          ...(category ? { category } : {}),
        });
        return {
          result: result.text || "No results found.",
          details: {
            mode: "search",
            query,
            ...(Array.isArray(result.results)
              ? { results: result.results }
              : {}),
          },
        };
      } catch (error) {
        return { error: `web search failed: ${(error as Error).message}` };
      }
    }

    const text = await localWebFetch({
      url,
      format,
      ...(prompt ? { prompt } : {}),
      ...(extras?.signal ? { signal: extras.signal } : {}),
    });
    return {
      result: text,
      details: {
        mode: "fetch",
        url,
        format,
        ...(prompt ? { prompt } : {}),
      },
    };
  },
});
