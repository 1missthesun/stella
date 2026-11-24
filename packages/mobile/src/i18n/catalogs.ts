import { Asset } from "expo-asset";
import { Directory, File, Paths } from "expo-file-system";
import {
  LOCALE_PACK_ASSETS,
  loadEnglishCatalog,
} from "./catalog-registry.generated";
import type { Catalog } from "./catalog-types";
import { extractSingleZipUtf8 } from "./inflate";
import { DEFAULT_LOCALE, type Locale } from "@stella/contracts/locales";

export type { Catalog };

const unwrap = (mod: unknown): Catalog => {
  if (mod && typeof mod === "object" && "default" in (mod as object)) {
    const inner = (mod as { default: unknown }).default;
    if (inner && typeof inner === "object") return inner as Catalog;
  }
  return (mod ?? {}) as Catalog;
};

const catalogCache = new Map<Locale, Catalog>();
const inflightLoads = new Map<Locale, Promise<Catalog>>();
let englishLeafOrderCache: string[] | null = null;

const isLeafCatalogValue = (value: unknown): boolean =>
  typeof value === "string" ||
  Array.isArray(value) ||
  isPluralForms(value) ||
  value === null ||
  typeof value !== "object";

const collectOrderedLeafPaths = (
  node: unknown,
  prefix = "",
  out: string[] = [],
): string[] => {
  if (isLeafCatalogValue(node)) {
    if (prefix) out.push(prefix);
    return out;
  }
  for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
    collectOrderedLeafPaths(child, prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
};

const getEnglishLeafOrder = (): string[] => {
  if (!englishLeafOrderCache) {
    englishLeafOrderCache = collectOrderedLeafPaths(getEnglishCatalog());
  }
  return englishLeafOrderCache;
};

const hydrateCatalogFromValues = (values: unknown[]): Catalog => {
  const keys = getEnglishLeafOrder();
  const root: Catalog = {};
  const count = Math.min(keys.length, values.length);
  for (let i = 0; i < count; i += 1) {
    const value = values[i];
    if (value === null || value === undefined) continue;
    const segments = keys[i]!.split(".");
    let cursor = root;
    for (let s = 0; s < segments.length - 1; s += 1) {
      const seg = segments[s]!;
      let next = cursor[seg];
      if (!next || typeof next !== "object" || Array.isArray(next)) {
        next = {};
        cursor[seg] = next;
      }
      cursor = next as Catalog;
    }
    cursor[segments[segments.length - 1]!] = value;
  }
  return root;
};

const localeCacheDir = (): Directory | null => {
  try {
    return new Directory(Paths.cache, "stella-i18n");
  } catch {
    return null;
  }
};

const localeCacheFile = (locale: Locale, hash: string): File | null => {
  const dir = localeCacheDir();
  if (!dir) return null;
  return new File(dir, `${locale}-${hash}.json`);
};

const readDiskCachedCatalogSync = (locale: Locale): Catalog | null => {
  const pack = LOCALE_PACK_ASSETS[locale];
  if (!pack) return null;
  try {
    const file = localeCacheFile(locale, pack.hash);
    if (!file || !file.exists) return null;
    const parsed: unknown = JSON.parse(file.textSync());
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Catalog;
  } catch {
    return null;
  }
};

const writeDiskCachedCatalog = (locale: Locale, hash: string, catalog: Catalog): void => {
  try {
    const dir = localeCacheDir();
    if (!dir) return;
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const prefix = `${locale}-`;
    const targetName = `${locale}-${hash}.json`;
    for (const item of dir.list()) {
      if (item instanceof File && item.name.startsWith(prefix) && item.name !== targetName) {
        try {
          item.delete();
        } catch {}
      }
    }
    const file = new File(dir, targetName);
    file.write(JSON.stringify(catalog));
  } catch {}
};

export const getEnglishCatalog = (): Catalog => {
  const cached = catalogCache.get(DEFAULT_LOCALE);
  if (cached) return cached;
  const catalog = unwrap(loadEnglishCatalog());
  catalogCache.set(DEFAULT_LOCALE, catalog);
  return catalog;
};

export const getCachedCatalogSync = (locale: Locale): Catalog | null => {
  if (locale === DEFAULT_LOCALE) return getEnglishCatalog();
  const inMemory = catalogCache.get(locale);
  if (inMemory) return inMemory;
  const fromDisk = readDiskCachedCatalogSync(locale);
  if (fromDisk) {
    catalogCache.set(locale, fromDisk);
    return fromDisk;
  }
  return null;
};

export const loadCatalogAsync = async (locale: Locale): Promise<Catalog> => {
  const cached = getCachedCatalogSync(locale);
  if (cached) return cached;

  const pack = LOCALE_PACK_ASSETS[locale];
  if (!pack) return getEnglishCatalog();

  const existing = inflightLoads.get(locale);
  if (existing) return existing;

  const work = (async (): Promise<Catalog> => {
    try {
      const asset = Asset.fromModule(pack.asset());
      if (!asset.localUri) {
        await asset.downloadAsync();
      }
      const uri = asset.localUri ?? asset.uri;
      if (!uri) return getEnglishCatalog();
      let zipBytes: Uint8Array;
      if (uri.startsWith("http://") || uri.startsWith("https://")) {
        const res = await fetch(uri);
        if (!res.ok) return getEnglishCatalog();
        zipBytes = new Uint8Array(await res.arrayBuffer());
      } else {
        zipBytes = await new File(uri).bytes();
      }
      const rawJson = extractSingleZipUtf8(zipBytes);
      const values: unknown = JSON.parse(rawJson);
      if (!Array.isArray(values)) return getEnglishCatalog();
      const catalog = hydrateCatalogFromValues(values);
      catalogCache.set(locale, catalog);
      writeDiskCachedCatalog(locale, pack.hash, catalog);
      return catalog;
    } catch {
      return getEnglishCatalog();
    }
  })().finally(() => {
    if (inflightLoads.get(locale) === work) inflightLoads.delete(locale);
  });

  inflightLoads.set(locale, work);
  return work;
};

export const getCatalog = (locale: Locale): Catalog =>
  getCachedCatalogSync(locale) ?? getEnglishCatalog();

const lookupPath = (catalog: Catalog | undefined, key: string): unknown => {
  if (!catalog) return undefined;
  let cursor: unknown = catalog;
  for (const segment of key.split(".")) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
    if (cursor === undefined) return undefined;
  }
  return cursor;
};

