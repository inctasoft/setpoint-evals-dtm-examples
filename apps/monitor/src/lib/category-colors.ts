// Deterministic category -> color mapping. The category vocabulary is open-ended (README
// authors coin new ones per docs/setpoint-eval-conventions.md), so this hashes the string
// into a fixed terminal-theme palette rather than hardcoding every category seen today.
const PALETTE = ['#58a6ff', '#3fb950', '#d29922', '#bc8cff', '#56d4dd', '#d18616', '#f85149'];

export function colorForCategory(category: string | undefined): string {
  if (!category) return '#8b949e'; // --text-dim fallback for uncategorized
  let hash = 0;
  for (let i = 0; i < category.length; i++) {
    hash = (hash * 31 + category.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}
