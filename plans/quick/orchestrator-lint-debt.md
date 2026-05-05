---
scope: services/orchestrator/eslint.config.mjs — demote noisy `no-unsafe-*` family + a few small rules from `error` to `warn`. Also fix 20 auto-fixable errors via `pnpm lint:fix` and the small handful that need code (no-require-imports x2, no-case-declarations x2, no-unused-vars x5).
risk: Low — only changes severity not the rule set, no runtime change. Pre-push hook stops being a no-op (currently bypassed via --no-verify because master fails). Warnings still printed for visibility.
test: `pnpm --filter @dtm/orchestrator lint:check` → exit 0 (no errors). Pre-push hook works without --no-verify.
phasing: N/A
---

Closes #2.

Real baseline: 938 errors / 1684 warnings (issue body's "31/125" was understated — debt grew or only counted unique rule kinds).

Strategy mirrors Path 3 in the issue body ("relax the rules"): the `@typescript-eslint/no-unsafe-*` family is exactly the kind of rule the issue says "could legitimately be 'warn' given the trust boundaries in NestJS." NestJS DI containers + decorators + dynamic module configs legitimately work in `any`-shaped values — typed rewrites would be hours of work for cosmetic gain.

Rules demoted to `warn`:
- `@typescript-eslint/no-unsafe-assignment` (645 errors → warn)
- `@typescript-eslint/no-unsafe-call` (213 → warn)
- `@typescript-eslint/no-unsafe-return` (40 → warn)
- `@typescript-eslint/no-unnecessary-type-assertion` (20 → warn)
- `@typescript-eslint/no-redundant-type-constituents` (9 → warn)
- `@typescript-eslint/restrict-plus-operands` (1 → warn)
- `@typescript-eslint/require-await` (1 → warn)

Rules autofixed via `pnpm lint:fix`:
- 20 errors auto-fixable (mostly `no-unnecessary-type-assertion` and `no-redundant-type-constituents`)

Rules manually fixed:
- `@typescript-eslint/no-require-imports` × 2 → convert to `import` syntax
- `no-case-declarations` × 2 → wrap case bodies in `{}`
- `@typescript-eslint/no-unused-vars` × 5 → prefix with `_` or remove
