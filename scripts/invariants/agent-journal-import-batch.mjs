import { readFileSync } from "node:fs";
import path from "node:path";

const IMPORTER = "packages/agent/src/host/desktop-chats.ts";
const JOURNAL = "workers/cloud-builder/src/conversation-types.ts";

const constant = (source, name) => {
  const expression = source.match(new RegExp(`const ${name} = ([\\d_\\s*]+);`, "u"))?.[1];
  if (!expression) return undefined;
  return expression
    .replaceAll("_", "")
    .split("*")
    .reduce((product, factor) => product * Number(factor.trim()), 1);
};

export async function check(root) {
  const importer = readFileSync(path.join(root, IMPORTER), "utf8");
  const journal = readFileSync(path.join(root, JOURNAL), "utf8");
  const pairs = [
    ["IMPORT_BATCH_ROWS", "APPEND_MAX_ROWS"],
    ["IMPORT_BATCH_BYTES", "APPEND_MAX_BYTES"],
  ];
  const problems = [];
  for (const [batchName, limitName] of pairs) {
    const batch = constant(importer, batchName);
    const limit = constant(journal, limitName);
    if (batch === undefined) problems.push(`${IMPORTER}: ${batchName} is no longer a plain number`);
    else if (limit === undefined) problems.push(`${JOURNAL}: ${limitName} is no longer a plain number`);
    else if (batch > limit) {
      problems.push(`${IMPORTER}: ${batchName} (${batch}) exceeds the cloud journal's ${limitName} (${limit}) per append`);
    }
  }
  return problems;
}
