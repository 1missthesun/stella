// GENERATED FILE — DO NOT EDIT.
// Derived from packages/desktop-ui/src/shared/i18n/locales/*.json
// by packages/mobile/scripts/sync-i18n-catalogs.mjs.

import type { Catalog } from "./catalog-types";

/** English is the only catalog bundled directly into Hermes JS bytecode. */
export const loadEnglishCatalog = (): Catalog =>
  require("./locales/en.json") as Catalog;

export type LocalePackDescriptor = {
  asset: () => number;
  hash: string;
};

/**
 * Compressed value-only packs for non-English locales, stored as Metro static
 * assets outside Hermes bytecode and unpacked on demand into expo-file-system.
 */
export const LOCALE_PACK_ASSETS: Record<string, LocalePackDescriptor> = {
  "ar": { asset: () => require("./packs/ar.zip") as number, hash: "07db73353d64" },
  "cs": { asset: () => require("./packs/cs.zip") as number, hash: "d158a517575b" },
  "da": { asset: () => require("./packs/da.zip") as number, hash: "567a61686409" },
  "de": { asset: () => require("./packs/de.zip") as number, hash: "47d9da6aedbe" },
  "el": { asset: () => require("./packs/el.zip") as number, hash: "58c32ba8a609" },
  "es": { asset: () => require("./packs/es.zip") as number, hash: "0f1c5f387af9" },
  "fi": { asset: () => require("./packs/fi.zip") as number, hash: "3e9e3ab9551d" },
  "fr": { asset: () => require("./packs/fr.zip") as number, hash: "e56ab56c81d3" },
  "he": { asset: () => require("./packs/he.zip") as number, hash: "0d5b7772f5b7" },
  "hi": { asset: () => require("./packs/hi.zip") as number, hash: "19d292c9af07" },
  "hu": { asset: () => require("./packs/hu.zip") as number, hash: "1083769efca7" },
  "id": { asset: () => require("./packs/id.zip") as number, hash: "741c9cf447b3" },
  "it": { asset: () => require("./packs/it.zip") as number, hash: "10d5d7937da2" },
  "ja": { asset: () => require("./packs/ja.zip") as number, hash: "bce071346b4a" },
  "ko": { asset: () => require("./packs/ko.zip") as number, hash: "6dced2ab87ed" },
  "nb": { asset: () => require("./packs/nb.zip") as number, hash: "4758baad026d" },
  "nl": { asset: () => require("./packs/nl.zip") as number, hash: "0535bdef150d" },
  "pl": { asset: () => require("./packs/pl.zip") as number, hash: "6c43dbb93a78" },
  "pt": { asset: () => require("./packs/pt.zip") as number, hash: "e62145ba971d" },
  "ro": { asset: () => require("./packs/ro.zip") as number, hash: "813b6a7b1228" },
  "ru": { asset: () => require("./packs/ru.zip") as number, hash: "ba4ec55da543" },
  "sv": { asset: () => require("./packs/sv.zip") as number, hash: "2f3703ec4f32" },
  "th": { asset: () => require("./packs/th.zip") as number, hash: "6f582d38e1d7" },
  "tr": { asset: () => require("./packs/tr.zip") as number, hash: "3700e6ef7ad5" },
  "vi": { asset: () => require("./packs/vi.zip") as number, hash: "1b86b413097e" },
  "zh-Hans": { asset: () => require("./packs/zh-Hans.zip") as number, hash: "f1399432f25f" },
  "zh-Hant": { asset: () => require("./packs/zh-Hant.zip") as number, hash: "fbb597714aca" },
};
