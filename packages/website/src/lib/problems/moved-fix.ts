/**
 * Old /fix/<slug> pages whose problem now has a full /how page. next.config.ts
 * redirects them permanently; the /fix index links straight to the new page and
 * the sitemap drops the old URL. No imports: next.config loads this file.
 */
export const MOVED_FIX_PAGES: Record<string, string> = {
  "organize-downloads-folder": "/how/pc-cleanup/organize-downloads-folder",
  "bank-statement-to-excel": "/how/pdf-excel/bank-statement-pdf-to-excel",
  "minecraft-modpack-crash": "/how/game-mods/minecraft-modpack-exit-code-1",
  "merge-excel-files": "/how/pdf-excel/combine-excel-files-into-one-sheet",
  // Retired (audit 2026-11-10): developer topics are the wrong audience, and the
  // DLSS 5 page promised a "leaked build". They redirect to the how-to index.
  "setup-dlss-5-one-click": "/how",
  "docker-wont-start": "/how",
  "git-disaster-recovery": "/how",
  "externally-managed-environment": "/how",
};
