#!/usr/bin/env bash
# Kit parity proof: each gallery page × theme drawn by the Rune engine (private Xvfb) next to the
# same page drawn by desktop-ui's components in headless Chromium (reference/, served by vite).
# Usage: OUT=<dir> BIN=<stella-engine> scripts/kit-compare.sh [page...]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${OUT:?OUT dir}"
THEMES="${THEMES:-light dark gradient}"
PAGES="${*:-buttons controls overlays dialog icons markdown empty}"
WAIT="${WAIT:-5}"
mkdir -p "$OUT/rune" "$OUT/ref" "$OUT/side"
export RUN="${RUN:-$ROOT/.run/kit}" DISP="${DISP:-:117}"
for theme in $THEMES; do
  for page in $PAGES; do
    EXTRA_ENV="STELLA_RUNE_GALLERY=$page@$theme" "$ROOT/scripts/xvfb.sh" start >/dev/null
    trap '"$ROOT/scripts/xvfb.sh" stop >/dev/null' EXIT
    sleep "$WAIT"
    "$ROOT/scripts/xvfb.sh" shot "$OUT/rune/full.png"
    "$ROOT/scripts/xvfb.sh" stop >/dev/null
    trap - EXIT
    magick "$OUT/rune/full.png" -crop 1280x820+0+0 +repage "$OUT/rune/$page-$theme.png"
    [ -f "$OUT/ref/$page-$theme.png" ] || "$ROOT/scripts/ref-shot.sh" "$page" "$theme" "$OUT/ref/$page-$theme.png"
    magick \( "$OUT/ref/$page-$theme.png" -gravity north -background '#888' -splice 0x28 -pointsize 18 -fill white -annotate +0+4 "Electron · desktop-ui  ($page, $theme)" \) \
      \( "$OUT/rune/$page-$theme.png" -gravity north -background '#888' -splice 0x28 -pointsize 18 -fill white -annotate +0+4 "Rune · kit  ($page, $theme)" \) \
      +append "$OUT/side/$page-$theme.png"
    echo "$OUT/side/$page-$theme.png"
  done
done
rm -f "$OUT/rune/full.png"
