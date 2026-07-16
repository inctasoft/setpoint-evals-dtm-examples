# iot-sensor-pipeline seed registry

Story: a **greenhouse fleet**. Devices are `greenhouse-N` (plus one named
`greenhouse-offline`) — obviously a demo fixture, not a real deployment.

This file is the source of truth for "what rows exist and who owns them."
`validate-seed-data.sh` re-implements it as executable assertions; keep the
two in sync when you touch the seed.

## Row ownership (by SE)

| Table | Row(s) | Owner | Notes |
|---|---|---|---|
| devices | `greenhouse-1` | SE-01-happy-path | 2 sensors, calm readings, 0 alerts |
| devices | `greenhouse-999` | SE-02-device-not-found | **sentinel — must NOT exist** |
| devices | `greenhouse-3` | SE-03-double-fan-out | 3 sensors (temp/humidity/soil) — wider fan-out breadth |
| devices | `greenhouse-4` | SE-04-feature-flag-disable-alerts | 2 sensors; `SENS-GH4-TEMP` genuinely spikes past its `max_threshold`, producing 1 real alert row — the SE disables `ENABLE_ALERT_GENERATION` and asserts EvaluateAlert/DispatchAlert are SKIPPED despite the alert being real |
| devices | `greenhouse-offline` | SE-05-empty-discovery | 1 sensor (`SENS-GHOFF-TEMP`), **0 readings** — exercises the *nested* fan-out's empty case (`DiscoverReadings` returns 0 for a real sensor), not the outer device->sensor one. See "Worker behavior notes" below for why this must stay a sensor-with-zero-readings, not a device-with-zero-sensors. |
| devices | `greenhouse-5` | SE-09-inner-empty-discovery | 2 sensors — `SENS-GH5-TEMP` has 6 real readings, `SENS-GH5-SOIL` has **0**. Unlike `greenhouse-offline` (SE-05, its ONLY sensor is empty), this is the MIXED case: one sensor in a multi-sensor fan-out set is empty while its sibling has real data — a distinct code path (partial empty within a fan-out set). |

`EvaluateAlert`/`DispatchAlert` filter the `alerts` table by `device_id`
directly (`workers/src/handlers/evaluate-alert.ts`), independent of which
sensor triggered it — so alerts are owned per-device, not per-sensor.

## Worker behavior notes (why the rows are shaped this way)

- `DiscoverSensors` fans out over `sensors` by `device_id`; each discovered
  sensor spawns its OWN child chain `[CalibrateSensor, ActivateSensor,
  DiscoverReadings, ComputeAggregate, PublishAggregate]`. A device with
  **zero sensors** never creates a `DiscoverReadings` step at all.
- SE-05's assertions require `DiscoverReadings` to exist and be `COMPLETED`
  with 0 results — i.e. it needs a REAL sensor whose reading fan-out is
  empty, not a device with no sensors. Do not "simplify" `greenhouse-offline`
  to zero sensors; that changes the scenario it proves and breaks Test 4 of
  `SE-05-empty-discovery/test.sh`.
- `EvaluateAlert`, `ComputeAggregate` etc. never throw on an empty result —
  `count: 0` is a valid success, which is why `greenhouse-1/2/3` legitimately
  have zero alert rows.

## General story rows (not owned by any single SE — free to read, never delete)

| Table | Rows | Story |
|---|---|---|
| devices | `greenhouse-2` | general demo/dashboard fill |
| sensors | `SENS-GH2-TEMP`, `SENS-GH2-HUM` | greenhouse-2's sensors |

## Reserved ranges (future SEs — do NOT reuse)

| Table | Range | |
|---|---|---|
| devices | `greenhouse-6` .. `greenhouse-9` | reserved (5 consumed by SE-09, Phase 3b) |
| sensors / readings / alerts / aggregates | no fixed range — child rows scoped to a reserved device | reserved |

## Not-found sentinel (guaranteed ABSENT — used for negative-path SEs)

| Entity | Sentinel value |
|---|---|
| device_id | `greenhouse-999` |

## Row counts (as of this seed)

| Table | Count |
|---|---|
| devices | 6 |
| sensors | 12 |
| readings | 60 |
| alerts | 1 |
| aggregates | 9 |

## Validator

`bash source-db/validate-seed-data.sh` — asserts the counts and key rows
above against `dtm-db` by default — the copy the Lambda workers actually
read (both it and the dedicated `dtm-iot-sensor-pipeline-source-db` container
load this same canonical seed file; override with SEED_CHECK_CONTAINER to
validate the dedicated container instead).
Wired as its own eval: `setpoint-evals/SE-06-seed-data-integrity/`.
