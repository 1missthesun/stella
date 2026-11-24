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
  "ar": { asset: () => require("./packs/ar.zip") as number, hash: "427351e53d30" },
  "cs": { asset: () => require("./packs/cs.zip") as number, hash: "143a047edcec" },
  "da": { asset: () => require("./packs/da.zip") as number, hash: "a68039ba91ab" },
  "de": { asset: () => require("./packs/de.zip") as number, hash: "36a9ed7e92a0" },
  "el": { asset: () => require("./packs/el.zip") as number, hash: "4fdf464678b4" },
  "es": { asset: () => require("./packs/es.zip") as number, hash: "d3543d45ea43" },
  "fi": { asset: () => require("./packs/fi.zip") as number, hash: "e61e1401f5bd" },
  "fr": { asset: () => require("./packs/fr.zip") as number, hash: "2c4f3472308f" },
  "he": { asset: () => require("./packs/he.zip") as number, hash: "6c47af66c8d3" },
  "hi": { asset: () => require("./packs/hi.zip") as number, hash: "78f640da043d" },
  "hu": { asset: () => require("./packs/hu.zip") as number, hash: "7ceaa4cfbb4e" },
  "id": { asset: () => require("./packs/id.zip") as number, hash: "97a9bac5f306" },
  "it": { asset: () => require("./packs/it.zip") as number, hash: "e41f666d1ee2" },
  "ja": { asset: () => require("./packs/ja.zip") as number, hash: "b3bdc9761356" },
  "ko": { asset: () => require("./packs/ko.zip") as number, hash: "808952eb47ec" },
  "nb": { asset: () => require("./packs/nb.zip") as number, hash: "9596b120abaa" },
  "nl": { asset: () => require("./packs/nl.zip") as number, hash: "d9e36ce607f2" },
  "pl": { asset: () => require("./packs/pl.zip") as number, hash: "f6f17c6bebcc" },
  "pt": { asset: () => require("./packs/pt.zip") as number, hash: "9c0d1f3a9e04" },
  "ro": { asset: () => require("./packs/ro.zip") as number, hash: "0da449e1e44b" },
  "ru": { asset: () => require("./packs/ru.zip") as number, hash: "93446d9b116e" },
  "sv": { asset: () => require("./packs/sv.zip") as number, hash: "8241efc267d5" },
  "th": { asset: () => require("./packs/th.zip") as number, hash: "fbd8ade5679d" },
  "tr": { asset: () => require("./packs/tr.zip") as number, hash: "01d3daf056df" },
  "vi": { asset: () => require("./packs/vi.zip") as number, hash: "96d2ee50a41d" },
  "zh-Hans": { asset: () => require("./packs/zh-Hans.zip") as number, hash: "76b8204ece5e" },
  "zh-Hant": { asset: () => require("./packs/zh-Hant.zip") as number, hash: "6398206b4d5f" },
};
