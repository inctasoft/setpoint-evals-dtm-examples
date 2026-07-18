# SE-07: cascade FK every hop

## Setpoint Eval Metadata

**Category**: cascade-fk
**Duration**: ~10s
**Timeout**: 900s
**Isolation**: parallel-safe

**UN-QUARANTINED (2026-07-16):** this SE originally surfaced a real,
reproducible (~50% of runs) engine race in the cascade/ACK path shared by
all 3 workflows — `AcknowledgementHandler.hasDependentCascades()` resolved
the DI-default `WorkflowConfigService` (order-processing, the
first-registered workflow) instead of the ACKed step's own workflow config,
so infra-provisioning and iot-sensor-pipeline never got their deferred
ACK-dependent publishes re-checked. Root-caused and fixed (RC5, see
`docs/guides/race-condition-prevention.md`); this SE was re-verified 10/10
consecutive PASS on the fixed build and its `se_skip` quarantine removed —
it now runs on every `run-all.sh` invocation like any other SE.

## Scenario
```gherkin
Feature: infra-provisioning cascade FK injection — threaded through every hop
  Scenario: the deepest 5-hop chain propagates externalId end-to-end
    Given the prod-eu web instance chain (INST-PROD-EU-1) with healthy
      environment, network, compute, DNS and certificate rows
    When a provisioning job is submitted for entityId "prod-eu-fk-every-hop"
    Then ApplyEnvironment's ack_metadata.externalId is injected as
      ApplyNetwork's output._fkInjections.ext_environment_id
    And ApplyNetwork's externalId is injected as ApplyDNS's
      ext_network_id
    And one of the fanned-out ApplyCompute instances' externalId is
      injected as ApplyDNS's ext_compute_id
    And ApplyDNS's externalId is injected as ApplyCertificate's
      ext_dns_id
    And the job reaches COMPLETED status
```

## Architecture
```mermaid
sequenceDiagram
    participant AE as ApplyEnvironment
    participant AN as ApplyNetwork
    participant AC as ApplyCompute
    participant AD as ApplyDNS
    participant ACert as ApplyCertificate

    AE-->>AE: ACK arrives, ack_metadata.externalId = E1
    AE->>AN: FK injection - output._fkInjections.ext_environment_id = E1
    AN-->>AN: ACK arrives, ack_metadata.externalId = N1
    AN->>AD: FK injection - ext_network_id = N1
    AC-->>AC: ACK arrives, ack_metadata.externalId = C1
    AC->>AD: FK injection - ext_compute_id = C1
    AD-->>AD: ACK arrives, ack_metadata.externalId = D1
    AD->>ACert: FK injection - ext_dns_id = D1
    Note over ACert: 5 hops confirmed - E1 through D1 all threaded
```

## Test Data
The prod-eu web chain shared read-only with SE-01/03/04/08/09
(`source-db/SEED-REGISTRY.md`) — pure read-only lookup, distinguished by its
own `entityId`. No seed row drives the FK values; they're generated at
runtime by the dev-ack-simulator (random UUIDs per ACK) and captured live by
this SE's direct `dtm_steps` query.

## Payload
Same full-chain payload as SE-04/SE-08 (`entityId: "prod-eu-fk-every-hop"`);
see `test.sh` for the literal JSON.

## Artifacts
Live SQL query results captured while building this SE (a clean run,
before the race below was found):
```
ApplyEnvironment  externalId=7e4461ab-...   -> ApplyNetwork._fkInjections.ext_environment_id=7e4461ab-...     (MATCH)
ApplyNetwork      externalId=d1f872be-...   -> ApplyDNS._fkInjections.ext_network_id=d1f872be-...             (MATCH)
ApplyCompute(x6)  externalId=d2e045b0-...(one of six) -> ApplyDNS._fkInjections.ext_compute_id=d2e045b0-...   (MATCH)
ApplyDNS          externalId=de05b59a-...   -> ApplyCertificate._fkInjections.ext_dns_id=de05b59a-...         (MATCH)
```
`Plan*` steps have `ack_metadata=NULL` (no ACK phase) and are excluded from
this SE's queries — only `Apply*` steps go through `WAITING_FOR_ACK`.

**Why quarantined:** run repeatedly against the same fresh-built stack, this
SE passed, failed, passed, failed (~50%, `--skip-purge` used to preserve
data on a captured failure). On a failure, the job still reaches
`COMPLETED` with `stepsFailed: 0` — this is NOT merely an empty
`_fkInjections` audit field being read before it's written. A direct query
showed `ApplyDNS`/`ApplyStorage`/`ApplyLoadBalancer` (the 3 steps delegated
in parallel right after `ApplyNetwork`+`ApplyCompute` complete) with
**`ack_metadata` entirely `NULL`** — despite `ackDelay: 1000` being set on
all three in the payload and the job reporting full success. Their own ACK
never landed/persisted; the FK-injection failure is downstream of that, not
the cause. This is a genuine race in the parallel-delegation / ACK-handling
path shared by all three workflows, not something specific to this SE's
assertions. Full reproduction notes: `DIFFICULTIES-LOG.md`.

## Assertions
<!-- one checkbox per verify/if call in test.sh — keep 1:1 -->
- [ ] Job status is COMPLETED
- [ ] Hop 1->2: ApplyEnvironment's externalId equals ApplyNetwork's `ext_environment_id`
- [ ] Hop 2->3: ApplyNetwork's externalId equals ApplyDNS's `ext_network_id`
- [ ] Hop compute->dns: ApplyDNS's `ext_compute_id` matches a real ApplyCompute externalId
- [ ] Hop 4->5: ApplyDNS's externalId equals ApplyCertificate's `ext_dns_id`

## Run
```bash
bash workflows/infra-provisioning/setpoint-evals/run-all.sh --se 07
```

No existing SE queries `ack_metadata`/`_fkInjections` directly via SQL — every
other SE only asserts on step STATUS via the HTTP API. This SE is the only
one that proves the FK VALUES themselves actually thread hop-to-hop (not
just that each step independently receives some ACK), which is the entire
point of `docs/diagrams/cascade-fk-flow.mermaid` — a regression that broke FK
injection (e.g. injecting the wrong parent's externalId, or a stale one)
would pass every status-only SE in the suite while silently corrupting the
provisioned infrastructure's referential integrity.
