import path from "node:path";
import fs from "node:fs/promises";
import { AGENT_IDS } from "@stella/contracts/agent-runtime";
import { BackendClient } from "@stella/contracts/backend/client";
import { compileView, lintView } from "@stella/views/compile";
import { iconProblems } from "@stella/views/icons";
import { awaitViewStatus, liveViewHost, readViewRestoreMark, readViewStatus, tellViewRestore, viewDataPath, viewFilePathFor, viewSourceHash } from "@stella/views/files";
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

/** Records a version of one of Stella's own views in the account's view index (the Apps list). */
export type ViewIndexer = (view: PublishedView, context: ToolContext) => Promise<void>;

export type ViewToolOptions = {
  stellaDataDir: string;
  /** Whether this host draws views itself (the Rune desktop); the cloud doesn't. */
  rendersHere: boolean;
  /** How a task's view reaches the user's chat (Stella's own views ride in her tool calls). */
  publish?: ViewPublisher;
  /** How Stella's own views reach the Apps list (a task's go there with its view card). */
  index?: ViewIndexer;
  /** How long to wait for an open view to run the new source. */
  statusWaitMs?: number;
};

/** How long a new view may take to start and draw its first screen before the tool says it didn't. */
const FIRST_RENDER_WAIT_MS = 3_000;

/** A problem, with the source line it points at. */
const withLine = (text: string, line: number | undefined, source: string): string => {
  if (!line) return text;
  const code = source.split("\n")[line - 1]?.trim();
  return code ? `${text}\n    ${line} | ${code.length > 160 ? `${code.slice(0, 160)}…` : code}` : text;
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

const utcClock = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";

/**
 * The user restored an earlier version of this view after the caller last saw it, so the caller's
 * whole-file source would undo the restore: say so once, with the file as it is now, and save
 * nothing. (The orchestrator usually learns of a restore from its conversation already; this
 * covers a restore it hasn't read yet, and tasks.)
 */
async function restoredSinceLastCall(dataDir: string, filePath: string, source: string, context: ToolContext) {
  const mark = await readViewRestoreMark(dataDir, filePath);
  if (!mark) return null;
  const who = context.agentType === AGENT_IDS.ORCHESTRATOR ? "orchestrator" : (context.agentId ?? context.agentType ?? "task");
  if (mark.told.includes(who)) return null;
  const current = await fs.readFile(filePath, "utf8").catch(() => null);
  if (current === null || viewSourceHash(current) !== mark.source || viewSourceHash(source) === mark.source) return null;
  await tellViewRestore(dataDir, filePath, mark.createdAt, who);
  // An error, so no device takes this call's source as a new version of the view.
  return {
    error: `Not saved: the user restored this view to its version from ${utcClock(mark.restoredFrom)} (at ${utcClock(mark.createdAt)}), after the version your source is based on, so saving it would undo their restore. The file now holds the restored version:\n\n\`\`\`tsx\n${current}\n\`\`\`\n\nTo change the view, call view again with the whole file built on that source.`,
  };
}

/** Stella's own views on this computer reach the account's Apps list through the user's Stella Cloud session. */
export const cloudSessionViewIndexer =
  (getCloudBackendAuth: () => { baseUrl: string; authToken: string } | null): ViewIndexer =>
  async (view, context) => {
    const auth = getCloudBackendAuth();
    if (!auth || !context.conversationId) return;
    const client = new BackendClient({
      baseUrl: auth.baseUrl,
      getToken: async () => getCloudBackendAuth()?.authToken ?? auth.authToken,
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(INDEX_TIMEOUT_MS) }),
    });
    try {
      await client.call("viewIndex.record", { conversationId: context.conversationId, ...view });
    } finally {
      client.dispose();
    }
  };

