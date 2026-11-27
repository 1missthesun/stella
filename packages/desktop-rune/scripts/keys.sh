#!/usr/bin/env bash
# Real compositor key events to the PoC window only (never the focused window): typing, Ctrl+B, Enter.
P="$1"; shift
send() { hyprctl dispatch "hl.dsp.send_shortcut({ mods = \"$1\", key = \"$2\", window = \"pid:$P\" })" >/dev/null; }
case "$1" in
  type) t="${2:-hello stella}"; for ((i=0; i<${#t}; i++)); do c="${t:i:1}"; [ "$c" = " " ] && c="space"; send "" "$c"; sleep 0.07; done ;;
  sidebar) for i in $(seq 1 ${2:-10}); do send "CTRL" "b"; sleep 0.5; done ;;
  enter) send "" "Return" ;;
esac
