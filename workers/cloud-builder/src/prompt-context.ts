import { WORLD_ROOT } from "./workspace.js";

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
