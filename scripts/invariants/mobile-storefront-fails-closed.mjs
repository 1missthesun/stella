import { readFileSync } from "node:fs";
import path from "node:path";

const FILE = "packages/mobile/src/lib/use-storefront-eligibility.js";

export async function check(root) {
  const source = readFileSync(path.join(root, FILE), "utf8");
  const problems = [];
  if (!/status:\s*code === US_STOREFRONT_CODE \? "eligible" : "ineligible"/.test(source)) {
    problems.push(
      `${FILE}: purchase eligibility must be exactly "StoreKit storefront is the US storefront", failing closed to ineligible`,
    );
  }
  for (const banned of [/\blocale/i, /Localization/, /I18nManager/, /\bIntl\./, /\bip\b/i]) {
    if (banned.test(source)) {
      problems.push(`${FILE}: matches ${banned}; eligibility reads only the StoreKit storefront, never device locale or IP`);
    }
  }
  return problems;
}
