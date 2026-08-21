#!/usr/bin/env bash
# Pure decision function for Dependabot auto-merge gating.
# Reads the `.check_runs` array from the GitHub REST endpoint
#   GET /repos/{owner}/{repo}/commits/{sha}/check-runs
# on stdin (each element has .name, .status, .conclusion). Using the REST shape
# (not `gh pr checks --json`, which needs gh >= 2.47) keeps this portable.
# Arg $1 = a regex matching this auto-merge workflow's own check-run name, so the
# gate never waits on itself (default "auto-merge").
# Emits exactly one verdict on stdout:
#   MERGE  every non-self check completed non-failing (or there are none) -> safe
#   WAIT   at least one non-self check has not completed yet
#   SKIP   at least one non-self check failed/cancelled -> leave for a human
# No network, no side effects: this is the unit the RED/GREEN test pins.
set -euo pipefail
self="${1:-auto-merge}"
json="$(cat)"
[ -n "$json" ] || json='[]'

others="$(printf '%s' "$json" | jq -c --arg self "$self" \
  '[.[] | select(((.name // "") | test($self; "i")) | not)]')"

fail="$(printf '%s' "$others" | jq '
  [ .[] | select(.status=="completed")
        | select(.conclusion=="failure" or .conclusion=="cancelled"
              or .conclusion=="timed_out" or .conclusion=="action_required"
              or .conclusion=="startup_failure" or .conclusion=="stale") ] | length')"
pending="$(printf '%s' "$others" | jq '[ .[] | select(.status!="completed") ] | length')"

if [ "$fail" -gt 0 ]; then
  echo "SKIP"
elif [ "$pending" -gt 0 ]; then
  echo "WAIT"
else
  echo "MERGE"
fi
