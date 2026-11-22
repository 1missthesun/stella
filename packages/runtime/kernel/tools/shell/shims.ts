import path from "path";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readSync, writeFileSync } from "fs";
import { windowsHiddenSpawnPreloadSource } from "@stella/node-shared/shared/windows-hidden-spawns.js";

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
  /** The host stops every command when the turn ends, so nothing reports an exit afterwards. */
  shellsEndWithTurn?: boolean;
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

const ELECTRON_NODE_ARGV_FIX = "electron-node-argv.cjs";

// Electron-as-Node loads the preload beside the shim (`%~dp0`). It is an
// argument rather than NODE_OPTIONS because a quoted NODE_OPTIONS value
// treats backslashes as escapes; the preload then puts itself into
// NODE_OPTIONS for the processes it starts.
const WINDOWS_ELECTRON_NODE = `"%STELLA_NODE_BIN%" --require "%~dp0${ELECTRON_NODE_ARGV_FIX}"`;

const buildWindowsCliShimScript = (envVar: string): string =>
  [
    "@echo off",
    `if /I "%${envVar}:~-3%"==".ts" (`,
    `  "%STELLA_BUN_PATH%" "%${envVar}%" %*`,
    "  exit /b %ERRORLEVEL%",
    ")",
    'set "ELECTRON_RUN_AS_NODE=1"',
    `${WINDOWS_ELECTRON_NODE} "%${envVar}%" %*`,
    "",
  ].join("\r\n");

const buildWindowsNodeShimScript = (): string =>
  [
    "@echo off",
    'set "ELECTRON_RUN_AS_NODE=1"',
    `${WINDOWS_ELECTRON_NODE} %*`,
    "",
  ].join("\r\n");

const buildWindowsPythonShimScript = (): string =>
  ["@echo off", '"%STELLA_PYTHON_BIN%" %*', ""].join("\r\n");

const buildWindowsPipShimScript = (): string =>
  ["@echo off", '"%STELLA_PYTHON_BIN%" -m pip %*', ""].join("\r\n");

/**
 * Preload for every Electron-as-Node process the shims start. `defaultApp`
 * makes argv parsers treat Electron-as-Node like Node. On Windows it also
 * starts every child without a console window: Electron has no console, so
 * a console program a script runs (git, npm, cmd) would otherwise open a
 * blank Terminal window for as long as it runs.
 */
const electronNodePreloadSource = (): string =>
  [
    'Object.defineProperty(process, "defaultApp", { value: true, configurable: true });',
    windowsHiddenSpawnPreloadSource(),
    "",
  ].join("\n");

const writeElectronNodePreload = (shimDir: string): void => {
  writeFileSync(
    path.join(shimDir, ELECTRON_NODE_ARGV_FIX),
    electronNodePreloadSource(),
    "utf-8",
  );
};

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
 * `bun`, guarded for drafts: a draft links a package set shared with every
 * draft that has its dependencies (draft-deps.ts; older drafts link the
 * app's own node_modules), and an install through that link would write
 * into packages others use. Before a command that installs, the link is
 * removed, so the draft gets packages of its own. An install inside a draft
 * also brings the self-modification tools (the type checker), which the
 * app's own install leaves out (its bunfig says `dev = false`).
 */
const BUN_DRAFT_CONFIG = "bun-draft-install.toml";
const BUN_DRAFT_CONFIG_SOURCE = "[install]\ndev = true\n";

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
    '      __stella_draft=""',
    '      while [ -n "$__stella_here" ]; do',
    '        __stella_shared=""',
    '        if [ -L "$__stella_here/node_modules" ]; then',
    '          if [ "$__stella_here/node_modules" -ef "$STELLA_APP_DIR/node_modules" ]; then __stella_shared=1; fi',
    '          case "$(readlink "$__stella_here/node_modules")" in "$STELLA_APP_DIR/.git/stella-packages/"*) __stella_shared=1 ;; esac',
    "        fi",
    '        if [ -n "$__stella_shared" ]; then',
    '          rm -f "$__stella_here/node_modules"',
    '          echo "Stella: this draft used shared packages; installing its own instead." >&2',
    "        fi",
    '        if [ -f "$__stella_here/.git" ]; then',
    '          case "$(sed -n "s/^gitdir: //p" "$__stella_here/.git")" in "$STELLA_APP_DIR/.git/worktrees/"*) __stella_draft=1 ;; esac',
    "          break",
    "        fi",
    '        [ -d "$__stella_here/.git" ] && break',
    '        [ "$__stella_here" = "/" ] && break',
    '        __stella_here="$(dirname -- "$__stella_here")"',
    "      done",
    '      if [ -n "$__stella_draft" ]; then',
    '        case "$1" in',
    "          install|i|add|a|remove|rm|update|ci)",
    '            __stella_verb="$1"',
    "            shift",
    `            exec "$__stella_bun" "$__stella_verb" --config="$(dirname -- "$0")/${BUN_DRAFT_CONFIG}" "$@"`,
    "            ;;",
    "        esac",
    "      fi",
    "    fi",
    "    ;;",
    "esac",
    'exec "$__stella_bun" "$@"',
    "",
  ].join("\n");

