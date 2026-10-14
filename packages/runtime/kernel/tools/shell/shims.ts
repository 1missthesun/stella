import path from "path";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readSync, writeFileSync } from "fs";

export type ShellStateOptions = {
  enableShellShims?: boolean;
  stellaBrowserBinPath?: string;
  stellaOfficeBinPath?: string;
  stellaComputerCliPath?: string;
  stellaMediaCliPath?: string;
  stellaXApiCliPath?: string;
  getStellaSiteAuth?: () => { baseUrl: string; authToken: string } | null;
  getCloudBackendAuth?: () => { baseUrl: string; authToken: string } | null;
  cliBridgeSocketPath?: string;
};

const WINDOWS_CLI_SHIMS = [
  {
    command: "stella-office",
    optionKey: "stellaOfficeBinPath",
    envVar: "STELLA_OFFICE_BIN",
  },
  {
    command: "stella-computer",
    optionKey: "stellaComputerCliPath",
    envVar: "STELLA_COMPUTER_CLI",
  },
  {
    command: "stella-media",
    optionKey: "stellaMediaCliPath",
    envVar: "STELLA_MEDIA_CLI",
  },
  {
    command: "stella-x-api",
    optionKey: "stellaXApiCliPath",
    envVar: "STELLA_X_API_CLI",
  },
] as const;

const buildWindowsCliShimScript = (envVar: string): string =>
  [
    "@echo off",
    `if /I "%${envVar}:~-3%"==".ts" (`,
    `  "%STELLA_BUN_PATH%" "%${envVar}%" %*`,
    "  exit /b %ERRORLEVEL%",
    ")",
    'set "ELECTRON_RUN_AS_NODE=1"',
    `"%STELLA_NODE_BIN%" "%${envVar}%" %*`,
    "",
  ].join("\r\n");

const buildWindowsNodeShimScript = (): string =>
  [
    "@echo off",
    'set "ELECTRON_RUN_AS_NODE=1"',
    '"%STELLA_NODE_BIN%" %*',
    "",
  ].join("\r\n");

const buildWindowsPythonShimScript = (): string =>
  ["@echo off", '"%STELLA_PYTHON_BIN%" %*', ""].join("\r\n");

const buildWindowsPipShimScript = (): string =>
  ["@echo off", '"%STELLA_PYTHON_BIN%" -m pip %*', ""].join("\r\n");

const ELECTRON_NODE_ARGV_FIX = "electron-node-argv.cjs";

const ELECTRON_NODE_ARGV_FIX_SOURCE =
  'Object.defineProperty(process, "defaultApp", { value: true, configurable: true });\n';

