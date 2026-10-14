import type {
  AnchorHTMLAttributes,
  CSSProperties,
  ImgHTMLAttributes,
} from "react";
import { memo, useMemo, useRef } from "react";
import {
  Streamdown,
  defaultRehypePlugins,
  defaultRemarkPlugins,
} from "streamdown";
import type { PluggableList, Plugin } from "unified";
import { cn } from "@/shared/lib/utils";
import {
  remarkStellaFileLinks,
  STELLA_APP_TAG,
  STELLA_APP_TAG_ATTRIBUTES,
  STELLA_FILE_TAG,
  STELLA_FILE_TAG_ATTRIBUTES,
} from "@/features/chat/lib/stella-file-links";
import { openCloudAppPanel } from "@/features/cloud/open-cloud-app-panel";
import { maybeHandleCanvasShareUrl } from "@/features/canvas-share/open-shared-canvas";
import {
  isUnmodifiedPrimaryClick,
  normalizedHttpUrl,
  openUrlInStellaBrowser,
} from "@/features/chat/lib/stella-web-links";
import { StellaFileLink } from "./StellaFileLink";
import {
  MarkdownDocumentImage,
  remarkDocumentImages,
  STELLA_DOCUMENT_IMAGE_TAG,
  STELLA_DOCUMENT_IMAGE_TAG_ATTRIBUTES,
} from "./MarkdownDocumentImage";
import {
  hasCompleteEmojiSpritePack,
  useActiveEmojiPack,
} from "./emoji-sprites/active-emoji-pack";
import { remarkEmojiSprites } from "./emoji-sprites/remark-emoji-sprites";
import { remarkMarkdownRenderCache } from "./markdown-render-cache";
import { shouldUseBoundedMarkdownPlaintext } from "@/features/chat/streaming/markdown-chunks";
import {
  cellToRowCol,
  getEmojiSpriteGridSize,
  parseEmojiSpriteUrl,
} from "./emoji-sprites/sprite-map";
import "./markdown.css";

interface MarkdownProps {
  text: string;
  cacheKey?: string;
  className?: string;
  hideHorizontalRules?: boolean;
  hiddenFilePaths?: readonly string[];
  documentPath?: string;
}

type MarkdownImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  node?: unknown;
};

/*
 * Streamdown's `remarkPlugins` prop *replaces* its defaults (which
 * include `remark-gfm` for tables/strikethrough/task lists), so we
 * have to spread its defaults back in alongside our additions.
 * `defaultRemarkPlugins` is exported as a `Record<string, Pluggable>`
 * map; the prop wants an array, so unwrap with `Object.values`.
 *
 * `BASE_REMARK_PLUGINS` is the default Streamdown set plus the
 * stella-file link rewriter (always on — assistant messages may reference
 * local files anywhere). The emoji sprite plugin is added only when a
 * complete active pack is present; otherwise native Unicode emoji must
 * remain visible.
 */
const DEFAULT_REMARK_PLUGINS = Object.values(defaultRemarkPlugins);

/*
 * `stella://file/...` and `stella://app/...` references are rewritten by
 * `remarkStellaFileLinks` into custom `<stella-file>` / `<stella-app>`
 * elements (a plain `<a href="stella://…">` would be stripped by
 * rehype-sanitize's protocol allow-list), so the sanitize schema must let
 * those tags and attributes through.
 *
 * Streamdown only merges its `allowedTags` prop into the schema while the
 * `rehypePlugins` prop is its own default array, and its default harden step
 * marks every link it cannot keep (a relative path, `ftp:`, `file:`, or any
 * scheme sanitize dropped) as "label [blocked]". Chat builds the same
 * raw / sanitize / harden pipeline itself so such a link renders as its
 * plain label instead.
 */
const ALLOWED_TAGS: Record<string, string[]> = {
  [STELLA_FILE_TAG]: [...STELLA_FILE_TAG_ATTRIBUTES],
  [STELLA_APP_TAG]: [...STELLA_APP_TAG_ATTRIBUTES],
  [STELLA_DOCUMENT_IMAGE_TAG]: [...STELLA_DOCUMENT_IMAGE_TAG_ATTRIBUTES],
};

type SanitizeSchema = {
  tagNames?: string[] | null;
  attributes?: Record<string, unknown[]> | null;
};
type HardenOptions = Record<string, unknown>;

const [sanitizePlugin, sanitizeSchema] =
  defaultRehypePlugins.sanitize as unknown as [
    Plugin<[SanitizeSchema]>,
    SanitizeSchema,
  ];
const [hardenPlugin, hardenOptions] =
  defaultRehypePlugins.harden as unknown as [
    Plugin<[HardenOptions]>,
    HardenOptions,
  ];

