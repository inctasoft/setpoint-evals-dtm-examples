# Agentic Documentation Guide

> A practical guide to structuring documentation for AI agent consumption.
> Based on lessons learned from restructuring the CDE documentation (89 files, 1500+ artifacts).
>
> **Author:** AI Agent (Claude), with direction from Krasimir Atanasov
> **Date:** 2026-03-12

---

## Table of Contents

1. [The Problem with Traditional Documentation](#the-problem-with-traditional-documentation)
2. [Core Principles](#core-principles)
3. [The AGENT_ROUTER Pattern](#the-agent_router-pattern)
4. [Information Architecture](#information-architecture)
5. [Indexing Strategy](#indexing-strategy)
6. [Content Lifecycle](#content-lifecycle)
7. [Writing for Agents vs Humans](#writing-for-agents-vs-humans)
8. [The CDE Implementation](#the-cde-implementation)
9. [Anti-Patterns](#anti-patterns)
10. [Measuring Success](#measuring-success)

---

## The Problem with Traditional Documentation

### What Goes Wrong

Most project documentation evolves organically. Someone writes a README. Another person creates a knowledge base. A third adds an index. Over months, you end up with:

1. **Multiple entry points** competing for authority (README vs INDEX vs KNOWLEDGE_BASE)
2. **Monolithic files** that grow without bound (1000+ line knowledge bases)
3. **Non-documentation artifacts** mixed in (patches, screenshots, build outputs)
4. **Stale content** that nobody deletes because "it might be useful"
5. **Duplicate information** across files with no canonical source

For human developers, this is annoying but manageable — they learn the layout over weeks and develop intuition for where things are. For AI agents, it's catastrophic.

### Why Agents Struggle

An AI agent arriving at a codebase has:

- **No memory** of previous sessions (unless summarized)
- **Limited context window** — cannot read all 89 files at once
- **No spatial intuition** — cannot "feel" where information is likely to be
- **High cost per search** — each file read consumes tokens and time
- **No ability to ask colleagues** — must find answers in the documentation itself

The consequence: if an agent reads the wrong entry point, it may spend its entire context window consuming outdated or duplicate information, never reaching the content it actually needs.

**The fundamental insight:** Agent-oriented documentation is about _minimizing time to the right information_, not about writing better prose.

---

## Core Principles

### 1. Single Entry Point (The Router)

**Every documentation tree must have exactly ONE file that an agent reads first.**

This file does NOT contain knowledge. It contains _routing instructions_: "If you need X, go to Y." Think of it as a function that takes a task description and returns a file path.

**Why:** Agents are instruction-followers. Give them one clear instruction ("read AGENT_ROUTER.md first") and they will follow it perfectly. Give them three competing files and they will waste tokens reading all of them.

### 2. Separation of Reference from Procedure

**Reference** = facts that don't change often (entity models, enum values, connection strings)
**Procedure** = step-by-step instructions for completing a task (hotfix workflow, DB tunnel setup)

These must live in separate files because:

- Reference is _scanned_ (ctrl+F for a value)
- Procedure is _followed_ (step 1, step 2, step 3)
- Agents use them differently: reference for context-building, procedure for action execution

### 3. Canonical Sources (No Duplication)

Every fact should exist in exactly one file. Other files may _link_ to it but must not _copy_ it.

**Why:** When an agent encounters conflicting information across two files, it cannot determine which is correct. It must either guess (risky) or ask the user (slow). A canonical source eliminates this class of error entirely.

### 4. Progressive Disclosure

Structure documentation in layers:

1. **Router** (~50-100 lines) — what to read for which task
2. **Domain documents** (~200-500 lines) — focused on one topic
3. **Deep references** (~500-1000 lines) — exhaustive detail for complex topics

An agent should be able to complete most tasks by reading the router + one domain document. Deep references are only needed for investigation or debugging.

### 5. Explicit Staleness Management

Documentation has a lifecycle: Active → Stale → Archived. Without explicit management, stale documents accumulate and poison agent context.

**Solution:** An `_archive/` directory with a clear rule: "Files in \_archive/ are deprecated. Do not read unless researching history."

---

## The AGENT_ROUTER Pattern

### What It Is

A single markdown file (<100 lines) that serves as the starting point for all agent interactions with the documentation. It contains:

1. **A mental model** — 3-5 sentences explaining the system (enough for an agent to orient itself)
2. **A routing table** — "If your task is X, read Y" (task-based, not topic-based)
3. **Safety rules** — what agents must NOT do (e.g., "never write to production databases")
4. **A directory map** — physical layout of the documentation tree

### Design Decisions

**Why task-based routing instead of topic-based?**

Topic-based: "For database information, see DATABASE_ACCESS.md"
Task-based: "To query a remote database, see runbooks/DB_TUNNEL_SETUP.md"

Agents work in tasks, not topics. When an agent is told "investigate this support ticket," it doesn't think "I need the database topic." It thinks "what steps do I need to complete this task?" Task-based routing matches the agent's execution model.

**Why keep it under 100 lines?**

The router will be read on every agent session. It must be small enough to fit in context without consuming meaningful budget. 100 lines is roughly 2-3KB — negligible even in constrained context windows.

**Why include safety rules in the router?**

Safety rules are the FIRST thing an agent should internalize. Putting them in a separate file risks them being skipped. In the router, they're unavoidable.

### Template

```markdown
# Agent Router

> Read this file first. It routes you to the right documentation.

## System in 30 Seconds

[3-5 sentences describing the system]

## Safety Rules

- [Rule 1]
- [Rule 2]

## What Do You Need?

| Task            | Read This        |
| --------------- | ---------------- |
| [Common task 1] | [path/to/doc.md] |
| [Common task 2] | [path/to/doc.md] |
| ...             | ...              |

## Directory Map

[Physical layout of documentation tree]
```

---

## Information Architecture

### The Five-Layer Model

```
Layer 1: AGENT_ROUTER.md          (routing — WHERE to look)
Layer 2: Domain docs               (understanding — WHAT things are)
          architecture/*.md
          provisioning/*.md
Layer 3: Development guides        (patterns — HOW to write code)
          development/*.md
          testing/*.md
Layer 4: Runbooks                  (procedures — HOW to operate)
          runbooks/*.md
Layer 5: Reference data            (facts — WHAT values are)
          AGENT_KNOWLEDGE.md
          GLOSSARY.md
          WIKI-SYNC/*.md
```

### Why These Categories?

**Architecture docs** answer "How does the system work?" — Entity models, data flows, integration patterns. An agent reads these to build a mental model before making changes.

**Development docs** answer "How should I write code?" — Coding guidelines, schema rules, testing conventions. An agent reads these to ensure its output matches project standards.

**Runbooks** answer "How do I perform this operation?" — Step-by-step procedures with exact commands. An agent reads these when executing operational tasks (releases, investigations, DB access).

**Reference data** answers "What is this value?" — Enum definitions, connection strings, error codes. An agent reads these for quick lookups during implementation.

The key insight is that each category serves a different _phase_ of agent work:

1. Understand the system (architecture)
2. Learn the conventions (development)
3. Execute the task (runbooks)
4. Look up specific values (reference)

### Directory Structure

```
md/
  AGENT_ROUTER.md       <-- Always read first
  AGENT_KNOWLEDGE.md    <-- Quick reference (kept lean)
  MASTER_INDEX.md       <-- Full catalog for humans
  README.md             <-- Human onboarding
  GLOSSARY.md           <-- Term definitions

  architecture/         <-- System design (relatively stable)
  provisioning/         <-- Domain-specific technical docs
  development/          <-- Coding & local setup guides
  testing/              <-- Test strategy & scripts
  runbooks/             <-- Operational step-by-step procedures
  bugfixes/             <-- Historical analyses (append-only)
  WIKI-SYNC/            <-- External content copies
  _archive/             <-- Deprecated (do not read)
```

### Naming Conventions

- **UPPERCASE.md** — Top-level routing/index files
- **UPPERCASE_WITH_UNDERSCORES.md** — Domain documents
- **lowercase-with-dashes/** — Subdirectories
- **\_prefix/** — Special directories (\_archive/, \_local/)

The uppercase convention signals "this is an important entry point." Agents and humans both benefit from this visual hierarchy.

---

## Indexing Strategy

### How Agents Discover Information

Agents have three discovery mechanisms:

1. **Direct routing** — AGENT_ROUTER.md says "read X for task Y"
2. **Semantic search** — IDE tools search documentation by meaning
3. **Grep/file search** — Exact string or pattern matching

Your indexing strategy must optimize for all three.

### Optimizing for Direct Routing

The AGENT_ROUTER.md routing table should cover 80% of common tasks. For CDE, these are:

- Provisioning/deprovisioning operations
- Support ticket investigation
- Hotfix releases
- Code changes (new features, bug fixes)
- Database operations

### Optimizing for Semantic Search

Semantic search works on natural language. To optimize:

1. **Use descriptive headings** — "## SPC Integration Internals" is searchable; "## Section 32" is not
2. **Include keywords in the first paragraph** — Semantic search weights the beginning of sections
3. **Use consistent terminology** — Don't alternate between "CSI" and "cloud solution instance" randomly

### Optimizing for Grep Search

Grep is exact-match. To optimize:

1. **Include enum values verbatim** — `SPC_IAS_CREATE`, `ACE51201` should appear in docs exactly as in code
2. **Include file paths** — `src/domain/cloud-solutions/automation-scenarios/` helps agents find code
3. **Include SQL table names** — `operations.operations`, `cloud_solutions.instances`

### Cross-Referencing

Every document should include links to related documents. But follow these rules:

- **Link to canonical source, not copies** — Link to `development/DATABASE_ACCESS.md`, not repeat its content
- **Use relative paths** — `[runbooks/HOTFIX_WORKFLOW.md](runbooks/HOTFIX_WORKFLOW.md)` works regardless of where the repo is cloned
- **Bidirectional where possible** — If A links to B, B should link back to A (helps agents navigate both directions)

### The Routing Header Pattern

Every domain document should start with a routing header that tells agents where they came from and where they can go:

```markdown
# Topic Name

> Part of: [architecture/](../AGENT_ROUTER.md)
> Related: [OTHER_DOC.md](OTHER_DOC.md), [ANOTHER_DOC.md](ANOTHER_DOC.md)
```

This eliminates "dead ends" where an agent reads a document but doesn't know what to read next.

---

## Content Lifecycle

### The Three States

```
ACTIVE    — Current, accurate, maintained
  |
  v
STALE     — Partially outdated, superseded by other docs
  |
  v
ARCHIVED  — Deprecated, moved to _archive/
```

### Rules

1. **Active documents** live in their category directory (architecture/, development/, etc.)
2. **When a document becomes stale**, add a deprecation notice at the top:
   ```markdown
   > **DEPRECATED:** This document is superseded by [NEW_DOC.md](NEW_DOC.md). Kept for historical reference.
   ```
3. **When a document is fully superseded**, move it to `_archive/`
4. **Never delete documentation** — archive it. Agent sessions may reference old file paths.

### What Triggers Archival?

- Content fully duplicated in a better-organized document
- Point-in-time status document (e.g., "FSM Provisioning Status 2026-02-17")
- Planning documents after implementation is complete
- Bug fix analyses after the fix is merged and stable

### The \_archive/ Directory

This is NOT a graveyard — it's a searchable history. Files in `_archive/` are:

- Still git-tracked
- Still grep-searchable
- Still readable if an agent specifically needs historical context
- NOT listed in routing tables or indexes

---

## Writing for Agents vs Humans

### Key Differences

| Aspect        | Human Reader                    | Agent Reader                                    |
| ------------- | ------------------------------- | ----------------------------------------------- |
| **Reads**     | Selectively, based on intuition | Sequentially, what router says                  |
| **Remembers** | Across sessions (brain)         | Only within session (context window)            |
| **Navigates** | By clicking links, scrolling    | By reading file paths, following links          |
| **Processes** | Skims, focuses on highlights    | Reads thoroughly, may over-attend to detail     |
| **Tolerates** | Mild inaccuracy, fills gaps     | Confusion from contradictions, cannot fill gaps |

### Writing Guidelines for Agent-Consumable Docs

1. **Lead with the conclusion** — "ACE26314 is the SERVICE_DEFINITION_ID for SSC deprovisioning" before explaining why

2. **Use tables for lookup data** — Agents parse tables efficiently and can extract specific cells

3. **Use code blocks for exact values** — Agents distinguish between prose and code; `ACE26314` in a code block signals "this is a literal value"

4. **Avoid ambiguity** — "usually" and "sometimes" are poison for agents. Be specific: "For IAS scenarios, X. For BIZX scenarios, Y."

5. **Include concrete examples** — Abstract descriptions are harder for agents to apply. Show the actual SQL query, not just "you can query the database."

6. **Mark safety-critical information explicitly** — Use "WARNING:", "NEVER:", "READ-ONLY" — agents are trained to treat these as hard constraints

7. **Keep files under 500 lines when possible** — A 500-line file is one read_file call. A 2000-line file requires four calls and strategic line range selection.

### What to Avoid

- **Motivational text** — "Welcome to the codebase! You'll do great!" adds no information
- **Rhetorical questions** — "But what if the schema fails?" Just state what happens when it fails
- **Lengthy introductions** — Get to the routing table or technical content within the first 20 lines
- **Emoji overuse** — One or two for visual hierarchy is fine; decorating every section header wastes tokens

---

## The CDE Implementation

### Before (Problems)

```
md/
  README.md              (630 lines, human-oriented, no agent routing)
  MASTER_INDEX.md        (299 lines, comprehensive but overwhelming)
  AGENT_KNOWLEDGE.md     (1270 lines, monolithic knowledge dump)
  PUPPETEER-SSO-...md    (operational procedure in wrong location)
  PLAN_20260213-...md    (stale planning doc)
  47735-TECHNICAL-...md  (stale TODO list)
  POC_PROGRESS.md        (stale progress tracker)
  patch-csi-attributes-clean-includes-certs/  (1562 non-md files!)
  patch-csi-attributes-configurable/          (operational artifacts!)
```

**Symptoms:**

- 3 competing entry points: README, MASTER_INDEX, AGENT_KNOWLEDGE
- No routing — agent had to guess which file contained relevant information
- 1562 non-markdown files polluting the documentation directory
- No separation between reference and procedure
- No archival policy — stale docs accumulated indefinitely

### After (Solution)

```
md/
  AGENT_ROUTER.md        (95 lines — THE entry point for agents)
  AGENT_KNOWLEDGE.md     (413 lines — slimmed quick-reference)
  MASTER_INDEX.md        (167 lines — full catalog, updated)
  README.md              (640 lines — human onboarding, directs agents away)

  architecture/
    DOMAIN_MODEL.md      (NEW — 919 lines, 33 entities, 13 schemas)

  runbooks/              (NEW — 6 operational procedures)
    HOTFIX_WORKFLOW.md
    RELEASE_PROCESS.md
    SUPPORT_TICKET_INVESTIGATION.md
    DB_TUNNEL_SETUP.md
    SCHEDULER_MANAGEMENT.md
    PUPPETEER_SCRAPING.md

  _archive/              (NEW — 11 deprecated docs)

  (1562 non-md files moved to _local/patches/)
```

**Results:**

- Single entry point (AGENT_ROUTER.md)
- AGENT_KNOWLEDGE.md reduced 67% (1270 → 413 lines) by extracting procedures to runbooks
- 1562 non-documentation files removed from md/
- Operational procedures in dedicated runbooks/ directory
- Stale docs in \_archive/ with clear deprecation policy
- New DOMAIN_MODEL.md provides entity reference that was previously scattered

### Metric Summary

| Metric                       | Before    | After                  | Change   |
| ---------------------------- | --------- | ---------------------- | -------- |
| Entry points                 | 3         | 1                      | -67%     |
| AGENT_KNOWLEDGE.md lines     | 1270      | 413                    | -67%     |
| MASTER_INDEX.md lines        | 299       | 167                    | -44%     |
| Non-md files in md/          | 1562      | 0                      | -100%    |
| Runbooks                     | 0         | 6                      | +6       |
| Entity model coverage        | scattered | 33 entities documented | complete |
| Deprecated docs in main tree | 11        | 0                      | -100%    |

---

## Anti-Patterns

### 1. The Knowledge Dump

**Symptom:** A single file that grows every time the team learns something.
**Problem:** Eventually too long to read in one pass; no structure for finding specific facts.
**Fix:** Extract procedures to runbooks, keep only quick-reference lookup tables.

### 2. The Competing Indexes

**Symptom:** Multiple files claiming to be "the starting point."
**Problem:** Agent reads the wrong one first, wastes context window.
**Fix:** Designate ONE router file. All other files defer to it.

### 3. The Operational Artifact Dump

**Symptom:** Non-documentation files (patches, screenshots, logs) in the documentation directory.
**Problem:** Pollutes search results, confuses directory listings.
**Fix:** Move to a separate directory (\_local/, build/, etc.).

### 4. The Immortal Planning Doc

**Symptom:** "PLAN_20260213-POST-PROVISIONING.md" still in the main tree 6 months after implementation.
**Problem:** Agent may read outdated plans instead of current implementation docs.
**Fix:** Archive after implementation. Add deprecation notice if keeping temporarily.

### 5. The Duplicate Truth

**Symptom:** Database credentials in AGENT_KNOWLEDGE.md AND DATABASE_ACCESS.md AND DB_TUNNEL_SETUP.md.
**Problem:** When credentials change, some copies get updated and others don't.
**Fix:** One canonical source. Others link to it. AGENT_KNOWLEDGE.md has a summary table that links to the canonical doc.

### 6. The Bottomless Reference

**Symptom:** A "reference" document that's 2000+ lines because it tries to be exhaustive.
**Problem:** Agent must do multiple read calls with strategic line ranges, may miss relevant sections.
**Fix:** Split by sub-domain. A 500-line provisioning reference + 500-line operations reference is better than a 1000-line combined reference.

---

## Measuring Success

### How to Know It's Working

1. **Agent first-read accuracy** — Does the agent find the right document on the first try? If AGENT_ROUTER.md is properly maintained, this should be >90%.

2. **Context window efficiency** — How many tokens does the agent spend on documentation before starting its actual task? Lower is better. Target: router + one domain doc + one reference lookup.

3. **Contradiction rate** — How often does an agent encounter conflicting information across documents? Target: zero. Canonical sources prevent this.

4. **Stale document encounters** — How often does an agent read archived material thinking it's current? Target: zero if \_archive/ policy is enforced.

5. **Documentation maintenance cost** — How much time does the team spend updating docs after changes? The routing + canonical source pattern reduces this because each fact lives in one place.

### The Maintenance Contract

This documentation structure requires ongoing maintenance:

- **When adding a new feature:** Add a row to AGENT_ROUTER.md routing table if it's a common task
- **When a document becomes stale:** Move to \_archive/
- **When creating a new document:** Add it to MASTER_INDEX.md
- **Quarterly:** Review AGENT_KNOWLEDGE.md — has it grown beyond 500 lines? Extract to domain docs.

---

## Appendix: Tools and Techniques

### IDE Integration

Modern IDEs (VS Code with Copilot, Cursor, etc.) provide agents with these documentation discovery tools:

- **semantic_search** — Natural language search across the workspace
- **grep_search** — Exact string/regex search
- **file_search** — Glob pattern file discovery
- **read_file** — Read specific line ranges

Your documentation should be optimized for all four:

- Semantic: descriptive headings, natural language summaries
- Grep: exact enum values, file paths, table names
- File search: consistent naming conventions, predictable directory structure
- Read: files under 500 lines, most important content near the top

### The Copilot Instructions File

Most IDEs support a `.github/copilot-instructions.md` file that's automatically included in every agent context. Use this for:

- Pointer to AGENT_ROUTER.md
- Critical safety rules (no production writes)
- Path aliases and import conventions

Keep it under 100 lines. It's consumed on every interaction.

### Frontmatter and Metadata

Consider adding YAML frontmatter to documents:

```markdown
---
category: runbook
status: active
last-reviewed: 2026-03-12
related: [RELEASE_PROCESS.md, DB_TUNNEL_SETUP.md]
---
```

This isn't universally supported yet, but future agent tooling will likely use it for smarter routing.

---

## Summary

The core thesis: **Documentation for AI agents is an information retrieval problem, not a writing problem.**

The quality of your prose matters less than the quality of your routing. An agent that finds the right 200-line document in 10 seconds will outperform an agent that reads a beautifully-written 2000-line document that's only 20% relevant.

Five things to remember:

1. **One entry point** — AGENT_ROUTER.md
2. **Separate reference from procedure** — architecture/ vs runbooks/
3. **One canonical source per fact** — link, don't copy
4. **Archive aggressively** — \_archive/ is your friend
5. **Keep files under 500 lines** — respect the context window