const quoteForShDoubleQuotes = (value: string): string =>
  value.replace(/[\\"$`]/g, (char) => `\\${char}`);

const buildUnixNodeShimScript = (argvFixPath: string): string =>
  [
    "#!/bin/sh",
    `NODE_OPTIONS="--require \\"${quoteForShDoubleQuotes(argvFixPath)}\\" \${NODE_OPTIONS:-}" ELECTRON_RUN_AS_NODE=1 exec "$STELLA_NODE_BIN" "$@"`,
    "",
  ].join("\n");

const buildUnixCliShimScript = (envVar: string): string =>
  [
    "#!/bin/sh",
    `case "$${envVar}" in *.ts) exec "\${STELLA_BUN_PATH:-bun}" "$${envVar}" "$@" ;; esac`,
    `ELECTRON_RUN_AS_NODE=1 exec "$STELLA_NODE_BIN" "$${envVar}" "$@"`,
    "",
  ].join("\n");

const SHIM_SIGNATURES = ["STELLA_REAL_GIT_BIN", "STELLA_NODE_BIN", "STELLA_PYTHON_BIN", "STELLA_REAL_BUN_BIN"];

export const isStellaShellShim = (file: string): boolean => {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const head = Buffer.alloc(2048);
    const read = readSync(fd, head, 0, head.length, 0);
    const text = head.subarray(0, read).toString("latin1");
    return SHIM_SIGNATURES.some((signature) => text.includes(signature));
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
};

export const isStellaShellShimDir = (directory: string): boolean =>
  existsSync(path.join(directory, ELECTRON_NODE_ARGV_FIX)) ||
  ["git", "node", "node.cmd"].some((name) => isStellaShellShim(path.join(directory, name)));

const buildUnixGitShimScript = (): string =>
  [
    "#!/bin/sh",
    'if [ -n "$STELLA_GIT_BIN" ]; then',
    '  __stella_git_bin="$STELLA_GIT_BIN"',
    "else",
    '  __stella_git_bin="$STELLA_REAL_GIT_BIN"',
    "fi",
    'if [ -z "$__stella_git_bin" ]; then',
    '  echo "git executable not found" >&2',
    "  exit 127",
    "fi",
    'case "$__stella_git_bin" in */shell-shims/git) __stella_git_shim=1 ;; *) __stella_git_shim=0 ;; esac',
    'if [ "$__stella_git_shim" -eq 1 ] || [ "$__stella_git_bin" -ef "$0" ]; then',
    '  echo "Stella\'s git shim points at a shim ($__stella_git_bin), not at git. Restart Stella, or set STELLA_GIT_BIN to git." >&2',
    "  exit 127",
    "fi",
    'if [ "$1" = "commit" ]; then',
    "  __stella_has_feature_tag=0",
    '  for __stella_arg in "$@"; do',
    '    case "$__stella_arg" in',
    '      *"[feature:"*) __stella_has_feature_tag=1 ;;',
    "    esac",
    "  done",
    '  if [ "$__stella_has_feature_tag" -eq 1 ]; then',
    '    __stella_repo_root="$("$__stella_git_bin" rev-parse --show-toplevel 2>/dev/null || true)"',
    '    if [ -n "$__stella_repo_root" ]; then',
    "      for __stella_dep_name in package.json bun.lock bun.lockb package-lock.json pnpm-lock.yaml yarn.lock npm-shrinkwrap.json; do",
    '        __stella_dep_file="$__stella_repo_root/$__stella_dep_name"',
    '        if [ -f "$__stella_dep_file" ]; then',
    '          "$__stella_git_bin" add -- "$__stella_dep_file" >/dev/null 2>&1 || true',
    "        fi",
    "      done",
    "    fi",
    "  fi",
    "fi",
    'exec "$__stella_git_bin" "$@"',
    "",
  ].join("\n");

/**
 * `bun`, guarded for drafts: a draft whose dependencies match the app links
 * the app's node_modules (draft-deps.ts), and an install through that link
 * would write into the running app's packages. Before a command that
 * installs, the link is removed, so the draft gets packages of its own.
 */
const buildUnixBunShimScript = (): string =>
  [
    "#!/bin/sh",
    '__stella_bun="${STELLA_REAL_BUN_BIN:-}"',
    'if [ -z "$__stella_bun" ]; then',
    "  __stella_ifs=$IFS",
    "  IFS=:",
    "  for __stella_dir in $PATH; do",
    '    case "$__stella_dir" in */shell-shims) continue ;; esac',
    '    if [ -x "$__stella_dir/bun" ] && ! [ "$__stella_dir/bun" -ef "$0" ]; then',
    '      __stella_bun="$__stella_dir/bun"',
    "      break",
    "    fi",
    "  done",
    "  IFS=$__stella_ifs",
    "fi",
    'if [ -z "$__stella_bun" ]; then __stella_bun="${STELLA_BUN_PATH:-}"; fi',
    'if [ -z "$__stella_bun" ]; then',
    '  echo "bun executable not found" >&2',
    "  exit 127",
    "fi",
    'case "$1" in',
    "  install|i|add|a|remove|rm|update|ci|link|unlink|patch)",
    '    if [ -n "$STELLA_APP_DIR" ] && [ -d "$STELLA_APP_DIR/node_modules" ]; then',
    '      __stella_here="$(pwd -P)"',
    '      while [ -n "$__stella_here" ]; do',
    '        if [ -L "$__stella_here/node_modules" ] && [ "$__stella_here/node_modules" -ef "$STELLA_APP_DIR/node_modules" ]; then',
    '          rm -f "$__stella_here/node_modules"',
    '          echo "Stella: this draft used the app\'s packages; installing its own instead." >&2',
    "          break",
    "        fi",
    '        [ "$__stella_here" = "/" ] && break',
    '        __stella_here="$(dirname -- "$__stella_here")"',
    "      done",
    "    fi",
    "    ;;",
    "esac",
    'exec "$__stella_bun" "$@"',
    "",
  ].join("\n");

export const ensureNodeShim = (
  secretStateRoot: string,
  options?: ShellStateOptions,
): string | undefined => {
  const shimDir = path.join(secretStateRoot, "shell-shims");
  const shimPath = path.join(
    shimDir,
    process.platform === "win32" ? "node.cmd" : "node",
  );
  try {
    mkdirSync(shimDir, { recursive: true });
    writeFileSync(
      shimPath,
      process.platform === "win32"
        ? buildWindowsNodeShimScript()
        : buildUnixNodeShimScript(path.join(shimDir, ELECTRON_NODE_ARGV_FIX)),
      "utf-8",
    );
    if (process.platform !== "win32") {
      writeFileSync(
        path.join(shimDir, ELECTRON_NODE_ARGV_FIX),
        ELECTRON_NODE_ARGV_FIX_SOURCE,
        "utf-8",
      );
    }
    if (process.platform === "win32" && process.env.STELLA_PYTHON_BIN?.trim()) {
      for (const command of ["python", "python3", "py"]) {
        writeFileSync(
          path.join(shimDir, `${command}.cmd`),
          buildWindowsPythonShimScript(),
          "utf-8",
        );
      }
      for (const command of ["pip", "pip3"]) {
        writeFileSync(
          path.join(shimDir, `${command}.cmd`),
          buildWindowsPipShimScript(),
          "utf-8",
        );
      }
    }
    if (process.platform !== "win32") {
      const unixShimPaths = [shimPath];
      const gitShimPath = path.join(shimDir, "git");
      writeFileSync(gitShimPath, buildUnixGitShimScript(), "utf-8");
      unixShimPaths.push(gitShimPath);
      const bunShimPath = path.join(shimDir, "bun");
      writeFileSync(bunShimPath, buildUnixBunShimScript(), "utf-8");
      unixShimPaths.push(bunShimPath);
      for (const shim of WINDOWS_CLI_SHIMS) {
        const cliPath = options?.[shim.optionKey];
        if (typeof cliPath !== "string" || !existsSync(cliPath)) continue;
        const cliShimPath = path.join(shimDir, shim.command);
        writeFileSync(
          cliShimPath,
          buildUnixCliShimScript(shim.envVar),
          "utf-8",
        );
        unixShimPaths.push(cliShimPath);
      }
      for (const unixShimPath of unixShimPaths) {
        chmodSync(unixShimPath, 0o700);
      }
    }
    return shimDir;
  } catch {
    return undefined;
  }
};

export const ensureWindowsCliShims = (
  secretStateRoot: string,
  options?: ShellStateOptions,
): string | undefined => {
  const requested = WINDOWS_CLI_SHIMS.filter(
    (shim) => typeof options?.[shim.optionKey] === "string",
  );
  if (requested.length === 0) {
    return undefined;
  }

  const shimDir = path.join(secretStateRoot, "shell-shims");
  try {
    mkdirSync(shimDir, { recursive: true });
    for (const shim of requested) {
      writeFileSync(
        path.join(shimDir, `${shim.command}.cmd`),
        buildWindowsCliShimScript(shim.envVar),
        "utf-8",
      );
    }
    return shimDir;
  } catch {
    return undefined;
  }
};
