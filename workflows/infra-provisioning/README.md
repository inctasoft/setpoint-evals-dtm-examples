# Infrastructure Provisioning Workflow

Infrastructure provisioning pipeline demonstrating deep cascade FK chains, long ACK timeouts, wide parallel branches after a bottleneck, cascade failure propagation with SKIPPED status, and fan-out compute provisioning across 7 entity types.

## Overview

This workflow models a realistic infrastructure provisioning pipeline. An environment is provisioned with networking, compute instances (fan-out), storage volumes, DNS records, TLS certificates, and load balancers. The DTM engine orchestrates the planning and applying of all entities in the correct dependency order, injecting foreign keys as entities cascade through a 5-level deep chain.

**Entities**: Environment, Network, ComputeInstance, StorageVolume, DnsRecord, Certificate, LoadBalancer
**Variants**: `default` (full provisioning workflow with all entities and fan-out compute)

## DTM Capabilities Demonstrated

### 1. Deep Cascade FK Chains (5 Levels)

The infra-provisioning workflow has the deepest FK chain in the DTM system:

```
Environment -> Network -> Compute -> DNS -> Certificate
    (1)          (2)        (3)       (4)       (5)
```

Each level depends on the previous entity's apply step completing and being acknowledged before the next entity's plan can begin. This exercises the cascade FK injection system through 5 successive levels.

### 2. Long ACK Timeouts

ApplyCompute has a 600000ms (10-minute) ACK timeout configured in `metadata.timeoutMs`. This simulates real-world cloud provisioning where creating EC2 instances, configuring security groups, and waiting for health checks can take many minutes. The DTM engine must keep the step in WAITING_FOR_ACK state without timing out prematurely.

### 3. Wide Parallel Branches After Bottleneck

After the Compute bottleneck (fan-out), three independent entity branches run in parallel:

```
ApplyCompute (bottleneck)
    |
    +-- PlanStorage -> ApplyStorage               (branch 1)
    +-- PlanDNS -> ApplyDNS -> ...                (branch 2)
    +-- PlanLoadBalancer -> ApplyLoadBalancer      (branch 3)
```

This tests the engine's ability to fan out from a single dependency into multiple parallel branches.

### 4. Cascade Failure Propagation (SKIPPED Status)

When ApplyDNS fails, the downstream Certificate entity is automatically SKIPPED because it depends on DNS. However, Storage and LoadBalancer are independent of DNS, so they continue executing. This results in a PARTIAL_SUCCESS job status rather than FAILED, because DNS and Certificate are optional entities.

### 5. Fan-Out Compute Provisioning

The `DiscoverCompute` step queries for all compute instance IDs in a network, and the orchestrator spawns N child step pairs (`PlanCompute` -> `ApplyCompute`), one per instance. All child pairs run in parallel.

```
DiscoverCompute
    |
    +-- PlanCompute (INST-PROD-EU-1) -> ApplyCompute (INST-PROD-EU-1)
    +-- PlanCompute (INST-PROD-EU-2) -> ApplyCompute (INST-PROD-EU-2)
    +-- PlanCompute (INST-N)         -> ApplyCompute (INST-N)
```

## Entity Relationship Diagram

