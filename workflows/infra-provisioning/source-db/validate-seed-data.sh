#!/usr/bin/env bash
# validate-seed-data.sh — re-implements SEED-REGISTRY.md as executable
# assertions against the infra-provisioning source DB: table row counts, key
# per-SE rows present, not-found sentinel ABSENT.
#
# Exit 0 = seed matches the registry. Exit 1 = drift detected (see FAIL lines).
#
# Target override (used by SE-06's negative control to point this SAME
# script at a throwaway clone database instead of the live one):
#   SEED_CHECK_CONTAINER (default: dtm-infra-provisioning-source-db)
#   SEED_CHECK_DB        (default: infra_provisioning_db)
#   SEED_CHECK_USER      (default: infra_user)
set -uo pipefail

CONTAINER="${SEED_CHECK_CONTAINER:-dtm-infra-provisioning-source-db}"
DB="${SEED_CHECK_DB:-infra_provisioning_db}"
DBUSER="${SEED_CHECK_USER:-infra_user}"

FAIL=0

psql_c() {
  docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U "$DBUSER" -d "$DB" -Atc "$1" 2>&1
}

check_eq() {
  local label="$1" sql="$2" expected="$3" actual
  actual="$(psql_c "$sql")"
  if [ "$actual" = "$expected" ]; then
    echo "PASS: $label = $actual"
  else
    echo "FAIL: $label = '$actual' (expected '$expected')"
    FAIL=1
  fi
}

if ! docker exec "$CONTAINER" true >/dev/null 2>&1; then
  echo "FAIL: container '$CONTAINER' is not reachable"
  exit 1
fi

echo "── infra-provisioning seed validation (container=$CONTAINER db=$DB) ──"

# ── table row counts ────────────────────────────────────────────────────────
check_eq "environments count"      "SELECT count(*) FROM dbo.environments"      "2"
check_eq "networks count"          "SELECT count(*) FROM dbo.networks"          "2"
check_eq "compute_instances count" "SELECT count(*) FROM dbo.compute_instances" "8"
check_eq "storage_volumes count"   "SELECT count(*) FROM dbo.storage_volumes"   "8"
check_eq "dns_records count"       "SELECT count(*) FROM dbo.dns_records"       "3"
check_eq "certificates count"      "SELECT count(*) FROM dbo.certificates"      "3"
check_eq "load_balancers count"    "SELECT count(*) FROM dbo.load_balancers"    "3"

# ── each environment has exactly ONE network (PlanNetwork's findOne is
#    only unambiguous if this holds — see "Worker behavior notes") ─────────
check_eq "staging-eu has exactly 1 network" \
  "SELECT count(*) FROM dbo.networks WHERE environment_id='staging-eu'" "1"
check_eq "prod-eu has exactly 1 network" \
  "SELECT count(*) FROM dbo.networks WHERE environment_id='prod-eu'" "1"

# ── per-SE dedicated rows present ───────────────────────────────────────────
check_eq "SE-01/SE-05 environment staging-eu present" \
  "SELECT count(*) FROM dbo.environments WHERE environment_id='staging-eu'" "1"
check_eq "SE-01 instance INST-STAGING-EU-1 present" \
  "SELECT count(*) FROM dbo.compute_instances WHERE instance_id='INST-STAGING-EU-1'" "1"
check_eq "SE-05 instance INST-STAGING-EU-2 present" \
  "SELECT count(*) FROM dbo.compute_instances WHERE instance_id='INST-STAGING-EU-2'" "1"
check_eq "SE-03/SE-04 environment prod-eu present" \
  "SELECT count(*) FROM dbo.environments WHERE environment_id='prod-eu'" "1"
check_eq "SE-03 prod-eu has 6 compute instances (fan-out breadth)" \
  "SELECT count(*) FROM dbo.compute_instances WHERE network_id='NET-PROD-EU-1'" "6"
check_eq "SE-04 DNS-PROD-EU-1 present (PlanDNS must succeed; ApplyDNS fails via testOptions)" \
  "SELECT count(*) FROM dbo.dns_records WHERE record_id='DNS-PROD-EU-1'" "1"

# ── not-found sentinel ABSENT ───────────────────────────────────────────────
check_eq "sentinel environment atlantis-eu ABSENT" \
  "SELECT count(*) FROM dbo.environments WHERE environment_id='atlantis-eu'" "0"

echo "──────────────────────────────────────────────────────────────────"
if [ "$FAIL" -eq 0 ]; then
  echo "RESULT: PASS — seed matches SEED-REGISTRY.md"
  exit 0
else
  echo "RESULT: FAIL — seed drifted from SEED-REGISTRY.md (see FAIL lines above)"
  exit 1
fi
