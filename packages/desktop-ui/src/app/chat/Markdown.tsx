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
 */
const DEFAULT_REMARK_PLUGINS = Object.values(defaultRemarkPlugins);

/*
 * rehype-sanitize's protocol allow-list strips `<a href="stella://…">`, and
 * Streamdown merges its `allowedTags` prop into the schema only while
 * `rehypePlugins` is its own default array; its default harden step also
 * marks every link it cannot keep as "label [blocked]".
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

const LINK_SAFETY = { enabled: false } as const;

const UNBOUNDED_STREAMDOWN_HEIGHT = Number.POSITIVE_INFINITY;

// Streamdown always lexes the text into blocks with `marked`, but static mode
// never reads them (they only feed streaming-mode memoization and `dir="auto"`).
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

// @reloadable render caches refill on the next render
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
