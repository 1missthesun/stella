#!/usr/bin/env bash
# Launches the PoC as a floating, unfocused window on the current Hyprland workspace.
# Writes the engine PID to $RUN/pid, logs to $RUN/engine.log, metrics to $RUN/metrics.jsonl.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN="${RUN:-$ROOT/.run/run}"
mkdir -p "$RUN"; rm -f "$RUN/pid"
# Stella's pinned Bun (host/services/stella-bun.ts), found by whichever bun is on PATH.
BUN="$("$(PATH=$(echo "$PATH" | tr ':' '\n' | grep -v shell-shims | paste -sd:) command -v bun)" "$ROOT/host/services/stella-bun.ts")"
BIN="${BIN:-$ROOT/engine/target/release/stella-rune}"; [ -x "$BIN" ] || BIN="$ROOT/bin/stella-rune"
W="${W:-1280}"; H="${H:-820}"
T0=$(date +%s%3N)
CMD="sh -c 'echo \$\$ > $RUN/pid; exec env ${ENV_OPTS:-} STELLA_RUNE_T0=$T0 STELLA_RUNE_ROOT=$ROOT STELLA_RUNE_BUN=$BUN STELLA_RUNE_METRICS=$RUN/metrics.jsonl STELLA_RUNE_CTL_PORT=${PORT:-47833} STELLA_RUNE_THEME=${THEME:-dark} STELLA_RUNE_W=$W STELLA_RUNE_H=$H ${EXTRA_ENV:-} $BIN > $RUN/engine.log 2>&1'"
# Hyprland 0.56 takes Lua: exec with per-launch rules (float, size, position, no focus steal).
hyprctl dispatch "hl.dsp.exec_cmd([[$CMD]], { float = true, size = \"$W $H\", move = \"${X:-80} ${Y:-80}\", no_initial_focus = true })" >/dev/null
for i in $(seq 1 100); do [ -s "$RUN/pid" ] && break; sleep 0.02; done
echo "pid $(cat $RUN/pid) t0 $T0"
