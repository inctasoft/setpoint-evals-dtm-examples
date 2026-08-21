import { marked } from 'marked';
import DOMPurify from 'dompurify';

// GFM task-list checkboxes as literal ballot-box glyphs, not <input> elements —
// simpler than allowlisting form controls through DOMPurify, and the README
// convention (docs/setpoint-eval-conventions.md) already treats them as
// plain text markers ('- [ ]' / '- [x]'), never as interactive checkboxes.
const CHECKBOX_UNCHECKED = /^(\s*[-*])\s\[ \]\s+/gm;
const CHECKBOX_CHECKED = /^(\s*[-*])\s\[[xX]\]\s+/gm;

marked.setOptions({ gfm: true, breaks: false });

// mermaid fences render as a dedicated <pre class="mermaid"> element (picked up by
// lib/mermaid.ts's mermaid.run()) instead of a plain code block. Other languages keep
// marked's default <pre><code class="language-x"> shape.
marked.use({
  renderer: {
    code({ text, lang }) {
      if (lang === 'mermaid') {
        const escaped = text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        return `<pre class="mermaid">${escaped}</pre>`;
      }
      const langClass = lang ? ` class="language-${lang}"` : '';
      const escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `<pre><code${langClass}>${escaped}</code></pre>`;
    },
  },
});

/**
 * Render a README's markdown to SANITIZED HTML — a real markdown parser
 * (marked, GFM tables/fences/task-lists) piped through DOMPurify, never
 * hand-rolled regex-to-HTML. The caller injects the result via
 * `dangerouslySetInnerHTML` (the only primitive Preact/React offer for
 * pre-rendered HTML) — safe here specifically BECAUSE it has already passed
 * through DOMPurify.
 */
export function renderMarkdown(source: string): string {
  const withCheckboxGlyphs = source
    .replace(CHECKBOX_UNCHECKED, '$1 ☐ ')
    .replace(CHECKBOX_CHECKED, '$1 ☑ ');

  const rawHtml = marked.parse(withCheckboxGlyphs, { async: false }) as string;

  return DOMPurify.sanitize(rawHtml, {
    // mermaid fences render separately (lib/mermaid.ts) via a dedicated
    // <pre class="mermaid"> element the caller inserts — no extra allowlist
    // needed here beyond DOMPurify's own safe HTML default. 'target' is
    // deliberately ABSENT: with it allowed, a raw-HTML `<a target="_blank">` in a README
    // survives without any enforced rel=noopener (reverse tabnabbing); README links open
    // in-tab instead. 'rel' stays (harmless without target, useful for nofollow etc.).
    ALLOWED_ATTR: ['href', 'title', 'class', 'id', 'rel'],
    // <style> survives DOMPurify's defaults via the MathML smuggle
    // (<math><mtext><style>…) — a repo-committed README could otherwise inject CSS into
    // the whole monitor view. Rendered READMEs carry no styles from content, ever.
    FORBID_TAGS: ['style'],
  });
}
