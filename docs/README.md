# DTM Documentation

> Last updated: February 2026

## Three-Layer Documentation Model

DTM (Distributed Task Manager) documentation is organized into three layers, reflecting the separation between the generic engine, domain-specific workflow implementations, and living test documentation.

### Layer 1 -- Core (this directory: `docs/`)

Engine-level architecture and protocols that apply to all workflows regardless of domain. This includes the callback protocol, fan-out orchestration, cascade publishing, race condition guards, and database schema documentation.

### Layer 2 -- Workflow (`workflows/<name>/docs/`)

Domain-specific documentation for each workflow implementation. Covers source and target data schemas, entity dependency graphs, FK injection rules, and transformation logic. Each workflow defines its own entities, step configurations, and data access patterns.

### Layer 3 -- SEs (`setpoint-evals/` + `workflows/<name>/setpoint-evals/`)

Structured Test Evaluations serve as living documentation. Core SEs validate engine-level behavior (callback handling, deduplication, retry logic). Workflow SEs validate domain-specific scenarios (entity extraction, transformation, cascade resolution). Each SE includes a README describing the scenario it validates and a runnable test script.

## Quick Links

| Document | Description |
|----------|-------------|
| [MASTER-INDEX.md](MASTER-INDEX.md) | Use-case-based navigation across all documentation |
| [guides/system-architecture.md](guides/system-architecture.md) | Complete architecture guide with component diagrams |
| [guides/race-condition-prevention.md](guides/race-condition-prevention.md) | Race condition guards in the callback flow |
| [TEST-OPTIONS-GUIDE.md](TEST-OPTIONS-GUIDE.md) | Reference for testOptions in migration payloads |

## AI Agent Guide

See [CLAUDE.md](../CLAUDE.md) for the project-level AI agent guide, which contains architecture context, configuration file locations, coding standards, and operational commands.
