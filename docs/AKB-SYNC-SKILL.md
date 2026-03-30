---
name: akb-sync
description: Sync the Agentic Knowledge Base (AKB). Reviews current session context for discoveries, patterns, and corrections worth persisting to the markdown documentation.
user-invokable: true
argument-hint: "[optional: 'deep' for full gap analysis, 'quick' for session-only check]"
---

# AKB Sync — Agentic Knowledge Base Update

Scan the current session context and update the AKB (markdown docs in `md/`, `CLAUDE.md`, `.claude/`, and auto-memory files).

Mode: `$ARGUMENTS` (default: `quick`)

---

## Quick Mode (default)

Review **this session only** for knowledge worth persisting:

### Step 1: Identify Candidates

Scan the conversation for:

- **New discoveries** — things that surprised us or were non-obvious (e.g., SPC SRVEXE ≠ Process Execution ID)
- **Corrections** — wrong assumptions that were corrected (update or remove incorrect AKB entries)
- **New patterns** — debugging techniques, SQL queries, log search recipes that worked
- **Gotchas** — things that failed in a confusing way and the root cause was non-obvious
- **Terminology** — new terms or abbreviations that were introduced or clarified
- **Configuration changes** — new skills, hooks, settings, or workflows that were added

### Step 2: Check for Duplicates

For each candidate, check if it already exists in:

1. `md/AGENT_KNOWLEDGE.md` — quick-reference knowledge
2. `md/GLOSSARY.md` — terms and definitions
3. Auto-memory `MEMORY.md` — cross-session memory
4. Relevant `md/architecture/*.md` or `md/provisioning/*.md` docs

**Do not write duplicate entries.** Update existing entries if the new info adds to them.

### Step 3: Persist

For each non-duplicate candidate:

- **Gotchas/patterns** → `md/AGENT_KNOWLEDGE.md` (appropriate section)
- **Terms/abbreviations** → `md/GLOSSARY.md`
- **Architecture insights** → relevant `md/architecture/*.md`
- **Cross-session memory** → `MEMORY.md` (keep concise, link to full docs)
- **Debugging recipes** → `md/AGENT_KNOWLEDGE.md` or relevant runbook

### Step 4: Report

Briefly report to the user:

```
AKB Sync (quick):
- Persisted: <count> items
  - <item 1 summary> → <target file>
  - <item 2 summary> → <target file>
- Already known: <count> items skipped
- Nothing to persist (if applicable)
```

---

## Deep Mode (`/akb-sync deep`)

Full gap analysis — compare what the agent knows against the AKB docs:

### Step 1: Load All AKB Docs

Read the core documentation set:

- `md/AGENT_ROUTER.md`
- `md/AGENT_KNOWLEDGE.md`
- `md/GLOSSARY.md`
- `md/architecture/DOMAIN_MODEL.md`
- `md/architecture/ARCHITECTURE.md`
- `md/architecture/OPERATION_TYPES.md`
- `md/architecture/OPERATION_LIFECYCLE.md`
- `md/architecture/PUBSUB_MESSAGING.md`
- `md/development/CODING_GUIDELINES.md`
- Auto-memory `MEMORY.md`

### Step 2: Identify Gaps

Compare loaded docs against agent's accumulated knowledge from all sessions:

- **Missing docs** — knowledge that exists in memory but not in any doc
- **Outdated info** — docs that contradict current codebase state
- **Incomplete sections** — docs with TODOs, placeholders, or known gaps
- **Stale references** — links to files that have moved or been renamed

### Step 3: Propose Updates

Present a summary of proposed changes to the user:

```
AKB Deep Sync — Gap Analysis:
1. [NEW] <description> → proposed target file
2. [UPDATE] <file> — <what needs updating>
3. [STALE] <file> — <what's outdated>
```

Ask user: "Proceed with all updates, or select specific items?"

### Step 4: Execute

Apply approved updates and report final results.

---

## Rules

- **Never delete knowledge** without user approval — only add or update
- **Keep entries concise** — link to detailed docs rather than duplicating content
- **Prefer updating existing entries** over creating new ones
- **Follow existing naming conventions** in each target file
- **Do not persist session-specific context** (operation IDs, temp values, in-progress work)
- **Do persist reusable knowledge** (patterns, recipes, gotchas, terminology)
