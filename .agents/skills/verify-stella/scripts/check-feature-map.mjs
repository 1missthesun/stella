#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COMMANDS, resolveCommand } from "../cli/registry.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDir, "..");
const featureDir = path.join(skillRoot, "features");
const referenceDir = path.join(skillRoot, "references");
const indexPath = path.join(featureDir, "README.md");
const failures = [];
const featureFiles = readdirSync(featureDir)
  .filter((name) => name.endsWith(".md") && name !== "README.md")
  .sort();
const index = readFileSync(indexPath, "utf8");
const linkedFiles = [...index.matchAll(/\]\(\.\/([^)]+\.md)\)/g)].map(
  (match) => match[1],
);

for (const file of featureFiles) {
  const count = linkedFiles.filter((linked) => linked === file).length;
  if (count !== 1) failures.push(`${file} is linked ${count} times from features/README.md; expected once.`);
}
for (const linked of linkedFiles) {
  if (!featureFiles.includes(linked)) failures.push(`features/README.md links missing file ${linked}.`);
}

for (const file of featureFiles) {
  const source = readFileSync(path.join(featureDir, file), "utf8");
  if (!/^# (.+)$/m.test(source)) failures.push(`features/${file} needs one H1 title.`);
}

// Every document that cites desktop commands or links to other files.
const documents = [
  path.join(skillRoot, "SKILL.md"),
  indexPath,
  ...featureFiles.map((file) => path.join(featureDir, file)),
  ...readdirSync(referenceDir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => path.join(referenceDir, name)),
];

// `control-stella.mjs <group> <command>` or a flat alias, spelled out in full
// or after `$C`/`C=` shorthands that documents define for the entry point.
const commandPattern = /control-stella\.mjs\s+([a-z][a-z-]*)(?:\s+([a-z][a-z-]*))?/g;
const backtickPattern = /`((?:session|chat|nav|settings|apps|inspect|drive|performance|diagnostics|cleanup) [a-z][a-z-]*)\b[^`]*`/g;
const groups = new Set(COMMANDS.map((entry) => entry.group));

for (const document of documents) {
  const name = path.relative(skillRoot, document);
  const source = readFileSync(document, "utf8");
  for (const match of source.matchAll(commandPattern)) {
    if (match[1] === "help" || match[1] === "capabilities") continue;
    const parts = groups.has(match[1]) && match[2] ? [match[1], match[2]] : [match[1]];
    if (!resolveCommand(parts)) failures.push(`${name} references unknown desktop command: ${parts.join(" ")}.`);
  }
  for (const match of source.matchAll(backtickPattern)) {
    const parts = match[1].split(" ");
    if (!resolveCommand(parts)) failures.push(`${name} names unknown desktop command: \`${match[1]}\`.`);
  }
  for (const match of source.matchAll(/\]\((?!https?:|#|mailto:)([^)\s]+)\)/g)) {
    const target = match[1].split("#")[0];
    if (!target) continue;
    if (!existsSync(path.resolve(path.dirname(document), target))) {
      failures.push(`${name} links a missing file: ${match[1]}.`);
    }
  }
}

const ids = COMMANDS.map((entry) => entry.id);
if (new Set(ids).size !== ids.length) failures.push("The control command registry contains duplicate command ids.");
const aliases = COMMANDS.flatMap((entry) => entry.aliases);
if (new Set(aliases).size !== aliases.length) failures.push("The control command registry contains duplicate aliases.");

if (failures.length > 0) {
  process.stderr.write(`${JSON.stringify({ ok: false, failures }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    featureFiles: featureFiles.length,
    indexedLinks: linkedFiles.length,
    documentsChecked: documents.length,
    commandIds: ids.length,
  })}\n`,
);
