#!/usr/bin/env bash
# se-run-suite.sh — THE shared Setpoint-Eval suite runner (SE Conventions v2).
# Replaces per-suite hand-written run-all.sh loops. A suite's run-all.sh becomes:
#     #!/usr/bin/env bash
#     exec bash "$(cd "$(dirname "$0")/../.." && pwd)/scripts/se-run-suite.sh" "$(cd "$(dirname "$0")" && pwd)" "$@"
# Canonical copy: server-config/scripts/se-run-suite.sh (vendored per repo by sync-se-tooling.sh).
# Spec: server-config/docs/setpoint-eval-conventions.md. Mechanisms adapted from the dtm-v2
# e2e-evals harness (filesystem auto-discovery, verdict markers, .results logs, results.json).
#
# Usage: se-run-suite.sh <suite-dir> [--se <id>...] [--list] [--quick] [--no-log]
#   --se 02 --se csm-origin   run only matching SEs (numeric id or name substring)
#   --list                    print the discovered execution order, run nothing
#   --quick                   export SE_QUICK=1 (SEs may shorten waits)
#   --no-log                  stream to stdout only (no .results dir; for tight CI logs)
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
ONLY=(); LIST=0; NOLOG=0
while [ $# -gt 0 ]; do
  case "$1" in
    --se) ONLY+=("$2"); shift 2 ;;
    --list) LIST=1; shift ;;
    --quick) export SE_QUICK=1; shift ;;
    --no-log) NOLOG=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

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

suite_name="$(basename "$SUITE")"
echo "═══ SE suite: $suite_name — $(printf '%s' "${#DISCOVERED[@]}") SEs ═══"
declare -a ROWS=()
pass=0; fail=0; skip=0; xfail=0; upass=0; tmo=0
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

total_bad=$((fail + upass + tmo))
echo "─── $suite_name: ${pass} pass · ${xfail} xfail · ${skip} skip · ${fail} fail · ${upass} unexpected-pass · ${tmo} timeout"
if [ "$NOLOG" -eq 0 ]; then
  { echo "{\"suite\":\"$suite_name\",\"ts\":\"$TS\",\"pass\":$pass,\"fail\":$fail,\"skip\":$skip,\"xfail\":$xfail,\"upass\":$upass,\"timeout\":$tmo,\"results\":[";
    (IFS=,; echo "${ROWS[*]}"); echo "]}"; } > "$RES/results.json"
  echo "    logs: $RES/"
fi
exit "$total_bad"
