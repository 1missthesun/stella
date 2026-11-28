import { getKeychainSettingsChange } from "./shell-command-safety.js";

const KEYCHAIN_GUARD_GUIDANCE = [
  "Tasks never change this Mac's Keychain search list, default keychain or login keychain: a list without the login keychain makes every app, Claude Code and Stella included, stop finding the user's saved sign-ins.",
  "Use your own keychain by its path instead, which needs none of these settings:",
  "  security create-keychain -p <password> /path/build.keychain-db",
  "  security unlock-keychain -p <password> /path/build.keychain-db",
  "  security import cert.p12 -k /path/build.keychain-db -P <p12 password> -T /usr/bin/codesign",
  "  security set-key-partition-list -S apple-tool:,apple: -k <password> /path/build.keychain-db",
  "  security find-identity -v -p codesigning /path/build.keychain-db",
  "  codesign --keychain /path/build.keychain-db --sign <identity> <target>",
  '  xcodebuild ... OTHER_CODE_SIGN_FLAGS="--keychain /path/build.keychain-db"',
  "  security delete-keychain /path/build.keychain-db   (when done)",
  "In fastlane pass add_to_search_list: false and default_keychain: false. Reading the settings (security list-keychains, security default-keychain) still works.",
  "If a change to these settings is truly needed, tell the user exactly what and why: only they can make it.",
].join("\n");

export const keychainSettingsBlockedMessage = (change: string): string =>
  `Command blocked: it would change the Mac's Keychain settings (${change}).\n${KEYCHAIN_GUARD_GUIDANCE}`;

export const keychainSettingsChangeMessage = (command: string): string | null => {
  const change = getKeychainSettingsChange(command);
  return change ? keychainSettingsBlockedMessage(change) : null;
};

/**
 * Stands in for `security` on PATH in macOS agent shells, so scripts and
 * build tools a task runs are held to the same rule as its own commands.
 * Mirrors `getKeychainSettingsChange`'s reading of the arguments.
 */
export const buildUnixSecurityShimScript = (): string =>
  [
    "#!/bin/sh",
    "__stella_cmd=",
    "__stella_started=0",
    "__stella_skip=0",
    "__stella_interactive=0",
    "__stella_sets=0",
    "__stella_login_arg=0",
    'for __stella_arg in "$@"; do',
    '  if [ "$__stella_skip" = 1 ]; then __stella_skip=0; continue; fi',
    '  if [ "$__stella_started" = 0 ]; then',
    '    case "$__stella_arg" in',
    '      --) __stella_started=1; __stella_skip=0 ;;',
    "      -?*)",
    '        __stella_rest=${__stella_arg#-}',
    '        while [ -n "$__stella_rest" ]; do',
    '          __stella_c=${__stella_rest%"${__stella_rest#?}"}',
    '          __stella_rest=${__stella_rest#?}',
    '          case "$__stella_c" in',
    "            i) __stella_interactive=1 ;;",
    '            p) __stella_interactive=1; [ -z "$__stella_rest" ] && __stella_skip=1; __stella_rest= ;;',
    "          esac",
    "        done",
    "        ;;",
    '      *) __stella_cmd=$__stella_arg; __stella_started=2 ;;',
    "    esac",
    "    continue",
    "  fi",
    '  if [ "$__stella_started" = 1 ]; then __stella_cmd=$__stella_arg; __stella_started=2; continue; fi',
    '  case "$__stella_arg" in',
    "    --*) ;;",
    "    -?*)",
    '      __stella_rest=${__stella_arg#-}',
    '      while [ -n "$__stella_rest" ]; do',
    '        __stella_c=${__stella_rest%"${__stella_rest#?}"}',
    '        __stella_rest=${__stella_rest#?}',
    '        case "$__stella_c" in',
    "          s) __stella_sets=1 ;;",
    '          d) [ -z "$__stella_rest" ] && __stella_skip=1; __stella_rest= ;;',
    "        esac",
    "      done",
    "      ;;",
    "    *)",
    '      case "${__stella_arg##*/}" in login.keychain|login.keychain-db) __stella_login_arg=1 ;; esac',
    "      ;;",
    "  esac",
    "done",
    "__stella_change=",
    'if [ "$__stella_interactive" = 1 ]; then __stella_change="interactive security"; fi',
    'if [ -z "$__stella_change" ] && [ -n "$__stella_cmd" ] && [ "$__stella_sets" = 1 ]; then',
    "  for __stella_known in list-keychains default-keychain login-keychain; do",
    '    case "$__stella_known" in "$__stella_cmd"*) __stella_change="security $__stella_cmd -s" ;; esac',
    "  done",
    "fi",
    'if [ -z "$__stella_change" ] && [ -n "$__stella_cmd" ] && [ "$__stella_login_arg" = 1 ]; then',
    '  case delete-keychain in "$__stella_cmd"*) __stella_change="deleting the login keychain" ;; esac',
    "fi",
    'if [ -n "$__stella_change" ]; then',
    `  printf '%s\\n' "Stella blocked this: it would change the Mac's Keychain settings ($__stella_change)." >&2`,
    "  cat >&2 <<'__STELLA_KEYCHAIN_GUIDANCE__'",
    KEYCHAIN_GUARD_GUIDANCE,
    "__STELLA_KEYCHAIN_GUIDANCE__",
    "  exit 1",
    "fi",
    'exec /usr/bin/security "$@"',
    "",
  ].join("\n");
