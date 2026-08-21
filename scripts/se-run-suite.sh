#!/usr/bin/env bash
# se-run-suite.sh — THE shared Setpoint-Eval suite runner (SE Conventions v2).
# Replaces per-suite hand-written run-all.sh loops. A suite's run-all.sh becomes:
#     #!/usr/bin/env bash
#     exec bash "$(cd "$(dirname "$0")/../.." && pwd)/scripts/se-run-suite.sh" "$(cd "$(dirname "$0")" && pwd)" "$@"
# Canonical copy: server-config/scripts/se-run-suite.sh (vendored per repo by sync-se-tooling.sh).
# Spec: server-config/docs/setpoint-eval-conventions.md. Mechanisms adapted from the dtm-v2
# e2e-evals harness (filesystem auto-discovery, verdict markers, .results logs, results.json).
#
# Usage: se-run-suite.sh <suite-dir> [--se <id>...] [--list] [--quick] [--no-log] [--parallel <N>]
#   --se 02 --se csm-origin   run only matching SEs (numeric id or name substring)
#   --list                    print the discovered execution order, run nothing
#   --quick                   export SE_QUICK=1 (SEs may shorten waits)
#   --no-log                  stream to stdout only (no .results dir; for tight CI logs)
#   --parallel <N>            concurrency (env SE_PARALLEL; flag wins). DEFAULT 1 = today's
#                             serial behavior, byte-for-byte — the N=1 path runs zero new code.
#                             N>1 caps concurrency; N=0 = unlimited. OPT-IN only.
#
# Parallel mode (N != 1) — donor job-pool (setpoint-evals-dtm-examples/setpoint-evals/run-all.sh):
#   Phase 1 runs parallel-safe SEs concurrently (capped at N); Phase 2 runs the rest serially.
#   An SE is parallel-safe ONLY if its README explicitly declares '**Isolation**: parallel-safe'.
#   Anything else — '**Isolation**: destructive', the line absent, or NO README at all — is treated
#   as destructive and runs serially (FAIL-SAFE: this INVERTS the conventions-doc parallel-safe
#   default so that an unmarked/legacy SE never races; parallelism is earned by an explicit mark).
#   Anti-drop guard (§1.2): launched == discovered == collected-verdicts, else exit 2 — a dispatched
#   SE that produces no verdict sidecar is a silent drop and must never be reported as green.
#   Verdicts are collected from per-SE sidecar files, so --no-log is incompatible with N != 1.
#
# Contract with each SE-*/test.sh:
#   exit 0 = PASS · exit 77 = SKIP (deliberate) · exit 124 = TIMEOUT (via timeout(1)) · else FAIL
# Per-SE metadata read from its README.md (bold-key lines):
#   **Timeout**: 90s                      (default 120s)
#   **Expected outcome:** EXPECTED-FAIL   (XFAIL anchor — FAIL is ok, PASS is UNEXPECTED-PASS)
# Verdict marker appended as the LAST LINE of each per-SE log: PASS:<sec>|FAIL:<sec>|SKIP:<sec>|TIMEOUT:<sec>|XFAIL:<sec>|UPASS:<sec>
# Results: <suite>/.results/<UTC-ts>/{<se>.log..., results.json}; last 10 runs kept.
set -uo pipefail

SUITE="${1:?usage: se-run-suite.sh <suite-dir> [--se id]... [--list] [--quick] [--no-log]}"; shift || true
SUITE="$(cd "$SUITE" && pwd)" || exit 2
ONLY=(); LIST=0; NOLOG=0; PARALLEL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --se) ONLY+=("$2"); shift 2 ;;
    --list) LIST=1; shift ;;
    --quick) export SE_QUICK=1; shift ;;
    --no-log) NOLOG=1; shift ;;
    --parallel) PARALLEL="${2:-}"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# Resolve concurrency: --parallel flag wins over SE_PARALLEL env; default 1 (serial).
