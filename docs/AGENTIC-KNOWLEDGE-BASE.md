# Agentic Knowledge Base (AKB) — Framework

> A reusable architecture for structuring project knowledge so AI agents work efficiently.
> Project-agnostic. Applicable to any codebase, any AI tool, any team size.

---

## The Core Thesis

Documentation for AI agents is an **information retrieval problem**, not a writing problem.

An agent arriving at a codebase has no memory, a limited context window, and no intuition about where things are. The quality of your *routing* — how fast the agent finds the right 200 lines — matters more than the quality of your prose.

---

## Five Principles

### 1. One Entry Point (The Router)

Every documentation tree has exactly ONE file an agent reads first. It contains routing instructions — "if you need X, read Y" — not knowledge itself. Think of it as a function: `task -> file path`.

Multiple competing entry points (README vs INDEX vs KNOWLEDGE_BASE) force agents to guess which to read. One router eliminates this.

### 2. Progressive Disclosure

Structure knowledge in layers. The router controls which layers an agent reads — agents don't self-select depth. Most tasks need the router + one domain doc. Deep references are rarely needed.

```
Typical task:  Router + 1 doc              = 2 reads
Complex task:  Router + 2-3 domain docs    = 3-4 reads
Full mastery:  Everything (rare)           = 10+ reads
```

### 3. Single Source of Truth

Every fact exists in exactly one file. Other files link to it but never copy it. When an agent encounters conflicting information across files, it cannot determine which is correct — it must guess (risky) or ask the user (slow). Canonical sources eliminate contradictions.

### 4. Separate Reference from Procedure

**Reference** = facts that don't change often (models, enums, connection strings). Agents scan these.
**Procedure** = step-by-step instructions (deploy workflow, investigation runbook). Agents follow these sequentially.

Mixing them forces agents to read everything when they only need one mode.

### 5. Archive Aggressively

Stale documentation actively misleads agents. Move superseded docs to `_archive/` with a deprecation notice. From the agent's perspective, archiving *is* deletion — the doc is removed from routing tables and indexes. From the team's perspective, nothing is lost — it's still in git and grep-searchable.

The rule: **active docs are routable, archived docs are searchable but never routed to.**

---

## The Layer Model

Five layers, numbered L0-L4. Each serves a distinct purpose in the agent's workflow.

```
L0  AUTO-LOADED CONTEXT (CLAUDE.md / copilot-instructions.md)
    Injected every session automatically. Zero agent effort.
    Contains: identity, safety rules, skill pointers, glossary pointer.
    Budget: 0 reads (system provides it). Keep under 150 lines.

L1  ROUTER (AGENT_ROUTER.md or equivalent)
    The ONE file agents read first. Task-based routing table.
    Contains: 30-second mental model, routing table, directory map.
    Budget: 1 read. Keep under 100 lines.

L2  DOMAIN KNOWLEDGE (architecture/, guides/)
    How the system works. Entity models, data flows, integration patterns.
    Read to build a mental model before making changes.
    Budget: 1-3 reads per task (only what's needed).

L3  CONVENTIONS & PROCEDURES (development/, runbooks/)
    How to write code. How to operate. Step-by-step instructions.
    Read before writing code (conventions) or executing tasks (runbooks).
    Budget: 1 read per task.

L4  REFERENCE DATA (glossary, knowledge base, lookup tables)
    Quick lookups: enum values, SQL templates, connection strings.
    Kept lean — extract anything procedural to L3.
    Budget: 1 read for specific value lookups.
```

### How an Agent Traverses Layers

For "investigate why job X failed":

```
L0 (auto)  ->  Know safety rules, know /investigate skill exists
L1 (router) ->  "Investigation task -> runbooks/INVESTIGATION.md"
L3 (runbook) ->  Step-by-step: query DB, check logs, find root cause
L4 (reference) ->  SQL templates, connection strings (if needed)
L2 (domain)  ->  Only if needed: understand system architecture
```

Most tasks touch 2-3 layers. The agent never reads everything.

---

## The Router Pattern

### What It Contains

1. **Mental model** — 3-5 sentences. Enough for the agent to orient itself.
2. **Routing table** — task-based, not topic-based. "If your task is X, read Y."
3. **Safety rules** — what agents must NOT do. Unavoidable because they're in the router.
4. **Directory map** — physical layout of the documentation tree.

### Why Task-Based Routing

Topic-based: *"For database information, see DATABASE.md"*
Task-based: *"To query a remote database, see runbooks/DB_ACCESS.md"*

Agents think in tasks, not topics. When told "investigate this failure," an agent doesn't think "I need the database topic." It thinks "what steps do I need?" Task-based routing matches the agent's execution model.

### Routing Header Pattern

Every domain document starts with a breadcrumb:

```markdown
> Part of: [architecture/](../AGENT_ROUTER.md)
> Related: [LIFECYCLE.md](LIFECYCLE.md), [DATA_MODEL.md](DATA_MODEL.md)
```

Eliminates dead ends. An agent that finishes reading a document always knows what to read next.

---

## Skills: Cached Reasoning Paths

Every time an agent discovers which docs to read for a common task, that reasoning is wasted if the next session must rediscover the same path. Skills cache it.

### Without a Skill

```
User: "Check why job abc-123 failed"
Agent reads router           (~100 lines)
Agent reads investigation runbook (~200 lines)
Agent reads reference for SQL     (~50 lines)
Agent composes and runs query
Total: 3 reads, ~350 lines, 2-3 minutes
```

