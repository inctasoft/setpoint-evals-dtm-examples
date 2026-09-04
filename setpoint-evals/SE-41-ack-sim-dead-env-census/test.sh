#!/usr/bin/env bash
# SE-41 — dev-ack-simulator dead-env census, BOTH DIRECTIONS:
#   (a) READS census: nothing in tools/dev-ack-simulator — source tree, entrypoint,
#       Dockerfile, or its dependency manifest (package.json) — reads ANY SUPERTOKENS_*
#       var. A presence-census of the running dtm-dev-ack-simulator container found the
#       3 orchestrator auth vars (SUPERTOKENS_CONNECTION_URI / SUPERTOKENS_API_DOMAIN /
#       SUPERTOKENS_WEBSITE_DOMAIN) in its env while a reads-census found 0 consumers —
#       dead wiring a presence-census mistook for use.
#   (b) WIRING census: the dev-ack-simulator service block in docker-compose.yml carries
#       no SUPERTOKENS_* var and no blanket `env_file: .env` passthrough (the .env is the
#       orchestrator's, and it holds those auth vars). The only .env vars this container
#       legitimately consumes — the bus-profile trio BUS_PROFILE / QUEUE_TRANSPORT /
#       EVENT_BUS — must arrive via EXPLICIT per-var passthroughs, so the zmq bus-profile
#       flows (SE-31..SE-36) keep working without re-leaking the orchestrator's auth env.
# A dynamic leg (only when a local .env + docker compose exist) re-runs the ORIGINAL
# census method — `docker compose config` of the resolved container env — and asserts
# zero SUPERTOKENS_* keys in it. CI has neither (and runs no SE corpus), so the static
# legs carry the verdict everywhere; the dynamic leg is the local proof.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# se-lib: ck/ck_eq/ck_has/ck_file_has/ck_absent (pipefail-safe, mutate counters — never call in $()),
# se_skip (exit 77 sentinel), se_summary. FLAT SE (no suite subdir, like SE-14), so
# se-lib.sh is 2 levels up, not the scaffold's usual 3 — and ROOT is computed directly
# instead of via se_root() (which assumes suite nesting).
. "$HERE/../../scripts/se-lib.sh"
ROOT="$(cd "$HERE/../.." && pwd)"

SIM_DIR="$ROOT/tools/dev-ack-simulator"
COMPOSE_MAIN="$ROOT/docker-compose.yml"
COMPOSE_ZMQ="$ROOT/docker-compose.zmq.yml"

for f in "$COMPOSE_MAIN" "$COMPOSE_ZMQ" "$SIM_DIR/package.json"; do
  [ -f "$f" ] || { log_fail "missing prerequisite: $f"; se_summary; }
done

# --- (a) READS census: 0 consumers of SUPERTOKENS_* in the ack simulator ------
# Case-insensitive grep over the whole service directory (src/, Dockerfile,
# docker-entrypoint.sh, package.json, README, tsconfig) — count MUST be 0.
# (SE-41's own README/test.sh live OUTSIDE $SIM_DIR, so the census can't see itself.)
read_census="$(grep -ri "supertokens" "$SIM_DIR" 2>/dev/null | grep -v '/node_modules/' | wc -l | tr -d ' ')"
ck_eq "(a) reads census: ack-simulator dir has 0 supertokens references (source+manifest)" "$read_census" "0"
ck_absent "(a) dependency manifest declares no supertokens package" "$SIM_DIR/package.json" '"supertokens'

# --- (b) WIRING census: the compose service block carries no SUPERTOKENS_* ----
# Extract the dev-ack-simulator service block from the BASE compose file
# (2-space indented service key → next 2-space key).
sim_block="$(awk '/^  dev-ack-simulator:/{f=1;next} f && /^  [a-zA-Z0-9_-]+:/{f=0} f' "$COMPOSE_MAIN")"
ck_has "(b) sanity: dev-ack-simulator service block found in docker-compose.yml" "$sim_block" "image: dtm-dev-ack-simulator"
ck_str_absent "(b) service block assigns no SUPERTOKENS_* var" "$sim_block" 'SUPERTOKENS_[A-Z_]+'
ck_str_absent "(b) service block has no blanket env_file passthrough (.env = the orchestrator's)" "$sim_block" '^[[:space:]]*env_file:'
# The legitimate .env consumers arrive explicitly (bus-profile shim contract —
# same precedence the orchestrator's zmq merge uses: explicit per-var env wins).
ck_has "(b) BUS_PROFILE arrives via explicit per-var passthrough"      "$sim_block" 'BUS_PROFILE=${BUS_PROFILE'
ck_has "(b) QUEUE_TRANSPORT arrives via explicit per-var passthrough"  "$sim_block" 'QUEUE_TRANSPORT=${QUEUE_TRANSPORT'
ck_has "(b) EVENT_BUS arrives via explicit per-var passthrough"        "$sim_block" 'EVENT_BUS=${EVENT_BUS'

# --- dynamic leg: re-run the original container-env census (local-only) ------
if [ -f "$ROOT/.env" ] && docker compose version >/dev/null 2>&1; then
  resolved="$(cd "$ROOT" && docker compose --profile dev-tools config 2>/dev/null \
    | awk '/^  dev-ack-simulator:/{f=1;next} f && /^  [a-zA-Z0-9_-]+:/{f=0} f')"
  if [ -n "$resolved" ]; then
    resolved_census="$(printf '%s' "$resolved" | grep -c "SUPERTOKENS" || true)"
    ck_eq "dynamic: resolved container env carries 0 SUPERTOKENS_* vars (docker compose config census)" "$resolved_census" "0"
  else
    log_warn "dynamic leg: could not resolve dev-ack-simulator from 'docker compose config' — static legs carry the verdict"
  fi
else
  log_warn "dynamic leg skipped: no local .env and/or docker compose — static legs carry the verdict"
fi

se_summary