```
+-------------------+
|   environments    |
|-------------------|
| environment_id(PK)|
| name              |
| type              |
| region            |
| account_id        |
| status            |
| created_at        |
+--------+----------+
         |
         | 1:N
         v
+-------------------+
|     networks      |
|-------------------|
| network_id   (PK) |
| environment_id(FK)|----> environments.environment_id
| name              |
| vpc_cidr          |
| subnet_cidr       |
| availability_zone |
| status            |
| created_at        |
+--------+----------+
         |
         | 1:N
         v
+------------------------+
|   compute_instances    |
|------------------------|
| instance_id       (PK) |
| network_id        (FK) |----> networks.network_id
| name                   |
| instance_type          |
| ami_id                 |
| status                 |
| public_ip              |
| private_ip             |
| created_at             |
+--------+-------+------+
         |       |       |
    1:N  |  1:N  |  1:N  |
         v       v       v
+------------+ +----------+ +---------------+
|  storage   | |   dns    | | load_balancers|
|  _volumes  | | _records | |               |
|------------| |----------| |---------------|
|volume_id PK| |record_id | |lb_id      (PK)|
|instance_id | |network_id| |network_id (FK)|
|name        | |instance  | |instance_id(FK)|
|size_gb     | |_id       | |name           |
|volume_type | |hostname  | |type           |
|iops        | |record    | |port           |
|status      | |_type     | |protocol       |
|attached_at | |value     | |health_check   |
+------------+ |ttl       | |_path          |
               |status    | |status         |
               +-----+----+ |created_at     |
                     |       +---------------+
                     | 1:N
                     v
              +---------------+
              |  certificates |
              |---------------|
              |certificate_id |
              |dns_record_id  |----> dns_records.record_id
              |domain         |
              |issuer         |
              |status         |
              |issued_at      |
              |expires_at     |
              |created_at     |
              +---------------+
```

## Step DAG

### Default Variant

```
    +---------------------+
    |  PlanEnvironment    |
    +----------+----------+
               |
    +----------v-----------+
    |  ApplyEnvironment   |  (ACK required)
    +----------+-----------+
               |
    +----------v----------+
    |    PlanNetwork      |
    +----------+----------+
               |
    +----------v-----------+
    |   ApplyNetwork      |  (ACK required)
    +----------+-----------+
               |
    +----------v-----------+
    |   DiscoverCompute   |  (fan-out)
    +----------+-----------+
               |
    +----------v-----------+
    | N x child steps:     |
    | PlanCompute(i)       |
    |   -> ApplyCompute(i) |  (ACK, long timeout 600s)
    +----------+-----------+
               |
    +----------+----------+-----------+
    |                     |           |
    v                     v           v
+--------+         +---------+   +----------+
| Plan   |         |  Plan   |   |Plan      |
|Storage |         |   DNS   |   |LoadBal.  |
+---+----+         +----+----+   +----+-----+
    |                   |             |
+---v-----+        +----v----+   +----v------+
| Apply   |        | Apply   |   | Apply     |
|Storage  |        |  DNS    |   |LoadBal.   |
|(ACK)    |        | (ACK)   |   |(ACK)      |
+---------+        +----+----+   +-----------+
                        |
                   +----v--------+
                   |   Plan      |
                   | Certificate |
                   +----+--------+
                        |
                   +----v--------+
                   |   Apply     |
                   | Certificate |
                   |   (ACK)     |
                   +-------------+
```

**Legend**: Steps marked `(ACK)` require acknowledgement via Kafka before the job can complete.

## Step Descriptions

| Step                   | Type      | Description                                                        |
|------------------------|-----------|--------------------------------------------------------------------|
| PlanEnvironment        | Plan      | Read environment config from source DB, build provisioning plan    |
| ApplyEnvironment       | Apply     | Provision environment in target infrastructure (ACK required)      |
| PlanNetwork            | Plan      | Read VPC/subnet config from source DB, build network plan          |
| ApplyNetwork           | Apply     | Provision VPC, subnets, and security groups (ACK required)         |
| DiscoverCompute        | Discovery | Find compute instance IDs for a network (fan-out)                 |
| PlanCompute            | Plan      | Read one compute instance config, build instance plan              |
| ApplyCompute           | Apply     | Launch compute instance, wait for health check (ACK, 600s timeout) |
| PlanStorage            | Plan      | Read storage volume config, build volume plan                      |
| ApplyStorage           | Apply     | Attach and mount storage volume to instance (ACK required)         |
| PlanDNS                | Plan      | Read DNS record config, build DNS change plan                      |
| ApplyDNS               | Apply     | Create/update DNS records in hosted zone (ACK required)            |
| PlanCertificate        | Plan      | Read TLS certificate config, build certificate request plan        |
| ApplyCertificate       | Apply     | Issue and validate TLS certificate (ACK required)                  |
| PlanLoadBalancer       | Plan      | Read load balancer config, build target group plan                 |
| ApplyLoadBalancer      | Apply     | Create load balancer, register targets, configure health (ACK)     |

