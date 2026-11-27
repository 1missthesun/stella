import path from "node:path";
import fs from "node:fs/promises";
import { AGENT_IDS } from "@stella/contracts/agent-runtime";
import { compileView, lintView } from "@stella/views/compile";
import { iconProblems } from "@stella/views/icons";
import { awaitViewStatus } from "@stella/views/files";
import type { ToolDefinition } from "../types.js";
import { htmlCanvasSlug } from "./html-def.js";
import { VIEW_TOOL_DESCRIPTION, VIEW_TOOL_NAME, VIEW_TOOL_PARAMETERS } from "./view-def.js";

export type ViewToolOptions = {
  stellaDataDir: string;
  /** How long to wait for an open view to run the new source. */
  statusWaitMs?: number;
};

export { hostRendersViews } from "../views-env.js";

export const createViewTool = (options: ViewToolOptions): ToolDefinition => {
  const { stellaDataDir } = options;
  return {
    name: VIEW_TOOL_NAME,
    replay: "unsafe",
    agentTypes: [AGENT_IDS.ORCHESTRATOR],
    description: VIEW_TOOL_DESCRIPTION,
    parameters: VIEW_TOOL_PARAMETERS,
    execute: async (args) => {
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

      const run = problems.length === 0 ? await awaitViewStatus(filePath, source, options.statusWaitMs ?? 1500) : null;
      if (run?.problem) problems.push(`${run.problem.phase}: ${run.problem.message}`);

      const createdAt = Date.now();
      const where = `${filePath}${args.data !== undefined ? ` (data in ${slug}.data.json)` : ""}`;
      const result =
        problems.length > 0
          ? `View "${title}" saved at ${where}, but it has problems; fix them in the file (the open view keeps its last good version until then):\n${problems.join("\n")}`
          : run
            ? `View "${title}" is on screen (rendered in ${Math.round(run.renderMs ?? 0)} ms); saved at ${where}.`
            : `View "${title}" opened; saved at ${where}.`;
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
