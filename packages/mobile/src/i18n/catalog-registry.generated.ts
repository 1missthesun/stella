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
  "ar": { asset: () => require("./packs/ar.zip") as number, hash: "01e143e0aeba" },
  "cs": { asset: () => require("./packs/cs.zip") as number, hash: "7e6648c6db60" },
  "da": { asset: () => require("./packs/da.zip") as number, hash: "aa705012f193" },
  "de": { asset: () => require("./packs/de.zip") as number, hash: "dd6fd981ec5c" },
  "el": { asset: () => require("./packs/el.zip") as number, hash: "a0d2f263fab8" },
  "es": { asset: () => require("./packs/es.zip") as number, hash: "9e1e01d2a4b5" },
  "fi": { asset: () => require("./packs/fi.zip") as number, hash: "3eedc462c986" },
  "fr": { asset: () => require("./packs/fr.zip") as number, hash: "b9ac147ffb30" },
  "he": { asset: () => require("./packs/he.zip") as number, hash: "d891e30af74a" },
  "hi": { asset: () => require("./packs/hi.zip") as number, hash: "09c74ec4dd94" },
  "hu": { asset: () => require("./packs/hu.zip") as number, hash: "f0f36d62d652" },
  "id": { asset: () => require("./packs/id.zip") as number, hash: "25a13499e9a6" },
  "it": { asset: () => require("./packs/it.zip") as number, hash: "aeaf4394052f" },
  "ja": { asset: () => require("./packs/ja.zip") as number, hash: "1083fc07c21e" },
  "ko": { asset: () => require("./packs/ko.zip") as number, hash: "1d2d6d7b7bbc" },
  "nb": { asset: () => require("./packs/nb.zip") as number, hash: "a39155478e07" },
  "nl": { asset: () => require("./packs/nl.zip") as number, hash: "11ef5882ec52" },
  "pl": { asset: () => require("./packs/pl.zip") as number, hash: "d8ccfda0fad2" },
  "pt": { asset: () => require("./packs/pt.zip") as number, hash: "3853bf8312e5" },
  "ro": { asset: () => require("./packs/ro.zip") as number, hash: "663440622782" },
  "ru": { asset: () => require("./packs/ru.zip") as number, hash: "d46dd4fa1117" },
  "sv": { asset: () => require("./packs/sv.zip") as number, hash: "59f612cc037c" },
  "th": { asset: () => require("./packs/th.zip") as number, hash: "e109e1b8abbc" },
  "tr": { asset: () => require("./packs/tr.zip") as number, hash: "4b5b66c4f786" },
  "vi": { asset: () => require("./packs/vi.zip") as number, hash: "7d31aea09ee3" },
  "zh-Hans": { asset: () => require("./packs/zh-Hans.zip") as number, hash: "4cb1b3a4788e" },
  "zh-Hant": { asset: () => require("./packs/zh-Hant.zip") as number, hash: "f7381e7aed95" },
};
