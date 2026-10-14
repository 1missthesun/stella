import { Platform, Share } from "react-native";
import * as Sharing from "expo-sharing";
import { Directory, File, Paths } from "expo-file-system";
import { fetch as expoFetch } from "expo/fetch";
import { getBackendClient } from "./backend";
import { locateDeviceFile } from "./linked-device-files";
import { uploadChatAttachment } from "./chat-attachments";

const safeName = (name: string): string =>
  name.replace(/[\u0000-\u001f\u007f/\\:]+/g, "_").trim() || "file";

const nameFromUri = (uri: string): string =>
  decodeURIComponent(uri.split(/[?#]/)[0]?.split("/").pop() ?? "") || "file";

/**
 * A `file://` copy of `uri` named `name`, so the save sheet offers the file
 * under its real name. Remote files are downloaded first.
 */
export const namedLocalCopy = async (uri: string, name: string): Promise<string> => {
  const directory = new Directory(Paths.cache, "file-save", String(Date.now()));
  directory.create({ intermediates: true, idempotent: true });
  const target = new File(directory, safeName(name || nameFromUri(uri)));
  if (/^https?:/i.test(uri)) {
    const downloaded = await File.downloadFileAsync(uri, target, { idempotent: true });
    return downloaded.uri;
  }
  const inline = /^data:[^,]*;base64,(.*)$/s.exec(uri);
  if (inline?.[1]) {
    target.create({ overwrite: true, intermediates: true });
    target.write(inline[1], { encoding: "base64" });
    return target.uri;
  }
  new File(uri).copy(target);
  return target.uri;
};

const UTI_BY_MIME: Record<string, string> = {
  "application/pdf": "com.adobe.pdf",
  "image/jpeg": "public.jpeg",
  "image/png": "public.png",
  "image/gif": "com.compuserve.gif",
  "image/heic": "public.heic",
  "video/mp4": "public.mpeg-4",
  "video/quicktime": "com.apple.quicktime-movie",
};

/**
 * Save a file to the phone through the system sheet: images and videos get
 * "Save Image" / "Save Video" (the Photos library), everything else "Save to
 * Files". Android's sheet hands it to Files, Drive or any other app.
 */
export const saveFileToDevice = async (
  uri: string,
  options: { name: string; mimeType?: string | null },
): Promise<void> => {
  const local = await namedLocalCopy(uri, options.name);
  const mimeType = options.mimeType?.split(";")[0]?.trim().toLowerCase() || undefined;
  const uti = mimeType ? UTI_BY_MIME[mimeType] : undefined;
  await Sharing.shareAsync(local, {
    ...(mimeType ? { mimeType } : {}),
    ...(uti ? { UTI: uti } : {}),
    dialogTitle: "Save",
  });
};

/** Upload a phone-side copy of a file into the drive, for a file the drive lacks. */
const uploadToDrive = async (
  uri: string,
  name: string,
  mimeType: string,
): Promise<string> => {
  const local = /^file:/i.test(uri) ? uri : await namedLocalCopy(uri, name);
  const file = new File(local);
  return await uploadChatAttachment(
    {
      id: `share-${Date.now()}`,
      uri: local,
      name,
      mimeType,
      sizeBytes: file.size ?? 0,
      kind: mimeType.startsWith("image/") ? "image" : "file",
    },
    new Set(),
    {
      client: getBackendClient(),
      readFile: async (path) => await new File(path).bytes(),
      fetch: expoFetch,
    },
  );
};

export type ShareSource = {
  /** The file's drive path, when it is known to be in the drive. */
  drivePath: string | null;
  /** A computer path the drive may hold a copy of. */
  devicePath: string | null;
  /** The bytes on the phone (or a URL for them), to upload when the drive has no copy. */
  localUri: string | null;
  name: string;
  mimeType: string;
};

/**
 * A public link to the file: the drive copy's existing link, or a new one.
 * A file only on a computer is found in the drive by its path; failing that,
 * the phone's copy goes into the drive first.
 */
export const publicFileLink = async (source: ShareSource): Promise<string> => {
  let drivePath = source.drivePath;
  if (!drivePath && source.devicePath) {
    drivePath = (await locateDeviceFile(source.devicePath))?.drivePath ?? null;
  }
  if (!drivePath && source.localUri) {
    drivePath = await uploadToDrive(source.localUri, source.name, source.mimeType);
  }
  if (!drivePath) throw new Error("This file isn't in your drive.");
  const link = await getBackendClient().call("shares.shareFile", { path: drivePath });
  return link.url;
};

/** Open the system share sheet with a link. */
export const shareLink = async (url: string, title?: string): Promise<void> => {
  await Share.share(
    Platform.OS === "ios" ? { url } : { message: url, ...(title ? { title } : {}) },
  );
};

/** A cache file holding `text`, named `name`, for saving or uploading text the viewer shows. */
export const writeTextCopy = (text: string, name: string): string => {
  const directory = new Directory(Paths.cache, "file-save", String(Date.now()));
  directory.create({ intermediates: true, idempotent: true });
  const target = new File(directory, safeName(name));
  target.create({ overwrite: true, intermediates: true });
  target.write(text);
  return target.uri;
};
