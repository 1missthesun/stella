import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { driveLinkPath } from "@stella/contracts/cloud-world-paths";
import { parseFileLinkTarget } from "@stella/contracts/local-file-links";
import { parseStellaAppUrl } from "@stella/contracts/workspace-apps";
import { basenameOf } from "@/features/workspace-display/path-to-viewer";

export const STELLA_FILE_SCHEME = "stella-file:";
export const STELLA_APP_SCHEME = "stella-app:";

const MARKDOWN_IMAGE = /!\[[^\]]*\]\(\s*<?((?:https?|data):[^)\s>]+)/gi;

/** Each `![alt](src)` whose src the host fetches for the engine (http(s) and data URLs), mapped to itself. */
export const fetchedImageSources = (markdown: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const match of markdown.matchAll(MARKDOWN_IMAGE)) out[match[1]!] = match[1]!;
  return out;
};

type Node = {
  type: string;
  url?: string;
  value?: string;
  children?: Node[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};

type Edit = { start: number; end: number; text: string };

const parser = unified().use(remarkParse).use(remarkGfm);

const SKIP = new Set(["code", "inlineCode", "html", "math", "inlineMath"]);

const textOf = (node: Node): string => (node.type === "text" || node.type === "inlineCode" ? (node.value ?? "") : (node.children ?? []).map(textOf).join(""));

const fileIdentity = (path: string): string => {
  const drivePath = driveLinkPath(path);
  return drivePath ? `cloud:${drivePath}` : `local:${path}`;
};

const fileLabel = (path: string): string => {
  const drivePath = driveLinkPath(path);
  return drivePath ? basenameOf(drivePath) : basenameOf(path);
};

const escapeLabel = (label: string) => label.replace(/[\\[\]]/g, (c) => `\\${c}`);

const link = (label: string, href: string) => `[${escapeLabel(label)}](<${href}>)`;

/** A Stella file link's path, from the href `prepareChatMarkdown` wrote. */
export const stellaFilePath = (href: string): string | null => (href.startsWith(STELLA_FILE_SCHEME) ? decodeURIComponent(href.slice(STELLA_FILE_SCHEME.length)) : null);

/** A Stella app link's slug, from the href `prepareChatMarkdown` wrote. */
export const stellaAppSlug = (href: string): string | null => (href.startsWith(STELLA_APP_SCHEME) ? decodeURIComponent(href.slice(STELLA_APP_SCHEME.length)) : null);

const cache = new Map<string, string>();
const CACHE_LIMIT = 400;

/**
 * desktop-ui's remark pass over chat Markdown (`remarkStellaFileLinks`, hidden files, hidden
 * rules) applied to the source itself, so the engine's Markdown draws the result: file and app
 * links become `stella-file:` / `stella-app:` links with their display labels, hidden file
 * images and (optionally) horizontal rules drop out.
 */
export function prepareChatMarkdown(text: string, options: { hideHorizontalRules?: boolean; hiddenFilePaths?: readonly string[] } = {}): string {
  const hidden = options.hiddenFilePaths ?? [];
  const key = `${options.hideHorizontalRules ? 1 : 0}\u0001${hidden.join("\0")}\u0001${text}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const hiddenSet = new Set(hidden);
  const edits: Edit[] = [];
  const at = (node: Node) => ({ start: node.position?.start.offset, end: node.position?.end.offset });
  const visit = (node: Node) => {
    if (SKIP.has(node.type)) return;
    const { start, end } = at(node);
    if (node.type === "link" && start !== undefined && end !== undefined) {
      const slug = parseStellaAppUrl(node.url ?? "");
      if (slug) {
        edits.push({ start, end, text: link(textOf(node).trim() || slug, `${STELLA_APP_SCHEME}${encodeURIComponent(slug)}`) });
        return;
      }
      const path = parseFileLinkTarget(node.url ?? "");
      if (path) {
        const label = textOf(node).trim();
        edits.push({ start, end, text: link(label && label !== path ? label : fileLabel(path), `${STELLA_FILE_SCHEME}${encodeURIComponent(path)}`) });
        return;
      }
    }
    if (node.type === "image" && start !== undefined && end !== undefined) {
      const path = parseFileLinkTarget(node.url ?? "");
      if (path && hiddenSet.has(fileIdentity(path))) {
        edits.push({ start, end, text: "" });
        return;
      }
    }
    if (node.type === "thematicBreak" && options.hideHorizontalRules && start !== undefined && end !== undefined) {
      edits.push({ start, end, text: "" });
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(parser.parse(text) as Node);
  let out = text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, out);
  return out;
}
