#!/usr/bin/env bash
# Builds the website with the dev backend and deploys it to its own preview
# Worker, stella-website-problem-preview.fromyou.workers.dev. A modified copy of
# deploy-stella.sh dev: different Worker, no routes, and noindex everywhere
# (robots.txt disallows all, X-Robots-Tag on every response).
set -euo pipefail
cd "$(dirname "$0")/.."

unset NEXT_PUBLIC_GOOGLE_ADS_ID NEXT_PUBLIC_GOOGLE_ADS_DOWNLOAD_LABEL NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_LABEL
unset VITE_STELLA_APPS_HOST VITE_STELLA_APPS_AUTH_HOST NEXT_PUBLIC_STELLA_APPS_HOST
export NEXT_PUBLIC_TURNSTILE_SITE_KEY="0x4AAAAAAElT6LwLa_VHN9Qq"
export NEXT_PUBLIC_STELLA_BACKEND_URL="https://stella-v2-cloud-builder-dev.fromyou.workers.dev"
export NEXT_PUBLIC_STELLA_SITE_URL="https://stella-website-problem-preview.fromyou.workers.dev"
export NEXT_PUBLIC_STELLA_NOINDEX=1
export VITE_STELLA_BACKEND_URL="$NEXT_PUBLIC_STELLA_BACKEND_URL"
export VITE_TURNSTILE_SITE_KEY="$NEXT_PUBLIC_TURNSTILE_SITE_KEY"

config=wrangler.problem-preview.jsonc
bunx opennextjs-cloudflare build --config "$config"
bunx opennextjs-cloudflare deploy --config "$config"
