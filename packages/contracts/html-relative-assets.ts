/**
 * A local HTML document's relative assets (`<img src="img/x.png">`, a video
 * or audio source, a stylesheet, a script), for viewers that hold the document's text rather
 * than serving its folder: the website and the phone. They read each asset
 * through their own file lane and embed it, so the document renders as it
 * does on the desktop.
 *
 * Only paths inside the document's own folder are considered: `..` past the
 * folder, absolute paths, URLs and hidden files or folders are left alone.
 */

export type HtmlAssetKind = "image" | "media" | "text";

export type HtmlAssetLoader = (asset: {
  path: string;
  kind: HtmlAssetKind;
}) => Promise<string | null>;

const MAX_ASSETS = 64;
const MAX_EMBEDDED_CHARS = 48 * 1024 * 1024;
const CONCURRENCY = 4;

const TAG_RE = /<(img|video|audio|source|link|script)\b[^>]*>/gi;
const ATTRIBUTE_RE = /(\s)(src|href|poster|rel)(\s*=\s*)("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

type AssetSlot = {
  tag: string;
  start: number;
  end: number;
  attribute: string;
  ref: string;
  kind: HtmlAssetKind;
  mode: "attribute" | "style" | "script";
};

const decodeRef = (value: string) => {
  const withoutSuffix = value.split(/[?#]/u, 1)[0] ?? "";
  try {
    return decodeURIComponent(withoutSuffix);
  } catch {
    return withoutSuffix;
  }
};

/**
 * The absolute path `ref` names relative to the document at `documentPath`,
 * or null when it is not a plain relative path inside the document's folder.
 */
export const resolveRelativeHtmlAsset = (
  documentPath: string,
  ref: string,
): string | null => {
  const trimmed = ref.trim();
  if (
    !trimmed ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("\\") ||
    SCHEME_RE.test(trimmed)
  ) {
    return null;
  }
  const slash = Math.max(documentPath.lastIndexOf("/"), documentPath.lastIndexOf("\\"));
  if (slash < 0) return null;
  const separator = documentPath[slash] ?? "/";
  const directory = documentPath.slice(0, slash);
  const parts: string[] = [];
  for (const segment of decodeRef(trimmed).split(/[\\/]/u)) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    if (segment.startsWith(".") || segment.includes("\0")) return null;
    parts.push(segment);
  }
  if (parts.length === 0) return null;
  return `${directory}${separator}${parts.join(separator)}`;
};

const attributesOf = (tag: string) => {
  const found = new Map<string, { value: string; index: number; length: number }>();
  for (const match of tag.matchAll(ATTRIBUTE_RE)) {
    const name = match[2]!.toLowerCase();
    if (found.has(name)) continue;
    found.set(name, {
      value: match[5] ?? match[6] ?? match[7] ?? "",
      index: match.index!,
      length: match[0].length,
    });
  }
  return found;
};

const findAssetSlots = (html: string): AssetSlot[] => {
  const slots: AssetSlot[] = [];
  for (const match of html.matchAll(TAG_RE)) {
    const tag = match[0];
    const name = match[1]!.toLowerCase();
    const attributes = attributesOf(tag);
    const push = (
      attribute: string,
      kind: HtmlAssetKind,
      mode: AssetSlot["mode"],
    ) => {
      const value = attributes.get(attribute)?.value;
      if (!value) return;
      slots.push({
        tag,
        start: match.index!,
        end: match.index! + tag.length,
        attribute,
        ref: value,
        kind,
        mode,
      });
    };
    if (name === "img") push("src", "image", "attribute");
    else if (name === "video") {
      push("poster", "image", "attribute");
      push("src", "media", "attribute");
    } else if (name === "audio" || name === "source") push("src", "media", "attribute");
    else if (name === "script") push("src", "text", "script");
    else if (
      name === "link" &&
      /(?:^|\s)stylesheet(?:\s|$)/iu.test(attributes.get("rel")?.value ?? "")
    ) {
      push("href", "text", "style");
    }
  }
  return slots;
};

/** The absolute paths of the document's relative assets inside its folder. */
export const relativeHtmlAssetPaths = (
  html: string,
  documentPath: string,
): string[] => {
  const paths = new Set<string>();
  for (const slot of findAssetSlots(html)) {
    const resolved = resolveRelativeHtmlAsset(documentPath, slot.ref);
    if (resolved) paths.add(resolved);
    if (paths.size >= MAX_ASSETS) break;
  }
  return [...paths];
};

const escapeAttribute = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

const withAttribute = (tag: string, attribute: string, value: string) => {
  const existing = attributesOf(tag).get(attribute);
  if (!existing) return tag;
  const match = tag.slice(existing.index, existing.index + existing.length);
  const prefix = /^(\s)([^=\s]+)(\s*=\s*)/u.exec(match)?.[0] ?? ` ${attribute}=`;
  return (
    tag.slice(0, existing.index) +
    `${prefix}"${escapeAttribute(value)}"` +
    tag.slice(existing.index + existing.length)
  );
};

/**
 * `html` with each relative image, stylesheet and script inside the
 * document's folder embedded: images, video and audio as the URIs `load`
 * returns for them, stylesheets and scripts inline as the text it returns. An asset
 * `load` cannot supply keeps its original reference.
 */
export const embedRelativeHtmlAssets = async (
  html: string,
  documentPath: string,
  load: HtmlAssetLoader,
  signal?: AbortSignal,
): Promise<string> => {
  const slots = findAssetSlots(html).filter(
    (slot) => resolveRelativeHtmlAsset(documentPath, slot.ref) !== null,
  );
  if (slots.length === 0) return html;
  const keys = [
    ...new Set(
      slots.map(
        (slot) => `${slot.kind}\0${resolveRelativeHtmlAsset(documentPath, slot.ref)}`,
      ),
    ),
  ].slice(0, MAX_ASSETS);
  const loaded = new Map<string, string>();
  let embeddedChars = 0;
  let next = 0;
  const worker = async () => {
    while (next < keys.length && !signal?.aborted) {
      const key = keys[next++]!;
      if (embeddedChars >= MAX_EMBEDDED_CHARS) return;
      const [kind, path] = key.split("\0") as [HtmlAssetKind, string];
      const content = await load({ path, kind }).catch(() => null);
      if (content === null || embeddedChars + content.length > MAX_EMBEDDED_CHARS) {
        continue;
      }
      embeddedChars += content.length;
      loaded.set(key, content);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (signal?.aborted || loaded.size === 0) return html;

  let output = "";
  let cursor = 0;
  const contentOf = (slot: AssetSlot) =>
    loaded.get(`${slot.kind}\0${resolveRelativeHtmlAsset(documentPath, slot.ref)}`);
  for (const slot of slots) {
    if (slot.start < cursor) continue;
    if (slot.mode === "attribute") {
      let tag = slot.tag;
      for (const sibling of slots) {
        if (sibling.start !== slot.start || sibling.mode !== "attribute") continue;
        const content = contentOf(sibling);
        if (content !== undefined) tag = withAttribute(tag, sibling.attribute, content);
      }
      if (tag === slot.tag) continue;
      output += html.slice(cursor, slot.start) + tag;
      cursor = slot.end;
      continue;
    }
    const content = contentOf(slot);
    if (content === undefined) continue;
    output += html.slice(cursor, slot.start);
    cursor = slot.end;
    if (slot.mode === "style") {
      output += `<style>${content.replace(/<\/style/giu, "<\\/style")}</style>`;
    } else {
      const closingRe = /\s*<\/script\s*>/iuy;
      closingRe.lastIndex = cursor;
      const closing = closingRe.exec(html);
      if (!closing) {
        output += slot.tag;
        continue;
      }
      cursor += closing[0].length;
      const open = slot.tag.replace(
        ATTRIBUTE_RE,
        (attribute: string, _space: string, name: string) =>
          name.toLowerCase() === "src" ? "" : attribute,
      );
      output += `${open}${content.replace(/<\/script/giu, "<\\/script")}</script>`;
    }
  }
  return output + html.slice(cursor);
};

const DOCUMENT_ASSET_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "svg",
  "ico",
  "bmp",
  "mp4",
  "m4v",
  "webm",
  "mov",
  "mp3",
  "wav",
  "ogg",
  "m4a",
  "flac",
  "css",
  "js",
  "mjs",
  "woff",
  "woff2",
  "ttf",
  "otf",
]);

const extensionOf = (filePath: string) =>
  /\.([a-z0-9]+)$/iu.exec(filePath)?.[1]?.toLowerCase() ?? "";

/** An HTML or markdown document, whose folder its relative assets load from. */
export const isAssetDocumentPath = (filePath: string): boolean =>
  /\.(?:html?|mdx?)$/iu.test(filePath);

/**
 * A file type a document loads as an asset (an image, video, audio, a
 * stylesheet, script or font): what sharing a document also shares from its
 * folder. Documents, data and code files are not.
 */
export const isDocumentAssetPath = (filePath: string): boolean =>
  DOCUMENT_ASSET_EXTENSIONS.has(extensionOf(filePath));

/**
 * `assetPath` sits inside `documentPath`'s folder tree (at any depth, no
 * hidden file or folder on the way) and is an asset type. Both are absolute
 * paths in the same style; separators may be `/` or `\`.
 */
export const isDocumentFolderAsset = (
  documentPath: string,
  assetPath: string,
): boolean => {
  if (!isAssetDocumentPath(documentPath) || !isDocumentAssetPath(assetPath)) {
    return false;
  }
  const slash = Math.max(documentPath.lastIndexOf("/"), documentPath.lastIndexOf("\\"));
  if (slash < 0) return false;
  const folder = documentPath.slice(0, slash + 1);
  if (!assetPath.startsWith(folder)) return false;
  const rest = assetPath.slice(folder.length).split(/[\\/]/u);
  return rest.every(
    (segment) => segment !== "" && segment !== ".." && !segment.startsWith("."),
  );
};

const MARKDOWN_IMAGE_RE =
  /(!\[[^\]\n]*\]\(\s*)(<[^>\n]*>|[^\s)<>]+)((?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\))/gu;

const markdownImageRef = (destination: string) =>
  destination.startsWith("<") ? destination.slice(1, -1) : destination;

/** The absolute paths of a markdown document's relative images inside its folder. */
export const relativeMarkdownImagePaths = (
  markdown: string,
  documentPath: string,
): string[] => {
  const paths = new Set<string>();
  for (const match of markdown.matchAll(MARKDOWN_IMAGE_RE)) {
    const resolved = resolveRelativeHtmlAsset(documentPath, markdownImageRef(match[2]!));
    if (resolved) paths.add(resolved);
    if (paths.size >= MAX_ASSETS) break;
  }
  for (const resolved of relativeHtmlAssetPaths(markdown, documentPath)) {
    if (paths.size >= MAX_ASSETS) break;
    paths.add(resolved);
  }
  return [...paths];
};

/**
 * `markdown` with each relative image (`![alt](img/a.png)`) inside the
 * document's folder pointed at the URI `load` returns for it. An image
 * `load` cannot supply keeps its original reference.
 */
export const rewriteRelativeMarkdownImages = async (
  markdown: string,
  documentPath: string,
  load: (path: string) => Promise<string | null>,
  signal?: AbortSignal,
): Promise<string> => {
  const paths = [
    ...new Set(
      [...markdown.matchAll(MARKDOWN_IMAGE_RE)].flatMap((match) => {
        const resolved = resolveRelativeHtmlAsset(documentPath, markdownImageRef(match[2]!));
        return resolved ? [resolved] : [];
      }),
    ),
  ].slice(0, MAX_ASSETS);
  if (paths.length === 0) return markdown;
  const loaded = new Map<string, string>();
  let next = 0;
  const worker = async () => {
    while (next < paths.length && !signal?.aborted) {
      const assetPath = paths[next++]!;
      const uri = await load(assetPath).catch(() => null);
      if (uri) loaded.set(assetPath, uri);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (signal?.aborted || loaded.size === 0) return markdown;
  return markdown.replace(
    MARKDOWN_IMAGE_RE,
    (whole, open: string, destination: string, close: string) => {
      const resolved = resolveRelativeHtmlAsset(documentPath, markdownImageRef(destination));
      const uri = resolved ? loaded.get(resolved) : undefined;
      return uri ? `${open}<${uri.replace(/[<>\n]/gu, encodeURIComponent)}>${close}` : whole;
    },
  );
};
