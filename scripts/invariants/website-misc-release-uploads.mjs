import { readFileSync } from "node:fs";
import path from "node:path";

export async function check(root) {
  const problems = [];
  const workflow = (name) => readFileSync(path.join(root, ".github", "workflows", name), "utf8");

  const launcherFiles = /^\s*files="([^"]+)"/m.exec(workflow("build-launchers.yml"))?.[1].split(" ") ?? [];
  if (launcherFiles.at(-1) !== "VERSION") {
    problems.push("build-launchers.yml: VERSION must upload last, so a launcher that sees it finds the binaries and sums");
  }

  // A build is addressed by its checksum and published before the pointer that names it; the
  // first build's legacy pair is never overwritten (its URLs are cached for a year).
  const identity = workflow("build-electron-identity.yml");
  const zipAt = identity.indexOf('put "out/Stella-darwin-$arch.zip" "$prefix/$sha/');
  const pointerAt = identity.indexOf('"$prefix/Stella-darwin-$arch.current.sha256"');
  if (zipAt < 0 || pointerAt < 0 || zipAt > pointerAt) {
    problems.push("build-electron-identity.yml: each zip must upload under its checksum before the pointer to it");
  }
  const legacy = /if absent "\$prefix\/Stella-darwin-\$arch\.zip\.sha256"; then\s+put "out\/Stella-darwin-\$arch\.zip" [^\n]+\n\s+put "out\/Stella-darwin-\$arch\.zip\.sha256"/;
  if (!legacy.test(identity)) {
    problems.push("build-electron-identity.yml: the legacy zip and checksum must upload once, zip first, never over an existing pair");
  }

  return problems;
}
