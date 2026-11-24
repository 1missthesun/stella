import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const linuxOnly = new Set(["drag"]);

export async function check(root) {
  const page = readFileSync(path.join(root, "launcher/common/launcher.html"), "utf8");
  const actions = new Set();
  for (const match of page.matchAll(/\bact\("([A-Za-z]+)"\)|\baction:\s*"([A-Za-z]+)"/g)) {
    actions.add(match[1] ?? match[2]);
  }
  if (actions.size === 0) return ["launcher.html posts no actions the check can find"];

  const macosDir = path.join(root, "launcher/macos/Sources/StellaLauncher");
  const launchers = {
    linux: readFileSync(path.join(root, "launcher/linux/stella-launcher.c"), "utf8"),
    macos: readdirSync(macosDir)
      .filter((name) => name.endsWith(".swift"))
      .map((name) => readFileSync(path.join(macosDir, name), "utf8"))
      .join("\n"),
    windows: readFileSync(path.join(root, "launcher/windows/stella-launcher.cpp"), "utf8"),
  };

  const problems = [];
  for (const action of actions) {
    for (const [platform, source] of Object.entries(launchers)) {
      if (platform !== "linux" && linuxOnly.has(action)) continue;
      if (!source.includes(`"${action}"`)) {
        problems.push(`the ${platform} launcher does not handle the launcher page's "${action}" action`);
      }
    }
  }
  return problems;
}