const reportedMissingKeys = new Set<string>();
const reportMissingKey = (key: string): void => {
  if (typeof __DEV__ === "undefined" || !__DEV__) return;
  if (reportedMissingKeys.has(key)) return;
  reportedMissingKeys.add(key);
  console.warn(
    `[i18n] missing translation key "${key}": add it to the desktop catalogs, or name it (or its prefix) as a literal so sync-i18n-catalogs keeps it.`,
  );
};

export type TranslateParams = Record<string, string | number>;

const interpolate = (template: string, params: TranslateParams): string =>
  template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined || value === null ? match : String(value);
  });

export const translate = (
  catalog: Catalog | undefined,
  key: string,
  params?: TranslateParams,
): string => {
  const value = lookupPath(catalog, key);
  if (typeof value === "string") {
    return params ? interpolate(value, params) : value;
  }
  const english = getEnglishCatalog();
  if (catalog !== english) {
    const fallback = lookupPath(english, key);
    if (typeof fallback === "string") {
      return params ? interpolate(fallback, params) : fallback;
    }
  }
  reportMissingKey(key);
  return key;
};

const PLURAL_CATEGORIES = [
  "zero",
  "one",
  "two",
  "few",
  "many",
  "other",
] as const;

type PluralCategory = (typeof PLURAL_CATEGORIES)[number];

type PluralForms = Partial<Record<PluralCategory, string>>;

const isPluralForms = (value: unknown): value is PluralForms => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return false;
  return entries.every(
    ([category, form]) =>
      (PLURAL_CATEGORIES as ReadonlyArray<string>).includes(category) &&
      typeof form === "string",
  );
};

const pluralRulesCache = new Map<string, Intl.PluralRules | null>();

const pluralRulesFor = (locale: string): Intl.PluralRules | undefined => {
  const cached = pluralRulesCache.get(locale);
  if (cached !== undefined) return cached ?? undefined;
  try {
    if (typeof Intl === "undefined" || typeof Intl.PluralRules !== "function") {
      pluralRulesCache.set(locale, null);
      return undefined;
    }
    const rules = new Intl.PluralRules(locale);
    pluralRulesCache.set(locale, rules);
    return rules;
  } catch {
    pluralRulesCache.set(locale, null);
    return undefined;
  }
};

const selectPluralForm = (
  forms: PluralForms,
  locale: string,
  count: number,
): string | undefined => {
  if (count === 0 && typeof forms.zero === "string") return forms.zero;

  const rules = pluralRulesFor(locale);
  const category = rules ? rules.select(count) : count === 1 ? "one" : "other";
  if (category) {
    const exact = forms[category as PluralCategory];
    if (typeof exact === "string") return exact;
  }
  return forms.other;
};

export const translatePlural = (
  catalog: Catalog | undefined,
  locale: string,
  key: string,
  count: number,
  params?: TranslateParams,
): string => {
  const withCount: TranslateParams = { ...params, count };

  const value = lookupPath(catalog, key);
  if (isPluralForms(value)) {
    const form = selectPluralForm(value, locale, count);
    if (typeof form === "string") return interpolate(form, withCount);
  }
  if (typeof value === "string") return interpolate(value, withCount);

  const english = getEnglishCatalog();
  if (catalog !== english) {
    const fallback = lookupPath(english, key);
    if (isPluralForms(fallback)) {
      const form = selectPluralForm(fallback, DEFAULT_LOCALE, count);
      if (typeof form === "string") return interpolate(form, withCount);
    }
    if (typeof fallback === "string") return interpolate(fallback, withCount);
  }
  reportMissingKey(key);
  return key;
};

export const translateArray = (
  catalog: Catalog | undefined,
  key: string,
  params?: TranslateParams,
): string[] => {
  const value = lookupPath(catalog, key);
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => (params ? interpolate(item, params) : item));
  }
  const english = getEnglishCatalog();
  if (catalog !== english) {
    const fallback = lookupPath(english, key);
    if (Array.isArray(fallback)) {
      return fallback
        .filter((item): item is string => typeof item === "string")
        .map((item) => (params ? interpolate(item, params) : item));
    }
  }
  reportMissingKey(key);
  return [];
};
