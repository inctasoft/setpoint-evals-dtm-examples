# Cursor Rules - DTM (Distributed Task Manager)

**Last Updated**: February 19, 2026
**Purpose**: AI assistant guidance for DTM (Distributed Task Manager) development

---

## 📚 Available Rule Files

This directory contains specialized rule files for different aspects of the codebase. Cursor AI reads all `.mdc` files automatically.

### Core Architecture
**[architecture.mdc](architecture.mdc)** - Complete system architecture
- Two-phase step pattern (input + output)
- Lambda workers details
- Database schema
- Kafka & SQS architecture
- Orchestration flow
- Naming conventions
- Critical rules

### Testing Standards
**[testing.mdc](testing.mdc)** - Testing best practices
- Unit & E2E test structure
- Test coverage requirements
- Manual testing scripts
- Debugging tests
- CI/CD integration

### Database & ORM
**[typeorm.mdc](typeorm.mdc)** - TypeORM & PostgreSQL
- Entity definitions
- Repository patterns
- Migration best practices
- Indexing strategy
- Query optimization
- Workflow source DB (read-only) access

### Package Management
**[pnpm-expert.mdc](pnpm-expert.mdc)** - pnpm monorepo
- Workspace protocol (`workspace:*`)
- Docker compatibility (hoisted)
- Filter patterns
- Build order
- Troubleshooting

### Code Quality
**[code-quality.mdc](code-quality.mdc)** - Standards & linting
- TypeScript standards
- ESLint configuration
- Prettier formatting
- Critical quality rules
- Code review checklist
- Specific patterns (DTOs, services, repositories)

### Documentation
**[docs.mdc](docs.mdc)** - Documentation standards
- Documentation structure
- Markdown best practices
- Required documentation
- Templates
- Mermaid diagrams

### Security
**[safety.mdc](safety.mdc)** - Security best practices
- Secrets management
- Input validation
- Authentication & authorization (TODO)
- Logging safely
- Data protection
- Security checklist

### CI/CD
**[ci-cd.mdc](ci-cd.mdc)** - Pipeline best practices
- Step dependency validation
- GitHub Actions patterns
- Caching dependencies
- Workflow validation
- Common pitfalls

### Lambda Workers
**[worker-writer.mdc](worker-writer.mdc)** - Creating new Lambda workers
- Input + Output worker implementation
- TypeORM entity creation for source databases
- Infrastructure checklist (steps, queues, Kafka topics, poller, deployment)
- TestOptions DTO support (CRITICAL for testability)
- Fan-out vs batch worker patterns

### AI Assistant Behavior
**[agent-rules.mdc](agent-rules.mdc)** - General guidelines
- Core principles
- Architecture awareness
- Implementation guidelines
- Testing guidelines
- Documentation guidelines
- Decision-making framework

---

## 🎯 How Cursor Uses These Files

### Automatic Loading
Cursor automatically loads all `.mdc` files in `.cursor/` directory and provides them to the AI assistant as context.

### File-Specific Rules
Each `.mdc` file can specify:
- **description**: What the rules cover
- **globs**: Which files they apply to
- **alwaysApply**: Whether to always include (most are `true`)

### Hierarchy
1. **alwaysApply: true** - Loaded for all conversations
2. **globs matched** - Loaded when editing matching files
3. **Manual reference** - AI can reference specific files when needed

---

## 📖 Quick Reference

### For AI Assistants

**Starting a new task?**
1. Read `.cursor/architecture.mdc` for system overview
2. Check relevant specialized file (testing, typeorm, etc.)
3. Search codebase for similar patterns

**Making changes?**
1. Follow patterns in `code-quality.mdc`
2. Check `testing.mdc` for test requirements
3. Update docs per `docs.mdc` guidelines
4. Verify security per `safety.mdc`

**Confused about something?**
1. Check `architecture.mdc` for architectural context
2. Review `agent-rules.mdc` for decision-making guidance
3. Search `../docs/MASTER-INDEX.md` for detailed guides (START HERE!)

---

## 🔄 Maintenance

### When to Update
- **architecture.mdc**: Any architectural changes
- **testing.mdc**: New testing patterns or tools
- **typeorm.mdc**: Database schema changes
- **pnpm-expert.mdc**: Monorepo structure changes
- **code-quality.mdc**: New linting rules or standards
- **docs.mdc**: Documentation standards change
- **safety.mdc**: New security requirements
- **ci-cd.mdc**: Pipeline changes
- **agent-rules.mdc**: General guideline updates

### Who Updates
- Developers after major changes
- Architects after design decisions
- Security team after audits
- DevOps after CI/CD changes

---

## 🎓 Additional Resources

### Project Documentation
- `../README.md` - Project overview
- `../PROJECT-STATE-COMPLETE.md` - Complete project snapshot
- `../docs/MASTER-INDEX.md` - Canonical documentation index (START HERE!)
- `../.cursorrules` - Backup comprehensive rules (for tools that don't read `.mdc` files)

### External Resources
- **Cursor AI**: https://cursor.sh
- **Mermaid**: https://mermaid.js.org (for rule file metadata)

---

## ✅ Status

**Last major update**: February 19, 2026

- ✅ architecture.mdc (333 lines)
- ✅ testing.mdc (complete test guidelines)
- ✅ typeorm.mdc (database best practices)
- ✅ pnpm-expert.mdc (monorepo management)
- ✅ code-quality.mdc (standards & linting)
- ✅ docs.mdc (documentation guidelines)
- ✅ safety.mdc (security best practices)
- ✅ ci-cd.mdc (pipeline rules)
- ✅ agent-rules.mdc (AI behavior guidelines)
- ✅ api-standards.mdc (API design)
- ✅ deployment.mdc (deployment strategies)

**Total**: 11 comprehensive rule files covering all aspects of development

---

## 🎉 Result

DTM now has **comprehensive, organized Cursor rules** that:
- ✅ Cover all aspects of development (architecture, testing, database, security, etc.)
- ✅ Are modular and easy to maintain
- ✅ Include real examples from this codebase
- ✅ Provide clear guidance for AI assistants
- ✅ Are automatically loaded by Cursor
- ✅ Keep `.cursorrules` as backup for compatibility

**Both systems work together** - `.cursor/*.mdc` (primary) + `.cursorrules` (backup) = comprehensive AI guidance!

---

## Claude Code Integration

The project also includes a `CLAUDE.md` file at the repository root for [Claude Code](https://claude.com/claude-code) (Anthropic's CLI tool). This file provides a condensed version of the key rules, architecture, database ports, and operational commands in a format optimized for Claude Code's context window.

- **`CLAUDE.md`**: Concise project guide loaded automatically by Claude Code on every conversation
- **`.cursor/*.mdc`**: Detailed domain-specific rules (serve as both Cursor rules AND reference documentation)

When updating rules, keep both in sync:
- `.cursor/*.mdc` files are the **detailed source of truth**
- `CLAUDE.md` is the **condensed summary** for Claude Code

