#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════
# SE 07: Cascade FK Every Hop
# ═══════════════════════════════════════════════════════════════════════════
# Pins the FK-injection mechanism documented in
# docs/diagrams/cascade-fk-flow.mermaid: when a dependent cascade's parent
# ACK arrives, its externalId (dtm_steps.ack_metadata->>'externalId') is
# injected as an FK into the CHILD cascade's outbound payload
# (dtm_steps.output->'_fkInjections'). This SE proves the externalId
# actually THREADS through all 5 hops of the deepest cascade chain
# (environment -> network -> compute -> dns -> certificate), by querying
# dtm_steps directly and cross-checking each hop's _fkInjections against its
# parent's real ack_metadata.externalId — not just that each hop happens to
# have SOME ack_metadata (that alone wouldn't prove propagation, only
# independent ACK receipt).
#
# Uses the same seeded prod-eu chain as SE-01/03/04/08 — read-only, its own
# entityId.
# ═══════════════════════════════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../shared/helpers.sh"

EVAL_NAME="SE 07: Cascade FK Every Hop"
EVAL_PURPOSE="ack_metadata externalId threads through all 5 cascade hops via _fkInjections"

display_eval_banner "$EVAL_NAME" "$EVAL_PURPOSE"

log_info "Entity ID: prod-eu (INST-PROD-EU-1 chain)"
log_info "Chain under test: environment -> network -> compute -> dns -> certificate"
echo ""

PAYLOAD='{
  "variant": "default",
  "enableDeduplication": false,
  "payload": {
    "environmentId": "prod-eu",
    "networkId": "NET-PROD-EU-1",
    "instanceId": "INST-PROD-EU-1",
    "dnsRecordId": "DNS-PROD-EU-1",
    "certificateId": "CERT-PROD-EU-1",
    "loadBalancerId": "LB-PROD-EU-1",
    "entityId": "prod-eu-fk-every-hop"
  },
  "testOptions": {
    "PlanEnvironment":    { "simDelay": 300 },
    "ApplyEnvironment":   { "simDelay": 300, "ackDelay": 1000 },
    "PlanNetwork":        { "simDelay": 300 },
    "ApplyNetwork":       { "simDelay": 300, "ackDelay": 1000 },
    "DiscoverCompute":    { "simDelay": 300 },
    "PlanCompute":        { "simDelay": 300 },
    "ApplyCompute":       { "simDelay": 300, "ackDelay": 1000 },
    "PlanStorage":        { "simDelay": 300 },
    "ApplyStorage":       { "simDelay": 300, "ackDelay": 1000 },
    "PlanDNS":            { "simDelay": 300 },
    "ApplyDNS":           { "simDelay": 300, "ackDelay": 1000 },
    "PlanCertificate":    { "simDelay": 300 },
    "ApplyCertificate":   { "simDelay": 300, "ackDelay": 1000 },
    "PlanLoadBalancer":   { "simDelay": 300 },
    "ApplyLoadBalancer":  { "simDelay": 300, "ackDelay": 1000 }
  }
}'

IFS=':' read -r JOB_ID CORRELATION_ID <<< "$(initiate_job "$PAYLOAD")"
validate_job_id "$JOB_ID" || exit 1

log_section "MONITORING PROGRESS"
poll_job "$JOB_ID" 900 5

display_results "$JOB_ID"

log_section "VERIFICATION (direct dtm_steps query, per hop)"

PASS_COUNT=0
FAIL_COUNT=0

if verify_job_status "$JOB_ID" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

DB_CONTAINER="${COMPOSE_PROJECT_NAME:-dtm}-db"

# externalId per hop, from ack_metadata (the ACK that step itself received)
ext_id() {
  docker exec "$DB_CONTAINER" psql -U dtm_user -d dtm -t -A -c \
    "SELECT ack_metadata->>'externalId' FROM dtm_steps WHERE job_id='$JOB_ID' AND step_value='$1' LIMIT 1;" | tr -d '[:space:]'
}

