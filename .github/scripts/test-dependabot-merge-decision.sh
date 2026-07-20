#!/usr/bin/env bash
# RED/GREEN proof for the Dependabot auto-merge gate decision.
# Fixtures mirror the /commits/{sha}/check-runs REST shape (.name/.status/.conclusion).
# Run: bash .github/scripts/test-dependabot-merge-decision.sh
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$DIR/dependabot-merge-decision.sh"
SELF="auto-merge"
fails=0
check() { # $1=label $2=expected $3=json
  got="$(printf '%s' "$3" | bash "$SCRIPT" "$SELF" 2>/dev/null)"
  if [ "$got" = "$2" ]; then echo "PASS  $1 -> $got"; else echo "FAIL  $1 expected=$2 got=$got"; fails=$((fails+1)); fi
}
pass='{"name":"build-test","status":"completed","conclusion":"success"}'
fail='{"name":"se-structure","status":"completed","conclusion":"failure"}'
cancel='{"name":"e2e","status":"completed","conclusion":"cancelled"}'
pend='{"name":"se-crud","status":"in_progress","conclusion":null}'
queued='{"name":"se-dev","status":"queued","conclusion":null}'
skip='{"name":"optional","status":"completed","conclusion":"skipped"}'
selfrun='{"name":"dependabot-auto-merge","status":"in_progress","conclusion":null}'

# GREEN: all non-self checks succeeded -> MERGE
check "all-pass"        MERGE "[$pass,$pass]"
# RED: a failing check -> SKIP (must NOT merge) -- the load-bearing assertion
check "one-fail"        SKIP  "[$pass,$fail]"
# RED: a cancelled check is ambiguous -> SKIP
check "one-cancel"      SKIP  "[$cancel]"
# PENDING: still running/queued -> WAIT
check "one-inprogress"  WAIT  "[$pass,$pend]"
check "one-queued"      WAIT  "[$pass,$queued]"
# NO-CI: empty set -> MERGE (workflow enforces the grace window first)
check "empty"           MERGE "[]"
# SELF-EXCLUSION: only our own (in-progress) run -> MERGE, not WAIT
check "only-self"       MERGE "[$selfrun]"
# SELF-EXCLUSION + real pass -> MERGE
check "self-plus-pass"  MERGE "[$selfrun,$pass]"
# SELF-EXCLUSION must not mask a real failure
check "self-plus-fail"  SKIP  "[$selfrun,$fail]"
# skipped/neutral are non-blocking -> MERGE
check "skipped-ok"      MERGE "[$skip,$pass]"

echo "---"
if [ "$fails" -eq 0 ]; then echo "ALL PASS"; exit 0; else echo "$fails FAILED"; exit 1; fi
