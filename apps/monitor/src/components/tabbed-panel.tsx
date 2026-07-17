import { useState, useEffect } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

export interface Tab {
  id: string;
  label: string;
  content: ComponentChildren;
}

interface TabbedPanelProps {
  tabs: Tab[];
  storageKey?: string;
  /** Overrides the storage-remembered tab on mount — demo mode's "pinned defaults" (§4.1: right
   *  panel starts on Events so a take never opens on whatever tab a prior manual session left). */
  initialTabId?: string;
}

/**
 * Generic tab container (donor apps/poc-monitor's TabbedPanel pattern,
 * reimplemented in our vocabulary — Preact, terminal.css classes, no
 * migration-domain assumptions). Remembers the active tab per storageKey
 * for the session (sessionStorage — ephemeral UI state, not worth
 * persisting across days the way the workflow selection is).
 */
export function TabbedPanel({ tabs, storageKey, initialTabId }: TabbedPanelProps) {
  const [activeId, setActiveId] = useState<string>(() => {
    if (initialTabId && tabs.some((t) => t.id === initialTabId)) return initialTabId;
    if (storageKey) {
      const saved = sessionStorage.getItem(`dtm-monitor:tab:${storageKey}`);
      if (saved && tabs.some((t) => t.id === saved)) return saved;
    }
    return tabs[0]?.id ?? '';
  });

  useEffect(() => {
    if (storageKey && activeId) {
      sessionStorage.setItem(`dtm-monitor:tab:${storageKey}`, activeId);
    }
  }, [activeId, storageKey]);

  const activeTab = tabs.find((t) => t.id === activeId) ?? tabs[0];

  return (
    <div class="tabbed-panel">
      <div class="tab-header">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            class={`tab-btn ${tab.id === activeTab?.id ? 'active' : ''}`}
            onClick={() => setActiveId(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div class="panel-body tab-body">{activeTab?.content}</div>
    </div>
  );
}
