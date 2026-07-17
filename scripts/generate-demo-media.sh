#!/usr/bin/env bash
# generate-demo-media.sh — regenerate the dtm-video-v2 subtitled demo videos +
# hero gif from a live stack. See docs/guides/DEMO-VIDEOS.md for the full write-up.
#
# Prerequisites (this script does NOT bring these up):
#   1. Infra running:    pnpm infra        (orchestrator + workers + DB + Kafka + SQS)
#   2. Monitor running:  cd apps/monitor && VITE_DISABLE_AUTH=true pnpm dev
#   3. Chromium:         npx playwright install chromium   (one-time, per machine)
#   4. jq on PATH (beat-manifest parsing — see step 3 below)
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
#   SPEED_RAMP        'on' (default) or 'off' — disable to inspect the raw,
#                      unramped 1:1 recordings instead of the compressed cut.
#
# What it does (dtm-video-v2 Lane C — see docs/guides/DEMO-VIDEOS.md "Beat-synced
# captions & the speed-ramp map" for the full design rationale):
#   1. Runs the three STORY-tagged Playwright specs in ONE invocation (sequential,
#      single worker — never parallel, and never split across multiple `playwright
#      test` calls: Playwright wipes its outputDir at the START of each invocation,
#      which would delete an earlier run's renamed webm before ffmpeg ever sees it).
#      Each spec ALSO writes `<slug>.beats.json` — a beat-label -> timestamp
#      manifest (setpoint-evals-playwright/src/demos/helpers.ts's `captionBeat`/
#      `beat()`) — the single source of truth this script reads for the speed-ramp
#      windows below, instead of hand-picked seconds.
#   2. Converts each webm -> a RAW mp4 (h264, no audio) — kept only as an
#      intermediate; the raw timestamps are what the beats.json manifest is
#      relative to.
#   3. Builds docs/media/hero.gif from the infra recording's own cascade-landing
#      beat window (RAW timestamps, unramped — "the cascade flipping amber across
#      a full-screen DAG", ux-storyboards.md's hero-gif-v2 pick) instead of the
#      old hardcoded iot `-ss 22 -t 20`.
#   4. Speed-ramps the order-processing and infra-provisioning recordings over
#      their real SQS-retry dead-air span (order: drilldown-open -> terminal-landed;
#      infra: drilldown-open -> cascade-landed) — a real ~30-60s wait compressed to
#      a few seconds with a baked "×N" corner tag, keyed to the SAME beat labels
#      the caption calls used, never to a hardcoded second offset. iot has no
#      comparable dead-air span (fan-out completes in seconds) so it publishes
#      unramped. Writes the final docs/media/*.mp4.
#   5. Prints ffprobe duration/size for every artifact so the caller can eyeball
#      the acceptance bounds (30s-3min per video, hero gif <=5MB) without a
#      separate verification pass.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
PW_DIR="$ROOT/setpoint-evals-playwright"
MEDIA_DIR="$ROOT/docs/media"
VIDEO_DIR="$PW_DIR/demo-recordings"
RAW_DIR="$VIDEO_DIR/.raw-mp4"
SPEED_RAMP="${SPEED_RAMP:-on}"

mkdir -p "$MEDIA_DIR" "$RAW_DIR"

# SKIP_RECORD=1 (undocumented, dev-iteration only) re-runs post-production against
# the LAST recording's raw mp4 + beats.json without re-recording — useful when
# fixing a post-production bug (e.g. a speed-ramp regression) without paying the
# ~5-7min recording cost again. Never set this for an actual publish run.
if [ "${SKIP_RECORD:-0}" = "1" ]; then
  echo "==> [1/5] SKIP_RECORD=1 — reusing existing raw recordings, NOT re-recording"
else
  echo "==> [1/5] Recording the three STORY demos (order-processing, iot, infra) — sequential, single stack"
  (
    cd "$PW_DIR"
    DASHBOARD_URL="${DASHBOARD_URL:-http://localhost:5173}" \
      npx playwright test --project=demo-videos -g 'STORY'
  )
fi

