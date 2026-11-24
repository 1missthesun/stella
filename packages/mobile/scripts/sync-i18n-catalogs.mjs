#!/usr/bin/env node
/**
 * Derives the phone's translation catalogs from the desktop ones
 * (`packages/desktop-ui/src/shared/i18n/locales/*.json`) into
 * `packages/mobile/src/i18n/`, so Metro can resolve them from inside the
 * mobile project root.
 *
 * WHY A COPY AND NOT A CROSS-PACKAGE IMPORT
 * -----------------------------------------
 * The desktop catalogs live OUTSIDE Metro's `projectRoot` (`packages/mobile`).
 * Reaching them directly would need `watchFolders: [monorepoRoot]`, which makes
 * Metro crawl the entire repo on every start, and a dependency on
 * `@stella/desktop-ui`, which mobile deliberately does not have. The outputs
 * are git-tracked inside `src/`, which is what makes an EAS build work (EAS
 * uploads the git-tracked tree before any build hook runs).
 *
 * WHAT IS WRITTEN
 * ---------------
 * - `locales/en.json`: English, the only catalog inside the Hermes bundle. It
 *   is also every other language's per-key fallback.
 * - `packs/<locale>.zip`: the other 27 languages as Metro static assets
 *   (`.zip` is a stock Metro asset extension: no Metro config change). Each is a
 *   single-entry zip of a JSON array of values in English's key order (the key
 *   names are not repeated 27 times). expo-updates downloads an asset only
 *   when its content hash changes, while the JS bundle is downloaded whole on
 *   every OTA, so translations no longer ride along with every update. The app
 *   unpacks the active language on demand (`src/i18n/catalogs.ts`, offline
 *   first launch included) and caches the result on disk under `hash`.
 * - `catalog-registry.generated.ts`: the static `require()` map (Metro cannot
 *   resolve a `require()` whose argument is a variable) plus each pack's hash.
 *
 * PRUNING
 * -------
 * The desktop catalogs hold ~2,700 keys, most of them desktop-only. The outputs
 * keep only the keys the phone can reach: any key or key subtree named by a
 * string literal (or by the static prefix of a built key, `prefix.${…}` or
 * "prefix." + value) anywhere in the mobile package or in the workspace
 * packages it depends on (found from package.json). Everything under `mobile.*`
 * is always kept. A key the phone builds from a value that is not a literal
 * anywhere in those sources must be listed in `ALWAYS_INCLUDED_PREFIXES`; in
 * development the app warns when a key resolves to nothing. CI
 * (`check:generated`) and `publish-ota.sh` refuse outputs that are stale
 * against the sources.
 *
 * Run: `node scripts/sync-i18n-catalogs.mjs` (wired into the mobile
 * `start` / `ios` / `android` / `typecheck` scripts).
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { isEntryPoint } from "../../../scripts/lib/entry-point.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const mobileRoot = resolve(here, "..");
const desktopI18n = resolve(mobileRoot, "../desktop-ui/src/shared/i18n");
const outDir = join(mobileRoot, "src", "i18n");

const banner = (source) =>
  `// GENERATED FILE — DO NOT EDIT.\n` +
  `// Derived from packages/desktop-ui/src/shared/i18n/${source}\n` +
  `// by packages/mobile/scripts/sync-i18n-catalogs.mjs.\n`;

// Bump when the pack layout or how the app reads it changes.
const PACK_FORMAT = "stella-i18n-pack/1";

const PLURAL_CATEGORIES = new Set(["zero", "one", "two", "few", "many", "other"]);
// Keep all mobile-owned keys; shared workspace packages (`@stella/contracts`,
// `@stella/theme`, ...) are discovered automatically from package.json below.
const ALWAYS_INCLUDED_PREFIXES = ["mobile"];

const isPluralNode = (value) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const entries = Object.entries(value);
  return (
    entries.length > 0 &&
    entries.every(
      ([category, form]) =>
        PLURAL_CATEGORIES.has(category) && typeof form === "string",
    )
  );
};

const isLeafValue = (value) =>
  typeof value === "string" ||
  Array.isArray(value) ||
  isPluralNode(value) ||
  value === null ||
  typeof value !== "object";

const collectCatalogPaths = (node, prefix = "", leaves = new Set(), branches = new Set()) => {
  if (isLeafValue(node)) {
    if (prefix) leaves.add(prefix);
    return { leaves, branches };
  }
  if (prefix) branches.add(prefix);
  for (const [key, child] of Object.entries(node)) {
    collectCatalogPaths(child, prefix ? `${prefix}.${key}` : key, leaves, branches);
  }
  return { leaves, branches };
};

const orderedLeafPaths = (node, prefix = "", out = []) => {
  if (isLeafValue(node)) {
    if (prefix) out.push(prefix);
    return out;
  }
  for (const [key, child] of Object.entries(node)) {
    orderedLeafPaths(child, prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
};

const lookupPath = (obj, pathStr) => {
  let cursor = obj;
  for (const seg of pathStr.split(".")) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = cursor[seg];
  }
  return cursor;
};

const SKIPPED_DIRS = new Set([
  "node_modules",
  "locales",
  "packs",
  ".expo",
  "dist",
  "ios",
  "android",
  "build",
]);

const walkSourceFiles = (dir, out = []) => {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      walkSourceFiles(full, out);
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
};

// The mobile package plus every workspace package it depends on, transitively.
const mobileSourceRoots = (mobileSourceRoot) => {
  const packagesDir = dirname(mobileSourceRoot);
  const byName = new Map();
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = join(packagesDir, entry.name, "package.json");
    if (!existsSync(manifest)) continue;
    const { name } = JSON.parse(readFileSync(manifest, "utf8"));
    if (name) byName.set(name, join(packagesDir, entry.name));
  }
  const roots = [];
  const pending = [mobileSourceRoot];
  while (pending.length > 0) {
    const root = pending.pop();
    if (roots.includes(root)) continue;
    roots.push(root);
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
      if (String(version).startsWith("workspace:") && byName.has(name)) {
        pending.push(byName.get(name));
      }
    }
  }
  return roots;
};

const collectUsedMobileKeys = ({ mobileSourceRoot, englishCatalog }) => {
  const { leaves, branches } = collectCatalogPaths(englishCatalog);
  const topSections = Object.keys(englishCatalog);
  const exactKeys = new Set();
  const branchPrefixes = new Set(ALWAYS_INCLUDED_PREFIXES);

  if (topSections.length === 0) return { exactKeys, branchPrefixes };

  const topAlt = topSections
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const literalKeyRe = new RegExp(`["'\`]((?:${topAlt})\\.[a-zA-Z0-9_.-]+)["'\`]`, "g");
  const builtPrefixRe = new RegExp(
    `(?:\`((?:${topAlt})(?:\\.[a-zA-Z0-9_-]+)*)\\.\\$\\{|["']((?:${topAlt})(?:\\.[a-zA-Z0-9_-]+)*)\\.["']\\s*\\+)`,
    "g",
  );

  const sourceFiles = mobileSourceRoots(mobileSourceRoot).flatMap((root) =>
    walkSourceFiles(root),
  );

  for (const file of sourceFiles) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(literalKeyRe)) {
      const candidate = match[1];
      if (leaves.has(candidate)) exactKeys.add(candidate);
      else if (branches.has(candidate)) branchPrefixes.add(candidate);
    }
    for (const match of text.matchAll(builtPrefixRe)) {
      const prefix = match[1] ?? match[2];
      if (branches.has(prefix) || leaves.has(prefix)) branchPrefixes.add(prefix);
    }
  }

  return { exactKeys, branchPrefixes };
};

const filterCatalog = (node, { exactKeys, branchPrefixes }, prefix = "") => {
  if (prefix && branchPrefixes.has(prefix)) return node;
  if (isLeafValue(node)) return exactKeys.has(prefix) ? node : undefined;
  const out = {};
  let kept = false;
  for (const [key, child] of Object.entries(node)) {
    const childPath = prefix ? `${prefix}.${key}` : key;
    const filtered = filterCatalog(child, { exactKeys, branchPrefixes }, childPath);
    if (filtered !== undefined) {
      out[key] = filtered;
      kept = true;
    }
  }
  return kept ? out : undefined;
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
};

/** Deterministic single-entry ZIP archive (zero timestamps so git & OTA hashes are reproducible). */
const buildSingleFileZip = (fileName, dataBuf) => {
  const nameBuf = Buffer.from(fileName, "utf8");
  const compressed = deflateRawSync(dataBuf, { level: 9 });
  const crc = crc32(dataBuf);

  const localHeader = Buffer.alloc(30 + nameBuf.length);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(8, 8);
  localHeader.writeUInt16LE(0, 10);
  localHeader.writeUInt16LE(0, 12);
  localHeader.writeUInt32LE(crc, 14);
  localHeader.writeUInt32LE(compressed.length, 18);
  localHeader.writeUInt32LE(dataBuf.length, 22);
  localHeader.writeUInt16LE(nameBuf.length, 26);
  localHeader.writeUInt16LE(0, 28);
  nameBuf.copy(localHeader, 30);

  const centralOffset = localHeader.length + compressed.length;
  const centralHeader = Buffer.alloc(46 + nameBuf.length);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0, 8);
  centralHeader.writeUInt16LE(8, 10);
  centralHeader.writeUInt16LE(0, 12);
  centralHeader.writeUInt16LE(0, 14);
  centralHeader.writeUInt32LE(crc, 16);
  centralHeader.writeUInt32LE(compressed.length, 20);
  centralHeader.writeUInt32LE(dataBuf.length, 24);
  centralHeader.writeUInt16LE(nameBuf.length, 28);
  centralHeader.writeUInt16LE(0, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt16LE(0, 34);
  centralHeader.writeUInt16LE(0, 36);
  centralHeader.writeUInt32LE(0, 38);
  centralHeader.writeUInt32LE(0, 42);
  nameBuf.copy(centralHeader, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralHeader.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localHeader, compressed, centralHeader, eocd]);
};

