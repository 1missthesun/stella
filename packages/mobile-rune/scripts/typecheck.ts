// tsc over this package. Importing desktop-ui's hooks pulls DOM components into Rune's JSX
// namespace, where they can't check; desktop-ui's own typecheck covers those files, so only
// diagnostics in this package count here.

import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const tsc = path.resolve(ROOT, "../../node_modules/typescript-7/bin/tsc");
const run = Bun.spawnSync(["node", tsc, "-p", ROOT, "--noEmit", "--pretty", "false"], { cwd: ROOT, stdout: "pipe", stderr: "inherit" });

let ours = 0;
let foreign = 0;
let inOurs = false;
for (const line of run.stdout.toString().split("\n")) {
  if (!line) continue;
  if (!line.startsWith(" ")) {
    inOurs = !line.startsWith("../");
    if (inOurs) ours++;
    else foreign++;
  }
  if (inOurs) console.log(line);
}
if (ours > 0) {
  console.error(`${ours} errors in mobile-rune`);
  process.exit(1);
}
if (run.exitCode !== 0 && foreign === 0) process.exit(run.exitCode ?? 1);
