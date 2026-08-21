# CDE Agentic AI Architecture

> Presentation notes for the team.
> How we structure knowledge, skills, and tooling so AI agents work effectively in our codebase.
>
> **Maintainers:** CDE Team
> **Last Updated:** 2026-03-20

---

## General Principles & Strategy

These principles are **universal** — they apply to any codebase, any AI tool, any team size. They are the foundation everything else builds on.

### Principle 1: Documentation Is an Information Retrieval Problem

The quality of your routing matters more than the quality of your prose. An agent that finds the right 200-line document in 10 seconds outperforms an agent that reads a beautifully-written 2000-line document that's only 20% relevant.

**Implication:** Invest in structure (how docs are organized and discovered) before investing in content (what the docs say).

### Principle 2: Progressive Disclosure Controls Token Cost

Every file an agent reads costs tokens and time. Structure documentation in layers so the agent reads the minimum needed for the task at hand.

```
Most tasks:   L0 (auto) + L1 (router) + 1 domain doc     = 2-3 reads
Deep tasks:   L0 + L1 + 2-3 domain docs + conventions     = 4-6 reads
Full mastery: Everything (rare, only for onboarding)       = 10+ reads
```

**Implication:** Annotate each layer with its cost. Make agents aware of the budget tradeoff.

### Principle 3: Single Source of Truth

Every fact should exist in exactly one file. Other files link to it but never copy it. When an agent encounters conflicting information, it cannot determine which is correct — it must either guess (risky) or ask the user (slow).

**Implication:** Canonical sources eliminate contradictions. Cross-reference via links, not duplication.

### Principle 4: Separate Reference from Procedure

**Reference** = facts that don't change often (entity models, enum values, connection strings). Agents scan these for specific values.
**Procedure** = step-by-step instructions (hotfix workflow, DB tunnel setup). Agents follow these sequentially.

Mixing them in one file forces agents to read the whole thing when they only need one mode.

### Principle 5: Auto-Injected Context Is Free Context

Anything in CLAUDE.md (or equivalent) loads every session at zero agent effort. Use this for safety rules, identity, and pointers — the things every task needs. Keep it under 100 lines to avoid context bloat.

### Principle 6: Skills Are Cached Reasoning Paths

Every time an agent discovers which docs to read for a common task, that's wasted work if the next agent must rediscover the same path. Skills cache the reasoning: "for task X, you need context Y and instructions Z." The agent skips discovery entirely.

### Principle 7: Archive Aggressively

Stale documentation is worse than no documentation. Outdated planning docs, completed bug analyses, and superseded designs actively mislead agents. Move them to `_archive/` with a deprecation notice.

---

## What We Invented for CDE

These are custom patterns we developed specifically for this project. They build on the general principles but are novel contributions.

### The AGENT_ROUTER Pattern

**What:** A single markdown file (~100 lines) that serves as the only entry point for AI agents. It contains a task-based routing table ("If you need X, go to Y"), a 30-second mental model, and safety rules.

**Why it's novel:** Most projects either have no agent-oriented documentation or try to cram everything into a single CLAUDE.md. The router separates _navigation_ from _knowledge_. It's a function: `task → file path`.

**How it differs from a README:** A README says "here's what the project does." A router says "here's what YOU should read for YOUR TASK." It's oriented toward the agent's current objective, not the project's history.

### Tiered Bootstrap Loading

**What:** Three explicit tiers that tell the agent how much context to load based on task complexity:

| Tier   | Read                                                 | Time  | Good For                               |
| ------ | ---------------------------------------------------- | ----- | -------------------------------------- |
| Tier 1 | Router + 1 doc                                       | ~30s  | Bug fixes, simple changes, DB queries  |
| Tier 2 | + Domain Model + Agent Knowledge                     | ~2min | Feature implementation, debugging      |
| Tier 3 | + Architecture + Operation Types + provisioning docs | ~5min | Architecture decisions, new subsystems |

**Why it's novel:** No other project we've seen makes token budget an explicit part of its documentation strategy. The agent self-selects its depth based on task complexity.

### The Knowledge Base Slimming Pattern

**What:** We took AGENT_KNOWLEDGE.md from 1270 lines to 455 lines by extracting procedures to runbooks/ and domain knowledge to architecture/ — keeping only quick-reference lookup tables.