[ -n "$PARALLEL" ] || PARALLEL="${SE_PARALLEL:-1}"
[[ "$PARALLEL" =~ ^[0-9]+$ ]] || { echo "--parallel/SE_PARALLEL must be a non-negative integer (1=serial, N>1=capped, 0=unlimited); got '$PARALLEL'" >&2; exit 2; }
# --no-log needs per-SE verdict sidecars, which only exist under a .results dir → incompatible with parallel.
if [ "$NOLOG" -eq 1 ] && [ "$PARALLEL" -ne 1 ]; then
  echo "--no-log is incompatible with --parallel != 1 (parallel dispatch collects verdicts from sidecar files under .results/)" >&2; exit 2
fi

if [ -n "${NO_COLOR:-}" ] || [ ! -t 1 ]; then G=""; R=""; Y=""; N=""; else G=$'\e[32m'; R=$'\e[31m'; Y=$'\e[33m'; N=$'\e[0m'; fi

# ── auto-discovery: every SE-*/test.sh, numeric ids first (zero-padded sort), template excluded ──
mapfile -t DISCOVERED < <(
  find "$SUITE" -mindepth 2 -maxdepth 2 -name test.sh -path '*/SE-*' ! -path '*/00-template/*' \
    -printf '%h\n' 2>/dev/null |
  while IFS= read -r d; do
    b="$(basename "$d")"                       # SE-03-name | SE-CSM-ORIGIN
    id="${b#SE-}"; id="${id%%-*}"
    if [[ "$id" =~ ^[0-9]+$ ]]; then printf '0%04d %s\n' "$((10#$id))" "$b"
    else printf '1%s %s\n' "$id" "$b"; fi      # non-numeric ids sort after numerics, lexical
  done | LC_ALL=C sort | awk '{print $2}'
)
[ "${#DISCOVERED[@]}" -gt 0 ] || { echo "no SE-*/test.sh found under $SUITE" >&2; exit 2; }

