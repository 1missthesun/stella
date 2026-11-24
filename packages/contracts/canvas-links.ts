import { driveLinkPath, safeDriveRelativePath } from "./cloud-world-paths";
import { isAbsoluteLocalFilePath } from "./local-file-links";
import { parseStellaAppUrl } from "./workspace-apps";

export type CanvasDocumentLocation =
  | { kind: "drive"; path: string }
  | { kind: "device"; path: string };

export type CanvasLink =
  | { kind: "fragment"; fragment: string }
  | { kind: "web"; url: string }
  | { kind: "external"; url: string }
  | { kind: "drive"; path: string }
  | { kind: "device"; path: string }
  | { kind: "app"; slug: string }
  | { kind: "blocked" };

const SCHEME_RE = /^([a-z][a-z\d+.-]*):/iu;
const EXTERNAL_SCHEMES = new Set(["mailto", "tel", "sms"]);

const decodePart = (value: string): string | null => {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

const splitHref = (href: string) => {
  const hashAt = href.indexOf("#");
  const beforeHash = hashAt === -1 ? href : href.slice(0, hashAt);
  const fragment = hashAt === -1 ? null : href.slice(hashAt + 1);
  const queryAt = beforeHash.indexOf("?");
  return {
    path: queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt),
    fragment,
  };
};

const fragmentLink = (fragment: string | null): CanvasLink => ({
  kind: "fragment",
  fragment: fragment ? (decodePart(fragment) ?? fragment) : "",
});

const normalizeSegments = (segments: readonly string[]): string[] | null => {
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out;
};

const sameDevicePath = (a: string, b: string) =>
  a.replace(/\\/gu, "/") === b.replace(/\\/gu, "/");

const deviceLink = (
  path: string,
  fragment: string | null,
  document: CanvasDocumentLocation | null,
): CanvasLink => {
  const drivePath = driveLinkPath(path);
  if (drivePath) return driveLink(drivePath, fragment, document);
  if (document?.kind === "device" && sameDevicePath(path, document.path)) {
    return fragmentLink(fragment);
  }
  return { kind: "device", path };
};

const driveLink = (
  path: string,
  fragment: string | null,
  document: CanvasDocumentLocation | null,
): CanvasLink => {
  if (document?.kind === "drive" && path === document.path) {
    return fragmentLink(fragment);
  }
  return { kind: "drive", path };
};

const absolutePath = (decoded: string): string | null => {
  const windows = /^([A-Za-z]:)[\\/](.*)$/u.exec(decoded);
  const separator = windows ? "\\" : "/";
  const rest = windows ? windows[2]! : decoded.replace(/^\/+/u, "");
  const segments = normalizeSegments(rest.split(/[\\/]/u));
  if (!segments || segments.length === 0) return null;
  return (windows ? `${windows[1]}${separator}` : "/") + segments.join(separator);
};

const resolveAbsolute = (
  rawPath: string,
  fragment: string | null,
  document: CanvasDocumentLocation | null,
): CanvasLink => {
  const decoded = decodePart(rawPath);
  if (!decoded || !isAbsoluteLocalFilePath(decoded)) return { kind: "blocked" };
  const path = absolutePath(decoded);
  return path ? deviceLink(path, fragment, document) : { kind: "blocked" };
};

const resolveRelative = (
  rawPath: string,
  fragment: string | null,
  document: CanvasDocumentLocation | null,
): CanvasLink => {
  if (!rawPath) return fragmentLink(fragment);
  if (!document) return { kind: "blocked" };
  const parts = rawPath.split("/").map(decodePart);
  if (parts.some((part) => part === null || /[\\\0]/u.test(part))) {
    return { kind: "blocked" };
  }
  if (document.kind === "drive") {
    const base = document.path.split("/").slice(0, -1);
    const segments = normalizeSegments([...base, ...(parts as string[])]);
    const drivePath = segments ? safeDriveRelativePath(segments.join("/")) : null;
    return drivePath ? driveLink(drivePath, fragment, document) : { kind: "blocked" };
  }
  const windows = /^([A-Za-z]:)[\\/]/u.exec(document.path);
  const separator = windows ? "\\" : "/";
  const documentSegments = document.path
    .slice(windows ? windows[0].length : 0)
    .split(/[\\/]/u)
    .slice(0, -1);
  const segments = normalizeSegments([...documentSegments, ...(parts as string[])]);
  if (!segments || segments.length === 0) return { kind: "blocked" };
  const path = (windows ? `${windows[1]}${separator}` : "/") + segments.join(separator);
  return deviceLink(path, fragment, document);
};

export const resolveCanvasLink = (
  href: string,
  document: CanvasDocumentLocation | null,
): CanvasLink => {
  const trimmed = href.trim();
  if (!trimmed) return { kind: "blocked" };
  if (trimmed.startsWith("#")) return fragmentLink(trimmed.slice(1));
  if (trimmed.startsWith("//")) {
    return resolveCanvasLink(`https:${trimmed}`, document);
  }
  const { path, fragment } = splitHref(trimmed);
  if (isAbsoluteLocalFilePath(path) || /^[A-Za-z]:[\\/]/u.test(path)) {
    return resolveAbsolute(path, fragment, document);
  }
  const scheme = SCHEME_RE.exec(trimmed)?.[1]?.toLowerCase();
  if (!scheme) return resolveRelative(path, fragment, document);
  if (scheme === "http" || scheme === "https") {
    try {
      return { kind: "web", url: new URL(trimmed).href };
    } catch {
      return { kind: "blocked" };
    }
  }
  if (EXTERNAL_SCHEMES.has(scheme)) return { kind: "external", url: trimmed };
  if (scheme === "stella") {
    const appSlug = parseStellaAppUrl(trimmed);
    if (appSlug) return { kind: "app", slug: appSlug };
    const drivePath = driveLinkPath(splitHref(trimmed).path);
    return drivePath ? driveLink(drivePath, fragment, document) : { kind: "blocked" };
  }
  if (scheme === "file") {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return { kind: "blocked" };
    }
    if (url.host && url.host !== "localhost") return { kind: "blocked" };
    const filePath = /^\/[A-Za-z]:\//u.test(url.pathname)
      ? url.pathname.slice(1)
      : url.pathname;
    return resolveAbsolute(filePath, fragment, document);
  }
  return { kind: "blocked" };
};

export const canvasDocumentLocation = (
  filePath: string,
  driveBacked: boolean,
): CanvasDocumentLocation | null => {
  const trimmed = filePath.trim();
  if (!trimmed) return null;
  const drivePath =
    driveLinkPath(trimmed) ??
    (driveBacked ? safeDriveRelativePath(trimmed.replace(/^\/+/u, "")) : null);
  if (drivePath) return { kind: "drive", path: drivePath };
  if (driveBacked) return null;
  return isAbsoluteLocalFilePath(trimmed) ? { kind: "device", path: trimmed } : null;
};
