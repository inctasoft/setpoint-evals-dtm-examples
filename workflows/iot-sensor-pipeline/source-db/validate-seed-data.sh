#!/usr/bin/env bash
# validate-seed-data.sh — re-implements SEED-REGISTRY.md as executable
# assertions against the iot-sensor-pipeline source DB: table row counts, key
# per-SE rows present, not-found sentinel ABSENT.
#
# Exit 0 = seed matches the registry. Exit 1 = drift detected (see FAIL lines).
#
# Target override (used by SE-06's negative control to point this SAME
# script at a throwaway clone database instead of the live one):
#   SEED_CHECK_CONTAINER (default: dtm-iot-sensor-pipeline-source-db)
#   SEED_CHECK_DB        (default: iot_sensor_pipeline_db)
#   SEED_CHECK_USER      (default: iot_user)
set -uo pipefail

CONTAINER="${SEED_CHECK_CONTAINER:-dtm-iot-sensor-pipeline-source-db}"
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
check_eq "devices count"    "SELECT count(*) FROM dbo.devices"    "5"
check_eq "sensors count"    "SELECT count(*) FROM dbo.sensors"    "10"
check_eq "readings count"   "SELECT count(*) FROM dbo.readings"   "54"
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
