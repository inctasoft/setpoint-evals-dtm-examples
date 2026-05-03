---
name: test
description: Run DTM SE evaluations. Use when user wants to run tests, evals, or SEs.
---

Run DTM State Transition Evaluations.

Arguments: $ARGUMENTS

Available suites:
- `all` — Run all 28 SEs (13 core + 15 workflow-specific)
- `core` — Run 13 core SEs: `cd setpoint-evals && ./run-all.sh`
- `order` — Run order-processing SEs: `cd workflows/order-processing/setpoint-evals && ./run-all.sh`
- `iot` — Run iot-sensor-pipeline SEs: `cd workflows/iot-sensor-pipeline/setpoint-evals && ./run-all.sh`
- `infra` — Run infra-provisioning SEs: `cd workflows/infra-provisioning/setpoint-evals && ./run-all.sh`
- `playwright` — Run Playwright core specs: `cd setpoint-evals-playwright && pnpm test`
- `playwright:demos` — Run Playwright demos with video recording:  `pnpm se:playwright:demos`

If no argument is given, ask the user which suite to run.

Current working directory is: !`pwd`
Docker status: !`docker ps --format "table {{.Names}}\t{{.Status}}" 2>/dev/null | head -20`

IMPORTANT: Before running SEs, verify the environment is up (docker containers running).
Monitor the output, identify any failures, and suggest fixes.