**Why it matters:** A monolithic knowledge dump grows without bound. Every team member adds "useful" facts. Eventually the file is too large for one context window and too unstructured for efficient lookup. The slimming pattern is: extract, link back, keep only tables.

### Task-Based Routing (Not Topic-Based)

**What:** The router organizes by _what you're trying to do_ ("Debug deprovisioning failure") rather than _what topic it relates to_ ("SPC adapter documentation").

**Why it's novel:** Agents think in tasks, not topics. When told "investigate this ticket," an agent doesn't think "I need the database topic." It thinks "what steps do I need?" Task-based routing matches the agent's execution model.

### Routing Header Pattern

**What:** Every domain document starts with a breadcrumb that tells agents where they came from and where they can go:

```markdown
> Part of: [architecture/](../AGENT_ROUTER.md)
> Related: [OPERATION_LIFECYCLE.md](OPERATION_LIFECYCLE.md), [OPERATION_TYPES.md](OPERATION_TYPES.md)
```

**Why it matters:** Eliminates dead ends. An agent that finishes reading a document always knows what to read next.

### The Documentation Meta-Guide

**What:** [AGENTIC_DOCUMENTATION_GUIDE.md](AGENTIC_DOCUMENTATION_GUIDE.md) — a guide on how to write documentation for AI agent consumption, including anti-patterns, naming conventions, the five-layer model, and lifecycle management.

**Why it's novel:** It's a meta-document: documentation about documentation, specifically for AI. It ensures that anyone adding new docs to the project maintains the architecture.

---

## Portability: What Any Team Can Reuse

| Component                                                   | Portable?       | Adaptation Needed                                            |
| ----------------------------------------------------------- | --------------- | ------------------------------------------------------------ |
| Five-layer model (L0-L5)                                    | Fully portable  | Map your docs to the layers                                  |
| AGENT_ROUTER pattern                                        | Fully portable  | Write your own routing table                                 |
| CLAUDE.md as bootstrap                                      | Fully portable  | Write your safety rules and identity                         |
| Skills as cached reasoning                                  | Fully portable  | Define your own common workflows                             |
| Agent teams for parallelism                                 | Fully portable  | Identify parallelizable tasks                                |
| Tiered bootstrap                                            | Fully portable  | Define your own tier 1/2/3 docs                              |
| Routing header pattern                                      | Fully portable  | Add breadcrumbs to existing docs                             |
| Archive policy (`_archive/`)                                | Fully portable  | Create the directory, enforce the rule                       |
| Task-based routing table                                    | Mostly portable | Tasks are domain-specific, but the table format is universal |
| Specific skills (`/investigate-ticket`, `/check-operation`) | CDE-specific    | Each team defines skills for their own workflows             |
| Domain knowledge docs (55 files)                            | CDE-specific    | Content is specific to our system                            |
| AGENT_KNOWLEDGE.md content                                  | CDE-specific    | SQL, SPC internals, provider routing — all CDE-specific      |

