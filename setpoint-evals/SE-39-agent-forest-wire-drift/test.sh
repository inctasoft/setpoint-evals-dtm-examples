#!/usr/bin/env bash
# SE-39 — agent-forest wire-drift meta-SE (R-A5): the agent_event/agent_forest wire variants
# exist on BOTH sides of the relay (orchestrator dtm-event.types.ts + monitor types/events.ts)
# with matching payload fields, the monitor's WS handler routes BOTH to named store actions
# (never CustomEvent — R-A2), sim scenarios exercise both actions, and the monitor still
# typechecks against the shared @dtm/core mirror. A wire change that forgets a leg fails here.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
SRV="$REPO_ROOT/services/orchestrator/src/websocket/dtm-event.types.ts"
CLI="$REPO_ROOT/apps/monitor/src/types/events.ts"
HOOK="$REPO_ROOT/apps/monitor/src/hooks/use-websocket.ts"
SCEN="$REPO_ROOT/setpoint-evals/SE-37-agent-forest-store-sim/sim/scenarios"
fail=0

ck() { # ck <label> <file> <regex>
  if grep -qE -- "$3" "$2" 2>/dev/null; then echo "  ✓ $1";
  else echo "  ✗ $1  ($2 !~ $3)"; fail=1; fi
}

for f in "$SRV" "$CLI" "$HOOK"; do
  [ -f "$f" ] || { echo "  ✗ missing wire file: $f"; exit 1; }
done

ck "orchestrator carries agent_event"  "$SRV" "type: ['\"]agent_event['\"]"
ck "orchestrator carries agent_forest" "$SRV" "type: ['\"]agent_forest['\"]"
ck "orchestrator agent_event payload field"  "$SRV" "type: ['\"]agent_event['\"]; event: AgentEvent"
ck "orchestrator agent_forest payload field" "$SRV" "type: ['\"]agent_forest['\"]; forest: AgentForest"
ck "monitor carries agent_event"  "$CLI" "type: ['\"]agent_event['\"]"
ck "monitor carries agent_forest" "$CLI" "type: ['\"]agent_forest['\"]"
ck "monitor agent_event payload field matches server"  "$CLI" "type: ['\"]agent_event['\"]; event: AgentEvent"
ck "monitor agent_forest payload field matches server" "$CLI" "type: ['\"]agent_forest['\"]; forest: AgentForest"

ck "WS handler routes agent_event to a named store action"  "$HOOK" "case ['\"]agent_event['\"]"
ck "WS handler routes agent_forest to a named store action" "$HOOK" "case ['\"]agent_forest['\"]"
ck "agent_event routes to ingestEvent"     "$HOOK" "ingestEvent\(event\.event\)"
ck "agent_forest routes to reconcileForest" "$HOOK" "reconcileForest\(event\.forest\)"
if grep -qE "CustomEvent" "$HOOK"; then
  echo "  ✗ CustomEvent in the WS handler — state transitions must be named actions (R-A2)"; fail=1
else
  echo "  ✓ no CustomEvent state path in the WS handler (R-A2)"
fi

ck "sim scenarios exercise ingestEvent"     <(grep -l '"ingestEvent"' "$SCEN"/*.json) "."
ck "sim scenarios exercise reconcileForest" <(grep -l '"reconcileForest"' "$SCEN"/*.json) "."

# Both sides compile against the SAME @dtm/core mirror (the drift the types exist to prevent).
if ( cd "$REPO_ROOT/apps/monitor" && npx tsc --noEmit -p tsconfig.json ) > /dev/null 2>&1; then
  echo "  ✓ monitor typechecks against the shared wire + mirror types"
else
  echo "  ✗ monitor tsc --noEmit failed"; fail=1
fi

exit "$fail"
