#!/usr/bin/env bash
# validate-seed-data.sh — re-implements SEED-REGISTRY.md as executable
# assertions against the order-processing source DB: table row counts, key
# per-SE rows present, not-found sentinels ABSENT.
#
# Exit 0 = seed matches the registry. Exit 1 = drift detected (see FAIL lines).
#
# Default target is dtm-db — the copy the Lambda workers ACTUALLY read
# (deploy-workers points ORDER_PROCESSING_DB_HOST at dtm-db, seeded by
# scripts/docker/init-all-databases.sh from the same canonical seed file).
# The dedicated dtm-order-processing-source-db container loads the identical
# file; point SEED_CHECK_CONTAINER at it to validate that copy instead.
#
# Target override (used by SE-06's negative control to point this SAME
# script at a throwaway clone database instead of the live one):
#   SEED_CHECK_CONTAINER (default: dtm-db)
#   SEED_CHECK_DB        (default: order_processing_db)
#   SEED_CHECK_USER      (default: order_user)
set -uo pipefail

CONTAINER="${SEED_CHECK_CONTAINER:-dtm-db}"
DB="${SEED_CHECK_DB:-order_processing_db}"
DBUSER="${SEED_CHECK_USER:-order_user}"

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

echo "── order-processing seed validation (container=$CONTAINER db=$DB) ──"

# ── table row counts ────────────────────────────────────────────────────────
check_eq "customers count"   "SELECT count(*) FROM ecommerce.customers"   "13"
check_eq "products count"    "SELECT count(*) FROM ecommerce.products"    "10"
check_eq "orders count"      "SELECT count(*) FROM ecommerce.orders"      "13"
check_eq "order_items count" "SELECT count(*) FROM ecommerce.order_items" "19"
check_eq "payments count"    "SELECT count(*) FROM ecommerce.payments"    "6"
check_eq "shipments count"   "SELECT count(*) FROM ecommerce.shipments"   "6"

# ── per-SE dedicated rows present ───────────────────────────────────────────
check_eq "SE-01 customer 1 (Ada Lovelace) present" \
  "SELECT last_name FROM ecommerce.customers WHERE customer_id=1" "Lovelace"
check_eq "SE-01 order 1 present"     "SELECT count(*) FROM ecommerce.orders WHERE order_id=1" "1"
check_eq "SE-03 customer 6 (Donald Knuth) present" \
  "SELECT last_name FROM ecommerce.customers WHERE customer_id=6" "Knuth"
check_eq "SE-03 order 6 has 6 order_items" \
  "SELECT count(*) FROM ecommerce.order_items WHERE order_id=6" "6"
check_eq "SE-04 customer 7 (Barbara Liskov) present" \
  "SELECT last_name FROM ecommerce.customers WHERE customer_id=7" "Liskov"
check_eq "SE-04 order 7 has zero payments (the story)" \
  "SELECT count(*) FROM ecommerce.payments WHERE order_id=7" "0"
check_eq "SE-04 order 7 HAS a shipment" \
  "SELECT count(*) FROM ecommerce.shipments WHERE order_id=7" "1"
check_eq "SE-05 customer 8 (Radia Perlman) present" \
  "SELECT last_name FROM ecommerce.customers WHERE customer_id=8" "Perlman"
check_eq "SE-05 order 8 has zero order_items (quick-order variant)" \
  "SELECT count(*) FROM ecommerce.order_items WHERE order_id=8" "0"
check_eq "SE-07 customer 10 (Katherine Johnson) present" \
  "SELECT last_name FROM ecommerce.customers WHERE customer_id=10" "Johnson"
check_eq "SE-07 order 10 has zero order_items (quick-order variant)" \
  "SELECT count(*) FROM ecommerce.order_items WHERE order_id=10" "0"
check_eq "SE-08 customer 11 (Hedy Lamarr) present" \
  "SELECT last_name FROM ecommerce.customers WHERE customer_id=11" "Lamarr"
check_eq "SE-09 customer 12 (Dorothy Vaughan) present" \
  "SELECT last_name FROM ecommerce.customers WHERE customer_id=12" "Vaughan"
check_eq "SE-09 customer 13 (Mary Jackson) present" \
  "SELECT last_name FROM ecommerce.customers WHERE customer_id=13" "Jackson"
check_eq "SE-09 order 13 has 2 order_items (optional-cascade-boundary)" \
  "SELECT count(*) FROM ecommerce.order_items WHERE order_id=13" "2"
check_eq "SE-09 order 13 HAS a payment" \
  "SELECT count(*) FROM ecommerce.payments WHERE order_id=13" "1"
check_eq "SE-09 order 13 HAS a shipment" \
  "SELECT count(*) FROM ecommerce.shipments WHERE order_id=13" "1"

# ── not-found sentinels ABSENT ──────────────────────────────────────────────
check_eq "sentinel customer 99999 ABSENT" \
  "SELECT count(*) FROM ecommerce.customers WHERE customer_id=99999" "0"
check_eq "sentinel order 99999 ABSENT" \
  "SELECT count(*) FROM ecommerce.orders WHERE order_id=99999" "0"
check_eq "sentinel product 99999 ABSENT" \
  "SELECT count(*) FROM ecommerce.products WHERE product_id=99999" "0"

echo "──────────────────────────────────────────────────────────────────"
if [ "$FAIL" -eq 0 ]; then
  echo "RESULT: PASS — seed matches SEED-REGISTRY.md"
  exit 0
else
  echo "RESULT: FAIL — seed drifted from SEED-REGISTRY.md (see FAIL lines above)"
  exit 1
fi
