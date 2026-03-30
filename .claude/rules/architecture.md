---
paths:
  - "services/**"
  - "packages/**"
---
# Architecture Rules

- Orchestrator NEVER accesses source databases — workers query sources, return data via callback
- `continueJob()` is the orchestration brain — called after every callback with a 4-case decision tree
- Step status machine has 10 states — terminal states reject callbacks (race condition guard)
- WAITING_FOR_ACK ≠ completed — dependent steps must wait for external Kafka ACK
- Atomic delegation via `claimForDelegation()` prevents double-delegation race condition
- Feature flags have 3 layers: defaults < env vars < per-request (if clientOverridable)
- Engine metadata keys (`extractConfig`/`transformConfig`) are internal plumbing — do not rename
- Port 3002 (host) maps to port 3000 (container) for the orchestrator
