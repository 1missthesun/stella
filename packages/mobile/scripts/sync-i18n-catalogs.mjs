#!/usr/bin/env node

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
import { isEntryPoint } from "../../../scripts/lib/entry-point.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const mobileRoot = resolve(here, "..");
const desktopI18n = resolve(mobileRoot, "../desktop-ui/src/shared/i18n");

const outDir = join(mobileRoot, "src", "i18n");

const banner = (source) =>
  `// GENERATED FILE — DO NOT EDIT.\n` +
  `// Copied from packages/desktop-ui/src/shared/i18n/${source}\n` +
  `// by packages/mobile/scripts/sync-i18n-catalogs.mjs.\n`;

const PLURAL_CATEGORIES = new Set(["zero", "one", "two", "few", "many", "other"]);
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

const SKIPPED_DIRS = new Set([
  "node_modules",
  "locales",
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

  if (topSections.length === 0) {
    return { exactKeys, branchPrefixes };
  }

  const topAlt = topSections
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  // A whole literal that is a key or a key subtree: "chat.send", 'settings.x'.
  const literalKeyRe = new RegExp(`["'\`]((?:${topAlt})\\.[a-zA-Z0-9_.-]+)["'\`]`, "g");
  // The static prefix of a key built at runtime: `chat.status.${kind}` or
  // "chat.status." + kind.
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
      if (leaves.has(candidate)) {
        exactKeys.add(candidate);
      } else if (branches.has(candidate)) {
        branchPrefixes.add(candidate);
      }
    }
    for (const match of text.matchAll(builtPrefixRe)) {
      const prefix = match[1] ?? match[2];
      if (branches.has(prefix) || leaves.has(prefix)) {
        branchPrefixes.add(prefix);
      }
    }
  }

  return { exactKeys, branchPrefixes };
};

const filterCatalog = (node, { exactKeys, branchPrefixes }, prefix = "") => {
  if (prefix && branchPrefixes.has(prefix)) {
    return node;
  }
  if (isLeafValue(node)) {
    return exactKeys.has(prefix) ? node : undefined;
  }
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

export const buildI18nCatalogOutputs = ({
  desktopI18nRoot,
  mobileSourceRoot = mobileRoot,
}) => {
  const catalogDir = join(desktopI18nRoot, "locales");
  const catalogFiles = readdirSync(catalogDir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  const outputs = new Map();

  const englishPath = join(catalogDir, "en.json");
  const englishCatalog = existsSync(englishPath)
    ? JSON.parse(readFileSync(englishPath, "utf8"))
    : null;
  const mobileFilter =
    englishCatalog && mobileSourceRoot
      ? collectUsedMobileKeys({ mobileSourceRoot, englishCatalog })
      : null;

  for (const name of catalogFiles) {
    const parsed = JSON.parse(readFileSync(join(catalogDir, name), "utf8"));
    const pruned = mobileFilter ? (filterCatalog(parsed, mobileFilter) ?? {}) : parsed;
    outputs.set(`locales/${name}`, `${JSON.stringify(pruned, null, 2)}\n`);
  }

  // Metro has no `import.meta.glob` and cannot resolve a `require()` whose
  // argument is a variable, so this mapping must exist literally in source.
  const entries = catalogFiles
    .map((name) => {
      const locale = name.slice(0, -".json".length);
      return `  ${JSON.stringify(locale)}: () =>\n    require("./locales/${name}") as Catalog,`;
    })
    .join("\n");
  outputs.set(
    "catalog-registry.generated.ts",
    `${banner("locales/*.json")}
import type { Catalog } from "./catalog-types";

/**
 * Lazy thunks, one per catalog. Every catalog is inside the JS bundle
 * (Metro does not code-split for native), but only the ones actually asked
 * for are parsed and evaluated, so a cold start pays for English alone.
 */
export const CATALOG_LOADERS: Record<string, () => Catalog> = {
${entries}
};
`,
  );

  return { catalogFiles, outputs };
};

const readOutput = (target) => {
  try {
    return readFileSync(target, "utf8");
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
  const { catalogFiles, outputs } = buildI18nCatalogOutputs({
    desktopI18nRoot,
  });
  const outputLocales = join(outputRoot, "locales");
  const expectedLocaleFiles = new Set(catalogFiles);
  const actualLocaleFiles = existsSync(outputLocales)
    ? readdirSync(outputLocales).sort()
    : [];

  if (check) {
    const drift = [];
    for (const stale of actualLocaleFiles) {
      if (!expectedLocaleFiles.has(stale)) {
        drift.push(`locales/${stale} (unexpected)`);
      }
    }
    for (const [relativePath, expected] of outputs) {
      if (readOutput(join(outputRoot, relativePath)) !== expected) {
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
      `[i18n] verified ${catalogFiles.length} catalogs in src/i18n/`,
    );
    return { ok: true, catalogCount: catalogFiles.length, drift };
  }

  mkdirSync(outputLocales, { recursive: true });
  for (const stale of actualLocaleFiles) {
    if (!expectedLocaleFiles.has(stale)) rmSync(join(outputLocales, stale));
  }
  for (const [relativePath, expected] of outputs) {
    writeFileSync(join(outputRoot, relativePath), expected);
  }

  logger.log(
    `[i18n] synced ${catalogFiles.length} catalogs into src/i18n/`,
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
