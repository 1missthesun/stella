import { backendClient } from "@/platform/backend/backend-client";
import { attachmentContentType } from "@stella/contracts/attachment-content-type";
import { driveLinkPath } from "@stella/contracts/cloud-world-paths";
import { pickDeviceFileLocation } from "@stella/contracts/device-files";

const nameOf = (filePath: string): string =>
  filePath.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, "-") || "file";

const sharedDrivePath = (name: string): string =>
  `shared/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID().slice(0, 8)}/${name}`;

/** Where a file shown on this computer is in the drive, uploading it there if it isn't. */
const drivePathFor = async (filePath: string, blob: Blob | null): Promise<string> => {
  const direct = driveLinkPath(filePath);
  if (direct) return direct;
  const { files } = await backendClient.call("drive.locateDeviceFiles", {
    paths: [filePath],
  });
  const located = pickDeviceFileLocation(files, filePath)?.drivePath;
  if (located) return located;
  if (!blob) throw new Error("This file isn't in your Drive yet.");
  const name = nameOf(filePath);
  const contentType = attachmentContentType({ declared: blob.type, name });
  const prepared = await backendClient.call("drive.prepareUpload", {
    path: sharedDrivePath(name),
    sizeBytes: blob.size,
    contentType,
  });
  const put = await fetch(prepared.uploadUrl, {
    method: "PUT",
    headers: { "content-type": prepared.contentType },
    body: blob,
  });
  if (!put.ok) throw new Error(`Upload failed (${put.status}).`);
  const finalized = await backendClient.call("drive.finalizeUpload", {
    path: prepared.path,
    uploadId: prepared.uploadId,
    contentType,
    source: "share",
  });
  return finalized.path;
};

/**
 * A public link to a file: its drive copy's existing link, or a new one. A
 * file the drive doesn't have goes there first, from the bytes on screen.
 */
export const publicFileLink = async (
  filePath: string,
  blob: Blob | null,
): Promise<string> => {
  const path = await drivePathFor(filePath, blob);
  const link = await backendClient.call("shares.shareFile", { path });
  return link.url;
};