# --se filtering (numeric id or case-insensitive name substring)
if [ "${#ONLY[@]}" -gt 0 ]; then
  SEL=()
  for se in "${DISCOVERED[@]}"; do
    for want in "${ONLY[@]}"; do
      norm="$se"
      if [[ "$want" =~ ^[0-9]+$ ]]; then
        [[ "$se" =~ ^SE-0*$((10#$want))- ]] && { SEL+=("$se"); break; }
      else
        shopt -s nocasematch; [[ "$norm" == *"$want"* ]] && { shopt -u nocasematch; SEL+=("$se"); break; }; shopt -u nocasematch
      fi
    done
  done
  DISCOVERED=("${SEL[@]}")
  [ "${#DISCOVERED[@]}" -gt 0 ] || { echo "--se matched nothing" >&2; exit 2; }
fi

if [ "$LIST" -eq 1 ]; then printf '%s\n' "${DISCOVERED[@]}"; exit 0; fi

# ── results dir (self-gitignoring), retention 10 ────────────────────────────
TS="$(date -u +%Y%m%d_%H%M%S)"
RES="$SUITE/.results/$TS"
if [ "$NOLOG" -eq 0 ]; then
  mkdir -p "$RES"
  printf '*\n' > "$SUITE/.results/.gitignore"
  ls -1d "$SUITE/.results"/2* 2>/dev/null | sort | head -n -10 | xargs -r rm -rf
fi

meta() { # meta <readme> <key> — value of a '**Key**: value' line ('' if absent)
  [ -f "$1" ] || { echo ""; return; }
  sed -n "s/^[> ]*\*\*$2\*\*:*[: ]*\(.*\)$/\1/pI" "$1" | head -1
}

iso() { # iso <readme> — 'parallel-safe' ONLY if the README explicitly declares it; else 'destructive'
  case "$(meta "$1" "Isolation")" in
    parallel-safe*) echo "parallel-safe" ;;
    *)              echo "destructive" ;;
  esac
}

suite_name="$(basename "$SUITE")"
echo "═══ SE suite: $suite_name — $(printf '%s' "${#DISCOVERED[@]}") SEs ═══"
declare -a ROWS=()
pass=0; fail=0; skip=0; xfail=0; upass=0; tmo=0

# ── verdict-emit helper: prints the per-SE line, tallies, appends ROWS.
# Shared by the serial and parallel paths so their output/JSON stay identical.
emit_verdict() { # emit_verdict <se> <verdict> <dur> <timeout> <logf>
  local se="$1" v="$2" dur="$3" t="$4" logf="$5"
  case "$v" in
    PASS) pass=$((pass+1)) ;;  XFAIL) xfail=$((xfail+1)) ;;  SKIP) skip=$((skip+1)) ;;
    UPASS) upass=$((upass+1)) ;;  TIMEOUT) tmo=$((tmo+1)) ;;  FAIL) fail=$((fail+1)) ;;
  esac
  case "$v" in
    PASS)  echo "  ${G}✅ $se${N} (${dur}s)" ;;
    XFAIL) echo "  ${G}🟡 $se${N} — expected-fail, still failing (anchor holds) (${dur}s)" ;;
    SKIP)  echo "  ${Y}⏭  $se${N} — $( [ "$NOLOG" -eq 0 ] && grep -m1 '^SKIP:' "$logf" | cut -c6-80 || echo skipped ) (${dur}s)" ;;
    UPASS) echo "  ${R}🔺 $se — UNEXPECTED PASS (flip its EXPECTED-FAIL anchor)${N} (${dur}s)" ;;
    TIMEOUT) echo "  ${R}⏱ $se — TIMEOUT after ${t}s${N}" ;;
    FAIL)  echo "  ${R}❌ $se${N} (${dur}s)"
           [ "$NOLOG" -eq 0 ] && sed 's/^/     │ /' < <(tail -8 "$logf") ;;
  esac
  ROWS+=("{\"se\":\"$se\",\"verdict\":\"$v\",\"seconds\":$dur,\"timeout\":$t}")
}

if [ "$PARALLEL" -eq 1 ]; then
# ── SERIAL PATH (default — byte-for-byte the historical behavior; runs zero new code) ──
for se in "${DISCOVERED[@]}"; do
  dir="$SUITE/$se"
  readme="$dir/README.md"
  t="$(meta "$readme" "Timeout" | grep -oE '^[0-9]+' || true)"; t="${t:-120}"
  expected_fail=0
  grep -qiE '^\W*\*\*Expected outcome:?\*\*:?\s*EXPECTED-FAIL' "$readme" 2>/dev/null && expected_fail=1
  logf="$RES/$se.log"; [ "$NOLOG" -eq 1 ] && logf=/dev/stdout
  start=$(date +%s)
  if [ "$NOLOG" -eq 1 ]; then
    timeout "$t" bash "$dir/test.sh"; rc=$?
  else
    timeout "$t" bash "$dir/test.sh" >"$logf" 2>&1; rc=$?
  fi
  dur=$(( $(date +%s) - start ))
  case "$rc" in
    0)   if [ "$expected_fail" -eq 1 ]; then v=UPASS; upass=$((upass+1)); else v=PASS; pass=$((pass+1)); fi ;;
    77)  v=SKIP; skip=$((skip+1)) ;;
    124) v=TIMEOUT; tmo=$((tmo+1)) ;;
    *)   if [ "$expected_fail" -eq 1 ]; then v=XFAIL; xfail=$((xfail+1)); else v=FAIL; fail=$((fail+1)); fi ;;
  esac
  [ "$NOLOG" -eq 0 ] && echo "$v:$dur" >> "$logf"
  case "$v" in
    PASS)  echo "  ${G}✅ $se${N} (${dur}s)" ;;
    XFAIL) echo "  ${G}🟡 $se${N} — expected-fail, still failing (anchor holds) (${dur}s)" ;;
    SKIP)  echo "  ${Y}⏭  $se${N} — $( [ "$NOLOG" -eq 0 ] && grep -m1 '^SKIP:' "$logf" | cut -c6-80 || echo skipped ) (${dur}s)" ;;
    UPASS) echo "  ${R}🔺 $se — UNEXPECTED PASS (flip its EXPECTED-FAIL anchor)${N} (${dur}s)" ;;
    TIMEOUT) echo "  ${R}⏱ $se — TIMEOUT after ${t}s${N}" ;;
    FAIL)  echo "  ${R}❌ $se${N} (${dur}s)"
           [ "$NOLOG" -eq 0 ] && sed 's/^/     │ /' < <(tail -8 "$logf") ;;
  esac
  ROWS+=("{\"se\":\"$se\",\"verdict\":\"$v\",\"seconds\":$dur,\"timeout\":$t}")
