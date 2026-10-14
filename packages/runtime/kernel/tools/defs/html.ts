import path from "node:path";
import fs from "node:fs/promises";
import { AGENT_IDS } from "@stella/contracts/agent-runtime";
import { BackendClient } from "@stella/contracts/backend/client";
import {
  SHARE_MAX_HTML_BYTES,
  type SavedCanvasShare,
} from "@stella/contracts/backend/shares";
import type { ToolDefinition } from "../types.js";
import {
  HTML_TOOL_DESCRIPTION,
  HTML_TOOL_NAME,
  HTML_TOOL_PARAMETERS,
  HTML_TOOL_PROMPT_SNIPPET,
  htmlCanvasSlug,
} from "./html-def.js";

export type HtmlToolOptions = {
  stellaDataDir: string;
  getCloudBackendAuth?: () => { baseUrl: string; authToken: string } | null;
};

const SAVE_LINK_TIMEOUT_MS = 10_000;

const asTrimmedString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const saveCanvasLink = async (
  options: HtmlToolOptions,
  args: { canvas: string; html: string; title: string },
): Promise<SavedCanvasShare | null> => {
  const auth = options.getCloudBackendAuth?.();
  if (!auth) return null;
  if (Buffer.byteLength(args.html, "utf8") > SHARE_MAX_HTML_BYTES) return null;
  const signal = AbortSignal.timeout(SAVE_LINK_TIMEOUT_MS);
  const client = new BackendClient({
    baseUrl: auth.baseUrl,
    getToken: async () => auth.authToken,
    fetch: (input, init) => fetch(input, { ...init, signal }),
  });
  try {
    return await client.call("shares.save", args);
  } catch {
    return null;
  }
};

export const createHtmlTool = (options: HtmlToolOptions): ToolDefinition => {
  const { stellaDataDir } = options;
  return {
    name: HTML_TOOL_NAME,
    replay: "unsafe",
    agentTypes: [AGENT_IDS.ORCHESTRATOR],
    description: HTML_TOOL_DESCRIPTION,
    promptSnippet: HTML_TOOL_PROMPT_SNIPPET,
    parameters: HTML_TOOL_PARAMETERS,
    execute: async (args) => {
      const rawSlug = asTrimmedString(args.slug);
      const title = asTrimmedString(args.title);
      const html = typeof args.html === "string" ? args.html : "";

      if (!title) return { error: "title is required." };
      if (html.length === 0) return { error: "html is required." };

      const slug = htmlCanvasSlug(rawSlug, title);
      const dir = path.join(stellaDataDir, "outputs", "html");
      const filePath = path.join(dir, `${slug}.html`);

      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, html, "utf8");

      const createdAt = Date.now();
      const link = await saveCanvasLink(options, { canvas: slug, html, title });

      return {
        result: link
          ? `Canvas "${title}" opened; link ${link.url} (${link.visibility === "public" ? "public" : "private"}).`
          : `Canvas "${title}" opened; saved at ${filePath}.`,
        details: {
          filePath,
          slug,
          title,
          createdAt,
          bytes: Buffer.byteLength(html, "utf8"),
          ...(link
            ? { shareUrl: link.url, shareVisibility: link.visibility }
            : {}),
        },
      };
    },
  };
};
