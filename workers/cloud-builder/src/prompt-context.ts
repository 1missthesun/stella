import { WORLD_ROOT } from "./workspace.js";

/**
 * The attachment note on a cloud user message, for both cloud engines.
 * Two names for one file, each true where it is used: the drive path is the
 * file's stable name, and `readableAt` is what Read takes in a session that
 * has the world on disk (the Claude Code orchestrator session does not). An
 * agent started on one of the user's computers receives the attachments as
 * real files there, so it needs no path.
 */
export const attachedFilesText = (
  attachments: readonly string[],
  options: { readableHere: boolean },
): string =>
  [
    "<attached-files>",
    "The user attached these exact files to this message. Do not substitute other files found by searching the Drive.",
    JSON.stringify(
      attachments.map((path) =>
        options.readableHere
          ? { drivePath: path, readableAt: `${WORLD_ROOT}/drive/${path}` }
          : { drivePath: path },
      ),
    ),
    options.readableHere
      ? "Use Read on `readableAt` to open one here. An agent you start on one of the user's computers is given these same attachments as files on that computer, so it needs no path from you; `readableAt` is valid only in this session."
      : "An agent you start is given these same attachments as files, so it needs no path from you.",
    "</attached-files>",
  ].join("\n");
