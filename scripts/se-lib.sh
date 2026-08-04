#!/usr/bin/env bash
# se-lib.sh — shared Setpoint-Eval assertion + harness library (SE Conventions v2).
# Source from an SE's test.sh:   . "$(dirname "$0")/../../../scripts/se-lib.sh"
# Canonical copy: server-config/scripts/se-lib.sh — vendored per repo by sync-se-tooling.sh
# (drift checked weekly via sha256). Spec: server-config/docs/setpoint-eval-conventions.md.
#
# Design constraints (from gotchas_se_harness.md — do not "simplify" these away):
# - pipefail + `grep -q` in a pipeline dies SIGPIPE(141) → false FAIL. All grep helpers here
#   use `grep -c ... || true` and compare counts.
# - Assertion helpers MUTATE the caller's counters. NEVER call them in a $() subshell —
#   the mutation is lost (se-subshell-state). Capture output separately if needed.
# - Background processes are started with setsid and killed by PROCESS GROUP, else grandchildren
#   (workerd, node) survive the trap and hold ports → false-green next run.

# ── colors (NO_COLOR / non-TTY aware) ───────────────────────────────────────
if [ -n "${NO_COLOR:-}" ] || [ ! -t 1 ]; then
  C_G=""; C_R=""; C_Y=""; C_B=""; C_0=""
else
  C_G=$'\e[32m'; C_R=$'\e[31m'; C_Y=$'\e[33m'; C_B=$'\e[34m'; C_0=$'\e[0m'
fi
log_info() { echo "${C_B}ℹ${C_0} $*"; }
log_pass() { echo "${C_G}✓${C_0} $*"; }
log_fail() { _SE_FAIL=$((_SE_FAIL+1)); echo "${C_R}✗${C_0} $*"; }
log_warn() { echo "${C_Y}⚠${C_0} $*"; }

# ── verdict plumbing ────────────────────────────────────────────────────────
_SE_PASS=0; _SE_FAIL=0
# se_skip "<reason>" — deliberate skip; exit code 77 is the SKIP sentinel (≠ FAIL).
se_skip() { echo "SKIP: $*"; exit 77; }
# se_summary — print tally and exit 0/1. Call as the LAST line of test.sh.
se_summary() {
  echo "── assertions: ${_SE_PASS} pass, ${_SE_FAIL} fail"
  [ "$_SE_FAIL" -eq 0 ] && exit 0 || exit 1
}

# ── assertions (mutate _SE_PASS/_SE_FAIL — never call inside $( )) ──────────
# ck "<label>" <command...>      — pass iff the command exits 0
ck() {
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then _SE_PASS=$((_SE_PASS+1)); log_pass "$label"
  else log_fail "$label  (cmd: $*)"; fi
}
# ck_eq "<label>" "<actual>" "<expected>"
ck_eq() {
  if [ "$2" = "$3" ]; then _SE_PASS=$((_SE_PASS+1)); log_pass "$1"
  else log_fail "$1  (actual='$2' expected='$3')"; fi
}
# ck_has "<label>" "<haystack-string>" "<needle>"   — substring, pipefail-safe
ck_has() {
  local n; n=$(printf '%s' "$2" | grep -cF -- "$3" || true)
  if [ "$n" -gt 0 ]; then _SE_PASS=$((_SE_PASS+1)); log_pass "$1"
  else log_fail "$1  (needle not found: '$3')"; fi
}
# ck_str_absent "<label>" "<haystack-string>" "<regex>"  — negative assertion on a STRING.
# The string-haystack mirror of ck_absent (which is FILE-only). An UNSET/EMPTY haystack FAILS
# loudly: "" trivially matches no pattern, so a typo'd/empty var would fake-green the absence
# (the same sin ck_absent had against an unreadable file). Use ck test ! -e / ck_eq for the
# genuine "output was never produced / is empty" assertion, not this.
ck_str_absent() {
  if [ -z "$2" ]; then
    log_fail "$1  (ck_str_absent: haystack is EMPTY — absence is UNPROVABLE against an empty string; assert emptiness explicitly instead)"; return
  fi
  local n; n=$(printf '%s' "$2" | grep -cE -- "$3" || true)
  if [ "${n:-0}" -eq 0 ]; then _SE_PASS=$((_SE_PASS+1)); log_pass "$1"
  else log_fail "$1  (string unexpectedly matches $3, $n hit(s))"; fi
}
# ck_file_has "<label>" <file> "<regex>"   — pipefail-safe grep -c
# A non-readable haystack FAILS (grep errs → count 0 → "not found" → fail already), but with a
# generic "!~" message; the explicit guard names the real cause (mistyped path vs. absent match).
ck_file_has() {
  if [ ! -r "$2" ] || [ -d "$2" ]; then
    log_fail "$1  (ck_file_has: haystack '$2' is not a readable file — check the path; use ck_has for a string haystack)"; return
  fi
  local n; n=$(grep -cE -- "$3" "$2" 2>/dev/null || true)
  if [ "${n:-0}" -gt 0 ]; then _SE_PASS=$((_SE_PASS+1)); log_pass "$1"
  else log_fail "$1  ($2 !~ $3)"; fi
}
# ck_absent "<label>" <file> "<regex>"     — negative assertion against a FILE.
# A non-readable haystack (mistyped path, or a STRING passed where a file was meant) used to
# fake-green: grep errs → count 0 → "absent" → PASS, asserting nothing. It now FAILS LOUDLY
# naming the unreadable haystack. For a string haystack use ck_str_absent; process
# substitution `<(printf '%s' "$x")` is a readable /dev/fd file and works here unchanged.
ck_absent() {
  if [ ! -r "$2" ] || [ -d "$2" ]; then
    log_fail "$1  (ck_absent: haystack '$2' is not a readable file — absence is UNPROVABLE; use ck_str_absent for a string haystack)"; return
  fi
  local n; n=$(grep -cE -- "$3" "$2" 2>/dev/null || true)
  if [ "${n:-0}" -eq 0 ]; then _SE_PASS=$((_SE_PASS+1)); log_pass "$1"
  else log_fail "$1  ($2 unexpectedly matches $3, $n hit(s))"; fi
}

