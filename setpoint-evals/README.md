# SE - Setpoint Evals

Setpoint Evals verify orchestrator engine behavior through end-to-end tests that exercise real Docker infrastructure (databases, queues, Lambda workers).

## Directory Structure

```
setpoint-evals/                                    # Core engine SEs (36 tests)
  SE-01-retry-transient-failure/
  SE-02-dlq-permanent-failure/
  ...
  SE-36-full-zmq-bus-profile/
  shared/helpers.sh                     # Generic helper functions
  run-all.sh                            # Core SE runner
  preflight-check.sh                    # Pre-flight checks
  analyze-results.sh                    # Results analyzer

workflows/<name>/setpoint-evals/                   # Workflow-specific SEs
  shared/helpers.sh                     # Workflow helpers (chains to generic)
  run-all.sh                            # Workflow SE runner
  preflight-check.sh                    # Workflow-specific pre-flight checks
```

Active workflow SE directories:
- `workflows/order-processing/setpoint-evals/`
- `workflows/iot-sensor-pipeline/setpoint-evals/`
- `workflows/infra-provisioning/setpoint-evals/`

## Two-Layer Architecture

### Core SEs (`setpoint-evals/`)

Test generic orchestrator capabilities that apply to ANY workflow:
- Retry/DLQ behavior, deduplication, concurrency
- Maintenance task recovery (stuck states, orphaned jobs, auto-timeout,
  redelivery engine, event-republish scan)
- Health metrics, acknowledgement handling
- Bus profiles (aws / zmq tasks / zmq events / full-zmq — see
  ../docs/guides/bus-profiles.md). SQS/Kafka-semantic SEs skip honestly under
  BUS_PROFILE=zmq; the estate runs green under both profiles.

These tests use the `order-processing` workflow as their test vehicle but verify engine-level behavior.

### Workflow SEs (`workflows/<name>/setpoint-evals/`)

Test workflow-specific functionality:
- Step DAG execution (Extract → Transform → Publish → ACK)
- FK cascade resolution, fan-out patterns
- Workflow-specific error handling and partial success

## Running SEs

```bash
# Run all core SEs
./setpoint-evals/run-all.sh

# Run all core + all workflow SEs
./setpoint-evals/run-all.sh --all-workflows

# Run a specific core SE
./setpoint-evals/SE-03-deduplication/test.sh

# Run all SEs for a specific workflow
./workflows/order-processing/setpoint-evals/run-all.sh

# Run a specific workflow SE
./workflows/order-processing/setpoint-evals/SE-01-happy-path/test.sh

# Common options (both runners)
./setpoint-evals/run-all.sh --parallel          # Default: parallel safe, sequential destructive
./setpoint-evals/run-all.sh --in-band           # Sequential execution
./setpoint-evals/run-all.sh --skip-purge        # Skip initial purge
./setpoint-evals/run-all.sh --category maintenance  # Run specific category
./setpoint-evals/run-all.sh --eval 03           # Run specific eval by ID
```

## Helper Architecture

```
setpoint-evals/shared/helpers.sh                              # Generic layer
  - Environment loading, colors, logging
  - initiate_job(), get_job_status(), poll_job()
  - verify_job_status(), verify_step_status()
  - display_results(), exit_with_summary()

workflows/<name>/setpoint-evals/shared/helpers.sh             # Workflow layer
  - Sources generic helpers
  - Workflow-specific validate_env_for_ste()
  - Domain-specific test data utilities
```

## Results

Results are saved to `.results/` within each runner's directory:
- `setpoint-evals/.results/parallel/<timestamp>/`
- `workflows/<name>/setpoint-evals/.results/parallel/<timestamp>/`

Each test log ends with `PASS:<seconds>`, `FAIL:<seconds>`, or `TIMEOUT:<seconds>`.
