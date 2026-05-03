---
name: results
description: View, compare, and analyze SE evaluation results. Use when user wants to see test results, compare runs, or check flakiness.
---

Analyze SE evaluation results.

Arguments: $ARGUMENTS

## Commands

- `latest` — Analyze the most recent run
- `compare` — Compare the two most recent runs side-by-side
- `compare <dir1> <dir2>` — Compare two specific runs
- `stats` — Cross-run statistics (flakiness, timing trends)
- `list` — List all available result runs with timestamps
- `all` — Summary of all runs

## How to Execute

All commands run from the `sms/setpoint-evals/` directory:

- **Latest results**: `./analyze-results.sh`
- **Cross-run stats**: `./analyze-results.sh --stats`
- **Compare two runs**: `./analyze-results.sh --compare <dir1> <dir2>`
- **Compare most recent**: `./analyze-results.sh --compare`
- **All runs summary**: `./analyze-results.sh --all`
- **List runs**: `ls -lt .results/parallel/ .results/in-band/ 2>/dev/null`

## Result Locations

- Core SE results: `setpoint-evals/.results/{parallel|in-band}/{YYYYMMDD_HHMMSS}/`
- Each run directory contains:
  - `results.json` — Machine-readable results (eval IDs, status, timing, job IDs)
  - `{evalId}_{evalName}_{timestamp}.log` — Per-eval log files
  - `run.log` — Full run output
  - `analysis_report.log` — ANSI-stripped analysis
- Playwright results: `setpoint-evals-playwright/test-results/results.json`

## Notes

- Results are stored as timestamped directories for historical tracking
- The `results.json` file enables programmatic comparison between runs
- Use `--stats` to identify flaky evals across multiple runs
- Workflow-specific SEs store results in `workflows/{name}/setpoint-evals/.results/`