done

else
# ── PARALLEL PATH (opt-in, N != 1) — donor job pool + fail-safe isolation + anti-drop guard ──
VDIR="$RES/.verdict"; mkdir -p "$VDIR"   # per-SE verdict sidecar (written LAST = "produced a verdict")
LDIR="$RES/.launched"; mkdir -p "$LDIR"  # per-SE launch marker (written FIRST = "dispatch reached run_one")
discovered=${#DISCOVERED[@]}

# Classify: parallel-safe (Phase 1, concurrent) vs everything-else (Phase 2, serial).
# parallel-safe is OPT-IN — unmarked/README-less SEs fall through to destructive (fail-safe).
PSAFE=(); PDESTR=()
for se in "${DISCOVERED[@]}"; do
  if [ "$(iso "$SUITE/$se/README.md")" = "parallel-safe" ]; then PSAFE+=("$se"); else PDESTR+=("$se"); fi
done
if [ "$PARALLEL" -eq 0 ]; then cap_label="unlimited"; else cap_label="$PARALLEL"; fi
echo "── parallel (cap=$cap_label): ${#PSAFE[@]} parallel-safe [phase 1] · ${#PDESTR[@]} destructive/unmarked [phase 2 serial]"

# run_one <se> — execute one SE, write its log + verdict sidecar. The sidecar is written
# LAST, so its presence is the "this SE produced a verdict" signal the guard reconciles.
run_one() {
  local se="$1" dir readme t expected_fail logf start dur rc v
  dir="$SUITE/$se"; readme="$dir/README.md"
  : > "$LDIR/$se"   # dispatch marker (FIRST) — a run_one that never fires leaves no marker → launched < discovered
  t="$(meta "$readme" "Timeout" | grep -oE '^[0-9]+' || true)"; t="${t:-120}"
  expected_fail=0
  grep -qiE '^\W*\*\*Expected outcome:?\*\*:?\s*EXPECTED-FAIL' "$readme" 2>/dev/null && expected_fail=1
  logf="$RES/$se.log"
  start=$(date +%s)
  timeout "$t" bash "$dir/test.sh" >"$logf" 2>&1; rc=$?
  dur=$(( $(date +%s) - start ))
  case "$rc" in
    0)   if [ "$expected_fail" -eq 1 ]; then v=UPASS; else v=PASS; fi ;;
    77)  v=SKIP ;;
    124) v=TIMEOUT ;;
    *)   if [ "$expected_fail" -eq 1 ]; then v=XFAIL; else v=FAIL; fi ;;
  esac
  echo "$v:$dur" >> "$logf"
  printf '%s %s\n' "$v" "$dur" > "$VDIR/$se"
}

# Phase 1 — parallel-safe SEs, capped at PARALLEL (0 = unlimited).
declare -a P1PIDS=()
for se in ${PSAFE[@]+"${PSAFE[@]}"}; do
  if [ "$PARALLEL" -gt 0 ]; then
    while :; do
      running=0
      for p in ${P1PIDS[@]+"${P1PIDS[@]}"}; do kill -0 "$p" 2>/dev/null && running=$((running+1)); done
      [ "$running" -lt "$PARALLEL" ] && break
      sleep 0.2
    done
  fi
  run_one "$se" &
  P1PIDS+=("$!")