### With a Skill

```
User: "/check-job abc-123"
Skill injects: SQL templates + credentials + log commands
Agent runs query immediately
Total: 0 reads, skill provides everything, 15 seconds
```

Skills sit on top of the layer model. Each skill:
1. Injects the right context (from L2-L4)
2. Provides step-by-step instructions (L3)
3. Constrains the agent's tools and scope
4. Accepts arguments for parameterization

### Skill Staleness

Skills encode exact commands and file paths. When the underlying system changes, skills go stale *faster* than docs because they're more specific. Every skill should include a `last-verified` date and be re-tested after significant changes. A stale skill is worse than no skill — it executes the wrong thing confidently.

---

## Writing for Agents

### Key Guidelines

1. **Lead with the conclusion** — "X is the ID for Y" before explaining why.
2. **Tables for lookup data** — agents parse tables efficiently.
3. **Code blocks for exact values** — signals "this is a literal value."
4. **Avoid ambiguity** — "usually" and "sometimes" are poison. Be specific.
5. **Concrete examples** — show the actual query, not "you can query the database."
6. **Mark safety-critical info** — WARNING:, NEVER:, READ-ONLY — agents treat these as hard constraints.
7. **Files under 500 lines** — one read call. A 2000-line file requires four calls with strategic ranges.

### What to Avoid

- Motivational text ("Welcome! You'll do great!")
- Rhetorical questions ("But what if it fails?")
- Lengthy introductions — get to the routing table within 20 lines
- Duplicating facts across files

---

## Knowledge Lifecycle

### Three States

```
ACTIVE   ->  Current, routable, in the routing table
STALE    ->  Partially outdated. Add deprecation notice at top.
ARCHIVED ->  Moved to _archive/. Removed from routing. Still searchable.
```

### Decay Detection

Docs don't announce when they're stale. Two mechanisms to catch it:

1. **Verification dates** — each doc gets `last-verified: YYYY-MM-DD`. Monthly sweep: anything unverified for 90 days gets flagged.
2. **Agent confusion signal** — when an agent takes the wrong path or asks "where do I find X?" after reading the router, that's signal the routing table is incomplete. Track these as router gaps.

### The AKB Sync Pattern

A periodic skill that reviews recent session context for knowledge worth persisting:

**Quick mode** (end of session): scan conversation for new discoveries, corrections, patterns, gotchas. Check for duplicates. Persist to the right layer. Report what was added.

**Deep mode** (monthly): read all core docs. Check for internal inconsistencies, stale references, broken links, outdated facts vs current codebase. Propose updates. Execute after user approval.

Rules:
- Never delete knowledge without user approval
- Prefer updating existing entries over creating new ones
- Don't persist session-specific context (temp IDs, in-progress work)
- Do persist reusable knowledge (patterns, recipes, gotchas, terminology)

---

## Anti-Patterns

| Anti-Pattern | Symptom | Fix |
|---|---|---|
| **Knowledge Dump** | Single file grows unbounded (1000+ lines) | Extract procedures to runbooks, keep only lookup tables |
| **Competing Indexes** | Multiple files claim to be "the starting point" | Designate ONE router. All others defer to it |
| **Immortal Planning Doc** | Implementation docs still in main tree months later | Archive after implementation. Deprecation notice if keeping temporarily |
| **Duplicate Truth** | Same fact in 3 files, only 1 gets updated | One canonical source. Others link to it |
| **Bottomless Reference** | 2000+ line "reference" that tries to be exhaustive | Split by sub-domain. Two 500-line files > one 1000-line file |
| **Stale Skill** | Skill executes outdated commands confidently | `last-verified` date + re-test after system changes |

---

## Agent Teams (Parallel Work)

Multiple agents can work simultaneously, each loading only the layers it needs. But parallelism has constraints:

**Safe to parallelize:** Independent tasks touching different files (3 investigations, a QA report, a cleanup).

**Must be serial:** Tasks that modify the same files, tasks where one depends on another's output, architectural decisions that affect shared interfaces.

Each teammate has its own context window and invokes skills independently. The team lead distributes work and merges results.

---

## Portability Checklist

To apply this framework to any project:

| Step | Action |
|---|---|
| 1 | Write L0: CLAUDE.md with identity, safety rules, skill pointers |
| 2 | Write L1: AGENT_ROUTER.md with task-based routing table |
| 3 | Organize existing docs into L2 (domain), L3 (conventions/runbooks), L4 (reference) |
| 4 | Add routing headers to each doc |
| 5 | Create `_archive/` and move stale docs there |
| 6 | Identify top 5 repetitive agent tasks, write skills for them |
| 7 | Add `last-verified` dates, schedule monthly decay sweep |
| 8 | Iterate: observe which docs agents read most, convert those paths into skills |

---

## Summary

Five layers (L0-L4). One router. Skills on top. Archive aggressively.

The architecture is the reusable part. The content is always project-specific.

```
      SKILLS (cached reasoning paths)
          |  reads from
          v
  L0  Auto-loaded context (CLAUDE.md)
  L1  Router (task -> file path)
  L2  Domain knowledge (how the system works)
  L3  Conventions & procedures (how to write code, how to operate)
  L4  Reference data (lookup tables, exact values)
          |
          v
      CODEBASE + EXTERNAL SYSTEMS
```
