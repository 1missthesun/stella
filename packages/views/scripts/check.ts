// `bun packages/views/scripts/check.ts <file.view.tsx>…`: type-checks views against the authoring
// API (types/view.d.ts), checks icon names and compiles them as devices will; for a view open on
// this device it then says how the file ran there. Prints each problem as `file:line:col message`
// and exits 1 if there are any.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import { compileView } from "../src/compile";
import { iconProblems } from "../src/icons";
import { awaitViewStatus } from "../src/files";

const files = process.argv.slice(2).map((f) => resolve(f));
if (files.length === 0) {
  console.error("usage: bun packages/views/scripts/check.ts <file.view.tsx>...");
  process.exit(2);
}

const typesFile = resolve(import.meta.dirname, "../types/view.d.ts");
const scratch = mkdtempSync(join(tmpdir(), "stella-view-check-"));
const ambient = join(scratch, "ambient.d.ts");
writeFileSync(ambient, `/// <reference path="${typesFile}" />\n`);

let problems = 0;
try {
  const program = ts.createProgram([...files, ambient, typesFile], {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.Preserve,
    lib: ["lib.es2023.d.ts"],
    types: [],
    skipLibCheck: true,
    allowJs: true,
    checkJs: false,
    noUnusedLocals: false,
  });
  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    if (!diagnostic.file || !files.includes(resolve(diagnostic.file.fileName))) continue;
    const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    console.log(`${diagnostic.file.fileName}:${line + 1}:${character + 1} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`);
    problems += 1;
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

for (const file of files) {
  const compiled = compileView(readFileSync(file, "utf8"), file);
  if (!compiled.ok) {
    console.log(`${file}:${compiled.error.line ?? 1}:${compiled.error.column ?? 1} ${compiled.error.message}`);
    problems += 1;
  }
  for (const problem of iconProblems(readFileSync(file, "utf8"))) {
    console.log(`${file}:${problem.line}:1 ${problem.message}`);
    problems += 1;
  }
}

// A view open on this device has picked up the file by now or will in a moment: say how it ran.
if (problems === 0) {
  for (const file of files) {
    const status = await awaitViewStatus(file, readFileSync(file, "utf8"), 1500);
    if (!status) continue;
    if (status.problem) {
      console.log(`${file}: on screen, but ${status.problem.phase} failed: ${status.problem.message}`);
      problems += 1;
    } else console.log(`${file}: on screen (rendered in ${Math.round(status.renderMs ?? 0)} ms)`);
  }
}
if (problems === 0) console.log(`ok: ${files.length} view${files.length === 1 ? "" : "s"}`);
process.exit(problems === 0 ? 0 : 1);
