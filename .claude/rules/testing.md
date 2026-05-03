---
paths:
  - "setpoint-evals/**"
  - "setpoint-evals-playwright/**"
---
# Testing Rules

- SEs (State Transition Evaluations) are bash scripts that test orchestrator behavior via API
- TestOptions are keyed by step name: `testOptions[stepName]` with fields like `simDelay`, `ackDelay`, `simError`
- SEs run from the host — they use host-mapped ports (3002 for orchestrator, 4567 for LocalStack)
- The `.env.local` file (see `.env.local.example`) provides host-side port overrides for SEs
- SQL queries in SEs that use `LIKE` patterns based on step name prefixes are fragile
- Always use the exact step name (e.g., `ValidateCustomer`, `SubmitOrder`) — never Extract/Transform
- Playwright specs are at `setpoint-evals-playwright/` — 4 core specs + 4 demo video specs
- Demo recordings use `pnpm se:playwright:demos` and save `.webm` files
