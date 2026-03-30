# Order Processing Workflow

E-commerce order processing pipeline demonstrating key DTM capabilities across 6 entity types with foreign key cascading, fan-out, and configurable criticality rules.

## Overview

This workflow models a realistic e-commerce order processing pipeline. A customer places an order containing multiple line items, with associated payment and shipment records. The DTM engine orchestrates the validation and submission of all entities in the correct dependency order, injecting foreign keys as entities are processed.

**Entities**: Customer, Product, Order, LineItem, Payment, Shipment
**Variants**: `default` (full fan-out), `quick-order` (simplified fast-path)

## DTM Capabilities Demonstrated

### 1. Parallel Independent Root Steps

ValidateCustomer and ValidateProduct have no dependencies and run in parallel at job start. This demonstrates the engine's ability to identify and execute independent root nodes in the step DAG concurrently.

### 2. Single-Level Fan-Out

The `DiscoverLineItems` step queries the source database for all line item IDs belonging to an order, then the orchestrator spawns N child step pairs (`ValidateLineItem` -> `SubmitLineItem`), one per discovered item. All child pairs run in parallel.

```
DiscoverLineItems
    |
    +-- ValidateLineItem (item 1) -> SubmitLineItem (item 1)
    +-- ValidateLineItem (item 2) -> SubmitLineItem (item 2)
    +-- ValidateLineItem (item N) -> SubmitLineItem (item N)
```

### 3. Cascade FK Injection

When `SubmitCustomer` completes and is acknowledged, the resulting `ext_customer_id` is injected into the Order entity's submit payload. Similarly, when `SubmitOrder` completes, the `ext_order_id` is injected into LineItem, Payment, and Shipment submit steps.

```
Customer  --[ext_customer_id]--> Order
Order     --[ext_order_id]-----> LineItem, Payment, Shipment
```

### 4. Optional Entities with Criticality Rules

- **Required** (`customer`, `order`): Failure causes the entire job to FAIL.
- **Optional** (`lineItem`, `payment`, `shipment`): Failure causes PARTIAL_SUCCESS, not FAILED.

This allows the engine to complete as much work as possible even when non-critical entities encounter errors.

### 5. Multiple Variants

| Variant        | Description                                          | Steps |
|----------------|------------------------------------------------------|-------|
| `default`      | Full fan-out workflow with all 6 entity types        | 12    |
| `quick-order`  | Simplified fast-path: Customer + Order only, no fan-out | 4  |

The `quick-order` variant strips away discovery, fan-out, and optional entities for fast order processing where only the core customer-order relationship matters.

## Entity Relationship Diagram

```
+-------------------+            +-------------------+
|    customers      |            |     products      |
|-------------------|            |-------------------|
| customer_id  (PK) |            | product_id   (PK) |
| first_name        |            | name              |
| last_name         |            | sku               |
| email             |            | price             |
| phone             |            | category          |
| address           |            | description       |
| created_at        |            | in_stock          |
+--------+----------+            +-------------------+
         |
         | 1:N
         v
+-------------------+
|      orders       |
|-------------------|
| order_id     (PK) |
| customer_id  (FK) |----> customers.customer_id
| order_date        |
| status            |
| total_amount      |
| shipping_address  |
+--------+----------+
         |
         |--- 1:N ---+--- 1:1 ---+--- 1:1 ---+
         |            |           |           |
         v            v           v           v
+----------------+ +----------+ +---------+ +----------+
|  order_items   | | payments | |shipments| |          |
|----------------| |----------| |---------| |          |
| order_item_id  | |payment_id| |shipment_id|          |
| order_id  (FK) | |order_id  | |order_id  |          |
| product_id(FK) | |method    | |carrier   |          |
| quantity       | |amount    | |tracking  |          |
| unit_price     | |status    | |status    |          |
| subtotal       | |txn_ref   | |dates     |          |
+----------------+ +----------+ +----------+          |
         |                                             |
         +---> products.product_id  <------------------+
```

## Step DAG

### Default Variant

```
                  +------------------+     +------------------+
                  | ValidateCustomer |     | ValidateProduct  |
                  +--------+---------+     +------------------+
                           |
               +-----------+-----------+
               |                       |
    +----------v----------+   +--------v--------+
    |   SubmitCustomer    |   | ValidateOrder   |
    +----------+----------+   +--------+--------+
               |                       |
               +-----------+-----------+
                           |
               +-----------+-----------+-----------+
               |           |           |           |
    +----------v--+  +-----v------+ +-v----------+ +--v-----------+
    | SubmitOrder  |  |DiscoverLIs | |ValPayment  | |ValShipment   |
    +----------+--+  +-----+------+ +-----+------+ +------+-------+
               |           |               |              |
               |     +-----+------+  +-----v------+ +----v--------+
               |     | N x child  |  |SubPayment  | |SubShipment  |
               |     | VLI -> SLI |  +------------+ +-------------+
               |     +------------+
               |
    (FK: ext_customer_id injected into Order submit)
    (FK: ext_order_id injected into LineItem, Payment, Shipment submit steps)
```

**Legend**: `DiscoverLIs` = DiscoverLineItems, `VLI` = ValidateLineItem, `SLI` = SubmitLineItem

