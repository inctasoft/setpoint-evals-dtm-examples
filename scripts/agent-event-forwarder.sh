#!/usr/bin/env bash
# agent-event-forwarder.sh — the Phase-C data path: tail the agent-event/1 journal(s) written
# by server-config's Phase-B emitter (.claude/hooks/emit-agent-event.sh — OPERATOR-GATED, see
# setpoint-evals/agent-event-schema/SPEC.md in server-config) and POST them to the
# orchestrator's ingest endpoint, which validates, aggregates, and fans them out over the
# monitor's WebSocket relay (agent_event + agent_forest).
#
# The journal is the load-bearing artifact; this forwarder is a dumb, restartable pump with
# per-journal byte offsets — killing it loses nothing (offsets re-read on the next pass).
#
# USAGE:
#   agent-event-forwarder.sh --once                 one pass over every journal, then exit
#   agent-event-forwarder.sh --follow [--interval S]  poll forever (default 2s)
# ENV:
#   AGENT_EVENT_ENDPOINT     ingest URL   (default http://localhost:3002/api/v1/agent-events)
#   AGENT_EVENT_JOURNAL_DIR  journal dir  (default ./.agent-journal, repo-local)
#   AGENT_EVENT_STATE_DIR    offset state (default ~/.local/state/agent-event-forwarder)
# EXIT: 0 on a clean pass (journals absent = nothing to do, NOT an error); 1 on usage error.
set -uo pipefail

MODE="--once"; INTERVAL=2
while [ $# -gt 0 ]; do
  case "$1" in
    --once) MODE="--once"; shift ;;
    --follow) MODE="--follow"; shift ;;
    --interval) INTERVAL="$2"; shift 2 ;;
    *) echo "agent-event-forwarder: unknown arg: $1" >&2; exit 1 ;;
  esac
done

ENDPOINT="${AGENT_EVENT_ENDPOINT:-http://localhost:3002/api/v1/agent-events}"
JOURNAL_DIR="${AGENT_EVENT_JOURNAL_DIR:-./.agent-journal}"
STATE_DIR="${AGENT_EVENT_STATE_DIR:-$HOME/.local/state/agent-event-forwarder}"
mkdir -p "$STATE_DIR"

pass() {
  local found=0
  for j in "$JOURNAL_DIR"/agent-events-*.jsonl; do
    [ -e "$j" ] || continue
    found=1
    python3 - "$j" "$STATE_DIR" "$ENDPOINT" <<'PY'
import sys, os, json, hashlib, urllib.request

journal, state_dir, endpoint = sys.argv[1], sys.argv[2], sys.argv[3]
off_file = os.path.join(state_dir, hashlib.sha256(journal.encode()).hexdigest()[:16] + ".off")
try:
    offset = int(open(off_file).read().strip())
except Exception:
    offset = 0
size = os.path.getsize(journal)
if size < offset:  # truncated/rotated: restart from zero (lines are self-contained)
    offset = 0
if size == offset:
    sys.exit(0)
with open(journal) as fh:
    fh.seek(offset)
    lines = [l.strip() for l in fh if l.strip()]
batch = []
for l in lines:
    try:
        batch.append(json.loads(l))
    except Exception:
        continue  # a torn tail line is skipped, never blocks the pump
if batch:
    req = urllib.request.Request(
        endpoint,
        data=json.dumps(batch).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp.read()
    except Exception as e:
        # offset NOT advanced: the next pass retries the whole batch (at-least-once;
        # the aggregator is idempotent over event_id-ordered merges).
        print(f"agent-event-forwarder: POST {endpoint} failed for {os.path.basename(journal)}: {e}", file=sys.stderr)
        sys.exit(0)
with open(off_file, "w") as fh:
    fh.write(str(size))
print(f"agent-event-forwarder: {os.path.basename(journal)}: forwarded {len(batch)} event(s)", file=sys.stderr)
PY
  done
  [ "$found" = 0 ] && echo "agent-event-forwarder: no journals in $JOURNAL_DIR (emitter gated off? nothing to do)" >&2
  return 0
}

if [ "$MODE" = "--once" ]; then
  pass; exit 0
fi
while true; do
  pass
  sleep "$INTERVAL"
done