const BUN_DRAFT_GUARD = "bun-draft-guard.cjs";

/**
 * Windows' `bun`, guarded for drafts like the Unix one: a command that
 * installs goes through a guard (run by the real Bun) that removes the
 * draft's link to shared packages and runs the install with the draft's
 * config. Package sets sit in `<app>\.git\stella-packages` or, for a launcher
 * install, `<install root>\pkgs` (draft-deps.ts).
 */
const buildWindowsBunShimScript = (): string =>
  [
    "@echo off",
    "setlocal",
    'set "__stella_bun=%STELLA_REAL_BUN_BIN%"',
    'if not defined __stella_bun set "__stella_bun=%STELLA_BUN_PATH%"',
    `if not defined __stella_bun for /f "delims=" %%b in ('where bun.exe 2^>nul') do if not defined __stella_bun set "__stella_bun=%%b"`,
    "if not defined __stella_bun (",
    "  echo bun executable not found 1>&2",
    "  exit /b 127",
    ")",
    "for %%c in (install i add a remove rm update ci link unlink patch) do if /I \"%~1\"==\"%%c\" goto guarded",
    '"%__stella_bun%" %*',
    "exit /b %ERRORLEVEL%",
    ":guarded",
    `"%__stella_bun%" "%~dp0${BUN_DRAFT_GUARD}" %*`,
    "exit /b %ERRORLEVEL%",
    "",
  ].join("\r\n");

const bunDraftGuardSource = (): string =>
  [
    '"use strict";',
    'const fs = require("fs");',
    'const path = require("path");',
    'const { spawnSync } = require("child_process");',
    "const args = process.argv.slice(2);",
    "const app = process.env.STELLA_APP_DIR;",
    "const real = (file) => {",
    "  try {",
    "    return fs.realpathSync(file).toLowerCase();",
    "  } catch {",
    "    return null;",
    "  }",
    "};",
    "const shared = app ? real(path.join(app, \"node_modules\")) : null;",
    "let draft = false;",
    "if (shared) {",
    "  const sets = [path.join(app, \".git\", \"stella-packages\"), path.join(path.dirname(app), \"pkgs\")]",
    "    .map(real)",
    "    .filter(Boolean);",
    "  const worktrees = real(path.join(app, \".git\", \"worktrees\"));",
    "  let dir = process.cwd();",
    "  for (;;) {",
    "    const link = path.join(dir, \"node_modules\");",
    "    const stat = fs.lstatSync(link, { throwIfNoEntry: false });",
    "    const target = stat && stat.isSymbolicLink() ? real(link) : null;",
    "    if (target && (target === shared || sets.some((set) => target.startsWith(set + path.sep)))) {",
    "      try {",
    "        fs.unlinkSync(link);",
    "      } catch {",
    "        fs.rmdirSync(link);",
    "      }",
    "      console.error(\"Stella: this draft used shared packages; installing its own instead.\");",
    "    }",
    "    const git = fs.lstatSync(path.join(dir, \".git\"), { throwIfNoEntry: false });",
    "    if (git && git.isFile()) {",
    "      const line = fs.readFileSync(path.join(dir, \".git\"), \"utf8\").match(/^gitdir:\\s*(.+?)\\s*$/m);",
    "      const gitdir = line ? real(path.resolve(dir, line[1])) : null;",
    "      draft = Boolean(worktrees && gitdir && gitdir.startsWith(worktrees + path.sep));",
    "    }",
    "    if (git) break;",
    "    const up = path.dirname(dir);",
    "    if (up === dir) break;",
    "    dir = up;",
    "  }",
    "}",
    "const configured = draft && [\"install\", \"i\", \"add\", \"a\", \"remove\", \"rm\", \"update\", \"ci\"].includes(args[0])",
    `  ? [args[0], "--config=" + path.join(__dirname, "${BUN_DRAFT_CONFIG}"), ...args.slice(1)]`,
    "  : args;",
    "const result = spawnSync(process.execPath, configured, { stdio: \"inherit\" });",
    "process.exit(result.status ?? 1);",
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
    writeElectronNodePreload(shimDir);
    if (process.platform === "win32") {
      writeFileSync(path.join(shimDir, "bun.cmd"), buildWindowsBunShimScript(), "utf-8");
      writeFileSync(path.join(shimDir, BUN_DRAFT_GUARD), bunDraftGuardSource(), "utf-8");
    }
    writeFileSync(path.join(shimDir, BUN_DRAFT_CONFIG), BUN_DRAFT_CONFIG_SOURCE, "utf-8");
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
    writeElectronNodePreload(shimDir);
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
