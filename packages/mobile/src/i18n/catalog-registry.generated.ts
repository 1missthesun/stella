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
  "ar": { asset: () => require("./packs/ar.zip") as number, hash: "47f38c98cf3e" },
  "cs": { asset: () => require("./packs/cs.zip") as number, hash: "ec20745b0cbc" },
  "da": { asset: () => require("./packs/da.zip") as number, hash: "f2a77811079d" },
  "de": { asset: () => require("./packs/de.zip") as number, hash: "f566911fd924" },
  "el": { asset: () => require("./packs/el.zip") as number, hash: "be94633d0050" },
  "es": { asset: () => require("./packs/es.zip") as number, hash: "2361ffd09435" },
  "fi": { asset: () => require("./packs/fi.zip") as number, hash: "9cd5bce80cb8" },
  "fr": { asset: () => require("./packs/fr.zip") as number, hash: "aa0490202102" },
  "he": { asset: () => require("./packs/he.zip") as number, hash: "7fc0008011ff" },
  "hi": { asset: () => require("./packs/hi.zip") as number, hash: "6ad3f9b620db" },
  "hu": { asset: () => require("./packs/hu.zip") as number, hash: "976244ac9831" },
  "id": { asset: () => require("./packs/id.zip") as number, hash: "3a417a46a33f" },
  "it": { asset: () => require("./packs/it.zip") as number, hash: "d686ac6f73aa" },
  "ja": { asset: () => require("./packs/ja.zip") as number, hash: "abcca5c9b27e" },
  "ko": { asset: () => require("./packs/ko.zip") as number, hash: "c42eec813f2c" },
  "nb": { asset: () => require("./packs/nb.zip") as number, hash: "fe9b60fcd01f" },
  "nl": { asset: () => require("./packs/nl.zip") as number, hash: "44717f2b52ab" },
  "pl": { asset: () => require("./packs/pl.zip") as number, hash: "9e3cbc40415b" },
  "pt": { asset: () => require("./packs/pt.zip") as number, hash: "8f61f3bd65da" },
  "ro": { asset: () => require("./packs/ro.zip") as number, hash: "8fe71bed291d" },
  "ru": { asset: () => require("./packs/ru.zip") as number, hash: "a40ff5aa9e59" },
  "sv": { asset: () => require("./packs/sv.zip") as number, hash: "e0c009534105" },
  "th": { asset: () => require("./packs/th.zip") as number, hash: "01cf4a1eb319" },
  "tr": { asset: () => require("./packs/tr.zip") as number, hash: "101fc74bcbc0" },
  "vi": { asset: () => require("./packs/vi.zip") as number, hash: "9cacc582a976" },
  "zh-Hans": { asset: () => require("./packs/zh-Hans.zip") as number, hash: "77eb44011dbd" },
  "zh-Hant": { asset: () => require("./packs/zh-Hant.zip") as number, hash: "4e8f090ab727" },
};
