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
  "ar": { asset: () => require("./packs/ar.zip") as number, hash: "3b1f63a0c194" },
  "cs": { asset: () => require("./packs/cs.zip") as number, hash: "99e8b3a4081e" },
  "da": { asset: () => require("./packs/da.zip") as number, hash: "ce7a6d270267" },
  "de": { asset: () => require("./packs/de.zip") as number, hash: "b4fb0ceeb8bc" },
  "el": { asset: () => require("./packs/el.zip") as number, hash: "d0e928b1b25c" },
  "es": { asset: () => require("./packs/es.zip") as number, hash: "6de0e5c9e441" },
  "fi": { asset: () => require("./packs/fi.zip") as number, hash: "79e4e405d573" },
  "fr": { asset: () => require("./packs/fr.zip") as number, hash: "33f600f7d9c0" },
  "he": { asset: () => require("./packs/he.zip") as number, hash: "6ff5dcf5f55e" },
  "hi": { asset: () => require("./packs/hi.zip") as number, hash: "3833cefad42c" },
  "hu": { asset: () => require("./packs/hu.zip") as number, hash: "9401af9009cd" },
  "id": { asset: () => require("./packs/id.zip") as number, hash: "3f867a0a5acb" },
  "it": { asset: () => require("./packs/it.zip") as number, hash: "56ce174eb6d0" },
  "ja": { asset: () => require("./packs/ja.zip") as number, hash: "3c2d63fc040f" },
  "ko": { asset: () => require("./packs/ko.zip") as number, hash: "eea5b6674b1c" },
  "nb": { asset: () => require("./packs/nb.zip") as number, hash: "c7fefcb9d06d" },
  "nl": { asset: () => require("./packs/nl.zip") as number, hash: "890b20527532" },
  "pl": { asset: () => require("./packs/pl.zip") as number, hash: "4add6ff16574" },
  "pt": { asset: () => require("./packs/pt.zip") as number, hash: "48565412a8b4" },
  "ro": { asset: () => require("./packs/ro.zip") as number, hash: "231a21f63b45" },
  "ru": { asset: () => require("./packs/ru.zip") as number, hash: "4282421f4679" },
  "sv": { asset: () => require("./packs/sv.zip") as number, hash: "8303f1cf1eb9" },
  "th": { asset: () => require("./packs/th.zip") as number, hash: "74a331a1e5a2" },
  "tr": { asset: () => require("./packs/tr.zip") as number, hash: "d1a65d7d2d4c" },
  "vi": { asset: () => require("./packs/vi.zip") as number, hash: "7b6e15a7fcf4" },
  "zh-Hans": { asset: () => require("./packs/zh-Hans.zip") as number, hash: "2bff5a8873c0" },
  "zh-Hant": { asset: () => require("./packs/zh-Hant.zip") as number, hash: "014b20c43422" },
};
