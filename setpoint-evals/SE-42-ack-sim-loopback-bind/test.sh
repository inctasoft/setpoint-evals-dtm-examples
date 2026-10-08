#!/usr/bin/env bash
# SE-42 — dev-ack-simulator publishes :3003 on loopback only (registry/services.yaml declares
# expose: localhost). Static compose check + a must-fail control: the OLD bare "3003:3001"
# (0.0.0.0) line, fed through the same predicate, must be rejected.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../../scripts/se-lib.sh"
ROOT="$(cd "$HERE/../.." && pwd)"

# bind_of <ports-lines> -> prints the host-IP part of the 3003:3001 publish ("" when bare/absent)
bind_of() { printf '%s\n' "$1" | sed -nE 's/^[[:space:]]*-[[:space:]]*"?(([0-9.]+):)?3003:3001"?.*/\2/p' | head -1; }
published() { printf '%s\n' "$1" | grep -cE '^[[:space:]]*-[[:space:]]*"?([0-9.]+:)?3003:3001' || true; }

block="$(awk '/^  dev-ack-simulator:/{f=1;next} f && /^  [a-zA-Z0-9_-]+:/{f=0} f' "$ROOT/docker-compose.yml")"
ck_has "sanity: dev-ack-simulator block found" "$block" "image: dtm-dev-ack-simulator"
ck_eq "exactly one 3003:3001 publish in the block" "$(published "$block")" "1"
ck_eq "3003:3001 is bound to 127.0.0.1 (not 0.0.0.0)" "$(bind_of "$block")" "127.0.0.1"

# no other compose file publishes 3003 bare
bare="$(grep -hE '^[[:space:]]*-[[:space:]]*"?3003:' "$ROOT"/docker-compose*.yml | wc -l | tr -d ' ')"
ck_eq "no compose file publishes a bare 3003:* (0.0.0.0)" "$bare" "0"

# must-fail control: the pre-fix line is rejected by the same predicate
old='    ports:
      - "3003:3001"'
ck_eq "control: the OLD bare \"3003:3001\" line is detected as wildcard (bind empty)" "$(bind_of "$old")" ""
[ "$(bind_of "$old")" = "127.0.0.1" ] && log_fail "control broken: old line passed the loopback predicate" || { _SE_PASS=$((_SE_PASS+1)); log_pass "control: old line fails the loopback predicate"; }
se_summary
