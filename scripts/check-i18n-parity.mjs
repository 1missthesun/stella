#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const CATALOG_ROOTS = [
  {
    name: "desktop-ui",
    dir: join(repoRoot, "packages/desktop-ui/src/shared/i18n/locales"),
  },
  {
    name: "mobile (generated)",
    dir: join(repoRoot, "packages/mobile/src/i18n/locales"),
    packsDir: join(repoRoot, "packages/mobile/src/i18n/packs"),
  },
];

const PLURAL_CATEGORIES = new Set([
  "zero",
  "one",
  "two",
  "few",
  "many",
  "other",
]);

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

const leafPaths = (node, prefix = "", out = new Set()) => {
  if (
    typeof node === "string" ||
    Array.isArray(node) ||
    isPluralNode(node) ||
    node === null ||
    typeof node !== "object"
  ) {
    out.add(prefix);
    return out;
  }
  for (const [key, child] of Object.entries(node)) {
    leafPaths(child, prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
};

const orderedLeafPaths = (node, prefix = "", out = []) => {
  if (
    typeof node === "string" ||
    Array.isArray(node) ||
    isPluralNode(node) ||
    node === null ||
    typeof node !== "object"
  ) {
    out.push(prefix);
    return out;
  }
  for (const [key, child] of Object.entries(node)) {
    orderedLeafPaths(child, prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
};

const readSingleFileZipJson = (zipPath) => {
  const buf = readFileSync(zipPath);
  if (buf.length < 30 || buf.readUInt32LE(0) !== 0x04034b50) {
    throw new Error(`Invalid zip header in ${zipPath}`);
  }
  const method = buf.readUInt16LE(8);
  const compSize = buf.readUInt32LE(18);
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  const payload = buf.subarray(start, start + compSize);
  const raw = method === 0 ? payload : inflateRawSync(payload);
  return JSON.parse(raw.toString("utf8"));
};

const readCatalog = (dir, locale) =>
  JSON.parse(readFileSync(join(dir, `${locale}.json`), "utf8"));

const checkRoot = ({ name, dir, packsDir }) => {
  const jsonLocales = readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -".json".length))
    .sort();
  if (!jsonLocales.includes("en")) {
    throw new Error(`${name}: no en.json in ${dir}`);
  }

  const englishCatalog = readCatalog(dir, "en");
  const englishOrder = orderedLeafPaths(englishCatalog);
  const english = new Set(englishOrder);
  const report = [];

  for (const locale of jsonLocales) {
    if (locale === "en") continue;
    const translated = leafPaths(readCatalog(dir, locale));
    const missing = [...english].filter((path) => !translated.has(path)).sort();
    const extra = [...translated].filter((path) => !english.has(path)).sort();
    if (missing.length || extra.length) report.push({ locale, missing, extra });
  }

  const packLocales =
    packsDir && existsSync(packsDir)
      ? readdirSync(packsDir)
          .filter((file) => file.endsWith(".zip"))
          .map((file) => file.slice(0, -".zip".length))
          .sort()
      : [];

  for (const locale of packLocales) {
    const values = readSingleFileZipJson(join(packsDir, `${locale}.zip`));
    const missing = [];
    const extra = [];
    if (!Array.isArray(values)) {
      missing.push("(pack payload is not an array)");
    } else {
      for (let i = 0; i < englishOrder.length; i += 1) {
        if (i >= values.length || values[i] === null || values[i] === undefined) {
          missing.push(englishOrder[i]);
        }
      }
      if (values.length > englishOrder.length) {
        extra.push(`(${values.length - englishOrder.length} trailing values)`);
      }
    }
    if (missing.length || extra.length) report.push({ locale, missing, extra });
  }

  const allLocales = new Set([...jsonLocales, ...packLocales]);
  return {
    name,
    dir,
    localeCount: allLocales.size,
    keyCount: english.size,
    report,
  };
};

const results = CATALOG_ROOTS.map(checkRoot);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(results, null, 2));
} else {
  for (const { name, localeCount, keyCount, report } of results) {
    console.log(
      `\n${name}: ${localeCount} catalogs, ${keyCount} keys in en.json`,
    );
    if (report.length === 0) {
      console.log("  ✓ every catalog matches en.json exactly");
      continue;
    }
    for (const { locale, missing, extra } of report) {
      console.log(
        `  ✗ ${locale}: ${missing.length} missing, ${extra.length} extra`,
      );
      for (const path of missing) console.log(`      - missing ${path}`);
      for (const path of extra) console.log(`      + extra   ${path}`);
    }
  }
}

if (results.some((result) => result.report.length > 0)) process.exitCode = 1;
