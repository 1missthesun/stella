import { driveLinkPath, parseDriveLinkTarget } from "./cloud-world-paths";

const isWindowsAbsolutePath = (candidate: string): boolean =>
  /^[A-Za-z]:[\\/]/.test(candidate);

export const isAbsoluteLocalFilePath = (candidate: string): boolean =>
  (candidate.startsWith("/") && !candidate.startsWith("//")) ||
  isWindowsAbsolutePath(candidate);

const decodeLinkTarget = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const parseLocalFileLinkTarget = (url: string): string | null => {
  const trimmed = url.trim();
  if (!trimmed) return null;

  const decoded = decodeLinkTarget(trimmed);
  return isAbsoluteLocalFilePath(decoded) && decoded !== "/" ? decoded : null;
};

const MARKDOWN_LINK_RE =
  /!?\[[^\]]*?\]\(\s*(?:<([^>\r\n]+)>|([^()<>\s]+))\s*(?:["'][^"'\r\n]*["'])?\s*\)/g;

const withoutMarkdownCode = (markdown: string): string =>
  markdown
    .replace(
      /(^|\n)[ \t]{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]{0,3}\2[ \t]*(?=\n|$)|$)/g,
      "$1",
    )
    .replace(/(`+)[\s\S]*?\1/g, "");

const MARKDOWN_LINK_PARTS_RE =
  /(!?)\[([^\]]*?)\]\(\s*(?:<([^>\r\n]+)>|([^()<>\s]+))\s*(?:["'][^"'\r\n]*["'])?\s*\)/g;

const FENCE_LINE_RE = /^[ \t]{0,3}(`{3,}|~{3,})/;
const LINE_MARKER_RE = /^\s*(?:(?:[-*+]|\d+[.)])\s+|>\s*)*/;
const SEPARATORS_ONLY_RE = /^(?:\s|[·•∙|/\\,;:.&+*_~—–-]|\band\b|\bor\b)*$/i;

/**
 * Rewrite a reply's prose line by line, leaving fenced code untouched.
 * `rewrite` returns the new line, or null to drop it; the blank lines a
 * dropped line leaves never stack up into an empty paragraph.
 */
const rewriteProseLines = (
  markdown: string,
  rewrite: (line: string) => string | null,
): string => {
  let fence: string | null = null;
  let dropped = false;
  const kept: string[] = [];
  for (const line of markdown.split("\n")) {
    const fenceMatch = FENCE_LINE_RE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      if (fence === null) fence = marker[0]!;
      else if (marker[0] === fence) fence = null;
      kept.push(line);
      continue;
    }
    if (fence !== null) {
      kept.push(line);
      continue;
    }
    const next = rewrite(line);
    if (next === null) dropped = true;
    else kept.push(next);
  }
  const joined = kept.join("\n");
  return dropped ? joined.replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, "\n\n").trim() : joined;
};

const LEAD_LABEL_RE = /^[*_]{0,3}([^\s:*_[\]()`][^:*_[\]()`\n]{0,47}?)[*_]{0,3}\s*:[*_]{0,3}/;
const MAX_LEAD_LABEL_WORDS = 5;

const withoutLeadLabel = (line: string): string => {
  const match = LEAD_LABEL_RE.exec(line);
  if (!match) return line;
  const words = match[1]!.trim().split(/\s+/).length;
  return words <= MAX_LEAD_LABEL_WORDS ? line.slice(match[0].length) : line;
};

/**
 * True when `line` is nothing but links to attached files plus separators,
 * optionally after a short lead-in label such as `Screenshots:`.
 */
const isAttachmentOnlyLine = (
  line: string,
  isAttached: (filePath: string) => boolean,
): boolean => {
  let linked = false;
  const marker = LINE_MARKER_RE.exec(line)?.[0] ?? "";
  const rest = withoutLeadLabel(line.slice(marker.length)).replace(
    MARKDOWN_LINK_PARTS_RE,
    (match, _bang: string, _label: string, angled?: string, bare?: string) => {
      const filePath = parseFileLinkTarget(angled ?? bare ?? "");
      if (!filePath || !isAttached(filePath)) return match;
      linked = true;
      return "";
    },
  );
  return linked && SEPARATORS_ONLY_RE.test(rest);
};

/**
 * Drop every line that is nothing but links to attached files plus separator
 * punctuation (`·`, `/`, `|`, `,`, dashes, "and"), such as a closing
 * `[Live homepage](…) · [Before](…) / [after](…)` or
 * `Screenshots: [Menu](…) · [Final](…)`: the attachments already show those
 * files, and keeping the line would leave dead labels or a stray `· /` behind.
 * A short lead-in label (up to five words before a colon) goes with the line;
 * lines with any other words are untouched.
 */
export const dropAttachmentOnlyLines = (
  markdown: string,
  isAttached: (filePath: string) => boolean,
): string =>
  markdown
    ? rewriteProseLines(markdown, (line) =>
        isAttachmentOnlyLine(line, isAttached) ? null : line,
      )
    : markdown;

/**
 * Present a reply whose linked files render as attachments: a line of nothing
 * but such links (after an optional short label like `Screenshots:`) goes, see
 * `dropAttachmentOnlyLines`; an image embed of one is dropped because the image
 * shows beside the message; a link inside a sentence stays a link, so its
 * words still open the file. Code blocks are left alone.
 */
export const unlinkLocalFileLinks = (
  markdown: string,
  filePaths: readonly string[],
): string => {
  if (!markdown || filePaths.length === 0) return markdown;
  const attached = new Set(filePaths);
  const isAttached = (filePath: string) => attached.has(filePath);
  return rewriteProseLines(markdown, (line) =>
    isAttachmentOnlyLine(line, isAttached)
      ? null
      : line.replace(
          MARKDOWN_LINK_PARTS_RE,
          (match, bang: string, _label: string, angled?: string, bare?: string) => {
            const filePath = parseFileLinkTarget(angled ?? bare ?? "");
            return bang && filePath && attached.has(filePath) ? "" : match;
          },
        ),
  );
};

/** Every markdown link and image target outside code, in order. */
export const extractMarkdownLinkTargets = (markdown: string): string[] =>
  markdown
    ? Array.from(
        withoutMarkdownCode(markdown).matchAll(MARKDOWN_LINK_RE),
        (match) => match[1] ?? match[2] ?? "",
      )
    : [];

const uniqueParsed = (
  markdown: string,
  parse: (target: string) => string | null,
): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const target of extractMarkdownLinkTargets(markdown)) {
    const value = parse(target);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
};

/**
 * Absolute paths a reply links. A `stella://drive/...` link is never one of
 * them: it names the owner's drive, not a file on any machine.
 */
export const extractLocalFileLinkPaths = (markdown: string): string[] =>
  uniqueParsed(markdown, parseLocalFileLinkTarget);

/**
 * A link target as a file reference: an absolute local path (a cloud world
 * path included), or the canonical `stella://drive/<path>` of a drive link.
 */
export const parseFileLinkTarget = (url: string): string | null =>
  parseLocalFileLinkTarget(url) ?? parseDriveLinkTarget(url);

/** Every file a reply links, local or in the drive, as `parseFileLinkTarget` names it. */
export const extractFileLinkTargets = (markdown: string): string[] =>
  uniqueParsed(markdown, parseFileLinkTarget);

/** Drive-relative paths of the drive files a reply links, in either link form. */
export const extractDriveLinkPaths = (markdown: string): string[] =>
  uniqueParsed(markdown, driveLinkPath);
