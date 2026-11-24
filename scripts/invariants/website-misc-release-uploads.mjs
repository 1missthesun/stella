import { readFileSync } from "node:fs";
import path from "node:path";

export async function check(root) {
  const problems = [];
  const workflow = (name) => readFileSync(path.join(root, ".github", "workflows", name), "utf8");

  const launcherFiles = /^\s*files="([^"]+)"/m.exec(workflow("build-launchers.yml"))?.[1].split(" ") ?? [];
  if (launcherFiles.at(-1) !== "VERSION") {
    problems.push("build-launchers.yml: VERSION must upload last, so a launcher that sees it finds the binaries and sums");
  }

  const identityFiles = /for file in (Stella-darwin[^;]+);/.exec(workflow("build-electron-identity.yml"))?.[1].split(" ") ?? [];
  const firstSum = identityFiles.findIndex((file) => file.endsWith(".sha256"));
  if (firstSum < 1 || identityFiles.slice(firstSum).some((file) => !file.endsWith(".sha256"))) {
    problems.push("build-electron-identity.yml: zips must upload before their checksums");
  }

  return problems;
}
