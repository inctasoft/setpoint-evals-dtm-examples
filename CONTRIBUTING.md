# Contributing to DTM

Thank you for your interest in contributing to DTM (Distributed Task Manager).

## What This Project Is

DTM is primarily a **reference implementation and showcase for agentic, AI-assisted software engineering**. While the orchestration engine is fully functional, the repository's main purpose is to demonstrate how AI agents can consistently build, test, and maintain a non-trivial distributed system.

If you're here to learn from the patterns or adapt them for your own use — welcome.

## Before You Start

### Understand the SE System

DTM uses **Setpoint Evals (SEs)** as its primary testing methodology. Before making code changes, familiarize yourself with how SEs work:

- Read [setpoint-evals/README.md](setpoint-evals/README.md) for the core engine SE catalog
- Read [docs/TEST-OPTIONS-GUIDE.md](docs/TEST-OPTIONS-GUIDE.md) for test configuration
- Run the existing SEs to see them pass before making changes

SEs are end-to-end tests that validate the orchestrator's state machine by submitting jobs and asserting on the resulting database state. Any change to the orchestrator's behavior should be covered by an SE — unit tests alone are not sufficient.

### Understand the Architecture

- Read [CLAUDE.md](CLAUDE.md) for the full project guide
- Read [docs/guides/system-architecture.md](docs/guides/system-architecture.md) for the engine architecture
- The orchestrator **never** accesses source databases — workers do that

## How to Contribute

### Reporting Issues

Open a GitHub issue with:
- A clear description of the problem
- Steps to reproduce (ideally an SE that demonstrates the failure)
- Expected vs actual behavior

### Submitting Changes

1. Fork the repository
2. Create a feature branch from `main`
3. Make your changes
4. Ensure all existing SEs still pass:
   ```bash
   ./setpoint-evals/run-all.sh --all-workflows
   ```
5. Add new SEs for new behavior
6. Run the build:
   ```bash
   pnpm install
   pnpm build
   ```
7. Open a pull request with a clear description of the change

### What Makes a Good Contribution

- **New workflow examples** in `workflows/` — the best way to showcase engine capabilities
- **New SEs** that cover untested edge cases
- **Bug fixes** with a corresponding SE that reproduces the issue
- **Documentation improvements** — especially guides in `docs/guides/`

### Code Style

- TypeScript strict mode throughout
- NestJS conventions for the orchestrator (modules, services, controllers)
- Domain-specific step names (Validate/Submit, Register/Provision — not Extract/Transform)
- No hardcoded workflow logic in the orchestrator — use `WorkflowDefinition` config

## Development Setup

```bash
# Prerequisites: Node.js 22+, pnpm 10+, Docker

# Install dependencies
pnpm install

# Start infrastructure
./scripts/local-env.sh start --standalone --orchestrator

# Deploy workers
./scripts/local-env.sh deploy-workers --poller --count=5

# Run SEs
./setpoint-evals/run-all.sh
```

## Tooling Provenance

Parts of the SE harness (`se-lib.sh` and friends) are vendored from an internal tooling
repository. Comments citing "server-config" or internal PR numbers (e.g. `sc#NNN`) are
provenance markers from that source and have no public counterpart — they're left in place
as historical context, not as pointers you can follow.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
