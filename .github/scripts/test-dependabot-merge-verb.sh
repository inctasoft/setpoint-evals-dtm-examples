#!/usr/bin/env bash
# SE (inctasoft/server-config#1668): the auto-merge workflow's merge verb must be
# `--auto` whenever the repo carries an ACTIVE RULESET. Reads the RULESETS API
# (/repos/{r}/rulesets) -- NOT branch protection, which 404s "Branch not protected"
# even while a ruleset gates the base branch (different API surfaces).
# Run: bash .github/scripts/test-dependabot-merge-verb.sh   (REPO=owner/name to override)
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WF="${WF:-$ROOT/.github/workflows/dependabot-auto-merge.yml}"
REPO="${REPO:-inctasoft/setpoint-evals-dtm-examples}"
fails=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; fails=$((fails+1)); }
has_auto() { grep -vE '^\s*#' "$WF" | grep -E 'gh pr merge .*--auto' >/dev/null; }

# 1. Static: a `gh pr merge` call carries --auto (executable lines only, not comments).
if has_auto; then ok "merge verb includes --auto"; else bad "no 'gh pr merge ... --auto' call in workflow"; fi

# 2. Static: the expired premise must not be asserted as fact again.
if grep -E 'cannot gate on CI;' "$WF" >/dev/null; then bad "stale premise 'cannot gate on CI' still in workflow"; else ok "stale premise comment absent"; fi

# 3. Live: rulesets API. An active ruleset REQUIRES the --auto verb.
if command -v gh >/dev/null 2>&1 && rs="$(gh api "repos/$REPO/rulesets" --jq '[.[]|select(.enforcement=="active")]|length' 2>/dev/null)"; then
  echo "INFO  $REPO active rulesets: $rs"
  if [ "$rs" -gt 0 ]; then
    if has_auto; then ok "active ruleset present and verb is --auto"; else bad "active ruleset present but merge verb is not --auto"; fi
  else ok "no active ruleset (fallback verb still fine)"; fi
else
  echo "SKIP  rulesets API unreachable (offline/unauthenticated); static checks stand"
fi
[ "$fails" -eq 0 ] && echo "ALL PASS" || echo "$fails FAILED"
exit $((fails>0))