export const buildI18nCatalogOutputs = ({
  desktopI18nRoot,
  mobileSourceRoot = mobileRoot,
}) => {
  const catalogDir = join(desktopI18nRoot, "locales");
  const catalogFiles = readdirSync(catalogDir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  const outputs = new Map();

  const englishSource = JSON.parse(readFileSync(join(catalogDir, "en.json"), "utf8"));
  const mobileFilter = mobileSourceRoot
    ? collectUsedMobileKeys({ mobileSourceRoot, englishCatalog: englishSource })
    : null;
  const prunedEnglish = mobileFilter
    ? (filterCatalog(englishSource, mobileFilter) ?? {})
    : englishSource;
  const keyOrder = orderedLeafPaths(prunedEnglish);

  outputs.set("locales/en.json", Buffer.from(`${JSON.stringify(prunedEnglish, null, 2)}\n`, "utf8"));

  const packFiles = [];
  const packEntries = [];
  for (const name of catalogFiles) {
    if (name === "en.json") continue;
    const locale = name.slice(0, -".json".length);
    const parsed = JSON.parse(readFileSync(join(catalogDir, name), "utf8"));
    const values = keyOrder.map((pathStr) => {
      const value = lookupPath(parsed, pathStr);
      return value === undefined ? null : value;
    });
    const jsonBuf = Buffer.from(JSON.stringify(values), "utf8");
    const zipBuf = buildSingleFileZip(`${locale}.json`, jsonBuf);
    // The app caches each unpacked catalog on disk under this hash, and a pack
    // is only positions in English's key order, so the hash must change when
    // that order changes even if the values don't (a renamed key would
    // otherwise keep reading the old cached catalog).
    const hash = createHash("sha256")
      .update(`${PACK_FORMAT}\n${JSON.stringify(keyOrder)}\n`)
      .update(jsonBuf)
      .digest("hex")
      .slice(0, 12);
    const packName = `${locale}.zip`;
    packFiles.push(packName);
    outputs.set(`packs/${packName}`, zipBuf);
    packEntries.push(
      `  ${JSON.stringify(locale)}: { asset: () => require("./packs/${packName}") as number, hash: ${JSON.stringify(hash)} },`,
    );
  }

  outputs.set(
    "catalog-registry.generated.ts",
    Buffer.from(
      `${banner("locales/*.json")}
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
${packEntries.join("\n")}
};
`,
      "utf8",
    ),
  );

  return { catalogFiles, packFiles, outputs };
};

const packPayload = (zip) => {
  try {
    const start = 30 + zip.readUInt16LE(26) + zip.readUInt16LE(28);
    return inflateRawSync(zip.subarray(start, start + zip.readUInt32LE(18)));
  } catch {
    return null;
  }
};

// A pack is current when it unpacks to the same strings: another Node's zlib
// may compress them to different bytes, which must neither fail the check nor
// rewrite the file (phones would download it again).
const isCurrent = (relativePath, actual, expected) => {
  if (!actual) return false;
  if (actual.equals(expected)) return true;
  if (!relativePath.startsWith("packs/")) return false;
  const payload = packPayload(actual);
  return payload !== null && payload.equals(packPayload(expected));
};

const readOutputBuf = (target) => {
  try {
    return readFileSync(target);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EISDIR") return null;
    throw error;
  }
};

export const syncI18nCatalogs = ({
  check,
  desktopI18nRoot,
  outputRoot,
  logger = console,
}) => {
  const { catalogFiles, packFiles, outputs } = buildI18nCatalogOutputs({
    desktopI18nRoot,
  });
  const outputLocales = join(outputRoot, "locales");
  const outputPacks = join(outputRoot, "packs");
  const expectedLocaleFiles = new Set(["en.json"]);
  const expectedPackFiles = new Set(packFiles);
  const actualLocaleFiles = existsSync(outputLocales)
    ? readdirSync(outputLocales).sort()
    : [];
  const actualPackFiles = existsSync(outputPacks)
    ? readdirSync(outputPacks).sort()
    : [];

  if (check) {
    const drift = [];
    for (const stale of actualLocaleFiles) {
      if (!expectedLocaleFiles.has(stale)) {
        drift.push(`locales/${stale} (unexpected)`);
      }
    }
    for (const stale of actualPackFiles) {
      if (!expectedPackFiles.has(stale)) {
        drift.push(`packs/${stale} (unexpected)`);
      }
    }
    for (const [relativePath, expected] of outputs) {
      const actual = readOutputBuf(join(outputRoot, relativePath));
      if (!isCurrent(relativePath, actual, expected)) {
        drift.push(relativePath);
      }
    }
    drift.sort();
    if (drift.length > 0) {
      logger.error(
        `[i18n] generated mobile catalogs are stale:\n${drift.map((entry) => `  - ${entry}`).join("\n")}\nRun \`bun run i18n:sync\` from packages/mobile.`,
      );
      return { ok: false, catalogCount: catalogFiles.length, drift };
    }
    logger.log(
      `[i18n] verified 1 JS catalog (en) + ${packFiles.length} compressed packs in src/i18n/`,
    );
    return { ok: true, catalogCount: catalogFiles.length, drift };
  }

  mkdirSync(outputLocales, { recursive: true });
  mkdirSync(outputPacks, { recursive: true });
  for (const stale of actualLocaleFiles) {
    if (!expectedLocaleFiles.has(stale)) rmSync(join(outputLocales, stale));
  }
  for (const stale of actualPackFiles) {
    if (!expectedPackFiles.has(stale)) rmSync(join(outputPacks, stale));
  }
  for (const [relativePath, expected] of outputs) {
    const actual = readOutputBuf(join(outputRoot, relativePath));
    if (isCurrent(relativePath, actual, expected)) continue;
    writeFileSync(join(outputRoot, relativePath), expected);
  }

  logger.log(
    `[i18n] synced 1 JS catalog (en) + ${packFiles.length} compressed packs into src/i18n/`,
  );
  return { ok: true, catalogCount: catalogFiles.length, drift: [] };
};

if (isEntryPoint(import.meta.url)) {
  const args = process.argv.slice(2);
  const check = args.length === 1 && args[0] === "--check";
  if (args.length > 0 && !check) {
    throw new Error("Usage: sync-i18n-catalogs.mjs [--check]");
  }
  const result = syncI18nCatalogs({
    check,
    desktopI18nRoot: desktopI18n,
    outputRoot: outDir,
  });
  if (!result.ok) process.exitCode = 1;
}
