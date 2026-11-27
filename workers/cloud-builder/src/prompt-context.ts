import { isUnsavedAttachmentPath } from "@stella/contracts/chat-attachments";
import { WORLD_ROOT } from "./workspace.js";

export const attachedFilesText = (
  attachments: readonly string[],
  options: { readableHere: boolean },
): string => {
  const saved = attachments.filter((path) => !isUnsavedAttachmentPath(path));
  const unsaved = attachments.filter(isUnsavedAttachmentPath);
  return [
    "<attached-files>",
    "The user attached these exact files to this message. Do not substitute other files found by searching the Drive.",
    JSON.stringify([
      ...saved.map((path) =>
        options.readableHere
          ? { drivePath: path, readableAt: `${WORLD_ROOT}/drive/${path}` }
          : { drivePath: path },
      ),
      ...unsaved.map((path) => ({ name: path.slice(path.lastIndexOf("/") + 1), savedToDrive: false })),
    ]),
    ...(options.readableHere && saved.length > 0
      ? ["Use Read on `readableAt` to open one here; `readableAt` is valid only in this session."]
      : []),
    ...(unsaved.length > 0
      ? [
          "The user's Drive is full, so the images marked savedToDrive false were sent straight to you without being saved: you see them in this message, but they are not in the Drive and cannot be opened with Read. If the user wants one kept, they need to free Drive space or upgrade.",
        ]
      : []),
    options.readableHere
      ? "An agent you start on one of the user's computers is given these same attachments as files on that computer, so it needs no path from you."
      : "An agent you start is given these same attachments as files, so it needs no path from you.",
    "</attached-files>",
  ].join("\n");
};
