# order-processing seed registry

Story: **Ada's Beans Cafe**, a specialty coffee roaster. Every customer is a
(real-world) computing pioneer, used here as an obviously-fictional demo
persona — not a real customer of a real coffee company.

This file is the source of truth for "what rows exist and who owns them."
`validate-seed-data.sh` re-implements it as executable assertions; keep the
two in sync when you touch the seed.

## Row ownership (by SE)

| Table | Row(s) | Owner | Notes |
|---|---|---|---|
| customers | `customer_id=1` (Ada Lovelace) | SE-01-happy-path | full default-variant run |
| orders | `order_id=1` | SE-01-happy-path | 2 order_items, 1 payment, 1 shipment — all healthy |
| customers | `customer_id=99999` | SE-02-customer-not-found | **sentinel — must NOT exist** |
| customers | `customer_id=6` (Donald Knuth) | SE-03-fan-out-order-items | |
| orders | `order_id=6` | SE-03-fan-out-order-items | 6 order_items across 6 products — fan-out breadth |
| customers | `customer_id=7` (Barbara Liskov) | SE-04-partial-payment-failure | |
| orders | `order_id=7` | SE-04-partial-payment-failure | 2 order_items, 1 shipment, **0 payments** (see below) |
| customers | `customer_id=8` (Radia Perlman) | SE-05-batch-import-variant | quick-order variant |
| orders | `order_id=8` | SE-05-batch-import-variant | **0** order_items/payments/shipments — quick-order never reads those tables |
| customers | `customer_id=10` (Katherine Johnson) | SE-07-quick-order-variant | quick-order variant, own dedicated rows (not SE-05's) |
| orders | `order_id=10` | SE-07-quick-order-variant | **0** order_items/payments/shipments — quick-order never reads those tables |
| customers | `customer_id=11` (Hedy Lamarr) | SE-08-request-deduplication | quick-order variant, generic workflow endpoint dedup |
| orders | `order_id=11` | SE-08-request-deduplication | **0** order_items/payments/shipments |
| customers | `customer_id=12` (Dorothy Vaughan) | SE-09-optional-cascade-boundary (part B) | quick-order variant — SubmitOrder exhausts retries → required cascade FAILED |
| orders | `order_id=12` | SE-09-optional-cascade-boundary (part B) | **0** order_items/payments/shipments |
| customers | `customer_id=13` (Mary Jackson) | SE-09-optional-cascade-boundary (part A) | default variant — line items forced to fail → optional cascade PARTIAL_SUCCESS |
| orders | `order_id=13` | SE-09-optional-cascade-boundary (part A) | 2 order_items, 1 payment, 1 shipment — all healthy; only lineItem forced to fail |

## Payment/shipment lookup quirk (worker behavior, not seed behavior)

`ValidatePayment` and `ValidateShipment` (`workers/src/handlers/validate-{payment,shipment}.ts`)
filter their tables by **`order_id`**, using whatever numeric value arrives in
`payload.paymentId` / `payload.shipmentId` respectively — NOT by the
payment/shipment row's own primary key. So to make a payment/shipment
validation **succeed** for order N, the job payload must set
`paymentId: N` / `shipmentId: N` (matching a real row whose `order_id = N`).
To make one **fail**, set it to a value with no matching `order_id` — this
registry reserves `99999` for that (see sentinels below). SE-04 exploits
this deliberately: order 7 legitimately has zero payment rows, so
`paymentId: 99999` and `paymentId: 7` would BOTH fail the lookup; we use
`99999` to keep the sentinel convention uniform across every not-found case.

## General story rows (not owned by any single SE — free to read, never delete)

| Table | Rows | Story |
|---|---|---|
| customers | 2 (Grace Hopper), 3 (Alan Turing), 4 (Margaret Hamilton), 5 (Edsger Dijkstra), 9 (Linus Torvalds) | general demo/dashboard fill |
| orders | 2, 3, 4, 5, 9 | delivered / shipped / confirmed / pending — status variety for dashboards |
| products | 1-10 | the full Ada's Beans Cafe menu |

## Reserved ranges (future SEs — do NOT reuse)

| Table | Range | |
|---|---|---|
| customers | `14-19` | reserved (10-13 consumed by SE-07/08/09, Phase 3b) |
| products | `11-19` | reserved |
| orders | `14-19` | reserved (10-13 consumed by SE-07/08/09, Phase 3b) |
| order_items / payments / shipments | next sequential id after the current max | reserved (no fixed range — these are child rows) |

## Not-found sentinels (guaranteed ABSENT — used for negative-path SEs)

| Entity | Sentinel value |
|---|---|
| customer_id | `99999` |
| product_id | `99999` |
| order_id | `99999` |
| paymentId / shipmentId (order_id lookup) | `99999` |

## Row counts (as of this seed)

| Table | Count |
|---|---|
| customers | 13 |
| products | 10 |
| orders | 13 |
| order_items | 19 |
| payments | 6 |
| shipments | 6 |

## Validator

`bash source-db/validate-seed-data.sh` — asserts the counts and key rows
above against `dtm-db` by default — the copy the Lambda workers actually
read (both it and the dedicated `dtm-order-processing-source-db` container
load this same canonical seed file; override with SEED_CHECK_CONTAINER to
validate the dedicated container instead).
Wired as its own eval: `setpoint-evals/SE-06-seed-data-integrity/`.
