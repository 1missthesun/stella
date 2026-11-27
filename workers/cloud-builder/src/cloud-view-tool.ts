// The orchestrator's `view` tool in the cloud (a phone-only or web-only user, or no computer of
// theirs holding the chat). Nothing renders a view here: the user's devices run it themselves,
// each reading the newest source of every view from this call's arguments in the conversation
// (@stella/views/conversation). So the tool checks the source with the same compiler and lint the
// devices use, keeps a copy in the user's Drive, and says honestly where it shows.
import type { TSchema } from "@sinclair/typebox";
import { compileView, lintView } from "@stella/views/compile";
import { iconProblems } from "@stella/views/icons";
import { conversationViewRelPath, viewDataPath, viewFileName } from "@stella/views/paths";
import { htmlCanvasSlug } from "@stella/runtime/kernel/tools/defs/html-def.js";
import {
  VIEW_TOOL_DESCRIPTION,
  VIEW_TOOL_NAME,
  VIEW_TOOL_PARAMETERS,
} from "@stella/runtime/kernel/tools/defs/view-def.js";
import type { CloudCodeSourceAgentTool } from "./cloud-code-tool.js";
import type { DriveTurnFilesResult } from "./owner-store/domains/drive.js";
import type { OwnerInternalCall } from "./owner-store/registry.js";

export const CLOUD_VIEW_DRIVE_DIR = "outputs/views";
const SOURCE_CONTENT_TYPE = "text/plain; charset=utf-8";
const DATA_CONTENT_TYPE = "application/json";
/** The source rides in the conversation as the call's arguments, so it stays well under a journal row. */
const MAX_VIEW_BYTES = 256 * 1024;
const MAX_DATA_BYTES = 1024 * 1024;

export type CloudViewToolContext = Readonly<{
  turnId: string;
  /** Each chat keeps its views in a folder of its own, so the same slug in two chats is two views; with its slug, the view's name in the account's view index. */
  conversationId: string;
  ownerInternal: OwnerInternalCall;
}>;

const failure = (message: string) => ({
  content: [{ type: "text" as const, text: message }],
  details: null,
  isError: true,
});

const encodeBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
};

export const cloudViewDrivePath = (conversationId: string, slug: string): string =>
  conversationId.trim() ? conversationViewRelPath(conversationId.trim(), slug) : `${CLOUD_VIEW_DRIVE_DIR}/${slug}.view.tsx`;

/** Compile, lint and icon problems in a view's source, as the model should read them. */
export const viewSourceProblems = (source: string, fileName: string): string[] => {
  const problems = [...lintView(source), ...iconProblems(source)].map((p) => `line ${p.line ?? "?"}: ${p.message}`);
  const compiled = compileView(source, fileName);
  if (!compiled.ok) {
    problems.unshift(
      `line ${compiled.error.line ?? "?"}${compiled.error.column ? `:${compiled.error.column}` : ""}: ${compiled.error.message}`,
    );
  }
  return problems;
};

export const createCloudViewTool = (context: CloudViewToolContext): CloudCodeSourceAgentTool => ({
  name: VIEW_TOOL_NAME,
  replay: "keyed",
  label: "View",
  workingText: "Writing view",
  description: VIEW_TOOL_DESCRIPTION,
  parameters: VIEW_TOOL_PARAMETERS as unknown as TSchema,
  execute: async (toolCallId, params, signal) => {
    const args = (params ?? {}) as Record<string, unknown>;
    const title = typeof args.title === "string" ? args.title.trim() : "";
    const source = typeof args.source === "string" ? args.source : "";
    if (!title) return failure("title is required.");
    if (!source.trim()) return failure("source is required.");
    const slug = htmlCanvasSlug(typeof args.slug === "string" ? args.slug.trim() : "", title);
    const sourceBytes = new TextEncoder().encode(source);
    if (sourceBytes.byteLength > MAX_VIEW_BYTES) {
      return failure(`The view is ${sourceBytes.byteLength} bytes; keep it under ${MAX_VIEW_BYTES}. Put bulky data in \`data\` instead.`);
    }
    const hasData = args.data !== undefined;
    const dataBytes = hasData ? new TextEncoder().encode(JSON.stringify(args.data, null, 2)) : null;
    if (dataBytes && dataBytes.byteLength > MAX_DATA_BYTES) {
      return failure(`The data is ${dataBytes.byteLength} bytes; keep it under ${MAX_DATA_BYTES}.`);
    }

    const filePath = cloudViewDrivePath(context.conversationId, slug);
    const dataPath = viewDataPath(filePath);
    const problems = viewSourceProblems(source, `${slug}.view.tsx`);

    // The Drive copy lets the user keep, download or move it; the devices run it from the conversation.
    const files = [
      {
        path: filePath,
        name: `${slug}.view.tsx`,
        sizeBytes: sourceBytes.byteLength,
        contentType: SOURCE_CONTENT_TYPE,
        contentBase64: encodeBase64(sourceBytes),
      },
      ...(dataBytes
        ? [
            {
              path: dataPath,
              name: viewFileName(dataPath),
              sizeBytes: dataBytes.byteLength,
              contentType: DATA_CONTENT_TYPE,
              contentBase64: encodeBase64(dataBytes),
            },
          ]
        : []),
    ];
    let saved = false;
    try {
      signal?.throwIfAborted();
      const result = (await context.ownerInternal("drive.turnFiles", {
        turnId: context.turnId,
        hydratesDrive: false,
        source: "view",
        batchKey: toolCallId,
        files,
      })) as DriveTurnFilesResult;
      saved = result.files.some((file) => file.path === filePath && file.stored);
    } catch {
      saved = false;
    }
    signal?.throwIfAborted();

    const createdAt = Date.now();
    // Apps on every device lists it (and a shared link follows it) from the account's view index.
    if (problems.length === 0) {
      try {
        await context.ownerInternal("viewIndex.record", {
          conversationId: context.conversationId,
          filePath,
          slug,
          title,
          source,
          ...(hasData ? { data: args.data } : {}),
          createdAt,
        });
      } catch {
        // The version still reaches the devices through this call; only the Apps list misses it.
      }
    }
    const where = saved ? ` A copy is in their Drive at ${filePath}${hasData ? ` (data in ${slug}.data.json)` : ""}.` : "";
    const text =
      problems.length > 0
        ? `View "${title}" has problems, so the user's devices keep showing its last good version (or an error, if it never ran). Fix them and call view again with the same slug and the whole file:\n${problems.join("\n")}`
        : `View "${title}" compiled cleanly and is sent to the user's devices: it runs live on their phone, in the web chat and in Stella's desktop app, as a card in this reply that opens full size.${where} Nothing renders in the cloud, so there is no on-screen check here; a runtime error shows on the card. To change it, call view again with slug "${slug}" and the whole new file: open copies swap to it and keep their state.`;
    return {
      content: [{ type: "text", text }],
      details: {
        filePath,
        slug,
        title,
        createdAt,
        bytes: sourceBytes.byteLength,
        ...(saved ? { drivePath: filePath } : {}),
        ...(problems.length > 0 ? { problems } : {}),
      },
    };
  },
});
