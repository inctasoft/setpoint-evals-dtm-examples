#!/usr/bin/env bash
# SE-40 — agent-forest schema-conformance, BOTH WAYS: the @dtm/core TS mirror + the
# orchestrator's runtime guards conform to the CANONICAL agent-event/1 schema maintained in a
# sibling private schema-tooling repo — and the canonical fixture corpus proves it in both
# directions:
#   (a) canonical -> TS: every valid fixture PASSES the orchestrator's validateAgentEvent
#       guards; every invalid fixture is REJECTED (incl. a recorded real-world event stream);
#   (b) schema -> mirror: the schema's closed enums (lifecycle, error_reason) all appear in
#       the @dtm/core interface — an enum added canonically but not mirrored fails here.
#
# DISCLAIMER: this SE validates conformance against a canonical schema maintained in a private
# tooling repo; without that sibling checkout it SKIPs by design in this public repo.
# HERMETIC: needs a sibling private-repo checkout; SKIP-77 without it (CI) — never fake-green.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
SC_ROOT="${AGENT_EVENT_SCHEMA_ROOT:-$REPO_ROOT/../server-config/setpoint-evals/agent-event-schema}"
MIRROR="$REPO_ROOT/packages/core/src/interfaces/agent-event.interface.ts"
GUARDS="$REPO_ROOT/services/orchestrator/src/agent-events/agent-event.guards.ts"
fail=0

if [ ! -f "$SC_ROOT/agent-event-1.schema.json" ]; then
  echo "  [SKIP] canonical schema not found at $SC_ROOT — needs a sibling private schema-tooling repo checkout (CI-hermetic); see the SE README disclaimer"
  exit 77
fi
[ -f "$MIRROR" ] || { echo "  ✗ mirror missing: $MIRROR"; exit 1; }
[ -f "$GUARDS" ] || { echo "  ✗ guards missing: $GUARDS"; exit 1; }

ESBUILD="$REPO_ROOT/apps/monitor/node_modules/.bin/esbuild"
[ -x "$ESBUILD" ] || { echo "  ✗ esbuild missing — pnpm install first"; exit 1; }

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

# Bundle the REAL guards (never a copy) to CJS for node.
( cd "$REPO_ROOT/services/orchestrator" && \
  "$ESBUILD" --bundle "$GUARDS" --platform=node --format=cjs --outfile="$tmp/guards.cjs" \
  --external:@nestjs/common --log-level=warning ) || { echo "  ✗ guards bundling failed"; exit 1; }

# (a) canonical fixture corpus vs the TS guards — valid pass, invalid reject, kimi-chain passes.
node - "$tmp/guards.cjs" "$SC_ROOT" <<'EOF' || fail=1
const path = require('path');
const fs = require('fs');
const { validateAgentEvent } = require(process.argv[2]);
const root = process.argv[3];
let bad = 0;
// fixtures/{valid,invalid}/*.json are SINGLE pretty-printed objects (whole-file parse);
// fixtures/streams/*.jsonl are one record per line.
for (const f of fs.readdirSync(path.join(root, 'fixtures/valid'))) {
  const r = validateAgentEvent(JSON.parse(fs.readFileSync(path.join(root, 'fixtures/valid', f), 'utf8')));
  if (!r.ok) { console.error(`  ✗ valid fixture REJECTED: ${f} — ${r.error}`); bad++; }
}
console.log('  ✓ every canonical valid fixture passes the TS guards');
for (const f of fs.readdirSync(path.join(root, 'fixtures/invalid'))) {
  const r = validateAgentEvent(JSON.parse(fs.readFileSync(path.join(root, 'fixtures/invalid', f), 'utf8')));
  if (r.ok) { console.error(`  ✗ invalid fixture ACCEPTED: ${f}`); bad++; }
}
console.log('  ✓ every canonical invalid fixture is rejected by the TS guards');
const lines = (p) => fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.trim());
for (const [i, l] of lines(path.join(root, 'fixtures/streams/kimi-chain.jsonl')).entries()) {
  const r = validateAgentEvent(JSON.parse(l));
  if (!r.ok) { console.error(`  ✗ kimi-chain event REJECTED: line ${i + 1} — ${r.error}`); bad++; }
}
console.log('  ✓ the recorded real-world event stream passes (cross-repo conformance)');
process.exit(bad ? 1 : 0);
EOF

# (b) schema closed enums vs the @dtm/core mirror.
python3 - "$SC_ROOT/agent-event-1.schema.json" "$MIRROR" <<'EOF' || fail=1
import json, sys
schema = json.load(open(sys.argv[1]))
mirror = open(sys.argv[2]).read()
props = schema['properties']
bad = 0
for field in ('lifecycle', 'error_reason'):
    for v in props[field]['enum']:
        if f"'{v}'" not in mirror and f'"{v}"' not in mirror:
            print(f"  ✗ schema {field} value '{v}' missing from the @dtm/core mirror")
            bad += 1
    print(f"  ✓ every schema {field} enum value is mirrored in @dtm/core")
ulid = props['event_id']['pattern']
if '^[0-9A-HJKMNP-TV-Z]{26}$' not in mirror and ulid not in mirror:
    # the mirror documents the pattern in a comment; the guards enforce it — accept either
    import pathlib
    guards = pathlib.Path(sys.argv[2].replace('packages/core/src/interfaces/agent-event.interface.ts',
                                              'services/orchestrator/src/agent-events/agent-event.guards.ts'))
    if '^[0-9A-HJKMNP-TV-Z]{26}$' not in guards.read_text():
        print("  ✗ ULID pattern not enforced in the guards"); bad += 1
    else:
        print("  ✓ ULID pattern enforced by the guards")
else:
    print("  ✓ ULID pattern referenced in the mirror")
sys.exit(1 if bad else 0)
EOF

exit "$fail"
