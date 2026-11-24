import { readFileSync } from "node:fs";
import path from "node:path";

const FILES = [
  "packages/mobile/src/i18n/catalogs.ts",
  "packages/desktop-ui/src/shared/i18n/catalogs.ts",
];

const interpolationPattern = (source) =>
  source.match(/template\.replace\((\/[^\n]*?\/[a-z]*),/)?.[1] ?? null;

export async function check(root) {
  const patterns = FILES.map((file) => ({
    file,
    pattern: interpolationPattern(readFileSync(path.join(root, file), "utf8")),
  }));
  const problems = patterns
    .filter(({ pattern }) => pattern === null)
    .map(({ file }) => `${file}: no \`template.replace(/…/, …)\` interpolation found`);
  if (problems.length > 0) return problems;
  const [mobile, desktop] = patterns;
  return mobile.pattern === desktop.pattern
    ? []
    : [
        `${mobile.file} interpolates with ${mobile.pattern} but ${desktop.file} uses ${desktop.pattern}; a key must render the same on both`,
      ];
}
