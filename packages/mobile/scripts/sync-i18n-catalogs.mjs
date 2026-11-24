#!/usr/bin/env node
/**
 * Copies the desktop translation catalogs into `packages/mobile/src/i18n/`
 * so Metro can resolve them from inside the mobile project root.
 *
 * WHY A COPY AND NOT A CROSS-PACKAGE IMPORT
 * -----------------------------------------
 * The desktop catalogs live at
 * `packages/desktop-ui/src/shared/i18n/locales/*.json`, which is OUTSIDE
 * Metro's `projectRoot` (`packages/mobile`). Reaching them directly would
 * need `watchFolders: [monorepoRoot]`, which makes Metro crawl the entire
 * repo (Electron main, Rust browser, native helpers, home-seed, …) on every
 * start, and it also depends on `packages/mobile` declaring a dependency on
 * `@stella/desktop-ui` — which it deliberately does not (nothing else in the
 * mobile app imports across package boundaries today).
 *
 * The copies are plain JSON inside `src/`, so they are:
 *   - resolvable by the stock Expo Metro config (no metro.config.js at all),
 *   - tracked by git (nothing in .gitignore covers them), which is what makes
 *     a production EAS build work: EAS uploads the git-tracked tree, so the
 *     catalogs are present before `npm install` or any build hook runs.
 *
 * Run: `node scripts/sync-i18n-catalogs.mjs` (wired into the mobile
 * `start` / `ios` / `android` / `typecheck` scripts).
 */

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

// Subtrees always kept in full: all mobile-owned keys and shared contract helpers
// (`@stella/contracts/schedule-notice*`).
const ALWAYS_INCLUDED_PREFIXES = ["mobile", "schedule.notice"];

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

const walkSourceFiles = (dir, out = []) => {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === "locales" ||
        entry.name === ".expo" ||
        entry.name === "dist"
      ) {
        continue;
      }
      walkSourceFiles(full, out);
    } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
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
  const literalKeyRe = new RegExp(`["'\`]((?:${topAlt})\\.[a-zA-Z0-9_.-]+)["'\`]`, "g");
  const templatePrefixRe = new RegExp(
    `\`((?:${topAlt})(?:\\.[a-zA-Z0-9_-]+)*)\\.\\$\\{`,
    "g",
  );

  const sourceFiles = [
    ...walkSourceFiles(join(mobileSourceRoot, "src")),
    ...walkSourceFiles(join(mobileSourceRoot, "app")),
  ];

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
    for (const match of text.matchAll(templatePrefixRe)) {
      const prefix = match[1];
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
