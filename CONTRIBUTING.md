# Contributing to DTM

Thank you for your interest in contributing to DTM (Distributed Task Manager).

## What This Project Is

DTM is primarily a **reference implementation and showcase for agentic, AI-assisted software engineering**. While the orchestration engine is fully functional, the repository's main purpose is to demonstrate how AI agents can consistently build, test, and maintain a non-trivial distributed system.

If you're here to learn from the patterns or adapt them for your own use — welcome.

## Before You Start

### Understand the STE System

DTM uses **State Transition Evals (STEs)** as its primary testing methodology. Before making code changes, familiarize yourself with how STEs work:

- Read [ste/README.md](ste/README.md) for the core engine STE catalog
- Read [docs/TEST-OPTIONS-GUIDE.md](docs/TEST-OPTIONS-GUIDE.md) for test configuration
- Run the existing STEs to see them pass before making changes

STEs are end-to-end tests that validate the orchestrator's state machine by submitting jobs and asserting on the resulting database state. Any change to the orchestrator's behavior should be covered by an STE — unit tests alone are not sufficient.

### Understand the Architecture

- Read [CLAUDE.md](CLAUDE.md) for the full project guide
- Read [docs/guides/system-architecture.md](docs/guides/system-architecture.md) for the engine architecture
- The orchestrator **never** accesses source databases — workers do that

## How to Contribute

### Reporting Issues

Open a GitHub issue with:
- A clear description of the problem
- Steps to reproduce (ideally an STE that demonstrates the failure)
- Expected vs actual behavior

### Submitting Changes

1. Fork the repository
2. Create a feature branch from `main`
3. Make your changes
4. Ensure all existing STEs still pass:
   ```bash
   ./ste/run-all.sh --all-workflows
   ```
5. Add new STEs for new behavior
6. Run the build:
   ```bash
   pnpm install
   pnpm build
   ```
7. Open a pull request with a clear description of the change

### What Makes a Good Contribution

- **New workflow examples** in `workflows/` — the best way to showcase engine capabilities
- **New STEs** that cover untested edge cases
- **Bug fixes** with a corresponding STE that reproduces the issue
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

# Run STEs
./ste/run-all.sh
```

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