const REHYPE_PLUGINS: PluggableList = [
  defaultRehypePlugins.raw,
  [
    sanitizePlugin,
    {
      ...sanitizeSchema,
      tagNames: [...(sanitizeSchema.tagNames ?? []), ...Object.keys(ALLOWED_TAGS)],
      attributes: { ...sanitizeSchema.attributes, ...ALLOWED_TAGS },
    },
  ],
  [hardenPlugin, { ...hardenOptions, linkBlockPolicy: "text-only" }],
];

/*
 * Disable Streamdown's built-in "Open external link?" confirmation modal.
 *
 * We don't need it because the Electron main process already gates every
 * external open through `ExternalLinkService.setupExternalLinkHandlers`
 * (`setWindowOpenHandler` + `will-navigate` → `shell.openExternal`), so
 * a chat link click is already routed safely to the OS browser without
 * any in-renderer confirmation.
 *
 * Leaving it enabled caused three regressions in the chat surface:
 *   1. Streamdown rendered each link as a `<button>` and called
 *      `preventDefault()`, which made the surrounding message bubble pick
 *      up button focus / active styling on click ("the message gets
 *      highlighted").
 *   2. Streamdown's modal uses `position: fixed`, but our chat list is
 *      virtualized by `@legendapp/list` which applies `transform` to row
 *      containers — a transformed ancestor traps `position: fixed`, so
 *      the modal would render centered on the clicked *message* instead
 *      of the viewport.
 *   3. The modal carried Streamdown's own card chrome, not the
 *      Connect-dialog aesthetic the rest of the app uses.
 *
 * With `enabled: false`, links render as plain `<a target="_blank">` and
 * Electron's main-process handlers take over.
 */
const LINK_SAFETY = { enabled: false } as const;

const UNBOUNDED_STREAMDOWN_HEIGHT = Number.POSITIVE_INFINITY;

// Streamdown always splits the text into blocks with a full `marked` lex, but
// static mode renders the whole document in one pass and never reads those
// blocks (they feed streaming-mode block memoization and `dir="auto"`, neither
// of which chat uses). Skip the discarded lex on every row mount.
const NO_BLOCK_SPLIT = (): string[] => [];

const areMarkdownPropsEqual = (
  prev: MarkdownProps,
  next: MarkdownProps,
): boolean =>
  prev.hiddenFilePaths?.join("\0") === next.hiddenFilePaths?.join("\0") &&
  prev.text === next.text &&
  prev.cacheKey === next.cacheKey &&
  prev.documentPath === next.documentPath &&
  prev.className === next.className &&
  Boolean(prev.hideHorizontalRules) === Boolean(next.hideHorizontalRules);

const MarkdownImage = ({
  src,
  alt,
  className,
  ...rest
}: MarkdownImageProps) => {
  const cell = typeof src === "string" ? parseEmojiSpriteUrl(src) : null;
  if (!cell) {
    return <img {...rest} src={src} alt={alt} className={className} />;
  }
  const { row, col } = cellToRowCol(cell.cell);
  const gridSize = getEmojiSpriteGridSize();
  const last = Math.max(1, gridSize - 1);
  return (
    <span
      className={cn("ai-emoji", className)}
      style={
        {
          "--ai-emoji-row": String(row),
          "--ai-emoji-col": String(col),
          backgroundImage: `var(--ai-emoji-sheet-${cell.sheet}-url)`,
          backgroundSize: `${gridSize * 100}% ${gridSize * 100}%`,
          backgroundPosition: `${(col / last) * 100}% ${(row / last) * 100}%`,
        } as CSSProperties
      }
      role="img"
      aria-label={alt ?? ""}
    />
  );
};

type MarkdownLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  node?: unknown;
};

const MarkdownLink = ({
  href,
  onClick,
  node: _node,
  ...rest
}: MarkdownLinkProps) => (
  <a
    {...rest}
    data-streamdown="link"
    href={href}
    onClick={(event) => {
      onClick?.(event);
      if (event.defaultPrevented || !isUnmodifiedPrimaryClick(event)) return;

      const url = normalizedHttpUrl(event.currentTarget.href);
      if (url && maybeHandleCanvasShareUrl(url)) {
        event.preventDefault();
        return;
      }
      const api = window.electronAPI?.browserView;
      if (!url || !api) return;

      event.preventDefault();
      void openUrlInStellaBrowser(url, api).catch(() => {
        window.electronAPI?.system?.openExternal(url);
      });
    }}
  />
);

