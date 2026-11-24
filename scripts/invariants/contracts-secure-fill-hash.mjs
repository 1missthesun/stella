import { readFileSync } from "node:fs";
import path from "node:path";

const FILE = "packages/contracts/secure-fill.ts";

const numbers = (body) => body.match(/0x[0-9a-f]+|\b\d+\b/gi) ?? [];

export async function check(root) {
  const source = readFileSync(path.join(root, FILE), "utf8");
  const hostHash = source.match(/export const secureFillHash = [\s\S]*?\n};/)?.[0];
  const pageHash = source.match(/const hash = \(str\) => \{[\s\S]*?\n {2}\};/)?.[0];
  if (!hostHash || !pageHash) return [`${FILE}: secureFillHash or the page script's hash not found`];
  const host = numbers(hostHash).join(",");
  const page = numbers(pageHash).join(",");
  if (host !== page) return [`${FILE}: the page script's hash must compute exactly what secureFillHash computes (constants ${page} vs ${host})`];
  return [];
}
