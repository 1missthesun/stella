import { spawnSync } from "node:child_process";

const LINUX_STACK = ["Segoe UI", "Roboto", "Helvetica Neue", "Noto Sans", "Arial"];

let resolved: string | null = null;

const run = (cmd: string, args: string[]) => spawnSync(cmd, args, { encoding: "utf8", env: process.env }).stdout ?? "";

/** Families fontconfig binds strongly to `family` after config substitution (aliases such as Roboto → Liberation Sans). */
function strongFamilies(family: string): string[] {
  const line = run("fc-pattern", ["-c", family, "family"]).split("\n").find((l) => l.trim().startsWith("family:")) ?? "";
  return [...line.matchAll(/"([^"]+)"\(s\)/g)].map((m) => m[1]);
}

/**
 * The face Chromium picks for desktop-ui's body stack (`-apple-system, BlinkMacSystemFont, "Segoe UI",
 * Roboto, "Helvetica Neue", "Noto Sans", Arial, sans-serif`): what text in portalled dialogs that sets
 * no family of its own is drawn in. On Linux Skia takes fontconfig's match for the first family whose
 * match is that family or one of its strong aliases.
 */
export function systemFontFamily(): string {
  if (resolved) return resolved;
  if (process.platform === "darwin") return (resolved = "SF Pro Text");
  if (process.platform === "win32") return (resolved = "Segoe UI");
  for (const family of LINUX_STACK) {
    const matched = run("fc-match", [family, "--format=%{family[0]}"]).trim();
    if (matched && strongFamilies(family).includes(matched)) return (resolved = matched);
  }
  return (resolved = "sans");
}
