#!/usr/bin/env bash
# SE-38 — agent-forest TRANSITIONS count-drift: the store's exported transition matrix
# is DATA, and every row has exactly one sim scenario (SE-37). Adding a transition without a
# scenario (or vice versa) fails the build — the matrix can never drift ahead of the sim.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
STORE="$REPO_ROOT/apps/monitor/src/state/agent-forest.store.ts"
SCEN="$REPO_ROOT/setpoint-evals/SE-37-agent-forest-store-sim/sim/scenarios"

[ -f "$STORE" ] || { echo "  ✗ store missing: $STORE"; exit 1; }
[ -d "$SCEN" ] || { echo "  ✗ scenarios dir missing: $SCEN"; exit 1; }

transitions="$(grep -cE '^\s*\{ from:' "$STORE")"
scenarios="$(find "$SCEN" -name '*.json' | wc -l)"

if [ "$transitions" -ge 1 ] && [ "$transitions" -eq "$scenarios" ]; then
  echo "  ✓ TRANSITIONS rows ($transitions) == sim scenarios ($scenarios)"
  exit 0
fi
echo "  ✗ drift — TRANSITIONS rows ($transitions) != sim scenarios ($scenarios):"
echo "    add/remove a scenario with every TRANSITIONS change"
exit 1
