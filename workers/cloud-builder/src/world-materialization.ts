import { dependencyAdoptionLines } from "./sandbox-dependencies.js";
import { worldSyncMarkerPath } from "@stella/contracts/cloud-tool-home";
import { IN_TOOL_TREE, WORLD_ROOT } from "./workspace.js";

const shellQuote = (value: string): string => {
  if (value.includes("\0")) throw new TypeError("Shell value contains NUL.");
  return `'${value.replace(/'/gu, `'"'"'`)}'`;
};

/**
 * The sync code before 2026-11 kept its marker inside the world, at
 * `.stella/world-manifest`, root-owned. A container saved by that code (or a
 * turn it still ran after this deploy) carries it over instead of downloading
 * the world again: only a root-owned, singly linked regular file is taken, the
 * one read is the one checked (same inode through the open descriptor), and
 * its text must be exactly a marker.
 */
const legacyMarkerLines = [
  'legacy="$root/.stella/world-manifest"',
  'if [ -d "$root/.stella" ] && [ ! -L "$root/.stella" ] && [ -f "$legacy" ] && [ ! -L "$legacy" ] && { [ ! -f "$marker" ] || [ "$legacy" -nt "$marker" ]; }; then',
  `checked="$(stat -c '%u %h %i' -- "$legacy")"`,
  `legacy_marker="$(if [ "\${checked% *}" = "0 1" ] && exec 8<"$legacy" 2>/dev/null && [ "$(stat -L -c '%u %h %i' /proc/self/fd/8)" = "$checked" ]; then head -c 512 <&8; fi)"`,
  `if printf '%s' "$legacy_marker" | grep -Eqx '\\{"manifestId":"[A-Za-z0-9:_-]+","revision":[0-9]+\\}'; then`,
  `printf '%s\\n' "$legacy_marker" > "$marker.tmp"`,
  'mv -f -- "$marker.tmp" "$marker"',
  "fi",
  "fi",
];

export const worldMaterializationCommand = (args: {
  worldRoot: string;
  exportUrl: string;
  capability: string;
}): string => {
  if (!args.worldRoot.startsWith("/")) {
    throw new TypeError("World materialization target must be exact.");
  }
  const marker = worldSyncMarkerPath(args.worldRoot);
  const index = `${args.worldRoot.slice(0, args.worldRoot.lastIndexOf("/"))}/.stella-world-index.json`;
  return [
    "set -euo pipefail",
    "umask 077",
    "cd /",
    "exec 9>/workspace/.world-materialize.lock",
    "/usr/bin/flock --exclusive 9",
    `root=${shellQuote(args.worldRoot)}`,
    `marker=${shellQuote(marker)}`,
    ...legacyMarkerLines,
    'if [ ! -f "$marker" ]; then',
    "headers=/workspace/.world-export-headers",
    "trap 'rm -f -- \"$headers\"' EXIT",
    `in_world_root() { ${IN_TOOL_TREE} /usr/bin/find "$root" -mindepth 1 -maxdepth 1 -exec "$@" -- {} +; }`,
    "in_world_root rm -rf || { in_world_root chmod -R u+rwX && in_world_root rm -rf; }",
    `rm -f -- ${shellQuote(index)}`,
    `curl --fail --silent --show-error --dump-header "$headers" -H ${shellQuote(`Authorization: Bearer ${args.capability}`)} ${shellQuote(args.exportUrl)} | ${IN_TOOL_TREE} /usr/bin/tar -x -f - -C "$root" --no-same-owner --preserve-permissions`,
    `manifest="$(tr -d '\\r' <"$headers" | awk 'tolower($0) ~ /^x-stella-world-manifest:/ { sub(/^[^:]*: */, ""); print }' | tail -1)"`,
    'case "$manifest" in ""|*[!A-Za-z0-9:_-]*) { echo "The world export named no manifest."; } >&2; exit 1;; esac',
    `revision="$(tr -d '\\r' <"$headers" | awk -F': *' 'tolower($1) == "x-stella-world-revision" { print $2 }' | tail -1)"`,
    'case "$revision" in ""|*[!0-9]*) { echo "The world export named no revision. Its response headers:"; cut -d: -f1 "$headers"; } >&2; exit 1;; esac',
    `printf '{"manifestId":"%s","revision":%s}\\n' "$manifest" "$revision" > "$marker.tmp"`,
    'mv -f -- "$marker.tmp" "$marker"',
    ...(args.worldRoot === WORLD_ROOT ? dependencyAdoptionLines(index) : []),
    "fi",
  ].join("\n");
};

export const worldMaterializationFailure = (result: { stderr: string; exitCode?: number }): string => {
  const detail = result.stderr.trim().split("\n").at(-1)?.trim().slice(0, 300) ?? "";
  if (/no space left on device/iu.test(result.stderr)) {
    return "Stella could not bring this world into the agent's workspace: the workspace's disk is full. Remove large files from the world, or start the agent with a large workspace.";
  }
  return `Stella could not bring this world into the agent's workspace${detail ? `: ${detail}` : ` (exit ${result.exitCode ?? "unknown"})`}.`;
};
