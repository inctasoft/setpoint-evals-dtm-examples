// Deterministic workflow-name -> accent-color mapping, same hashing approach as
// lib/category-colors.ts. Deliberately EXCLUDES --red (#f85149) — that color is
// reserved workspace-wide for failure/error state (status.failed, step-icon.failed,
// log-type.step_failed, ...); an accent bar that happened to land on red for some
// workflow name would read as "this workflow failed" even when nothing did.
const PALETTE = ['#58a6ff', '#3fb950', '#d29922', '#bc8cff', '#56d4dd', '#d18616'];

export function colorForWorkflow(workflow: string | null | undefined): string {
  if (!workflow) return '#8b949e'; // --text-dim fallback for "All" / unknown
  let hash = 0;
  for (let i = 0; i < workflow.length; i++) {
    hash = (hash * 31 + workflow.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}
