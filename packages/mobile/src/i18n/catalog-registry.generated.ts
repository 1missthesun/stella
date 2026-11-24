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
  "ar": { asset: () => require("./packs/ar.zip") as number, hash: "f9d50d3518cd" },
  "cs": { asset: () => require("./packs/cs.zip") as number, hash: "2b2d751cca92" },
  "da": { asset: () => require("./packs/da.zip") as number, hash: "5f00f822cfd8" },
  "de": { asset: () => require("./packs/de.zip") as number, hash: "b3a07bb58876" },
  "el": { asset: () => require("./packs/el.zip") as number, hash: "81834c6ad441" },
  "es": { asset: () => require("./packs/es.zip") as number, hash: "d855f4b8c243" },
  "fi": { asset: () => require("./packs/fi.zip") as number, hash: "0c7b717413f2" },
  "fr": { asset: () => require("./packs/fr.zip") as number, hash: "41e9400ade0d" },
  "he": { asset: () => require("./packs/he.zip") as number, hash: "f41d8f65c510" },
  "hi": { asset: () => require("./packs/hi.zip") as number, hash: "d4c5cbc3f2c4" },
  "hu": { asset: () => require("./packs/hu.zip") as number, hash: "92c28ad3b6c0" },
  "id": { asset: () => require("./packs/id.zip") as number, hash: "1e431b25e513" },
  "it": { asset: () => require("./packs/it.zip") as number, hash: "079066c00dc3" },
  "ja": { asset: () => require("./packs/ja.zip") as number, hash: "5eeb93e1f7c5" },
  "ko": { asset: () => require("./packs/ko.zip") as number, hash: "a73b0a34ec62" },
  "nb": { asset: () => require("./packs/nb.zip") as number, hash: "2ab5230e98e0" },
  "nl": { asset: () => require("./packs/nl.zip") as number, hash: "8e7f8924af72" },
  "pl": { asset: () => require("./packs/pl.zip") as number, hash: "c4c7576b7824" },
  "pt": { asset: () => require("./packs/pt.zip") as number, hash: "13d150847f55" },
  "ro": { asset: () => require("./packs/ro.zip") as number, hash: "fde9889ce03e" },
  "ru": { asset: () => require("./packs/ru.zip") as number, hash: "990888b6aaaf" },
  "sv": { asset: () => require("./packs/sv.zip") as number, hash: "988c61feaa46" },
  "th": { asset: () => require("./packs/th.zip") as number, hash: "f0f28097f2dd" },
  "tr": { asset: () => require("./packs/tr.zip") as number, hash: "2ba41cfae643" },
  "vi": { asset: () => require("./packs/vi.zip") as number, hash: "3227026cd39f" },
  "zh-Hans": { asset: () => require("./packs/zh-Hans.zip") as number, hash: "77e38a589ca2" },
  "zh-Hant": { asset: () => require("./packs/zh-Hant.zip") as number, hash: "21d3d624d6be" },
};
