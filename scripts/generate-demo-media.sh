#!/usr/bin/env bash
# generate-demo-media.sh — regenerate the Phase 5 subtitled demo videos + hero gif
# from a live stack. See docs/guides/DEMO-VIDEOS.md for the full write-up.
#
# Prerequisites (this script does NOT bring these up):
#   1. Infra running:    pnpm infra        (orchestrator + workers + DB + Kafka + SQS)
#   2. Monitor running:  cd apps/monitor && VITE_DISABLE_AUTH=true pnpm dev
#   3. Chromium:         npx playwright install chromium   (one-time, per machine)
#
# Usage:
#   DASHBOARD_URL=http://localhost:5184 DTM_DB_PASSWORD=<...> \
#     bash scripts/generate-demo-media.sh
#
# Env vars (all optional — defaults match a stock `pnpm infra` + `.env` bring-up):
#   DASHBOARD_URL     Monitor dev server URL. Default http://localhost:5173.
#                      Set explicitly if Vite auto-shifted ports (5173-5182 busy).
#   DTM_DB_PASSWORD   Postgres password for the preflight DB check. Default
#                      'migration_pass' (env.ts's own default) — override to match
#                      your .env's DTM_DB_PASSWORD if it differs (it does on a
#                      standard local bring-up: dtm_dev_password_2026).
#
# What it does:
#   1. Runs the three STORY-tagged Playwright specs in ONE invocation (sequential,
#      single worker — never parallel, and never split across multiple `playwright
#      test` calls: Playwright wipes its outputDir at the START of each invocation,
#      which would delete an earlier run's renamed webm before ffmpeg ever sees it).
#   2. Converts each webm -> mp4 (h264, no audio, faststart) into docs/media/.
#   3. Builds ONE hero gif from the iot double-fan-out clip's most kinetic ~20s
#      (the DAG mini-viz going from partial to fully green, step count landing).
#   4. Prints ffprobe duration/size for every artifact so the caller can eyeball
#      the acceptance bounds (30s-3min per video, hero gif <=5MB) without a
#      separate verification pass.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
PW_DIR="$ROOT/setpoint-evals-playwright"
MEDIA_DIR="$ROOT/docs/media"
VIDEO_DIR="$PW_DIR/demo-recordings"

mkdir -p "$MEDIA_DIR"

echo "==> [1/4] Recording the three STORY demos (order-processing, iot, infra) — sequential, single stack"
(
  cd "$PW_DIR"
  DASHBOARD_URL="${DASHBOARD_URL:-http://localhost:5173}" \
    npx playwright test --project=demo-videos -g 'STORY'
)

declare -A SLUGS=(
  [order-processing-partial-payment-failure]="Ada's Beans Cafe — a failed payment doesn't sink the order (PARTIAL_SUCCESS)"
  [iot-double-fan-out]="Greenhouse 3 — double fan-out explodes into an N-by-M step tree (COMPLETED)"
  [infra-cascade-failure]="prod-eu — a mid-chain failure cascades SKIPPED (FAILED)"
)

echo "==> [2/4] Converting webm -> mp4"
for slug in "${!SLUGS[@]}"; do
  in="$VIDEO_DIR/$slug.webm"
  out="$MEDIA_DIR/$slug.mp4"
  [ -f "$in" ] || { echo "ERROR: missing recording $in — the Playwright run above should have produced it" >&2; exit 1; }
  ffmpeg -y -i "$in" -c:v libx264 -pix_fmt yuv420p -crf 20 -preset slow -movflags +faststart -an "$out"
done

echo "==> [3/4] Building the hero gif (iot double fan-out, t=22s..42s — the DAG going green + step count landing)"
ffmpeg -y -ss 22 -t 20 -i "$MEDIA_DIR/iot-double-fan-out.mp4" \
  -vf "fps=10,scale=720:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3" \
  "$MEDIA_DIR/hero.gif"

echo "==> [4/4] Verifying artifacts"
for f in "$MEDIA_DIR"/*.mp4 "$MEDIA_DIR/hero.gif"; do
  name="$(basename "$f")"
  size_mb=$(du -m "$f" | cut -f1)
  duration=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$f")
  printf '  %-45s %6sMB  %8.1fs\n' "$name" "$size_mb" "$duration"
done

echo "==> Done. Artifacts in $MEDIA_DIR"
