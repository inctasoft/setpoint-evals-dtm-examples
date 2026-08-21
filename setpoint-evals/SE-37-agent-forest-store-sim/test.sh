#!/usr/bin/env bash
# SE-37 — agent-forest store sim (SE-SIM + SE-RECONCILE-NO-SYNTH): esbuild-bundle the REAL
# agent-forest store (never a copy) and replay one scenario per TRANSITIONS row (R-A1 pair of
# SE-38) — incl. the reconcile-lost path, where a vanished node MUST surface with the TYPED
# discriminator error_reason 'lost_connection', never a synthesized "crashed" (SPEC inv. 3).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
SUITE_DIR="$HERE"
STORE="$REPO_ROOT/apps/monitor/src/state/agent-forest.store.ts"
fail=0

tmp="$REPO_ROOT/apps/monitor/.se-sim-tmp"; trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp"

ESBUILD="$REPO_ROOT/apps/monitor/node_modules/.bin/esbuild"
[ -x "$ESBUILD" ] || { echo "  ✗ esbuild missing — pnpm install in the worktree first"; exit 1; }
[ -f "$STORE" ] || { echo "  ✗ store missing: $STORE"; exit 1; }

cat > "$tmp/run.mjs" <<EOF
// Dynamic imports AFTER the shim: guarantees the localStorage shim evaluates before the
// store module (persist touches localStorage at create time) regardless of bundler ordering.
await import('./localstorage-shim.mjs');
const { useAgentForestStore, TRANSITIONS } = await import('$STORE');
const { runScenario } = await import('$SUITE_DIR/sim/harness.mjs');
import fs from 'node:fs';
const scenario = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const ok = runScenario(useAgentForestStore, TRANSITIONS, scenario);
process.exit(ok ? 0 : 1);
EOF
cp "$SUITE_DIR/sim/localstorage-shim.mjs" "$tmp/localstorage-shim.mjs"

# esbuild resolves bare imports (zustand, @dtm/core) walking up from the CWD — run it from
# apps/monitor so the workspace node_modules apply.
( cd "$REPO_ROOT/apps/monitor" && \
  "$ESBUILD" --bundle "$tmp/run.mjs" --format=esm --platform=node --outfile="$tmp/run.bundle.mjs" \
  --log-level=warning ) || { echo "  ✗ esbuild bundling failed"; exit 1; }

for scenario in "$SUITE_DIR"/sim/scenarios/*.json; do
  name="$(basename "$scenario")"
  if node "$tmp/run.bundle.mjs" "$scenario"; then
    echo "  ✓ $name"
  else
    echo "  ✗ $name"; fail=1
  fi
done

# ── SE-RECONCILE-NO-SYNTH (structural): the reconcile path renders a vanished node with the
#    TYPED discriminator 'lost_connection' — the ONLY literal error_reason the store assigns —
#    and never a synthesized condition string. (Scenario files 10-12 prove the behavior; these
#    greps make the structural class unrepresentable.) ──────────────────────────────────────
if grep -q "error_reason: 'lost_connection'" "$STORE"; then
  echo "  ✓ typed lost discriminator present (error_reason: 'lost_connection')"
else
  echo "  ✗ typed lost discriminator missing from the reconcile path"; fail=1
fi
if grep -qE "error_reason: '(crashed|timeout|tool_denied|cancelled)'" "$STORE"; then
  echo "  ✗ store assigns a literal non-lost error_reason — synthesized-condition class"; fail=1
else
  echo "  ✓ no synthesized error_reason literal in the store (only live events carry reasons)"
fi
if grep -qE "'(server restarted|agent crashed|backend failed)" "$STORE"; then
  echo "  ✗ synthesized server-state claim string in the store"; fail=1
else
  echo "  ✓ no synthesized server-state claim strings"
fi

exit "$fail"
