export const SHARE_MAX_HTML_BYTES = 5 * 1024 * 1024;
export const SHARE_MAX_TITLE_CHARS = 300;
export const SHARE_CANVAS_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export type ShareVisibility = "private" | "public";

export type PublishedShare = {
  url: string;
  slug: string;
  expiresAt: number;
};

export type SavedCanvasShare = {
  url: string;
  slug: string;
  visibility: ShareVisibility;
  expiresAt: number;
};

export type ShareLink = {
  slug: string;
  url: string;
  title: string | null;
  createdAt: number;
  expiresAt: number;
  visibility?: ShareVisibility;
  canvas?: string | null;
  file?: string | null;
};

export type SharedFileLink = {
  url: string;
  slug: string;
  expiresAt: number;
};

export type ShareCalls = {
  "shares.publish": {
    args: { html: string; title?: string };
    result: PublishedShare;
  };
  "shares.save": {
    args: {
      canvas: string;
      html: string;
      title?: string;
      visibility?: ShareVisibility;
    };
    result: SavedCanvasShare;
  };
  "shares.setVisibility": {
    args: { slug: string; visibility: ShareVisibility };
    result: SavedCanvasShare;
  };
  "shares.viewLink": {
    args: { slug: string };
    result: { url: string };
  };
  "shares.shareFile": {
    args: { path: string };
    result: SharedFileLink;
  };
  "shares.revoke": {
    args: { slug: string };
    result: { revoked: true };
  };
};

export type ShareViews = {
  "shares.list": { args: Record<string, never>; result: ShareLink[] };
  "shares.canvas": { args: { canvas: string }; result: ShareLink | null };
};
