# DTM Workflow Template

This is a starter template for creating a new DTM workflow project.

## Quick Start

1. Copy this directory:
   ```bash
   cp -r workflows/00-template workflows/my-workflow
   ```

2. Edit `workflow.config.ts` — define your steps, cascades, and outcome rules

3. Implement workers in `workers/src/handlers/`

4. Configure ACK defaults in `dev-tools/ack-defaults.ts` (optional)

5. Write STEs in `ste/` to validate your workflow

6. Add source DB infrastructure in `source-db/` if needed

## Directory Structure

```
my-workflow/
├── workflow.config.ts          # Step DAG, cascades, outcome rules
├── workers/
│   └── src/handlers/           # Lambda worker handlers
├── dev-tools/
│   └── ack-defaults.ts         # Dev ACK simulator payload defaults
├── source-db/                  # Source database schema & seed data (add as needed)
│   ├── entities/               # TypeORM entities for source DB
│   └── init-scripts/           # SQL init scripts
├── ste/                        # State Transition Evals
│   ├── 01-happy-path/test.sh   # Your workflow-specific tests
│   ├── shared/helpers.sh       # Workflow STE helpers
│   └── run-all.sh              # Run all workflow STEs
├── package.json
├── tsconfig.json
└── README.md
```

## See Also

- **Full guide**: `docs/guides/creating-a-workflow.md`
- **Reference implementation**: `workflows/order-processing/`
- **Core interfaces**: `packages/core/src/interfaces/workflow-definition.interface.ts`