### Quick-Order Variant

```
    +------------------+
    | ValidateCustomer |
    +--------+---------+
             |
    +--------v---------+     +---------------+
    |  SubmitCustomer   |     | ValidateOrder |
    +--------+---------+     +-------+-------+
             |                       |
             +----------+-----------+
                        |
               +--------v--------+
               |   SubmitOrder   |
               +-----------------+
```

Only 4 steps. No discovery, no fan-out, no optional entities.

## Source Database

**Image**: `postgres:16-alpine`
**Port**: 5449 (host) -> 5432 (container)
**Database**: `order_processing_db`
**User**: `order_user` / `order_pass`

### Tables

| Table             | Records | Description                                  |
|-------------------|---------|----------------------------------------------|
| `dbo.customers`   | 5       | Customer profiles with contact info          |
| `dbo.products`    | 10      | Product catalog with pricing                 |
| `dbo.orders`      | 8       | Orders linked to customers                   |
| `dbo.order_items` | 25      | Line items linking orders to products        |
| `dbo.payments`    | 8       | Payment records (one per order)              |
| `dbo.shipments`   | 6       | Shipment tracking (not all orders shipped)   |

### Seed Data Summary

| Customer ID | Name             | Orders        | Items per Order        |
|-------------|------------------|---------------|------------------------|
| 1           | Sarah Mitchell   | 1, 3          | 3 items, 4 items       |
| 2           | James Rodriguez  | 2, 7          | 4 items, 1 item        |
| 3           | Emily Chen       | 4, 8          | 4 items, 2 items       |
| 4           | Michael Thompson | 5             | 3 items                |
| 5           | Olivia Patel     | 6             | 4 items                |

- Customer 99999 does NOT exist (reserved for negative testing).
- Orders 7 and 8 have `pending` payment status and no shipment tracking yet.

## STE Catalog

| #  | Name                       | Description                                                                 | Expected Status   |
|----|----------------------------|-----------------------------------------------------------------------------|-------------------|
| 01 | Happy Path                 | Standard successful job with default variant, all steps complete            | COMPLETED         |
| 02 | Customer Not Found         | Non-existent customer triggers critical entity failure                       | FAILED            |
| 03 | Fan-Out Line Items         | DiscoverLineItems spawns N child ValidateLineItem/SubmitLineItem pairs      | COMPLETED         |
| 04 | Partial Payment Failure    | SubmitPayment fails permanently; payment is optional                        | PARTIAL_SUCCESS   |
| 05 | Quick-Order Variant        | Simplified quick-order variant with only 4 steps, no fan-out               | COMPLETED         |

### Running STEs

```bash
# Run all order-processing STEs sequentially
./workflows/order-processing/ste/run-all.sh

# Run a specific STE
bash ./workflows/order-processing/ste/01-happy-path/test.sh
bash ./workflows/order-processing/ste/02-customer-not-found/test.sh
bash ./workflows/order-processing/ste/03-fan-out-order-items/test.sh
bash ./workflows/order-processing/ste/04-partial-payment-failure/test.sh
bash ./workflows/order-processing/ste/05-quick-order-variant/test.sh
```

## Running Locally

### Prerequisites

1. Docker and Docker Compose installed
2. The DTM orchestrator and core infrastructure running (see root `README.md`)
3. `jq` and `curl` available on the host

### Start the Source Database

```bash
# From the repository root
docker compose -f workflows/order-processing/docker-compose.order-processing.yml up -d

# Verify it is healthy
docker ps --filter "name=dtm-order-processing-source-db"
```

The database will auto-initialize with schema and seed data from `source-db/init-scripts/01-schema-and-seed.sql`.

### Connect to the Source Database

```bash
# Via docker exec
docker exec -it dtm-order-processing-source-db psql -U order_user -d order_processing_db

# Via psql from host
psql -h localhost -p 5449 -U order_user -d order_processing_db
```

### Deploy Workers

```bash
# Deploy order-processing Lambda workers to LocalStack
./scripts/local-env.sh deploy-workers
```

### Run STEs

```bash
# Run all 5 order-processing STEs
./workflows/order-processing/ste/run-all.sh
```

### Tear Down

```bash
# Stop and remove the source database
docker compose -f workflows/order-processing/docker-compose.order-processing.yml down -v
```

## File Structure

```
workflows/order-processing/
  docker-compose.order-processing.yml   # Source database container
  workflow.config.ts                     # Step DAG, cascades, outcome rules
  package.json                           # Workflow package metadata
  tsconfig.json                          # TypeScript configuration
  source-db/
    init-scripts/
      01-schema-and-seed.sql             # Schema + 52 seed records
    src/                                 # TypeORM entities for source DB
  workers/                               # Lambda worker handlers
  dev-tools/                             # Dev ACK simulator payload generators
  ste/
    shared/
      helpers.sh                         # Workflow-specific STE helpers
    run-all.sh                           # Run all STEs sequentially
    01-happy-path/test.sh                # Happy path test
    02-customer-not-found/test.sh        # Critical entity failure test
    03-fan-out-order-items/test.sh       # Fan-out pattern test
    04-partial-payment-failure/test.sh   # Optional entity failure test
    05-quick-order-variant/test.sh       # Alternative variant test
```
