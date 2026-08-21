/**
 * Splits a Setpoint Eval README's raw markdown into two buckets by its `## ` (H2) headings —
 * the D4 hygiene fix (ux-storyboards.md §3.5): "Artifacts" and "Run" carry raw shell/JSON
 * (verify_step_status, run-all.sh, step-snapshot dumps) that reads as harness/eval-authoring
 * exposition, exactly what plan D4 bans from pitched surfaces. Everything else (Metadata,
 * Scenario, Architecture, Test Data, Payload, **Assertions**) stays in the visible main flow —
 * Assertions in particular stays a normal, always-visible styled checklist per spec, it is
 * NOT pulled into the technical bucket even though it sits between Artifacts and Run in most
 * READMEs (workflows/order-processing/setpoint-evals/SE-04.../README.md's own heading order).
 *
 * Deliberately splits the RAW markdown (not the rendered HTML) — a heading-name match on `## `
 * lines is unambiguous and heading-level safe (`^##\s+` never matches `### `), whereas
 * re-parsing already-sanitized HTML for section boundaries would be far more fragile.
 */

export interface ReadmeSections {
  /** Everything except the technical sections, in original document order. Always visible. */
  main: string;
  /** Artifacts + Run, concatenated in original relative order. Collapsed by default (§3.5). */
  technical: string;
  hasTechnical: boolean;
}

const TECHNICAL_HEADINGS = new Set(['artifacts', 'run']);
const H2_HEADING = /^##\s+(.+?)\s*$/;

export function splitReadmeSections(markdown: string): ReadmeSections {
  const lines = markdown.split('\n');
  const sections: Array<{ heading: string | null; lines: string[] }> = [{ heading: null, lines: [] }];

  for (const line of lines) {
    const match = H2_HEADING.exec(line);
    if (match) {
      sections.push({ heading: match[1], lines: [line] });
    } else {
      sections[sections.length - 1].lines.push(line);
    }
  }

  const mainParts: string[] = [];
  const technicalParts: string[] = [];
  for (const section of sections) {
    const isTechnical = section.heading != null && TECHNICAL_HEADINGS.has(section.heading.trim().toLowerCase());
    (isTechnical ? technicalParts : mainParts).push(section.lines.join('\n'));
  }

  const technical = technicalParts.join('\n').trim();
  return {
    main: mainParts.join('\n').trim(),
    technical,
    hasTechnical: technical.length > 0,
  };
}
