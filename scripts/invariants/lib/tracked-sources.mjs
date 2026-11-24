import { execFileSync } from "node:child_process";
import path from "node:path";

export const trackedSources = (root, tops) =>
  execFileSync("git", ["ls-files", "-z", "--", ...tops], { cwd: root, maxBuffer: 1 << 28 })
    .toString("utf8")
    .split("\0")
    .filter((rel) => /\.(?:[cm]?[jt]sx?)$/.test(rel))
    .map((rel) => path.join(root, rel));
