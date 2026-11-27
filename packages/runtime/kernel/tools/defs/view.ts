import path from "node:path";
import fs from "node:fs/promises";
import { AGENT_IDS } from "@stella/contracts/agent-runtime";
import { BackendClient } from "@stella/contracts/backend/client";
import { compileView, lintView } from "@stella/views/compile";
import { iconProblems } from "@stella/views/icons";
import { awaitViewStatus } from "@stella/views/files";
import type { ToolContext, ToolDefinition } from "../types.js";
import { htmlCanvasSlug } from "./html-def.js";
import { VIEW_TOOL_DESCRIPTION, VIEW_TOOL_NAME, VIEW_TOOL_PARAMETERS } from "./view-def.js";

/** One version of a task's view, for the user's chat (`@stella/contracts/view-card`). */
export type PublishedView = {
  filePath: string;
  slug: string;
  title: string;
  source: string;
  data?: unknown;
  createdAt: number;
};

/** Puts a task's view into the user's chat; resolves to an error message when it couldn't. */
export type ViewPublisher = (view: PublishedView, context: ToolContext) => Promise<{ posted: boolean } | { error: string }>;

export type ViewToolOptions = {
  stellaDataDir: string;
  /** Whether this host draws views itself (the Rune desktop); the cloud doesn't. */
  rendersHere: boolean;
  /** How a task's view reaches the user's chat (Stella's own views ride in her tool calls). */
  publish?: ViewPublisher;
  /** How long to wait for an open view to run the new source. */
  statusWaitMs?: number;
};

export { hostRendersViews } from "../views-env.js";

/** A desktop task's views go into the chat through the user's Stella Cloud session. */
export const cloudSessionViewPublisher =
  (getCloudBackendAuth: () => { baseUrl: string; authToken: string } | null): ViewPublisher =>
  async (view, context) => {
    const auth = getCloudBackendAuth();
    if (!auth) return { error: "this computer isn't signed in to Stella Cloud" };
    if (!context.conversationId || !context.agentId) return { error: "this task has no chat to show it in" };
    const client = new BackendClient({ baseUrl: auth.baseUrl, getToken: async () => getCloudBackendAuth()?.authToken ?? auth.authToken });
    try {
      return await client.call("conversations.publishView", {
        conversationId: context.conversationId,
        agentId: context.agentId,
        ...view,
      });
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    } finally {
      client.dispose();
    }
  };

export const createViewTool = (options: ViewToolOptions): ToolDefinition => {
  const { stellaDataDir } = options;
  return {
    name: VIEW_TOOL_NAME,
    replay: "unsafe",
    agentTypes: [AGENT_IDS.ORCHESTRATOR, AGENT_IDS.GENERAL],
    description: VIEW_TOOL_DESCRIPTION,
    parameters: VIEW_TOOL_PARAMETERS,
    execute: async (args, context) => {
      const title = typeof args.title === "string" ? args.title.trim() : "";
      const source = typeof args.source === "string" ? args.source : "";
      if (!title) return { error: "title is required." };
      if (!source.trim()) return { error: "source is required." };

      const slug = htmlCanvasSlug(typeof args.slug === "string" ? args.slug.trim() : "", title);
      const dir = path.join(stellaDataDir, "outputs", "views");
      const filePath = path.join(dir, `${slug}.view.tsx`);
      await fs.mkdir(dir, { recursive: true });
      if (args.data !== undefined) {
        const dataPath = path.join(dir, `${slug}.data.json`);
        await fs.writeFile(`${dataPath}.tmp`, JSON.stringify(args.data, null, 2), "utf8");
        await fs.rename(`${dataPath}.tmp`, dataPath);
      }
      // Write the source whole in one rename, so an open view never reads half a file.
      await fs.writeFile(`${filePath}.tmp`, source, "utf8");
      await fs.rename(`${filePath}.tmp`, filePath);

      const problems = [...lintView(source), ...iconProblems(source)].map((p) => `line ${p.line ?? "?"}: ${p.message}`);
      const compiled = compileView(source, `${slug}.view.tsx`);
      if (!compiled.ok) problems.unshift(`line ${compiled.error.line ?? "?"}${compiled.error.column ? `:${compiled.error.column}` : ""}: ${compiled.error.message}`);

      const run = options.rendersHere && problems.length === 0 ? await awaitViewStatus(filePath, source, options.statusWaitMs ?? 1500) : null;
      if (run?.problem) problems.push(`${run.problem.phase}: ${run.problem.message}`);

      const createdAt = Date.now();
      // Stella's own calls reach her other devices as they are; a task's calls stay in its thread,
      // so each good version of its view goes into the user's chat as a view card.
      const task = context.agentType !== AGENT_IDS.ORCHESTRATOR;
      const published =
        task && options.publish && problems.length === 0
          ? await options.publish({ filePath, slug, title, source, ...(args.data !== undefined ? { data: args.data } : {}), createdAt }, context)
          : null;
      const where = `${filePath}${args.data !== undefined ? ` (data in ${slug}.data.json)` : ""}`;
      const chat =
        !task || problems.length > 0
          ? ""
          : published && "posted" in published && published.posted
            ? options.rendersHere
              ? " It is also live in the user's chat on their phone and the web."
              : " It is live in the user's chat on their phone, the web and Stella's desktop app."
            : published && "error" in published
              ? ` It couldn't reach the user's chat on their other devices (${published.error}).`
              : "";
      const link = task && problems.length === 0 ? ` Link it in your report as [${title}](<${filePath}>).` : "";
      const result =
        problems.length > 0
          ? `View "${title}" saved at ${where}, but it has problems; fix them in the file (the open view keeps its last good version until then):\n${problems.join("\n")}`
          : run
            ? `View "${title}" is on screen (rendered in ${Math.round(run.renderMs ?? 0)} ms); saved at ${where}.${chat}${link}`
            : options.rendersHere
              ? `View "${title}" opened; saved at ${where}.${chat}${link}`
              : `View "${title}" compiled cleanly; saved at ${where}. Nothing draws it here, so a runtime error shows only on the user's devices.${chat}${link}`;
      // Other devices (the phone, the web chat) run the newest version of each slug from this
      // call's arguments, which sync as written; tool results are redacted on the way to the cloud.
      return {
        result,
        details: {
          filePath,
          slug,
          title,
          createdAt,
          bytes: Buffer.byteLength(source, "utf8"),
          ...(problems.length > 0 ? { problems } : {}),
          ...(run?.renderMs != null ? { renderMs: run.renderMs } : {}),
        },
      };
    },
  };
};