**The bottom line:** The architecture (layers, routing, skills, teams) is reusable. The content (what's in each layer) is domain-specific.

---

## The Problem We Solved

An AI agent arriving at a codebase has **no memory**, a **limited context window**, and **no intuition** about where things are. Without structure, it wastes tokens reading the wrong files, encounters contradictions, and produces inconsistent output.

We built a **layered information architecture** that gives agents the right knowledge at the right time — from a 30-second orientation to deep domain mastery — combined with **executable skills** that turn documentation into action.

---

## The Six-Layer Model

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 0: AUTO-LOADED CONTEXT (CLAUDE.md)                   │
│  Injected into every session automatically.                 │
│  Safety rules, system identity, available skills, SSO rules.│
│  Cost: 0 tokens of agent effort (system provides it)        │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: ROUTER (AGENT_ROUTER.md)                          │
│  ~100 lines. "If your task is X, read Y."                   │
│  Task-based routing table + 30-second mental model.         │
│  Cost: 1 file read                                          │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: DOMAIN KNOWLEDGE (architecture/, provisioning/)   │
│  ~200-500 lines each. How the system works.                 │
│  Entity models, operation flows, adapter patterns.          │
│  Cost: 1-3 file reads (only what's needed for the task)     │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: CONVENTIONS (development/, testing/)              │
│  How to write code, how to test.                            │
│  Coding guidelines, test patterns, schema rules.            │
│  Cost: 1 file read (before writing any code)                │
├─────────────────────────────────────────────────────────────┤
│  Layer 4: PROCEDURES (runbooks/)                            │
│  Step-by-step instructions for operational tasks.           │
│  Hotfix workflow, release process, ticket investigation.    │
│  Cost: 1 file read (when executing a procedure)             │
├─────────────────────────────────────────────────────────────┤
│  Layer 5: REFERENCE DATA (AGENT_KNOWLEDGE.md, GLOSSARY.md) │
│  Quick lookup tables, SQL templates, enum values.           │
│  Cost: 1 file read (for specific value lookups)             │
├─────────────────────────────────────────────────────────────┤
│  Layer 6: ACTIVE WORK STATE (_local/tickets/)               │
│  Per-ticket: progress, scraped knowledge, branch mapping.   │
│  NOT committed to git. Ephemeral operational state.         │
│  Managed by: /ticket skill                                  │
│  Cost: 1 file read (progress.md for the active ticket)      │
└─────────────────────────────────────────────────────────────┘
```

### How an Agent Traverses the Layers

For a typical task — say "investigate why operation X failed":

```
CLAUDE.md (auto)  →  Know safety rules, know /investigate-ticket exists
       ↓
AGENT_ROUTER.md   →  "Investigate support ticket → runbooks/SUPPORT_TICKET_INVESTIGATION.md"
       ↓
Runbook (L4)      →  Step-by-step: query DB, check GCP logs, find SRVEXE
       ↓
Reference (L5)    →  SQL templates, GCP cluster mapping, connection strings
       ↓
Domain (L2)       →  Only if needed: understand operation lifecycle, provider patterns
```

**Key insight:** Most tasks only need 2-3 layers. The agent never reads all 55 docs — it reads the router and follows one path.

---

## Skills: Turning Documentation into Action

Skills (slash commands) sit **on top of** the five layers. They are the **action interface** — pre-packaged workflows that combine routing, knowledge, and instructions into a single invocation.

```
┌───────────────────────────────────────────────────────────┐
│                    SKILL LAYER                             │
│  /investigate-ticket  /hotfix  /check-operation  /qa-report│
│                                                            │
│  Each skill:                                               │
│  1. Injects the right context (from Layers 2-5)           │
│  2. Provides step-by-step instructions (Layer 4)          │
│  3. Constrains the agent's tools and scope                │
│  4. Accepts arguments ($ARGUMENTS) for parameterization   │
└────────────────────────┬──────────────────────────────────┘
                         │ reads from
                         ▼
┌───────────────────────────────────────────────────────────┐
│              KNOWLEDGE LAYERS 0-5                          │
│  CLAUDE.md → AGENT_ROUTER → Domain → Conventions →        │
│  Runbooks → Reference                                     │
└───────────────────────────────────────────────────────────┘
```

### Without Skills (Current State)

```
User: "Check why operation abc-123 failed"
  ↓
Agent reads AGENT_ROUTER.md                    (~100 lines)
Agent reads SUPPORT_TICKET_INVESTIGATION.md    (~200 lines)
Agent reads AGENT_KNOWLEDGE.md §16 for SQL     (~50 lines)
Agent reads DATABASE_ACCESS.md for credentials (~100 lines)
Agent composes the SQL query
Agent runs the query
  ↓
Total: 4 file reads, ~450 lines consumed, 2-3 minutes
```

### With Skills (Proposed State)

```
User: "/check-operation abc-123"
  ↓
Skill injects: SQL templates + credentials + GCP log commands
Agent runs the query immediately
  ↓
Total: 0 file reads, skill provides everything, 15 seconds
```

**Skills eliminate the discovery phase.** The agent doesn't need to find the right docs — the skill delivers the right context directly.

---

## Skill Categories

### Operational Skills (from runbooks/)

These encode step-by-step procedures. The agent follows them like a checklist.

| Skill                 | Trigger                      | What It Automates                                         |
| --------------------- | ---------------------------- | --------------------------------------------------------- |
| `/investigate-ticket` | Support ticket arrives       | DB queries, GCP logs, SRVEXE lookup, findings summary     |
| `/check-operation`    | "Why did operation X fail?"  | SQL for operation + tasks, error extraction, CSM job logs |
| `/hotfix`             | Urgent production fix needed | Branch creation, cherry-pick, deploy, verification        |
| `/release`            | Scheduled deployment         | Build, test, stage-gate approvals, deploy sequence        |
| `/qa-report`          | Weekly QA meeting            | DB error stats, GCP logs, SonarQube metrics, Top 5 report |
| `/sonar-todos`        | SonarQube cleanup sprint     | Fetch issues via API, categorize, implement or convert    |

### Development Skills (from development/ + testing/)

These enforce conventions. The agent produces code that matches existing patterns.

| Skill                        | Trigger                      | What It Enforces                                      |
| ---------------------------- | ---------------------------- | ----------------------------------------------------- |
| `/add-provisioning-scenario` | New SAP product to provision | Domain class, schema, migration, CSIT record, factory |
| `/add-post-provisioning`     | New post-prov step needed    | Domain class, response schema, attribute extraction   |
| `/write-test`                | Tests needed for new code    | Testing rules, separate process arch, nock patterns   |
| `/db-query [env]`            | Need to query a remote DB    | Connection details, READ-ONLY rules, table naming     |
| `/debug-pubsub`              | Stuck async operation        | AwaitMessage SQL, subscription health, message flow   |

### Context Skills (non-invocable, agent-triggered)

These are not slash commands. Claude invokes them automatically when it recognizes the task matches.

| Skill           | Triggers When                    | What It Loads                              |
| --------------- | -------------------------------- | ------------------------------------------ |
| `cde-architect` | Agent needs system understanding | AGENT_ROUTER + DOMAIN_MODEL + ARCHITECTURE |
| `cde-safety`    | Agent is about to modify code    | CODING_GUIDELINES + safety rules           |

---

## How Skills, Layers, and Agent Teams Fit Together

```
┌─────────────────────────────────────────────────────────┐
│                    AGENT TEAMS                           │
│  Multiple independent Claude sessions working in        │
│  parallel, coordinated by a team lead.                  │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐             │
│  │ Lead     │  │ Teammate │  │ Teammate │             │
│  │ /qa-rep  │  │ /hotfix  │  │ /write-  │             │
│  │  ort     │  │          │  │  test    │             │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘             │
│       │              │              │                    │
│       ▼              ▼              ▼                    │
│  Each teammate has its own context window               │
│  Each loads only the layers it needs                    │
│  Each can invoke skills independently                   │
└─────────────────────────────────────────────────────────┘
         │              │              │
         ▼              ▼              ▼
┌─────────────────────────────────────────────────────────┐
│              SKILL LAYER (per-agent)                     │
│  Pre-packaged workflows with injected context           │
└─────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│         KNOWLEDGE LAYERS 0-5 (shared docs)              │
│  Same 55 docs, but each agent reads only what it needs  │
└─────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│              CODEBASE + DATABASES + GCP                  │
│  The actual system being operated on                    │
└─────────────────────────────────────────────────────────┘
```

### Example: Sprint Support Day

```
You say: "Handle today's support — 3 tickets came in,
          also prepare the QA report, and there's a
          sonar cleanup needed on the current branch."

Team Lead distributes:
  Teammate 1: /investigate-ticket DINC-4521
  Teammate 2: /investigate-ticket DINC-4522
  Teammate 3: /qa-report
  You (lead):  /sonar-todos

All four work in parallel.
Each loads only the knowledge layers it needs.
Each follows the skill's procedure autonomously.
Results converge when all finish.
```

---

## The Information Flow

```
                         ┌──────────────────┐
                         │   User Request    │
                         └────────┬─────────┘
                                  │
                    ┌─────────────┼──────────────┐
                    │             │               │
              Skill matches?   Router?      Direct code?
                    │             │               │
                    ▼             ▼               ▼
              ┌──────────┐ ┌──────────┐   ┌──────────────┐
              │  SKILL   │ │  ROUTER  │   │  CLAUDE.md   │
              │  (L0+)   │ │  (L1)    │   │  (L0 only)   │
              │ Injects  │ │ Points   │   │ Safety rules │
              │ context  │ │ to docs  │   │ + patterns   │
              └────┬─────┘ └────┬─────┘   └──────┬───────┘
                   │            │                 │
                   ▼            ▼                 ▼
              Agent executes   Agent reads     Agent writes
              with full        targeted doc    code following
              context already  then executes   conventions
              loaded                            from L0
```

### Why This Matters

| Without Architecture                      | With Architecture                               |
| ----------------------------------------- | ----------------------------------------------- |
| Agent reads 5-10 files to orient itself   | Agent reads 0-2 files (skill or router + 1 doc) |
| 3-5 minutes before productive work starts | 15-30 seconds to first useful action            |
| May miss safety rules buried in docs      | Safety rules auto-injected every session        |
| Inconsistent code patterns                | Conventions enforced via skills                 |
| One agent does everything sequentially    | Team of agents works in parallel                |
| Knowledge rediscovered every session      | Knowledge persisted in skills + memory          |

---

## Implementation Status

| Component                  | Status         | Location                                                    |
| -------------------------- | -------------- | ----------------------------------------------------------- |
| Layer 0: CLAUDE.md         | **Done**       | `CLAUDE.md` (project root)                                  |
| Layer 1: AGENT_ROUTER      | Done           | `md/AGENT_ROUTER.md`                                        |
| Layers 2-5: Documentation  | Done (55 docs) | `md/architecture/`, `md/development/`, `md/runbooks/`, etc. |
| Layer 6: Active Work State | **Done**       | `_local/tickets/` (3 tickets backfilled)                    |
| Skills (13 total)          | **Done**       | `.claude/skills/`                                           |
| Agent Teams                | **Done**       | `settings.json` → `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`  |
| Agent Memory               | Done           | `~/.claude/projects/.../memory/MEMORY.md`                   |
| Documentation Meta-Guide   | Done           | `md/AGENTIC_DOCUMENTATION_GUIDE.md`                         |
| Presentation Notes         | Done           | `md/AI.md` (this file)                                      |

### Skills Inventory

| Skill                        | Type         | Location                                            |
| ---------------------------- | ------------ | --------------------------------------------------- |
| `/ticket`                    | **Workflow** | `.claude/skills/ticket/SKILL.md`                    |
| `/email`                     | Outlook      | `.claude/skills/email/SKILL.md`                     |
| `/catchup` (`/inbox`)        | Outlook      | `.claude/skills/catchup/SKILL.md`                   |
| `/check-operation`           | Operational  | `.claude/skills/check-operation/SKILL.md`           |
| `/investigate-ticket`        | Operational  | `.claude/skills/investigate-ticket/SKILL.md`        |
| `/hotfix`                    | Operational  | `.claude/skills/hotfix/SKILL.md`                    |
| `/sonar-todos`               | Operational  | `.claude/skills/sonar-todos/SKILL.md`               |
| `/qa-report`                 | Operational  | `.claude/skills/qa-report/SKILL.md`                 |
| `/write-test`                | Development  | `.claude/skills/write-test/SKILL.md`                |
| `/add-provisioning-scenario` | Development  | `.claude/skills/add-provisioning-scenario/SKILL.md` |
| `/db-query`                  | Development  | `.claude/skills/db-query/SKILL.md`                  |
| `/debug-pubsub`              | Development  | `.claude/skills/debug-pubsub/SKILL.md`              |

### Next Steps

1. Test each skill in a fresh session to validate context injection
2. Iterate: observe which docs agents read most, convert those paths into skills
3. Add more skills as new runbooks or workflows emerge

---

## Key Takeaways for the Team

1. **Documentation is an API for AI agents.** The quality of routing matters more than the quality of prose.

2. **Skills are the killer feature.** They eliminate the discovery phase entirely — the agent goes from question to action in seconds instead of minutes.

3. **Layers control cost.** Each layer adds context but costs tokens. Most tasks need only 2-3 layers. Skills pre-select the right layers.

4. **Agent teams multiply throughput.** Three support tickets + a QA report + a sonar cleanup can run simultaneously instead of sequentially.

5. **The architecture is maintainable.** Adding a new runbook automatically makes it routable. Wrapping it in a skill makes it instant. No framework changes needed.

---

_This document is maintained as team presentation notes. For the technical meta-guide on documentation structure, see [AGENTIC_DOCUMENTATION_GUIDE.md](AGENTIC_DOCUMENTATION_GUIDE.md)._
