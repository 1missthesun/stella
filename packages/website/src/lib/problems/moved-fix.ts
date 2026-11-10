/**
 * Old /fix/<slug> pages whose problem now has a full /how page. next.config.ts
 * redirects them permanently; the /fix index links straight to the new page and
 * the sitemap drops the old URL. No imports: next.config loads this file.
 */
export const MOVED_FIX_PAGES: Record<string, string> = {
  "organize-downloads-folder": "/how/files/organize-downloads-folder",
  "bank-statement-to-excel": "/how/excel/bank-statement-pdf-to-excel",
};
