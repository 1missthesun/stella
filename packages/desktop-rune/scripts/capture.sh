#!/usr/bin/env bash
# Screenshots (dark/light, before/after a live TS edit) and one continuous recording of
# fast scrolling, the sidebar spring, a live TS hot swap, a theme switch and typing.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${OUT:-$HOME/.stella/outputs/stella-rune-poc/media}"
export RUN="$(cd "$(dirname "$0")/.." && pwd)/.run/capture"
mkdir -p "$OUT"; rm -rf "$RUN"
C=http://127.0.0.1:47833
SIDEBAR="$ROOT/ui/app/Sidebar.tsx"
cp "$SIDEBAR" "$RUN.sidebar.bak"
REC_PID=""
cleanup() {
  [ -n "$REC_PID" ] && kill -INT "$REC_PID" 2>/dev/null && sleep 1
  cp "$RUN.sidebar.bak" "$SIDEBAR"; rm -f "$RUN.sidebar.bak"
  if [ -s "$RUN/pid" ]; then kill "$(cat "$RUN/pid")" 2>/dev/null || true; fi
}
trap cleanup EXIT

shot() { grim -g "80,80 1280x820" "$OUT/$1.png"; }
X=80 Y=80 "$ROOT/scripts/launch.sh" >/dev/null
P=$(cat "$RUN/pid"); sleep 2.5

shot dark-before
curl -s "$C/set?dark=false" >/dev/null; sleep 1.2; shot light-before
curl -s "$C/set?dark=true" >/dev/null; sleep 1.2

# One continuous recording of the window region (logical points).
gpu-screen-recorder -w region -region 1280x820+80+80 -f 60 -k h264 -cursor no -o "$OUT/rune-poc-raw.mp4" >/dev/null 2>&1 &
REC_PID=$!
sleep 1.5
curl -s "$C/scroll?cycles=2&glide=0.6" >/dev/null           # fast glides through 52 messages
sleep 0.4
curl -s "$C/sidebar?n=2" >/dev/null                         # sidebar spring
sleep 0.4
METRICS="$RUN/metrics.jsonl" bun "$ROOT/scripts/hotswap.ts" 1 leave-edited >/dev/null   # live TS edit
sleep 1.6
curl -s "$C/set?dark=false" >/dev/null                      # theme springs in OKLab
sleep 1.4
"$ROOT/scripts/keys.sh" "$P" type "plan my sunday" ; sleep 0.3
"$ROOT/scripts/keys.sh" "$P" enter                          # TS adds the message, streams a reply
sleep 2.4
kill -INT "$REC_PID"; wait "$REC_PID" 2>/dev/null || true; REC_PID=""

shot light-after
curl -s "$C/set?dark=true" >/dev/null; sleep 1.2; shot dark-after
grep '"hot_swap"' "$RUN/metrics.jsonl" | tail -1 > "$OUT/capture-hotswap.json"
echo "captured into $OUT"
