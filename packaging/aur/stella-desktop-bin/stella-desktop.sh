#!/bin/sh
# Starts Stella (stella.sh). Installed by the stella-desktop-bin package.
#
# The launcher updates itself, but it can't rewrite /usr, so it keeps its
# updates in the user's data directory (<data>/stella/bin/stella-launcher).
# Run that copy when it's at least as new as the packaged one; otherwise run
# the packaged launcher, which copies itself there on first start.
packaged=/usr/lib/stella-desktop/stella-launcher
if [ -n "${STELLA_LAUNCHER_ROOT:-}" ]; then
  root="$STELLA_LAUNCHER_ROOT"
else
  root="${XDG_DATA_HOME:-$HOME/.local/share}/stella"
fi
user="$root/bin/stella-launcher"

# The package's menu entry and icon stand in for the ones the launcher would
# write for itself.
STELLA_LAUNCHER_PACKAGED=1
export STELLA_LAUNCHER_PACKAGED

if [ -x "$user" ]; then
  mine="$("$packaged" --version 2>/dev/null)"
  theirs="$("$user" --version 2>/dev/null)"
  case "$mine$theirs" in
    *[!0-9]*) ;;
    *)
      if [ -n "$mine" ] && [ -n "$theirs" ] && [ "$theirs" -ge "$mine" ]; then
        exec "$user" "$@"
      fi
      ;;
  esac
fi
exec "$packaged" "$@"