## Source Database

**Image**: `postgres:16-alpine`
**Port**: 5451 (host) -> 5432 (container)
**Database**: `infra_provisioning_db`
**User**: `infra_user` / `infra_pass`

### Tables

| Table                   | Records | Description                                    |
|-------------------------|---------|------------------------------------------------|
| `dbo.environments`      | 2       | Environment configs (staging-eu, prod-eu)      |
| `dbo.networks`          | 2       | VPC/subnet configurations (1 per environment)  |
| `dbo.compute_instances` | 8       | EC2-like compute instances                     |
| `dbo.storage_volumes`   | 8       | EBS-like storage volumes (1 per instance)      |
| `dbo.dns_records`       | 3       | DNS A records                                  |
| `dbo.certificates`      | 3       | TLS certificates linked to DNS records         |
| `dbo.load_balancers`    | 3       | ALB load balancer configs                      |

### Seed Data Summary — two European regions

`staging-eu` and `prod-eu`. Full row->SE ownership map:
[`source-db/SEED-REGISTRY.md`](source-db/SEED-REGISTRY.md) — including why
compute instances are shared per-environment (`PlanNetwork` resolves by
`environment_id`) while storage/DNS/certificate/load-balancer chains are
genuinely per-SE isolated (addressed by explicit payload IDs).

