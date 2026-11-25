#!/usr/bin/env bash
# Runs the engine on a private X display with software Vulkan (lavapipe), so nothing opens on the
# user's screen. Usage:
#   scripts/xvfb.sh start [display]   -> starts Xvfb + engine, prints PIDs into $RUN
#   scripts/xvfb.sh shot <file.png>   -> screenshot of the private display
#   scripts/xvfb.sh stop              -> stops exactly the PIDs this script started
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN="${RUN:-$ROOT/.run/xvfb}"
DISP="${DISP:-:93}"
XVFB="${XVFB:-$HOME/.cache/stella-verify/xvfb/usr/bin/Xvfb}"
BIN="${BIN:-$ROOT/engine/target/release/stella-engine}"
BUN="$(PATH=$(echo "$PATH" | tr ':' '\n' | grep -v shell-shims | paste -sd:) command -v bun)"
W="${W:-1280}"; H="${H:-820}"
mkdir -p "$RUN"

case "${1:-}" in
  start)
    [ -n "${2:-}" ] && DISP="$2"
    "$XVFB" "$DISP" -screen 0 "$((W + 40))x$((H + 40))x24" -nolisten tcp > "$RUN/xvfb.log" 2>&1 &
    echo $! > "$RUN/xvfb.pid"
    echo "$DISP" > "$RUN/display"
    for _ in $(seq 50); do [ -e "/tmp/.X11-unix/X${DISP#:}" ] && break; sleep 0.05; done
    env -u WAYLAND_DISPLAY DISPLAY="$DISP" VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json \
      STELLA_RUNE_T0="$(date +%s%3N)" STELLA_RUNE_ROOT="$ROOT" STELLA_RUNE_BUN="$BUN" \
      STELLA_RUNE_METRICS="$RUN/metrics.jsonl" STELLA_RUNE_CTL_PORT="${PORT:-0}" \
      STELLA_RUNE_W="$W" STELLA_RUNE_H="$H" ${EXTRA_ENV:-} \
      "$BIN" > "$RUN/engine.log" 2>&1 &
    echo $! > "$RUN/engine.pid"
    echo "display $DISP xvfb $(cat "$RUN/xvfb.pid") engine $(cat "$RUN/engine.pid")"
    ;;
  shot)
    DISPLAY="$(cat "$RUN/display")" import -window root "${2:?file}"
    ;;
  stop)
    for f in engine xvfb; do
      [ -f "$RUN/$f.pid" ] || continue
      pid="$(cat "$RUN/$f.pid")"
      if [ -e "/proc/$pid" ]; then
        kids="$(cat /proc/"$pid"/task/*/children 2>/dev/null || true)"
        kill "$pid" 2>/dev/null || true
        for k in $kids; do [ -e "/proc/$k" ] && kill "$k" 2>/dev/null || true; done
      fi
      rm -f "$RUN/$f.pid"
    done
    echo stopped
    ;;
  *) echo "usage: $0 start|shot <file>|stop"; exit 2 ;;
esac