const INDEX_TIMEOUT_MS = 15_000;

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
      // Each chat keeps its views in a folder of its own, so the same slug in two chats is two views.
      const filePath = await viewFilePathFor(stellaDataDir, context.conversationId, slug);
      const restored = await restoredSinceLastCall(stellaDataDir, filePath, source, context);
      if (restored) return restored;
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      if (args.data !== undefined) {
        const dataPath = viewDataPath(filePath);
        await fs.writeFile(`${dataPath}.tmp`, JSON.stringify(args.data, null, 2), "utf8");
        await fs.rename(`${dataPath}.tmp`, dataPath);
      }
      // Write the source whole in one rename, so an open view never reads half a file.
      await fs.writeFile(`${filePath}.tmp`, source, "utf8");
      await fs.rename(`${filePath}.tmp`, filePath);

      const problems = [...lintView(source), ...iconProblems(source)].map((p) => withLine(`line ${p.line ?? "?"}: ${p.message}`, p.line, source));
      const compiled = compileView(source, `${slug}.view.tsx`);
      if (!compiled.ok) problems.unshift(withLine(`line ${compiled.error.line ?? "?"}${compiled.error.column ? `:${compiled.error.column}` : ""}: ${compiled.error.message}`, compiled.error.line, source));

      // A views host runs each view written here as soon as it lands, so even the first write can
      // say whether it rendered; with no host, only a view already open reports.
      const host = options.rendersHere && problems.length === 0 && (await liveViewHost(stellaDataDir));
      const run = options.rendersHere && problems.length === 0 ? await awaitViewStatus(filePath, source, host ? FIRST_RENDER_WAIT_MS : (options.statusWaitMs ?? 1500), { appear: host }) : null;
      if (run?.problem) problems.push(withLine(`${run.problem.phase}: ${run.problem.message}`, run.problem.line, source));
      let notRendered: string | null = null;
      if (host && !run && problems.length === 0) {
        const last = await readViewStatus(filePath);
        notRendered =
          last?.status === "loading"
            ? `it was still starting after ${FIRST_RENDER_WAIT_MS / 1000} s (long work before its first render? move it into an effect)`
            : `Stella didn't pick the file up within ${FIRST_RENDER_WAIT_MS / 1000} s`;
      }

      const createdAt = Date.now();
      // Stella's own calls reach her other devices as they are; a task's calls stay in its thread,
      // so each good version of its view goes into the user's chat as a view card.
      const task = context.agentType !== AGENT_IDS.ORCHESTRATOR;
      const published =
        task && options.publish && problems.length === 0
          ? await options.publish({ filePath, slug, title, source, ...(args.data !== undefined ? { data: args.data } : {}), createdAt }, context)
          : null;
      // Stella's own good versions go to the Apps list in the background: the chat doesn't wait on it.
      if (!task && options.index && problems.length === 0) {
        void options.index({ filePath, slug, title, source, ...(args.data !== undefined ? { data: args.data } : {}), createdAt }, context).catch((error: unknown) => {
          console.error(`[views] couldn't add "${title}" to Apps: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
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
      const ms = Math.round(run?.renderMs ?? 0);
      const result =
        problems.length > 0
          ? `View "${title}" saved at ${where}, but it has problems; fix them in the file (the open view keeps its last good version until then):\n${problems.join("\n")}`
          : notRendered
            ? `View "${title}" saved at ${where}, but it hasn't rendered: ${notRendered}.${chat}${link}`
            : run
              ? run.shown === false
                ? task
                  ? `View "${title}" rendered (first screen in ${ms} ms); saved at ${where}.${chat}${link}`
                  : `View "${title}" rendered (first screen in ${ms} ms) and shows in the chat with this reply; saved at ${where}.`
                : `View "${title}" is on screen (rendered in ${ms} ms); saved at ${where}.${chat}${link}`
              : options.rendersHere
                ? `View "${title}" saved at ${where}; it shows when the chat displays it.${chat}${link}`
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
          ...(run ? { rendered: !run.problem } : {}),
        },
      };
    },
  };
};