| Environment | Network         | Compute Instances                                     | Owning SE(s) |
|-------------|-----------------|--------------------------------------------------------|--------------|
| staging-eu  | NET-STAGING-EU-1| INST-STAGING-EU-1 (web), INST-STAGING-EU-2 (api)        | SE-01 (inst 1), SE-05 (inst 2) |
| prod-eu     | NET-PROD-EU-1   | INST-PROD-EU-1..6 (web x2, api x2, worker, cache)       | SE-03 (fan-out over all 6), SE-04 (inst 1's DNS chain) |

- `atlantis-eu` does NOT exist (reserved not-found sentinel).
- DNS/certificate/load-balancer chains exist for INST-STAGING-EU-1,
  INST-STAGING-EU-2, and INST-PROD-EU-1 only — instances 2-6 in prod-eu
  exist purely for fan-out breadth (SE-03) and are never addressed by an
  explicit payload ID.

## Entity Criticality

| Entity       | Criticality | Notes                                     |
|--------------|-------------|-------------------------------------------|
| environment  | required    | Job fails if environment planning fails    |
| network      | required    | Job fails if network planning fails        |
| compute      | required    | Job fails if no compute instances found    |
| storage      | optional    | Partial success if storage fails           |
| dns          | optional    | Partial success if DNS fails               |
| certificate  | optional    | Partial success (or SKIPPED if DNS failed) |
| loadBalancer | optional    | Partial success if load balancer fails     |

## SE Catalog

| #  | Name                         | Description                                                                     | Expected Status   |
|----|------------------------------|---------------------------------------------------------------------------------|-------------------|
| 01 | Happy Path                   | Full provisioning with all 7 entity types, fan-out compute, all ACKs succeed    | COMPLETED         |
| 02 | Environment Not Found        | Non-existent environment triggers critical entity failure                        | FAILED            |
| 03 | Compute Fan-Out              | DiscoverCompute spawns N PlanCompute/ApplyCompute child pairs in parallel        | COMPLETED         |
| 04 | Cascade Failure Propagation  | DNS fails -> Certificate SKIPPED, but Storage succeeds -> PARTIAL_SUCCESS       | PARTIAL_SUCCESS   |
| 05 | Long ACK Wait                | ApplyCompute enters WAITING_FOR_ACK, ACK arrives after 5s delay                 | COMPLETED         |
| 06 | Seed Data Integrity          | `validate-seed-data.sh` passes against the real seed and catches a deleted row  | PASS (validator)  |

### Running SEs

```bash
# Run all infra-provisioning SEs sequentially
./workflows/infra-provisioning/setpoint-evals/run-all.sh

# Run a specific SE
./workflows/infra-provisioning/setpoint-evals/run-all.sh --se 01
./workflows/infra-provisioning/setpoint-evals/run-all.sh --se 02
./workflows/infra-provisioning/setpoint-evals/run-all.sh --se 03
./workflows/infra-provisioning/setpoint-evals/run-all.sh --se 04
./workflows/infra-provisioning/setpoint-evals/run-all.sh --se 05
```

## Running Locally

### Prerequisites

1. Docker and Docker Compose installed
2. The DTM orchestrator and core infrastructure running (see root `README.md`)
3. `jq` and `curl` available on the host

### Start the Source Database

```bash
# From the repository root
docker compose -f workflows/infra-provisioning/docker-compose.infra-provisioning.yml up -d

# Verify it is healthy
docker ps --filter "name=dtm-infra-provisioning-source-db"
```

The database will auto-initialize with schema and seed data from `source-db/init-scripts/01-schema-and-seed.sql`.

### Connect to the Source Database

```bash
# Via docker exec
docker exec -it dtm-infra-provisioning-source-db psql -U infra_user -d infra_provisioning_db

# Via psql from host
psql -h localhost -p 5451 -U infra_user -d infra_provisioning_db
```

### Deploy Workers

```bash
# Deploy infra-provisioning Lambda workers to LocalStack
./scripts/local-env.sh deploy-workers
```

### Run SEs

```bash
# Run all 6 infra-provisioning SEs
./workflows/infra-provisioning/setpoint-evals/run-all.sh
```

### Tear Down

```bash
# Stop and remove the source database
docker compose -f workflows/infra-provisioning/docker-compose.infra-provisioning.yml down -v
```

## File Structure

```
workflows/infra-provisioning/
  docker-compose.infra-provisioning.yml   # Source database container
  workflow.config.ts                       # Step DAG, cascades, outcome rules
  README.md                                # This file
  source-db/
    init-scripts/
      01-schema-and-seed.sql               # Schema + 25 seed records
    src/                                   # TypeORM entities for source DB
      entities/
        environment.entity.ts
        network.entity.ts
        compute-instance.entity.ts
        storage-volume.entity.ts
        dns-record.entity.ts
        certificate.entity.ts
        load-balancer.entity.ts
        index.ts
      config/
        datasource.ts
      index.ts
  workers/                                 # Lambda worker handlers
    package.json
    tsconfig.json
    esbuild.config.js
    src/
      index.ts                             # Handler map + exports
      handlers/
        plan-environment.ts
        apply-environment.ts
        plan-network.ts
        apply-network.ts
        discover-compute.ts
        plan-compute.ts
        apply-compute.ts
        plan-storage.ts
        apply-storage.ts
        plan-dns.ts
        apply-dns.ts
        plan-certificate.ts
        apply-certificate.ts
        plan-load-balancer.ts
        apply-load-balancer.ts
  setpoint-evals/
    shared/
      helpers.sh                           # Workflow-specific SE helpers
    run-all.sh                             # Run all SEs sequentially
    01-happy-path/test.sh                  # Happy path test
    02-environment-not-found/test.sh       # Critical entity failure test
    03-compute-fan-out/test.sh             # Fan-out pattern test
    04-cascade-failure-propagation/test.sh # Cascade failure/SKIPPED test
    05-long-ack-wait/test.sh               # Long ACK timeout test
```
