#!/usr/bin/env bash
# validate-seed-data.sh — re-implements SEED-REGISTRY.md as executable
# assertions against the iot-sensor-pipeline source DB: table row counts, key
# per-SE rows present, not-found sentinel ABSENT.
#
# Exit 0 = seed matches the registry. Exit 1 = drift detected (see FAIL lines).
#
# Default target is dtm-db — the copy the Lambda workers ACTUALLY read
# (deploy-workers points IOT_SENSOR_DB_HOST at dtm-db, seeded by
# scripts/docker/init-all-databases.sh from the same canonical seed file).
# The dedicated dtm-iot-sensor-pipeline-source-db container loads the identical
# file; point SEED_CHECK_CONTAINER at it to validate that copy instead.
#
# Target override (used by SE-06's negative control to point this SAME
# script at a throwaway clone database instead of the live one):
#   SEED_CHECK_CONTAINER (default: dtm-db)
#   SEED_CHECK_DB        (default: iot_sensor_pipeline_db)
#   SEED_CHECK_USER      (default: iot_user)
set -uo pipefail

CONTAINER="${SEED_CHECK_CONTAINER:-dtm-db}"
DB="${SEED_CHECK_DB:-iot_sensor_pipeline_db}"
DBUSER="${SEED_CHECK_USER:-iot_user}"

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

echo "── iot-sensor-pipeline seed validation (container=$CONTAINER db=$DB) ──"

# ── table row counts ────────────────────────────────────────────────────────
check_eq "devices count"    "SELECT count(*) FROM dbo.devices"    "6"
check_eq "sensors count"    "SELECT count(*) FROM dbo.sensors"    "12"
check_eq "readings count"   "SELECT count(*) FROM dbo.readings"   "60"
check_eq "alerts count"     "SELECT count(*) FROM dbo.alerts"     "1"
check_eq "aggregates count" "SELECT count(*) FROM dbo.aggregates" "9"

# ── per-SE dedicated rows present ───────────────────────────────────────────
check_eq "SE-01 device greenhouse-1 present" \
  "SELECT count(*) FROM dbo.devices WHERE device_id='greenhouse-1'" "1"
check_eq "SE-03 device greenhouse-3 present" \
  "SELECT count(*) FROM dbo.devices WHERE device_id='greenhouse-3'" "1"
check_eq "SE-03 greenhouse-3 has 3 sensors (fan-out breadth)" \
  "SELECT count(*) FROM dbo.sensors WHERE device_id='greenhouse-3'" "3"
check_eq "SE-04 device greenhouse-4 present" \
  "SELECT count(*) FROM dbo.devices WHERE device_id='greenhouse-4'" "1"
check_eq "SE-04 greenhouse-4 has the heat-spike alert" \
  "SELECT count(*) FROM dbo.alerts WHERE device_id='greenhouse-4'" "1"
check_eq "SE-05 device greenhouse-offline present" \
  "SELECT count(*) FROM dbo.devices WHERE device_id='greenhouse-offline'" "1"
check_eq "SE-05 greenhouse-offline has exactly 1 sensor" \
  "SELECT count(*) FROM dbo.sensors WHERE device_id='greenhouse-offline'" "1"
check_eq "SE-05 that sensor has ZERO readings (the story)" \
  "SELECT count(*) FROM dbo.readings WHERE sensor_id='SENS-GHOFF-TEMP'" "0"
check_eq "SE-09 device greenhouse-5 present" \
  "SELECT count(*) FROM dbo.devices WHERE device_id='greenhouse-5'" "1"
check_eq "SE-09 greenhouse-5 has exactly 2 sensors" \
  "SELECT count(*) FROM dbo.sensors WHERE device_id='greenhouse-5'" "2"
check_eq "SE-09 SENS-GH5-TEMP has 6 real readings (the sibling WITH data)" \
  "SELECT count(*) FROM dbo.readings WHERE sensor_id='SENS-GH5-TEMP'" "6"
check_eq "SE-09 SENS-GH5-SOIL has ZERO readings (the mixed inner-empty case)" \
  "SELECT count(*) FROM dbo.readings WHERE sensor_id='SENS-GH5-SOIL'" "0"

# ── not-found sentinel ABSENT ───────────────────────────────────────────────
check_eq "sentinel device greenhouse-999 ABSENT" \
  "SELECT count(*) FROM dbo.devices WHERE device_id='greenhouse-999'" "0"

echo "──────────────────────────────────────────────────────────────────"
if [ "$FAIL" -eq 0 ]; then
  echo "RESULT: PASS — seed matches SEED-REGISTRY.md"
  exit 0
else
  echo "RESULT: FAIL — seed drifted from SEED-REGISTRY.md (see FAIL lines above)"
  exit 1
fi
