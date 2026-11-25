import { extname } from "./chat-evidence-paths.js";
import { EVIDENCE_TILE_HEIGHT, EVIDENCE_TILE_WIDTH } from "./chat-evidence.js";

export const PAGE_PREVIEW_VIEWPORT = { width: 800, height: 600 } as const;

export const PAGE_PREVIEW_IMAGE = {
  width: EVIDENCE_TILE_WIDTH.page * 3,
  height: EVIDENCE_TILE_HEIGHT * 3,
} as const;

export const PAGE_PREVIEW_SHAPES = ["card", "page"] as const;
export type PagePreviewShape = (typeof PAGE_PREVIEW_SHAPES)[number];

export const PAGE_PREVIEW_LAYOUTS: Record<
  PagePreviewShape,
  {
    viewport: { width: number; height: number };
    scale: number;
    image: { width: number; height: number };
  }
> = {
  card: { viewport: PAGE_PREVIEW_VIEWPORT, scale: 1, image: PAGE_PREVIEW_IMAGE },
  page: {
    viewport: { width: 390, height: 468 },
    scale: 2,
    image: { width: 450, height: 540 },
  },
};

export const PAGE_PREVIEW_JPEG_QUALITY = 82;
export const PAGE_PREVIEW_CONTENT_TYPE = "image/jpeg";
export const PAGE_PREVIEW_SOURCE_MAX_BYTES = 8 * 1024 * 1024;
export const PAGE_PREVIEW_MAX_BYTES = 512 * 1024;
export const PAGE_PREVIEW_SETTLE_MS = 900;
export const PAGE_PREVIEW_TIMEOUT_MS = 12_000;

const PAGE_EXTENSIONS = new Set([".html", ".htm"]);

export const isHtmlPagePath = (filePath: string): boolean => {
  const cleaned = filePath.trim().split(/[?#]/)[0] ?? "";
  return PAGE_EXTENSIONS.has(extname(cleaned).toLowerCase());
};