declare -A SLUGS=(
  [order-processing-partial-payment-failure]="Ada's Beans Cafe — a failed payment doesn't sink the order (PARTIAL_SUCCESS)"
  [iot-double-fan-out]="Greenhouse 3 — double fan-out explodes into an N-by-M step tree (COMPLETED)"
  [infra-cascade-failure]="prod-eu — a mid-chain failure cascades SKIPPED (FAILED)"
)

echo "==> [2/5] Converting webm -> raw mp4"
for slug in "${!SLUGS[@]}"; do
  in="$VIDEO_DIR/$slug.webm"
  raw="$RAW_DIR/$slug.mp4"
  [ -f "$in" ] || { echo "ERROR: missing recording $in — the Playwright run above should have produced it" >&2; exit 1; }
  ffmpeg -y -i "$in" -c:v libx264 -pix_fmt yuv420p -crf 20 -preset slow -movflags +faststart -an "$raw"
done

# Beat-manifest lookup — returns the timestamp (seconds, float) for a given
# label in <slug>.beats.json, or empty string if the label is missing (a spec
# that timed out before reaching a beat, or a future spec edit that renamed
# one — this script degrades gracefully in both cases, see beat_or_empty callers).
beat_t() {
  local slug="$1" label="$2"
  local beats_file="$VIDEO_DIR/$slug.beats.json"
  [ -f "$beats_file" ] || { echo ""; return; }
  jq -r --arg label "$label" '[.[] | select(.label == $label)][0].t // empty' "$beats_file"
}

echo "==> [3/5] Building the hero gif (infra cascade beat window, raw/unramped timestamps)"
INFRA_SLUG="infra-cascade-failure"
CASCADE_T="$(beat_t "$INFRA_SLUG" "cascade-landed")"
if [ -n "$CASCADE_T" ]; then
  GIF_START="$(awk -v t="$CASCADE_T" 'BEGIN { s = t - 4; if (s < 0) s = 0; print s }')"
else
  echo "  WARNING: no 'cascade-landed' beat found in $INFRA_SLUG.beats.json — falling back to a fixed offset." >&2
  GIF_START=45
fi
ffmpeg -y -ss "$GIF_START" -t 18 -i "$RAW_DIR/$INFRA_SLUG.mp4" \
  -vf "fps=10,scale=720:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3" \
  "$MEDIA_DIR/hero.gif"

