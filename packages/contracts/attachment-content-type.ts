const BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  html: "text/html",
  htm: "text/html",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  zip: "application/zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const GENERIC = new Set(["", "application/octet-stream", "binary/octet-stream", "application/unknown"]);

const normalized = (value: string | null | undefined): string =>
  (value ?? "").split(";")[0]!.trim().toLowerCase();

export const isGenericContentType = (value: string | null | undefined): boolean =>
  GENERIC.has(normalized(value));

export const contentTypeFromName = (name: string | null | undefined): string | undefined => {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot < 0) return undefined;
  return BY_EXTENSION[base.slice(dot + 1).toLowerCase()];
};

export const imageContentTypeFromBytes = (bytes: Uint8Array): string | undefined => {
  const at = (index: number) => bytes[index];
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "image/png";
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return "image/gif";
  if (
    at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 &&
    at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50
  ) {
    return "image/webp";
  }
  return undefined;
};

export const attachmentContentType = (args: {
  declared?: string | null;
  name?: string | null;
  bytes?: Uint8Array;
}): string => {
  const declared = normalized(args.declared);
  if (!GENERIC.has(declared)) return declared;
  return (
    contentTypeFromName(args.name) ??
    (args.bytes ? imageContentTypeFromBytes(args.bytes) : undefined) ??
    "application/octet-stream"
  );
};

export const drivePathFromSignedDriveUrl = (url: string | null | undefined): string | undefined => {
  if (!url || !/^https:\/\//i.test(url)) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (!parsed.searchParams.has("X-Amz-Signature")) return undefined;
  const match = /\/drive\/[0-9a-f]{64}\/files\/[^/]+\/[^/]+\/(.+)$/.exec(parsed.pathname);
  if (!match) return undefined;
  try {
    const path = match[1]!.split("/").map(decodeURIComponent).join("/");
    return path && !path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
      ? path
      : undefined;
  } catch {
    return undefined;
  }
};
