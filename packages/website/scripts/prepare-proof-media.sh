#!/usr/bin/env bash
# Turns a raw proof recording into web media for a /how page and uploads it to
# the public R2 bucket under marketing/proofs/<niche>/<slug>/:
#   proof.mp4  H.264, ≤720p, faststart, no audio unless --keep-audio, ~2–6 MB
#   poster.jpg a frame from --poster-at seconds (default: 60% through)
# usage: scripts/prepare-proof-media.sh <recording> <niche>/<slug> [--speed N] [--poster-at S] [--keep-audio] [--no-upload]
set -euo pipefail
src="$1"; id="$2"; shift 2
speed=1; poster_at=""; audio=(-an); upload=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --speed) speed="$2"; shift 2 ;;
    --poster-at) poster_at="$2"; shift 2 ;;
    --keep-audio) audio=(-c:a aac -b:a 96k); shift ;;
    --no-upload) upload=0; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
out="${TMPDIR:-/tmp}/proof-media/$id"
mkdir -p "$out"
vf="setpts=PTS/${speed},scale='min(1280,iw)':'-2':flags=lanczos,fps=30"
ffmpeg -y -loglevel error -i "$src" -vf "$vf" -c:v libx264 -preset slow -crf 27 -pix_fmt yuv420p \
  -profile:v high -movflags +faststart "${audio[@]}" "$out/proof.mp4"
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$out/proof.mp4")
[[ -n "$poster_at" ]] || poster_at=$(awk "BEGIN{print $dur*0.6}")
ffmpeg -y -loglevel error -ss "$poster_at" -i "$out/proof.mp4" -frames:v 1 -q:v 3 "$out/poster.jpg"
size=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x "$out/proof.mp4")
echo "duration=${dur}s size=${size} mp4=$(du -h "$out/proof.mp4" | cut -f1) poster=$(du -h "$out/poster.jpg" | cut -f1)"
if [[ "$upload" == 1 ]]; then
  for f in proof.mp4 poster.jpg; do
    type=$([[ $f == *.mp4 ]] && echo video/mp4 || echo image/jpeg)
    bunx wrangler r2 object put "stella-files/marketing/proofs/$id/$f" --file "$out/$f" \
      --content-type "$type" --cache-control "public, max-age=86400" --remote >/dev/null
  done
  echo "https://pub-a319aaada8144dc9be5a83625033769c.r2.dev/marketing/proofs/$id/proof.mp4"
fi
echo "$out"
