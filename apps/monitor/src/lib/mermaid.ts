import mermaid from 'mermaid';

let initialized = false;

/** Initialize mermaid exactly once (dark theme, matches the terminal aesthetic). */
function ensureInitialized() {
  if (initialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    securityLevel: 'strict',
    themeVariables: {
      background: '#0d1117',
      primaryColor: '#161b22',
      primaryTextColor: '#c9d1d9',
      primaryBorderColor: '#30363d',
      lineColor: '#58a6ff',
      secondaryColor: '#1c2128',
      tertiaryColor: '#161b22',
    },
  });
  initialized = true;
}

/**
 * Render every `<pre class="mermaid">` element currently in the DOM. Call on
 * mount AND whenever the selected eval changes (mermaid.run() only touches
 * elements it hasn't already processed, so re-selecting the same eval is a
 * cheap no-op; a fresh README's fence gets picked up because it's a new,
 * unprocessed element).
 */
export async function renderMermaidDiagrams(container: HTMLElement | Document = document) {
  ensureInitialized();
  const nodes = container.querySelectorAll<HTMLElement>('pre.mermaid:not([data-processed])');
  if (nodes.length === 0) return;
  await mermaid.run({ nodes: Array.from(nodes) });
}
