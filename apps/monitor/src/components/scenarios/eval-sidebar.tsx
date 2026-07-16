import { useMemo, useState } from 'preact/hooks';
import { EvalSuite, EvalSummary, SUITE_LABELS, SUITE_ORDER } from '../../types/evals';
import { colorForCategory } from '../../lib/category-colors';

interface EvalSidebarProps {
  evals: EvalSummary[];
  selected: EvalSummary | null;
  onSelect: (evalItem: EvalSummary) => void;
}

export function EvalSidebar({ evals, selected, onSelect }: EvalSidebarProps) {
  const [suite, setSuite] = useState<EvalSuite | 'all'>('all');
  const [category, setCategory] = useState<string | null>(null);
  const [filterText, setFilterText] = useState('');

  const suiteCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of evals) counts[e.suite] = (counts[e.suite] ?? 0) + 1;
    return counts;
  }, [evals]);

  const suiteScoped = useMemo(
    () => (suite === 'all' ? evals : evals.filter((e) => e.suite === suite)),
    [evals, suite],
  );

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const e of suiteScoped) if (e.category) set.add(e.category);
    return Array.from(set).sort();
  }, [suiteScoped]);

  const filtered = useMemo(() => {
    const needle = filterText.trim().toLowerCase();
    return suiteScoped.filter((e) => {
      if (category && e.category !== category) return false;
      if (!needle) return true;
      return e.id.toLowerCase().includes(needle) || e.name.toLowerCase().includes(needle);
    });
  }, [suiteScoped, category, filterText]);

  return (
    <div class="scenarios-sidebar">
      <div class="suite-tabs">
        <button
          class={`suite-tab ${suite === 'all' ? 'active' : ''}`}
          onClick={() => {
            setSuite('all');
            setCategory(null);
          }}
        >
          All<span class="count">{evals.length}</span>
        </button>
        {SUITE_ORDER.map((s) => (
          <button
            key={s}
            class={`suite-tab ${suite === s ? 'active' : ''}`}
            onClick={() => {
              setSuite(s);
              setCategory(null);
            }}
          >
            {SUITE_LABELS[s]}
            <span class="count">{suiteCounts[s] ?? 0}</span>
          </button>
        ))}
      </div>

      <div class="scenarios-filter">
        <input
          type="text"
          placeholder="Filter by id or name..."
          value={filterText}
          onInput={(e) => setFilterText((e.target as HTMLInputElement).value)}
        />
      </div>

      {categories.length > 0 && (
        <div class="category-chips">
          {categories.map((c) => {
            const color = colorForCategory(c);
            const active = category === c;
            return (
              <span
                key={c}
                class={`category-chip ${active ? 'active' : ''}`}
                style={
                  active
                    ? { background: color, borderColor: color }
                    : { color, borderColor: color }
                }
                onClick={() => setCategory(active ? null : c)}
              >
                {c}
              </span>
            );
          })}
        </div>
      )}

      <div class="eval-list">
        {filtered.length === 0 && <div class="eval-list-empty">No evals match this filter.</div>}
        {filtered.map((e) => (
          <div
            key={`${e.suite}/${e.id}`}
            class={`eval-list-item ${selected?.suite === e.suite && selected?.id === e.id ? 'selected' : ''}`}
            onClick={() => onSelect(e)}
          >
            {!e.hasReadme && (
              <span class="no-readme-warning" title="No README.md">
                ⚠
              </span>
            )}
            <span class="eval-id">{e.id}</span>
            <span class="eval-name">{e.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
