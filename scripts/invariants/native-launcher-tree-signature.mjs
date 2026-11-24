import { readFileSync } from "node:fs";
import path from "node:path";

const expectations = [
  ["launcher/linux/stella-launcher.c", 'xasprintf("stella-tree-v1\\n%s\\n", tree)', '#define NOTES_REF "stella-signed"'],
  ["launcher/macos/Sources/StellaLauncher/Signing.swift", 'Data("stella-tree-v1\\n\\(tree)\\n".utf8)', 'notesRef = "stella-signed"'],
  ["launcher/windows/stella-launcher.cpp", 'return "stella-tree-v1\\n" + tree + "\\n";', 'kNotesRef = "stella-signed"'],
  ["packages/desktop/electron/launcher-client.ts", "Buffer.from(`stella-tree-v1\\n${tree}\\n`)", 'SIGNED_NOTES_REF = "stella-signed"'],
];

export async function check(root) {
  const problems = [];
  for (const [file, message, notesRef] of expectations) {
    const source = readFileSync(path.join(root, file), "utf8");
    if (!source.includes(message)) {
      problems.push(`${file}: the signed tree message is no longer "stella-tree-v1\\n<tree>\\n", which every launcher and the desktop app must sign and verify identically`);
    }
    if (!source.includes(notesRef)) {
      problems.push(`${file}: tree signatures are no longer kept under the git notes ref "stella-signed" shared by every launcher and the desktop app`);
    }
  }
  return problems;
}
