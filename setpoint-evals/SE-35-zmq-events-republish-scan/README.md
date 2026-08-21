# SE-35: zmq events republish scan

## Setpoint Eval Metadata

**Category**: recovery · **Duration**: ~90s (lease wait + two scan triggers + completion) · **Timeout**: 300s · **Isolation**: destructive

Full-zmq profile (`QUEUE_TRANSPORT=zmq` + `EVENT_BUS=zmq`) with a short
republish lease (`EVENT_REPUBLISH_LEASE_SECONDS=10`). The dev-ack-simulator
is STOPPED when the first cascade publish fires — PUB/SUB silently drops it —
so the step parks in WAITING_FOR_ACK with no ACK. The EventRepublishScanTask
(auto-on under zmq events, no FORCE flag needed) re-publishes it; once the
simulator is back and subscribed, a re-publish lands, the ACK arrives, and
the job completes **well before** the 30-minute stuck-ack auto-fail that is
today's only net. RED-first by construction: without the scan this scenario
stalls for 30 minutes and then FAILS the step. Everything (.env,
orchestrator, simulator, worker hosts) is restored in an EXIT trap.

## Scenario
```gherkin
Feature: the republish scan recovers dropped event publishes
  Scenario: publish dropped while the subscriber is down, recovered in seconds
    Given the full-zmq profile with a 10 second republish lease
    And the dev-ack-simulator is stopped so the first publish drops silently
    When a quick-order job parks a step in WAITING_FOR_ACK with no ACK
    And the republish scan is triggered after the lease expires
    Then the scan reports the expired publish and re-publishes it
    When the simulator returns and the scan fires again
    Then the re-published event is ACKed and the job completes
    And no step is dead-lettered or auto-failed
```

## Architecture
```mermaid
sequenceDiagram
    participant T as test.sh
    participant O as Orchestrator (PUB/PULL)
    participant S as dev-ack-simulator (down, then up)
    participant E as EventRepublishScanTask
    participant DB as dtm_steps

    T->>S: docker stop (no subscriber)
    T->>O: POST jobs quick-order
    O->>DB: SubmitCustomer completed → publish → WAITING_FOR_ACK
    Note over O: PUB drops the event — no subscriber, publish() still "succeeds"
    T->>E: POST maintenance/tasks/event-republish-scan/execute (lease expired)
    E->>DB: scan WAITING_FOR_ACK with kafka_published_at < now-10s
    E->>O: republishStepEvent → PUB again (drops again)
    T->>S: docker start (SUB connects + subscribes)
    T->>E: trigger scan again
    E->>O: republishStepEvent → PUB — this one lands
    S->>O: ack envelope via PUSH/PULL
    O->>DB: ack_received_at → COMPLETED; job completes
    Note over O,DB: 30-minute stuck-ack auto-fail never engages; zero dead letters
```

## Test Data
Reads (does not own) order-processing's seeded rows — `customer_id=1` (Ada Lovelace)
and `order_id=1`, owned by workflow suite `SE-01-happy-path`
(`workflows/order-processing/source-db/SEED-REGISTRY.md`). `entityId` is a fresh
`uuidgen` per run.

## Payload

### Orchestrator env flip (restored by trap)
```bash
QUEUE_TRANSPORT=zmq
EVENT_BUS=zmq
EVENT_REPUBLISH_LEASE_SECONDS=10
```

### Job payload
```json
{
  "variant": "quick-order",
  "payload": { "customerId": 1, "orderId": 1, "entityId": "<uuidgen per run>" },
  "enableDeduplication": false,
  "testOptions": {
    "ValidateCustomer": { "simDelay": 500 },
    "ValidateProduct": { "simDelay": 500 },
    "SubmitCustomer": { "simDelay": 500, "ackDelay": 500 },
    "SubmitOrder": { "simDelay": 500, "ackDelay": 500 }
  }
}
```

### Scan invocation
```bash
curl -X POST -H "Content-Type: application/json" -d '{}' \
  "${ORCHESTRATOR_HOST}/api/${API_VERSION}/maintenance/tasks/event-republish-scan/execute"
```

## Artifacts

### Expected output (scan response, excerpt)
```json
{ "success": true, "metrics": { "expiredPublishesFound": 1, "republished": 1, "pendingPublished": 0, "skipped": 0, "failed": 0 } }
```

### DB probes
```sql
SELECT COUNT(*) FROM dtm_steps WHERE job_id='<JOB_ID>' AND status='waiting_for_ack' AND ack_received_at IS NULL;  -- >= 1 while subscriber down
SELECT COUNT(*) FROM dtm_steps WHERE job_id='<JOB_ID>' AND ack_received_at IS NOT NULL;                          -- >= 1 after recovery
SELECT COUNT(*) FROM dtm_dead_letters WHERE job_id='<JOB_ID>';                                                   -- 0
```

## Assertions
<!-- one checkbox per ck_* gate in test.sh, in execution order -->
- [ ] a step parked in WAITING_FOR_ACK with no ACK while the subscriber was down
- [ ] the republish scan executed successfully (auto-on under zmq events)
- [ ] the scan found the expired un-ACKed publish
- [ ] the scan re-published the dropped event
- [ ] the ACK arrived after the subscriber returned (ack_received_at set)
- [ ] the job completed via re-publish — not via the 30-min stuck-ack auto-fail
- [ ] no step was dead-lettered or auto-failed on the way

## Run
```bash
bash setpoint-evals/run-all.sh --se 35
```

## Troubleshooting

**`expiredPublishesFound = 0`** — the lease had not expired at trigger time
(the SE sleeps `REPUB_LEASE + 3` after the WAITING_FOR_ACK probe), or the scan
is not active: under zmq events it needs no FORCE flag, but check
`docker logs dtm-orchestrator` for `EventRepublishScanTask` lines.

**Job still stalls after the simulator returns** — the scan was triggered
before the simulator's SUB finished subscribing (slow joiner drops the
re-publish too). The SE settles 8s; the 30s cron re-fires anyway, so the job
should still complete within the poll window.

**Step auto-failed instead of completing** — the 30-minute stuck-ack task
fired first, which means the scan never ran (check the capability gate:
`EVENT_BUS=zmq` must reach the orchestrator via `.env` + recreate).

Related: `services/orchestrator/src/maintenance/tasks/event-republish-scan.task.ts`,
`services/orchestrator/src/orchestration/cascade-publish.service.ts` (`republishStepEvent`),
`services/orchestrator/src/event-bus/zmq-event-bus.service.ts`.