# ── paths ───────────────────────────────────────────────────────────────────
# se_root — repo root for an SE at <repo>/setpoint-evals/<suite>/SE-x/test.sh
se_root() { cd "$(dirname "${BASH_SOURCE[1]:-$0}")/../../.." && pwd; }

# ── hermetic background services (setsid + kill-by-pgid + port-refuse) ──────
_SE_BG_PGIDS=()
# se_start_bg <logfile> <command...>  — starts a NEW PROCESS GROUP; registers for cleanup.
se_start_bg() {
  local logf="$1"; shift
  setsid "$@" >"$logf" 2>&1 &
  local pid=$!
  _SE_BG_PGIDS+=("$pid")
  echo "$pid"
}
# se_stop_bg — kill every registered process GROUP (grandchildren included).
se_stop_bg() {
  local pgid
  for pgid in "${_SE_BG_PGIDS[@]:-}"; do
    [ -n "$pgid" ] && kill -- "-$pgid" 2>/dev/null || true
  done
  _SE_BG_PGIDS=()
}
# se_port_free <port> — 0 iff nothing listens (pre-flight against orphaned listeners).
se_port_free() { ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
# se_wait_http <url> <tries> — poll-for-ready (never fixed sleeps).
se_wait_http() {
  local i
  for i in $(seq 1 "${2:-40}"); do
    curl -s -o /dev/null -m 2 "$1" && return 0
    sleep 0.25
  done
  return 1
}
free_port() { python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()'; }

# ── jest vacuous-match guard (D6) ────────────────────────────────────────────
# `npx jest <pattern> -t '<title>' ...` with NO matching spec exits 0 — "N skipped, 0 of
# N total" reads as a PASS, so an SE-first/XFAIL suite whose spec file doesn't exist yet
# (or whose pathPattern typo'd) reports green with ZERO behavioral coverage exercised.
# se_jest is a drop-in replacement for `npx jest`: same args, same cwd (caller has already
# cd'd). It runs `npx jest --listTests` with those SAME args FIRST; if that lists no test
# files, it fails LOUDLY and never invokes the real run. Only on a non-empty match does it
# fall through to the real `npx jest "$@"`, returning THAT exit code.
# Usage: replace  `npx jest credits-portal -t 'foo' --runInBand`
#             with `se_jest credits-portal -t 'foo' --runInBand`
se_jest() {
  local list n
  list="$(npx jest --listTests "$@" 2>/dev/null)"
  n=$(printf '%s\n' "$list" | grep -c '\S' || true)
  if [ "${n:-0}" -eq 0 ]; then
    log_fail "se_jest: --listTests matched ZERO spec files for args [$*] — refusing to run (D6 vacuous-pass guard)"
    return 1
  fi
  npx jest "$@"
}
