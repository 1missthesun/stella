import { backendClient } from "@/platform/backend/backend-client";
import { attachmentContentType } from "@stella/contracts/attachment-content-type";
import { driveLinkPath } from "@stella/contracts/cloud-world-paths";
import { pickDeviceFileLocation } from "@stella/contracts/device-files";
import { putSignedUpload } from "@stella/contracts/request-deadline";

const isControlCharacter = (char: string): boolean => {
  const code = char.charCodeAt(0);
  return code < 0x20 || code === 0x7f;
};

const nameOf = (filePath: string): string =>
  Array.from(filePath.split(/[\\/]/).pop() ?? "", (char) =>
    isControlCharacter(char) ? "-" : char,
  ).join("") || "file";

const sharedDrivePath = (name: string): string =>
  `shared/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID().slice(0, 8)}/${name}`;

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
  const put = await putSignedUpload({
    url: prepared.uploadUrl,
    body: blob,
    contentType: prepared.contentType,
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

export const publicFileLink = async (
  filePath: string,
  blob: Blob | null,
): Promise<string> => {
  const path = await drivePathFor(filePath, blob);
  const link = await backendClient.call("shares.shareFile", { path });
  return link.url;
};