const StellaAppLink = ({ slug, label }: { slug?: unknown; label?: unknown; node?: unknown }) => {
  const appId = typeof slug === "string" ? slug : "";
  return (
    <a
      role="button"
      tabIndex={0}
      data-streamdown="link"
      onClick={() => appId && openCloudAppPanel({ appId })}
      onKeyDown={(event) => {
        if ((event.key === "Enter" || event.key === " ") && appId) {
          event.preventDefault();
          openCloudAppPanel({ appId });
        }
      }}
    >
      {typeof label === "string" ? label : appId}
    </a>
  );
};

const HiddenHorizontalRule = () => null;

const COMPONENTS = {
  a: MarkdownLink,
  img: MarkdownImage,
  [STELLA_FILE_TAG]: StellaFileLink,
  [STELLA_APP_TAG]: StellaAppLink,
  [STELLA_DOCUMENT_IMAGE_TAG]: MarkdownDocumentImage,
};
const COMPONENTS_WITHOUT_RULES = { ...COMPONENTS, hr: HiddenHorizontalRule };

let nextAnonCacheKey = 0;

export const Markdown = memo(function Markdown({
  text,
  cacheKey,
  className,
  hideHorizontalRules = false,
  hiddenFilePaths,
  documentPath,
}: MarkdownProps) {
  const anonCacheKeyRef = useRef<string | null>(null);
  if (anonCacheKeyRef.current === null) {
    anonCacheKeyRef.current = `markdown-anon-${nextAnonCacheKey++}`;
  }
  const effectiveCacheKey = cacheKey ?? anonCacheKeyRef.current;
  const components = hideHorizontalRules
    ? COMPONENTS_WITHOUT_RULES
    : COMPONENTS;
  const [activeEmojiPack] = useActiveEmojiPack();
  const emojiSpritesEnabled = hasCompleteEmojiSpritePack(activeEmojiPack);
  const hiddenFileKey = hiddenFilePaths?.join("\0") ?? "";
  const remarkPlugins = useMemo(() => {
    const cacheScope = `${emojiSpritesEnabled ? "emoji" : "plain"}\0${hiddenFileKey}\0${documentPath ?? ""}`;
    const plugins = [
      [remarkMarkdownRenderCache, cacheScope] as [
        typeof remarkMarkdownRenderCache,
        string,
      ],
      ...DEFAULT_REMARK_PLUGINS,
      [remarkStellaFileLinks, hiddenFileKey ? hiddenFileKey.split("\0") : []] as [typeof remarkStellaFileLinks, string[]],
      ...(documentPath
        ? [[remarkDocumentImages, documentPath] as [typeof remarkDocumentImages, string]]
        : []),
    ];
    return emojiSpritesEnabled ? [...plugins, remarkEmojiSprites] : plugins;
  }, [documentPath, emojiSpritesEnabled, hiddenFileKey]);
  const emojiVars = useMemo<CSSProperties | undefined>(() => {
    if (!emojiSpritesEnabled || !activeEmojiPack) return undefined;
    return Object.fromEntries(
      activeEmojiPack.sheetUrls.map((url, index) => [
        `--ai-emoji-sheet-${index}-url`,
        `url("${url}")`,
      ]),
    ) as CSSProperties;
  }, [activeEmojiPack, emojiSpritesEnabled]);
  const streamdownKey = `${effectiveCacheKey}:${emojiSpritesEnabled ? "emoji" : "plain"}:${hiddenFileKey}:${documentPath ?? ""}`;
  // Streamdown parsing is intentionally a hard-bounded main-thread task.
  // Parsing separate fragments changes document-level Markdown semantics
  // (references, lists), while one pathological paragraph or fence defeats
  // blank-line chunking. Preserve the complete authored text as plaintext
  // once the bounded parser budget is exceeded.
  const useBoundedPlaintext = shouldUseBoundedMarkdownPlaintext(text.length);
  return (
    <div style={emojiVars}>
      {useBoundedPlaintext ? (
        <div className={cn("markdown markdown--streaming-plaintext", className)}>
          {text}
        </div>
      ) : (
        <Streamdown
          key={streamdownKey}
          mode="static"
          codeBlockMaxHeight={UNBOUNDED_STREAMDOWN_HEIGHT}
          tableMaxHeight={UNBOUNDED_STREAMDOWN_HEIGHT}
          className={cn("markdown", className)}
          remarkPlugins={remarkPlugins}
          rehypePlugins={REHYPE_PLUGINS}
          components={components}
          allowedTags={ALLOWED_TAGS}
          linkSafety={LINK_SAFETY}
          parseMarkdownIntoBlocksFn={NO_BLOCK_SPLIT}
        >
          {text}
        </Streamdown>
      )}
    </div>
  );
}, areMarkdownPropsEqual);
