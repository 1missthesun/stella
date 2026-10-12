/** Hash-history reconciliation for extensions shipped as Stella-home seed. */

import type { Effect } from "effect";

import {
  createDirectoryEntryAdapter,
  reconcileBundledEntriesEffect,
  type BundledSyncReport,
} from "./bundled-sync.js";

export type ExtensionsSyncReport = BundledSyncReport;

export const reconcileBundledExtensionsEffect = (
  bundledExtensionsDir: string,
  homeExtensionsDir: string,
): Effect.Effect<ExtensionsSyncReport, unknown> =>
  reconcileBundledEntriesEffect(
    bundledExtensionsDir,
    homeExtensionsDir,
    createDirectoryEntryAdapter(),
    {
      // Unknown/user-authored extensions are never retired by an app update.
      removeObsolete: false,
      manifestFilename: ".bundled-extensions-manifest.json",
    },
  );

