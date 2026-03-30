# STE - State Transition Evals

State Transition Evals verify orchestrator engine behavior through end-to-end tests that exercise real Docker infrastructure (databases, queues, Lambda workers).

## Directory Structure

```
ste/                                    # Core engine STEs (13 tests)
  01-retry-transient-failure/
  02-dlq-permanent-failure/
  ...
  13-in-progress-auto-timeout/
  shared/helpers.sh                     # Generic helper functions
  run-all.sh                            # Core STE runner
  preflight-check.sh                    # Pre-flight checks
  analyze-results.sh                    # Results analyzer

workflows/<name>/ste/                   # Workflow-specific STEs
  shared/helpers.sh                     # Workflow helpers (chains to generic)
  run-all.sh                            # Workflow STE runner
  preflight-check.sh                    # Workflow-specific pre-flight checks
```

Active workflow STE directories:
- `workflows/order-processing/ste/`
- `workflows/iot-sensor-pipeline/ste/`
- `workflows/infra-provisioning/ste/`

## Two-Layer Architecture

### Core STEs (`ste/`)

Test generic orchestrator capabilities that apply to ANY workflow:
- Retry/DLQ behavior, deduplication, concurrency
- Maintenance task recovery (stuck states, orphaned jobs, auto-timeout)
- Health metrics, acknowledgement handling

These tests use the `order-processing` workflow as their test vehicle but verify engine-level behavior.

### Workflow STEs (`workflows/<name>/ste/`)

Test workflow-specific functionality:
- Step DAG execution (Extract → Transform → Publish → ACK)
- FK cascade resolution, fan-out patterns
- Workflow-specific error handling and partial success

## Running STEs

```bash
# Run all core STEs
./ste/run-all.sh

# Run all core + all workflow STEs
./ste/run-all.sh --all-workflows

# Run a specific core STE
./ste/03-deduplication/test.sh

# Run all STEs for a specific workflow
./workflows/order-processing/ste/run-all.sh

# Run a specific workflow STE
./workflows/order-processing/ste/01-happy-path/test.sh

# Common options (both runners)
./ste/run-all.sh --parallel          # Default: parallel safe, sequential destructive
./ste/run-all.sh --in-band           # Sequential execution
./ste/run-all.sh --skip-purge        # Skip initial purge
./ste/run-all.sh --category maintenance  # Run specific category
./ste/run-all.sh --eval 03           # Run specific eval by ID
```

## Helper Architecture

```
ste/shared/helpers.sh                              # Generic layer
  - Environment loading, colors, logging
  - initiate_job(), get_job_status(), poll_job()
  - verify_job_status(), verify_step_status()
  - display_results(), exit_with_summary()

workflows/<name>/ste/shared/helpers.sh             # Workflow layer
  - Sources generic helpers
  - Workflow-specific validate_env_for_ste()
  - Domain-specific test data utilities
```

## Results

Results are saved to `.results/` within each runner's directory:
- `ste/.results/parallel/<timestamp>/`
- `workflows/<name>/ste/.results/parallel/<timestamp>/`

Each test log ends with `PASS:<seconds>`, `FAIL:<seconds>`, or `TIMEOUT:<seconds>`.
