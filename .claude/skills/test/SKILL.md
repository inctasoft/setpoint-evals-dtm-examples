---
name: test
description: Run DTM STE evaluations. Use when user wants to run tests, evals, or STEs.
---

Run DTM State Transition Evaluations.

Arguments: $ARGUMENTS

Available suites:
- `all` — Run all 28 STEs (13 core + 15 workflow-specific)
- `core` — Run 13 core STEs: `cd sms/ste && ./run-all.sh`
- `order` — Run order-processing STEs: `cd sms/workflows/order-processing/ste && ./run-all.sh`
- `iot` — Run iot-sensor-pipeline STEs: `cd sms/workflows/iot-sensor-pipeline/ste && ./run-all.sh`
- `infra` — Run infra-provisioning STEs: `cd sms/workflows/infra-provisioning/ste && ./run-all.sh`
- `playwright` — Run Playwright core specs: `cd sms/ste-playwright && pnpm test`
- `playwright:demos` — Run Playwright demos with video recording: `cd sms && pnpm ste:playwright:demos`

If no argument is given, ask the user which suite to run.

Current working directory is: !`pwd`
Docker status: !`docker ps --format "table {{.Names}}\t{{.Status}}" 2>/dev/null | head -20`

IMPORTANT: Before running STEs, verify the environment is up (docker containers running).
Monitor the output, identify any failures, and suggest fixes.