done
for p in ${P1PIDS[@]+"${P1PIDS[@]}"}; do wait "$p" 2>/dev/null || true; done  # flush every sidecar before collect

# Phase 2 — destructive/unmarked SEs, strictly serial.
for se in ${PDESTR[@]+"${PDESTR[@]}"}; do run_one "$se"; done

# launched = SEs that actually reached run_one (marker files), NOT a count computed from the arrays —
# so a dispatch-skip bug (an SE that never fires) shows up as launched < discovered, distinct from a
# mid-run death (collected < launched). The three legs are independently measured.
launched=0; for se in "${DISCOVERED[@]}"; do [ -f "$LDIR/$se" ] && launched=$((launched+1)); done

# Collect verdicts from sidecar files — the single source of truth for the tally.
collected=0; declare -A PV=() PD=()
for se in "${DISCOVERED[@]}"; do
  if [ -f "$VDIR/$se" ]; then read -r pv pd < "$VDIR/$se"; PV[$se]="$pv"; PD[$se]="$pd"; collected=$((collected+1)); fi
done

# >>> anti-drop-guard (§1.2) — launched == discovered == collected, else exit 2. Delimited for
# the SE-1 canary (a strip of these lines must let a dropped verdict slip through). DO NOT remove.
if [ "$launched" -ne "$discovered" ] || [ "$collected" -ne "$discovered" ]; then
  echo "${R}✗ ANTI-DROP GUARD TRIPPED${N}: discovered=$discovered launched=$launched collected=$collected — a dispatched SE produced no verdict; refusing to report a partial run as green" >&2
  exit 2
fi
# <<< anti-drop-guard

# Emit rows in deterministic discovery order (jobs finished out of order). The `:-` defaults keep
# this loop from being what catches a dropped verdict — the guard above is the sole enforcer, so a
# guard-stripped copy silently false-greens instead of crashing (SE-1's canary depends on this).
for se in "${DISCOVERED[@]}"; do
  t="$(meta "$SUITE/$se/README.md" "Timeout" | grep -oE '^[0-9]+' || true)"; t="${t:-120}"
  emit_verdict "$se" "${PV[$se]:-}" "${PD[$se]:-0}" "$t" "$RES/$se.log"
done
fi

total_bad=$((fail + upass + tmo))
echo "─── $suite_name: ${pass} pass · ${xfail} xfail · ${skip} skip · ${fail} fail · ${upass} unexpected-pass · ${tmo} timeout"
if [ "$NOLOG" -eq 0 ]; then
  { echo "{\"suite\":\"$suite_name\",\"ts\":\"$TS\",\"pass\":$pass,\"fail\":$fail,\"skip\":$skip,\"xfail\":$xfail,\"upass\":$upass,\"timeout\":$tmo,\"results\":[";
    (IFS=,; echo "${ROWS[*]}"); echo "]}"; } > "$RES/results.json"
  echo "    logs: $RES/"
fi
# EXIT 77 IS THE ONLY SKIP (canonical port of upstream #1937). If EVERY discovered SE
# skipped, the suite exercised ZERO real assertions — total_bad is 0, so a bare `exit 0` would
# fake-green the suite to a caller that only checks the rc. Report SKIP (77) instead. A MIX of
# pass+skip still exits via total_bad (0 = a legitimate pass: real assertions ran; the skip count
# is visible in the summary line above). Consumers must treat 77 as SKIP, never as PASS or FAIL —
# see .github/workflows/ci.yml's suite loop and setpoint-evals/se-verdict-integrity/.
if [ "$total_bad" -eq 0 ] && [ "$skip" -gt 0 ] && [ "$skip" -eq "${#DISCOVERED[@]}" ]; then
  exit 77
fi
exit "$total_bad"