# Speed-ramp: re-encode [0,rampStart) and [rampEnd,end) at 1x, [rampStart,rampEnd)
# at `factor`x with a baked "×<factor>" corner tag, then concat. Re-encodes every
# segment (never stream-copies across the cut points) so the concat boundary is
# always a clean keyframe — a stream-copy cut at an arbitrary mid-GOP timestamp
# can corrupt the first frames of the following segment.
speed_ramp() {
  local slug="$1" start_label="$2" end_label="$3" factor="$4"
  local raw="$RAW_DIR/$slug.mp4"
  local out="$MEDIA_DIR/$slug.mp4"
  local start_t end_t
  start_t="$(beat_t "$slug" "$start_label")"
  end_t="$(beat_t "$slug" "$end_label")"

  if [ -z "$start_t" ] || [ -z "$end_t" ]; then
    echo "  WARNING: $slug missing beat '$start_label' or '$end_label' — publishing UNRAMPED." >&2
    cp "$raw" "$out"
    return
  fi

  local tmp; tmp="$(mktemp -d)"
  # -ss/-to as INPUT options (before -i), not output options (after -i) — this is
  # the fix for a real bug found live (dtm-video-v2 Lane C, 2026-07-17): placed
  # AFTER -i, -ss/-to trim against the FILTERED stream's timestamps, which
  # `setpts=PTS/factor` has already scaled down — the requested window (e.g.
  # 35s..84s) can fall entirely past the filtered stream's now-shorter max
  # timestamp, so ffmpeg silently emits an EMPTY segment ("No filtered frames
  # for output stream") while still exiting 0. Input-side seeking trims the
  # ORIGINAL (pre-filter) timeline first, so `setpts` then only ever sees the
  # already-correct sub-range. `setpts=PTS-STARTPTS` before the divide
  # normalizes the segment's own timeline to start at 0 regardless of how the
  # input seek offsets frame PTS.
  ffmpeg -y -ss 0 -to "$start_t" -i "$raw" \
    -c:v libx264 -pix_fmt yuv420p -crf 20 -preset veryfast -an "$tmp/seg1.mp4" -loglevel error
  ffmpeg -y -ss "$start_t" -to "$end_t" -i "$raw" \
    -vf "setpts=PTS-STARTPTS,setpts=PTS/${factor},drawtext=text='×${factor}':fontsize=30:fontcolor=#ffcc33:x=w-tw-24:y=h-th-24:box=1:boxcolor=black@0.55:boxborderw=8" \
    -c:v libx264 -pix_fmt yuv420p -crf 20 -preset veryfast -an "$tmp/seg2.mp4" -loglevel error
  ffmpeg -y -ss "$end_t" -i "$raw" \
    -vf "setpts=PTS-STARTPTS" \
    -c:v libx264 -pix_fmt yuv420p -crf 20 -preset veryfast -an "$tmp/seg3.mp4" -loglevel error

  # Guard the exact failure mode above: a segment that silently encoded to zero
  # duration must fail the build loudly, never publish a corrupt/truncated cut.
  for seg in seg1 seg2 seg3; do
    local seg_dur
    seg_dur="$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$tmp/$seg.mp4" 2>/dev/null || echo "")"
    if [ -z "$seg_dur" ] || awk -v d="$seg_dur" 'BEGIN{exit !(d+0 <= 0.05)}'; then
      echo "ERROR: $slug/$seg.mp4 encoded to ~zero duration (got '${seg_dur:-N/A]}') — speed_ramp produced a broken segment, refusing to publish." >&2
      rm -rf "$tmp"
      exit 1
    fi
  done

  printf "file 'seg1.mp4'\nfile 'seg2.mp4'\nfile 'seg3.mp4'\n" > "$tmp/concat.txt"
  ffmpeg -y -f concat -safe 0 -i "$tmp/concat.txt" -c copy -movflags +faststart "$out" -loglevel error
  rm -rf "$tmp"
  echo "  $slug: ramped [$start_label=$start_t s .. $end_label=$end_t s] at ${factor}x"
}

echo "==> [4/5] Speed-ramping the real SQS-retry dead-air spans (keyed to beat labels, not seconds)"
if [ "$SPEED_RAMP" = "on" ]; then
  speed_ramp "order-processing-partial-payment-failure" "drilldown-open" "terminal-landed" 3
  # infra's dead-air span runs longer than order's (6 ApplyCompute instances retry
  # in parallel, each 3x, plus the console-scope beat) — 5x here, vs 3x for order,
  # is what lands infra near its own ~80s storyboard target instead of ~100s+.
  speed_ramp "infra-cascade-failure" "drilldown-open" "cascade-landed" 5
else
  echo "  SPEED_RAMP=off — publishing raw 1:1 recordings unramped."
fi
# iot has no comparable dead-air span (fan-out completes in seconds) — publish as-is.
cp "$RAW_DIR/iot-double-fan-out.mp4" "$MEDIA_DIR/iot-double-fan-out.mp4"
if [ "$SPEED_RAMP" != "on" ]; then
  cp "$RAW_DIR/order-processing-partial-payment-failure.mp4" "$MEDIA_DIR/order-processing-partial-payment-failure.mp4"
  cp "$RAW_DIR/infra-cascade-failure.mp4" "$MEDIA_DIR/infra-cascade-failure.mp4"
fi

echo "==> [5/5] Verifying artifacts"
for f in "$MEDIA_DIR"/*.mp4 "$MEDIA_DIR/hero.gif"; do
  name="$(basename "$f")"
  size_mb=$(du -m "$f" | cut -f1)
  duration=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$f")
  printf '  %-45s %6sMB  %8.1fs\n' "$name" "$size_mb" "$duration"
done

echo "==> Done. Artifacts in $MEDIA_DIR (raw/unramped intermediates in $RAW_DIR, gitignored)"