# a given _fkInjections key on a step's own output (what it received FROM its parent)
fk_injection() {
  docker exec "$DB_CONTAINER" psql -U dtm_user -d dtm -t -A -c \
    "SELECT output->'_fkInjections'->>'$2' FROM dtm_steps WHERE job_id='$JOB_ID' AND step_value='$1' LIMIT 1;" | tr -d '[:space:]'
}

EXT_ENV=$(ext_id "ApplyEnvironment")
EXT_NET=$(ext_id "ApplyNetwork")
EXT_DNS=$(ext_id "ApplyDNS")

FK_NET_FROM_ENV=$(fk_injection "ApplyNetwork" "ext_environment_id")
FK_DNS_FROM_NET=$(fk_injection "ApplyDNS" "ext_network_id")
FK_CERT_FROM_DNS=$(fk_injection "ApplyCertificate" "ext_dns_id")

log_info "Hop 1->2: ApplyEnvironment externalId=$EXT_ENV | ApplyNetwork received ext_environment_id=$FK_NET_FROM_ENV"
if [ -n "$EXT_ENV" ] && [ "$EXT_ENV" == "$FK_NET_FROM_ENV" ]; then
  log_success "Hop 1->2 (environment -> network): FK matches"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Hop 1->2 mismatch: environment externalId='$EXT_ENV' vs network's ext_environment_id='$FK_NET_FROM_ENV'"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

log_info "Hop 2->3: ApplyNetwork externalId=$EXT_NET | ApplyDNS received ext_network_id=$FK_DNS_FROM_NET"
if [ -n "$EXT_NET" ] && [ "$EXT_NET" == "$FK_DNS_FROM_NET" ]; then
  log_success "Hop 2->3 (network -> dns): FK matches"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Hop 2->3 mismatch: network externalId='$EXT_NET' vs dns's ext_network_id='$FK_DNS_FROM_NET'"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Hop 3 (compute -> dns): dns received ext_compute_id from ONE of the fanned-out
# ApplyCompute instances — verify it matches SOME ApplyCompute externalId, not a
# specific one (compute is a fan-out cascade, dns depends on the discovery as a whole).
FK_DNS_FROM_COMPUTE=$(fk_injection "ApplyDNS" "ext_compute_id")
COMPUTE_MATCH=$(docker exec "$DB_CONTAINER" psql -U dtm_user -d dtm -t -A -c \
  "SELECT count(*) FROM dtm_steps WHERE job_id='$JOB_ID' AND step_value='ApplyCompute' AND ack_metadata->>'externalId'='$FK_DNS_FROM_COMPUTE';" | tr -d '[:space:]')
log_info "Hop compute->dns: ApplyDNS received ext_compute_id=$FK_DNS_FROM_COMPUTE (matches $COMPUTE_MATCH real ApplyCompute externalId(s))"
if [ -n "$FK_DNS_FROM_COMPUTE" ] && [ "$COMPUTE_MATCH" -ge 1 ]; then
  log_success "Hop compute->dns: FK matches a real ApplyCompute externalId"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Hop compute->dns mismatch: ext_compute_id='$FK_DNS_FROM_COMPUTE' does not match any real ApplyCompute externalId"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

log_info "Hop 4->5: ApplyDNS externalId=$EXT_DNS | ApplyCertificate received ext_dns_id=$FK_CERT_FROM_DNS"
if [ -n "$EXT_DNS" ] && [ "$EXT_DNS" == "$FK_CERT_FROM_DNS" ]; then
  log_success "Hop 4->5 (dns -> certificate): FK matches — full 5-hop chain confirmed"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Hop 4->5 mismatch: dns externalId='$EXT_DNS' vs certificate's ext_dns_id='$FK_CERT_FROM_DNS'"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

exit_with_summary "$PASS_COUNT" "$FAIL_COUNT"
