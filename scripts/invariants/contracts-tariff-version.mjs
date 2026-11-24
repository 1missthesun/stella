import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const FILE = "packages/contracts/billing-tariffs.ts";

const RATES_HASH_BY_VERSION = {
  "2026-11-16.1": "0a10324d3428",
};

const withoutComments = (source) => {
  let out = "";
  let quote = null;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      out += ch;
      if (ch === "\\") out += source[++i] ?? "";
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
    } else if (ch === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      out += "\n";
    } else if (ch === "/" && source[i + 1] === "*") {
      i = source.indexOf("*/", i + 2) + 1;
      if (i === 0) break;
    } else {
      out += ch;
    }
  }
  return out;
};

export async function check(root) {
  const source = readFileSync(path.join(root, FILE), "utf8");
  const version = source.match(/export const TARIFF_VERSION = "([^"]+)";/)?.[1];
  if (!version) return [`${FILE}: TARIFF_VERSION not found`];
  const rates = withoutComments(source)
    .split("\n")
    .filter((line) => !line.includes("TARIFF_VERSION ="))
    .join("\n")
    .match(/\b\d[\d_]*(?:\.\d+)?(?:e[-+]?\d+)?\b/gi)
    ?.join(",") ?? "";
  const hash = createHash("sha256").update(rates).digest("hex").slice(0, 12);
  const recorded = RATES_HASH_BY_VERSION[version];
  if (recorded === hash) return [];
  if (recorded) {
    return [`${FILE}: a rate changed under TARIFF_VERSION ${version}; bump TARIFF_VERSION and record its rates hash ${hash} in this check`];
  }
  return [`${FILE}: record TARIFF_VERSION ${version}'s rates hash ${hash} in RATES_HASH_BY_VERSION in this check`];
}
