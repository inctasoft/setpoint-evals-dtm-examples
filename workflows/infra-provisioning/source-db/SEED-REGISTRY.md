# infra-provisioning seed registry

Story: two European regions, **staging-eu** and **prod-eu** — obviously a
demo fixture (RFC 2606 `.example.com` / `.internal.example.com` hostnames
throughout), not a real deployment.

This file is the source of truth for "what rows exist and who owns them."
`validate-seed-data.sh` re-implements it as executable assertions; keep the
two in sync when you touch the seed.

## Worker behavior notes (why the rows are shaped this way — read this first)

- `PlanNetwork` looks up `networks` by **`environment_id`** with TypeORM
  `findOne` (`workers/src/handlers/plan-network.ts`) — NOT by a `networkId`
  in the payload (that field is accepted but unused for this step). An
  environment with more than one network would make the result
  implementation-defined. **Each environment therefore has exactly ONE
  network.**
- `PlanStorage`, `PlanDNS`, `PlanCertificate`, `PlanLoadBalancer` all read
  their row via an **explicit ID taken directly from the job payload**
  (`instanceId`, `dnsRecordId`, `certificateId`, `loadBalancerId`) — they are
  NOT fanned from the compute discovery. Only `compute` fans out
  (`DiscoverCompute`, by `network_id`).
- **Practical consequence for isolation:** compute instances are **shared
  per-environment** (every job against an environment fans out over ALL of
  that environment's instances) — true per-SE isolation only exists for the
  explicit-ID entities (storage/dns/certificate/load_balancer), because those
  are the only ones addressed by a payload-supplied ID rather than discovery.
  SE-03 and SE-04 both target `prod-eu`'s only fully-chained instance
  (`INST-PROD-EU-1`) — this is safe because both are **read-only** lookups;
  SE-04's failure is a `testOptions.ApplyDNS.failureAfter` simulation, not a
  missing row, so there's nothing for the two SEs to race on.

## Row ownership (by SE)

| Table | Row(s) | Owner | Notes |
|---|---|---|---|
| environments | `staging-eu` | SE-01-happy-path, SE-05-long-ack-wait | shared environment/network, isolated per-instance chains (see below) |
| compute_instances | `INST-STAGING-EU-1` + its storage/dns/cert/lb chain | SE-01-happy-path | |
| compute_instances | `INST-STAGING-EU-2` + its storage/dns/cert/lb chain | SE-05-long-ack-wait | `ApplyCompute` has a 10min ACK timeout; this SE sends a delayed ACK |
| environments | `atlantis-eu` | SE-02-environment-not-found | **sentinel — must NOT exist** |
| environments | `prod-eu` | SE-03-compute-fan-out, SE-04-cascade-failure-propagation | shared environment/network (6 compute instances — fan-out breadth) |
| compute_instances | `INST-PROD-EU-1` + its storage/dns/cert/lb chain | SE-03 (fan-out target chain) AND SE-04 (cascade-failure target chain) | see "Worker behavior notes" above for why sharing this one is safe |
| compute_instances | `INST-PROD-EU-2..6` | SE-03-compute-fan-out | fan-out breadth only — no dedicated storage/dns/cert/lb (never addressed by any SE's explicit payload IDs) |

SE-04's DNS failure (`ApplyDNS` → `SKIPPED` `PlanCertificate`/`ApplyCertificate`,
job → `PARTIAL_SUCCESS`) is driven entirely by `testOptions.ApplyDNS.
failureAfter` in its own `test.sh` — `DNS-PROD-EU-1` is a real, valid row
(`PlanDNS` must succeed for the SKIPPED-propagation story to mean anything).

## General story rows (not owned by any single SE — free to read, never delete)

None beyond the per-SE rows above — this seed intentionally has no
"unowned" filler rows (infra fixtures are naturally larger per row than
customers/devices, so we kept it to exactly what each SE and the two-region
narrative needs).

## Reserved ranges (future SEs — do NOT reuse)

| Table | Range | |
|---|---|---|
| environments | `qa-eu`, `dr-eu` | reserved |
| networks / compute_instances / storage_volumes / dns_records / certificates / load_balancers | rows scoped to a reserved environment | reserved |

## Not-found sentinel (guaranteed ABSENT — used for negative-path SEs)

| Entity | Sentinel value |
|---|---|
| environment_id | `atlantis-eu` |

## Row counts (as of this seed)

| Table | Count |
|---|---|
| environments | 2 |
| networks | 2 |
| compute_instances | 8 |
| storage_volumes | 8 |
| dns_records | 3 |
| certificates | 3 |
| load_balancers | 3 |

## Validator

`bash source-db/validate-seed-data.sh` — asserts the counts and key rows
above against `dtm-db` by default — the copy the Lambda workers actually
read (both it and the dedicated `dtm-infra-provisioning-source-db` container
load this same canonical seed file; override with SEED_CHECK_CONTAINER to
validate the dedicated container instead).
Wired as its own eval: `setpoint-evals/SE-06-seed-data-integrity/`.
