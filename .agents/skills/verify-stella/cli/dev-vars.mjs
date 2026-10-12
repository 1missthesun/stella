import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const RELATIVE = "workers/cloud-builder/.dev.vars";

const mainCheckoutRoot = () => {
  try {
    const common = execFileSync("git", ["-C", repoRoot, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return common ? path.dirname(common) : null;
  } catch {
    return null;
  }
};

let resolved;

export const devVarsPath = () => {
  if (resolved !== undefined) return resolved;
  const candidates = [path.join(repoRoot, RELATIVE)];
  const main = mainCheckoutRoot();
  if (main && path.resolve(main) !== repoRoot) candidates.push(path.join(main, RELATIVE));
  resolved = candidates.find((candidate) => existsSync(candidate)) ?? null;
  return resolved;
};

export const readDevVar = (name) => {
  const file = devVarsPath();
  if (!file) return "";
  const line = readFileSync(file, "utf8")
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).split(" #")[0].trim().replace(/^"(.*)"$/, "$1") : "";
};

export const adminApiSecret = () => process.env.STELLA_ADMIN_API_SECRET?.trim() || readDevVar("STELLA_ADMIN_API_SECRET");

export const ADMIN_SECRET_HELP =
  "Export STELLA_ADMIN_API_SECRET, or put it in the gitignored workers/cloud-builder/.dev.vars of this tree or of the main checkout (worktrees read the main checkout's file).";
